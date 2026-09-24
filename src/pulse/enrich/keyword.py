"""Keyword/lexicon baseline.

Reproduces the keyword-search approach used in the original social-listening
project. It is the *control* in every evaluation and doubles as an offline
enricher for tests. It is deliberately naive: it cannot handle negation,
sarcasm or contrast well, which is exactly what the evaluation should expose.
"""

from __future__ import annotations

import re

from ..schema import AspectLabel, Enrichment, Mention
from ..study import Study

POSITIVE = {
    "great", "love", "excellent", "perfect", "easy", "crisp", "sharp", "fast", "reliable",
    "recommend", "amazing", "good", "works", "worth", "happy", "best", "clear", "quick", "durable",
}
NEGATIVE = {
    "bad", "terrible", "awful", "hate", "broke", "broken", "slow", "jam", "jams", "faded",
    "blurry", "disconnect", "disconnects", "nightmare", "useless", "return", "returned", "refund",
    "worst", "poor", "crash", "crashes", "stopped", "died", "expensive", "smudge", "fails", "junk",
}
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "a": 1, "an": 1}
OWNERSHIP_RE = re.compile(
    r"\b(?:after|for|owned[^.]*?for|using[^.]*?for|had (?:it|this|mine)[^.]*?for)\s+"
    r"(\d+|one|two|three|four|five|six|a|an)\s+(week|month|year)s?\b",
    re.IGNORECASE,
)


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def _score(sentence: str) -> int:
    words = re.findall(r"[a-z']+", sentence.lower())
    return sum(w in POSITIVE for w in words) - sum(w in NEGATIVE for w in words)


def _label(score: int) -> str:
    return "positive" if score > 0 else "negative" if score < 0 else "neutral"


class KeywordEnricher:
    name = "keyword_baseline"
    prompt_version = "keyword-v1"

    def enrich(self, mention: Mention, study: Study) -> Enrichment:
        text = mention.full_text
        sentences = _sentences(text)
        aspects: list[AspectLabel] = []
        for aspect in study.aspects:
            for s in sentences:
                if any(k in s.lower() for k in aspect.keywords):
                    aspects.append(AspectLabel(aspect=aspect.key, sentiment=_label(_score(s)), evidence=s))
                    break

        total = sum(_score(s) for s in sentences)
        pos = any(_score(s) > 0 for s in sentences)
        neg = any(_score(s) < 0 for s in sentences)
        overall = "mixed" if pos and neg and abs(total) <= 1 else _label(total)

        months, evidence = None, None
        if m := OWNERSHIP_RE.search(text):
            n = int(m.group(1)) if m.group(1).isdigit() else NUMBER_WORDS[m.group(1).lower()]
            months = {"week": n / 4.345, "month": n, "year": n * 12}[m.group(2).lower()]
            evidence = m.group(0)

        stage = "unknown"
        if months is not None:
            stage = "early_use" if months < 1 else "established_use" if months <= 6 else "long_term_use"
        elif re.search(r"\b(set ?up|unbox|out of the box)\b", text, re.I):
            stage = "setup_onboarding"

        return Enrichment(
            mention_id=mention.id,
            extractor=self.name,
            model=None,
            prompt_version=self.prompt_version,
            overall_sentiment=overall,
            overall_score=max(-1.0, min(1.0, total / 3)),
            aspects=aspects,
            journey_stage=stage,
            ownership_months=months,
            ownership_evidence=evidence,
            pain_points=[a.evidence for a in aspects if a.sentiment == "negative"],
            needs=[],
            touchpoints=[],
            intent="return" if re.search(r"\breturn(ed|ing)?\b", text, re.I) else "none",
            competitors=[p.name for p in study.products if p.id != mention.product_id and p.name.lower() in text.lower()],
            trust_flags=[],
            summary=sentences[0][:200] if sentences else "",
        )
