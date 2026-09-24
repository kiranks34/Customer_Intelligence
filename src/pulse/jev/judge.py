"""Tier-2 LLM judge: an independent re-read of the mention against the extracted labels."""

from __future__ import annotations

import json
from typing import Any, Optional, Protocol

from ..enrich.claude import call_structured
from ..schema import Enrichment, JudgeOpinion, Mention
from ..study import Study

JUDGE_PROMPT_VERSION = "judge-v1"


class Judge(Protocol):
    def judge(self, mention: Mention, enrichment: Enrichment, study: Study) -> JudgeOpinion: ...


def build_judge_system(study: Study) -> str:
    aspects = "\n".join(f"- {a.key}: {a.description}" for a in study.aspects)
    return f"""You are Jev, the verification reviewer for a customer-intelligence platform.
Another system labelled a customer mention. Decide whether each label is supported by what the customer
actually wrote. Be independent: do not assume the labels are right, and do not nitpick wording.
A label is wrong only if a careful human analyst would disagree with it.

Study: {study.name} ({study.category})
Aspect taxonomy:
{aspects}

Check in particular: negation and sarcasm, mixed reviews collapsed into one polarity, aspects that are only
mentioned rather than evaluated, star rating contradicting the text (label the text), and posts that are not
about the product at all (set is_relevant false).
If the overall sentiment is wrong, give corrected_overall_sentiment. List aspect keys with unsupported labels
in disputed_aspects. Keep the rationale to two sentences."""


class ClaudeJudge:
    def __init__(self, client: Optional[Any] = None):
        if client is None:
            import anthropic

            client = anthropic.Anthropic()
        self.client = client
        self._system_cache: dict[str, str] = {}

    def judge(self, mention: Mention, enrichment: Enrichment, study: Study) -> JudgeOpinion:
        system = self._system_cache.setdefault(study.id, build_judge_system(study))
        labels = {
            "overall_sentiment": enrichment.overall_sentiment,
            "aspects": [a.model_dump() for a in enrichment.aspects],
            "journey_stage": enrichment.journey_stage,
            "ownership_months": enrichment.ownership_months,
        }
        user = (
            "Mention:\n"
            + json.dumps(
                {"rating": mention.rating, "title": mention.title, "text": mention.text}, ensure_ascii=False, indent=2
            )
            + "\n\nLabels to verify:\n"
            + json.dumps(labels, ensure_ascii=False, indent=2)
        )
        return call_structured(self.client, study, system, user, JudgeOpinion, max_tokens=4000).parsed_output
