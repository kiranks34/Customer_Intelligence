"""Study configuration: everything product/brand/industry specific lives here."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel, Field


class Aspect(BaseModel):
    key: str
    description: str
    keywords: list[str] = Field(default_factory=list, description="Used by the keyword baseline only")


class Product(BaseModel):
    id: str
    name: str
    brand: str
    is_competitor: bool = False


class JevConfig(BaseModel):
    accept_threshold: float = 0.7
    audit_sample_rate: float = 0.1
    use_llm_judge: bool = True


class LLMConfig(BaseModel):
    model: str = "claude-opus-5"
    effort: Optional[str] = Field(None, description="low|medium|high|xhigh|max; None = API default")


class AlertConfig(BaseModel):
    min_weekly_volume: int = 5
    z_threshold: float = 2.0
    min_share_jump: float = 0.15


class Study(BaseModel):
    id: str
    name: str
    description: str
    category: str
    regions: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=lambda: ["en"])
    products: list[Product]
    aspects: list[Aspect]
    sources: list[dict] = Field(default_factory=list)
    jev: JevConfig = Field(default_factory=JevConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    alerts: AlertConfig = Field(default_factory=AlertConfig)

    @property
    def aspect_keys(self) -> set[str]:
        return {a.key for a in self.aspects}

    def product(self, product_id: str) -> Optional[Product]:
        return next((p for p in self.products if p.id == product_id), None)


def load_study(path: str | Path) -> Study:
    with open(path) as f:
        return Study.model_validate(yaml.safe_load(f))
