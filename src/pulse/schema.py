"""Canonical data model shared by every pipeline stage."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field

Sentiment = Literal["positive", "negative", "neutral", "mixed"]
AspectSentiment = Literal["positive", "negative", "neutral"]
JourneyStage = Literal[
    "pre_purchase",
    "setup_onboarding",
    "early_use",  # < 1 month of ownership
    "established_use",  # 1-6 months
    "long_term_use",  # > 6 months
    "support_service",
    "churn_return",
    "unknown",
]
Intent = Literal["recommend", "repurchase", "return", "switch_competitor", "warn_others", "none"]
Decision = Literal["accept", "review", "reject"]


def stable_id(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Mention(BaseModel):
    """A single piece of customer voice (review, comment, post, ticket)."""

    id: str
    study_id: str
    source: str
    source_id: str
    url: Optional[str] = None
    product_id: str
    brand: Optional[str] = None
    author_hash: Optional[str] = None
    verified_purchase: Optional[bool] = None
    posted_at: datetime
    rating: Optional[float] = None
    rating_norm: Optional[float] = Field(None, description="Rating scaled to 0-1")
    title: str = ""
    text: str
    language: str = "en"
    region: Optional[str] = None
    text_hash: str
    also_seen_on: list[str] = Field(default_factory=list)
    ingested_at: datetime = Field(default_factory=utcnow)

    @property
    def full_text(self) -> str:
        return f"{self.title}\n{self.text}".strip()


# --- LLM extraction output --------------------------------------------------
# Kept free of numeric range constraints so it maps cleanly onto structured
# outputs; ranges are enforced by Jev instead.


class AspectLabel(BaseModel):
    aspect: str = Field(description="An aspect key from the study taxonomy")
    sentiment: AspectSentiment
    evidence: str = Field(description="Verbatim quote from the mention supporting this label")


class Extraction(BaseModel):
    overall_sentiment: Sentiment
    overall_score: float = Field(description="-1.0 (very negative) to 1.0 (very positive)")
    aspects: list[AspectLabel]
    journey_stage: JourneyStage
    ownership_months: Optional[float] = Field(
        None, description="How long the author has owned/used the product, in months, if stated"
    )
    ownership_evidence: Optional[str] = Field(None, description="Verbatim quote stating ownership duration")
    use_case: Optional[str] = None
    persona: Optional[str] = None
    pain_points: list[str]
    needs: list[str]
    touchpoints: list[str]
    intent: Intent
    competitors: list[str]
    trust_flags: list[str] = Field(description="e.g. incentivized, spam, off_topic, not_a_customer")
    summary: str = Field(description="One sentence, neutral tone")


class Enrichment(Extraction):
    mention_id: str
    extractor: str
    model: Optional[str] = None
    prompt_version: str
    created_at: datetime = Field(default_factory=utcnow)


# --- Jev ---------------------------------------------------------------------


class CheckResult(BaseModel):
    name: str
    passed: bool
    severity: Literal["hard", "soft", "info"] = "soft"
    detail: str = ""


class JudgeOpinion(BaseModel):
    """Output of the Tier-2 LLM judge."""

    overall_agrees: bool
    corrected_overall_sentiment: Optional[Sentiment] = None
    disputed_aspects: list[str] = Field(description="Aspect keys whose label is not supported by the text")
    is_relevant: bool = Field(description="False if off-topic/spam/not about the product")
    rationale: str


class Verdict(BaseModel):
    mention_id: str
    verifier: str
    decision: Decision
    confidence: float
    checks: list[CheckResult]
    judge: Optional[JudgeOpinion] = None
    created_at: datetime = Field(default_factory=utcnow)
