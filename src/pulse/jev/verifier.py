"""Jev decision policy: combine Tier-1 checks with the optional Tier-2 judge."""

from __future__ import annotations

from typing import Optional

from ..schema import Enrichment, Mention, Verdict
from ..study import Study
from .checks import run_checks
from .judge import Judge

PENALTY = {"hard": 0.4, "soft": 0.15, "info": 0.0}
REJECT_FLAGS = {"spam", "off_topic"}


def in_audit_sample(mention_id: str, rate: float) -> bool:
    """Deterministic, so re-runs pick the same audit sample."""
    return int(mention_id[:8], 16) % 10_000 < rate * 10_000


class JevVerifier:
    name = "jev-v1"

    def __init__(self, judge: Optional[Judge] = None):
        self.judge = judge

    def verify(self, mention: Mention, enrichment: Enrichment, study: Study) -> Verdict:
        checks = run_checks(mention, enrichment, study)
        failed = [c for c in checks if not c.passed]
        hard_fail = any(c.severity == "hard" for c in failed)
        confidence = max(0.0, 1.0 - sum(PENALTY[c.severity] for c in failed))

        if REJECT_FLAGS & set(enrichment.trust_flags):
            return Verdict(mention_id=mention.id, verifier=self.name, decision="reject", confidence=confidence, checks=checks)

        needs_judge = bool(failed) or in_audit_sample(mention.id, study.jev.audit_sample_rate)
        opinion = None
        if needs_judge and self.judge is not None and study.jev.use_llm_judge:
            opinion = self.judge.judge(mention, enrichment, study)
            if not opinion.is_relevant:
                return Verdict(
                    mention_id=mention.id, verifier=self.name, decision="reject",
                    confidence=confidence, checks=checks, judge=opinion,
                )
            if opinion.overall_agrees and not opinion.disputed_aspects:
                confidence = min(1.0, confidence + 0.25)
            else:
                confidence = max(0.0, confidence - 0.3)

        if hard_fail:
            decision = "review"
        elif opinion is not None and (not opinion.overall_agrees or opinion.disputed_aspects):
            decision = "review"
        else:
            decision = "accept" if confidence >= study.jev.accept_threshold else "review"

        return Verdict(
            mention_id=mention.id, verifier=self.name, decision=decision,
            confidence=round(confidence, 3), checks=checks, judge=opinion,
        )
