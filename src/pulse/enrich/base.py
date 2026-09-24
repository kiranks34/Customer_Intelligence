from __future__ import annotations

from typing import Protocol

from ..schema import Enrichment, Mention
from ..study import Study


class Enricher(Protocol):
    name: str

    def enrich(self, mention: Mention, study: Study) -> Enrichment: ...
