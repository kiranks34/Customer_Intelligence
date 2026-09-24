"""Claude-based aspect/evidence extraction via structured outputs."""

from __future__ import annotations

import json
from typing import Any, Optional

from ..schema import Enrichment, Extraction, Mention
from ..study import Study

PROMPT_VERSION = "extract-v1"
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class EnrichmentError(RuntimeError):
    pass


def build_system_prompt(study: Study) -> str:
    """Stable per study, so it is prompt-cached across every mention."""
    aspects = "\n".join(f"- {a.key}: {a.description}" for a in study.aspects)
    products = "\n".join(
        f"- {p.id}: {p.name} by {p.brand}{' (competitor)' if p.is_competitor else ''}" for p in study.products
    )
    return f"""You analyse customer voice (reviews, comments, posts) for a customer-intelligence platform.
Your labels feed leadership dashboards, so they must be faithful to what the customer actually wrote.

Study: {study.name}
Category: {study.category}
Context: {study.description.strip()}

Products in scope:
{products}

Aspect taxonomy (use only these keys):
{aspects}

How to label:
- overall_sentiment: the author's net stance toward the product. Use "mixed" when clear positives and clear
  negatives both matter to the author. Read negation, sarcasm and contrast carefully ("not bad" is positive;
  "great, another jam" is negative). A star rating is context, not the answer: label the text.
- aspects: one entry per aspect the author actually evaluates. Mentioning a feature without judging it is not
  an evaluation. Every entry needs an evidence quote copied verbatim (exact characters) from the title or text.
  Keep quotes short, the minimal span that supports the label.
- journey_stage: where the author is when writing. early_use < 1 month of ownership, established_use 1-6 months,
  long_term_use > 6 months. Use support_service if the post is mainly about a support interaction,
  churn_return if they returned or abandoned the product, pre_purchase if they do not own it yet.
  Use unknown when the text gives no signal.
- ownership_months: only if the text states or clearly implies a duration; include ownership_evidence verbatim.
- use_case / persona: short phrases (e.g. "shipping labels for Etsy shop", "small e-commerce seller") or null.
- pain_points / needs: short paraphrases in the customer's terms. needs = things they want that are missing.
- touchpoints: channels or moments mentioned (retailer, customer support, packaging, mobile app, docs, ...).
- competitors: other brands or products the author compares against.
- trust_flags: add "incentivized" (free product / discount for review), "off_topic", "spam" or "not_a_customer"
  when applicable; otherwise leave empty.
- summary: one neutral sentence."""


def _user_content(mention: Mention, study: Study) -> str:
    product = study.product(mention.product_id)
    payload = {
        "product": product.name if product else mention.product_id,
        "source": mention.source,
        "posted_at": mention.posted_at.date().isoformat(),
        "rating": None if mention.rating is None else f"{mention.rating:g}",
        "verified_purchase": mention.verified_purchase,
        "title": mention.title,
        "text": mention.text,
    }
    return "Label this mention:\n" + json.dumps(payload, ensure_ascii=False, indent=2)


def call_structured(
    client: Any, study: Study, system: str, user: str, output_type: type, max_tokens: int = 16000
) -> Any:
    """One structured-output call with refusal fallbacks and prompt caching."""
    kwargs: dict[str, Any] = dict(
        model=study.llm.model,
        max_tokens=max_tokens,
        system=system,
        cache_control={"type": "ephemeral"},
        messages=[{"role": "user", "content": user}],
        output_format=output_type,
        betas=[FALLBACK_BETA],
        fallbacks="default",
    )
    if study.llm.effort:
        kwargs["output_config"] = {"effort": study.llm.effort}
    response = client.beta.messages.parse(**kwargs)
    if response.stop_reason == "refusal":
        raise EnrichmentError("model declined the request (refusal)")
    if response.stop_reason == "max_tokens":
        raise EnrichmentError("output truncated at max_tokens")
    if response.parsed_output is None:
        raise EnrichmentError(f"no parsed output (stop_reason={response.stop_reason})")
    return response


class ClaudeEnricher:
    name = "claude"
    prompt_version = PROMPT_VERSION

    def __init__(self, client: Optional[Any] = None):
        if client is None:
            import anthropic

            client = anthropic.Anthropic()
        self.client = client
        self._system_cache: dict[str, str] = {}

    def enrich(self, mention: Mention, study: Study) -> Enrichment:
        system = self._system_cache.setdefault(study.id, build_system_prompt(study))
        response = call_structured(self.client, study, system, _user_content(mention, study), Extraction)
        extraction: Extraction = response.parsed_output
        return Enrichment(
            **extraction.model_dump(),
            mention_id=mention.id,
            extractor=self.name,
            model=getattr(response, "model", study.llm.model),
            prompt_version=self.prompt_version,
        )
