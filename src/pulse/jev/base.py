from __future__ import annotations

from typing import Protocol

from ..schema import Enrichment, Mention, Verdict
from ..study import Study


class Verifier(Protocol):
    """Any verification/decision model. The existing Jev implementation can plug in here."""

    name: str

    def verify(self, mention: Mention, enrichment: Enrichment, study: Study) -> Verdict: ...
