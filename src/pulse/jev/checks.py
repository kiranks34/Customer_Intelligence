"""Tier-1 deterministic checks. Cheap, run on 100% of records."""

from __future__ import annotations

import re

from ..schema import CheckResult, Enrichment, Mention
from ..study import Study

AMBIGUITY_CUES = re.compile(
    r"\b(not bad|not great|not the best|yeah right|sure,|of course it|thanks a lot|so much for|"
    r"would be great if|if only|supposedly|except|but|however|although|though)\b",
    re.IGNORECASE,
)


def _norm(s: str) -> str:
    s = s.lower().replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s']", " ", s)).strip()


def is_grounded(quote: str, text: str) -> bool:
    q = _norm(quote)
    return bool(q) and q in _norm(text)


def check_evidence_grounded(m: Mention, e: Enrichment) -> CheckResult:
    missing = [a.aspect for a in e.aspects if not is_grounded(a.evidence, m.full_text)]
    return CheckResult(
        name="evidence_grounded",
        passed=not missing,
        severity="hard",
        detail=f"quotes not found in text for: {', '.join(missing)}" if missing else "",
    )


def check_taxonomy_valid(e: Enrichment, study: Study) -> CheckResult:
    invalid = sorted({a.aspect for a in e.aspects} - study.aspect_keys)
    return CheckResult(
        name="taxonomy_valid",
        passed=not invalid,
        severity="hard",
        detail=f"unknown aspects: {', '.join(invalid)}" if invalid else "",
    )


def check_score_range(e: Enrichment) -> CheckResult:
    ok = -1.0 <= e.overall_score <= 1.0
    consistent = (
        e.overall_sentiment in ("mixed", "neutral")
        or (e.overall_sentiment == "positive" and e.overall_score > 0)
        or (e.overall_sentiment == "negative" and e.overall_score < 0)
    )
    return CheckResult(
        name="score_consistent",
        passed=ok and consistent,
        severity="soft",
        detail="" if ok and consistent else f"{e.overall_sentiment} with score {e.overall_score}",
    )


def check_rating_consistency(m: Mention, e: Enrichment) -> CheckResult:
    if m.rating_norm is None:
        return CheckResult(name="rating_consistency", passed=True, severity="soft", detail="no rating")
    high, low = m.rating_norm >= 0.75, m.rating_norm <= 0.25
    conflict = (high and e.overall_sentiment == "negative") or (low and e.overall_sentiment == "positive")
    return CheckResult(
        name="rating_consistency",
        passed=not conflict,
        severity="soft",
        detail=f"rating {m.rating:g} vs text {e.overall_sentiment}" if conflict else "",
    )


def check_ownership_grounded(m: Mention, e: Enrichment) -> CheckResult:
    if e.ownership_months is None:
        return CheckResult(name="ownership_grounded", passed=True, severity="soft")
    ok = e.ownership_months >= 0 and bool(e.ownership_evidence) and is_grounded(e.ownership_evidence, m.full_text)
    return CheckResult(
        name="ownership_grounded",
        passed=ok,
        severity="soft",
        detail="" if ok else "ownership duration has no verbatim evidence",
    )


def check_coverage(m: Mention, e: Enrichment) -> CheckResult:
    long_text = len(m.text.split()) >= 25
    empty = long_text and not e.aspects
    return CheckResult(
        name="coverage",
        passed=not empty,
        severity="soft",
        detail="long mention with no aspects extracted" if empty else "",
    )


def check_ambiguity(m: Mention) -> CheckResult:
    """Info-level: flags linguistically tricky text so it is routed to the judge."""
    cues = sorted({c.group(0).lower() for c in AMBIGUITY_CUES.finditer(m.full_text)})
    return CheckResult(
        name="ambiguity_cues",
        passed=not cues,
        severity="info",
        detail=f"cues: {', '.join(cues)}" if cues else "",
    )


def run_checks(m: Mention, e: Enrichment, study: Study) -> list[CheckResult]:
    return [
        check_evidence_grounded(m, e),
        check_taxonomy_valid(e, study),
        check_score_range(e),
        check_rating_consistency(m, e),
        check_ownership_grounded(m, e),
        check_coverage(m, e),
        check_ambiguity(m),
    ]
