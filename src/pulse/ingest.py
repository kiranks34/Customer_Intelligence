"""Connectors and normalization into the canonical Mention schema."""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator, Protocol

from .schema import Mention, stable_id
from .study import Study

AUTHOR_SALT = os.environ.get("PULSE_AUTHOR_SALT", "pulse-dev-salt")


class Connector(Protocol):
    name: str

    def fetch(self) -> Iterator[dict]: ...


class JsonlConnector:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.name = f"jsonl:{self.path.name}"

    def fetch(self) -> Iterator[dict]:
        with open(self.path) as f:
            for line in f:
                if line.strip():
                    yield json.loads(line)


class CsvConnector:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.name = f"csv:{self.path.name}"

    def fetch(self) -> Iterator[dict]:
        with open(self.path, newline="") as f:
            yield from csv.DictReader(f)


def connector_for(path: str | Path) -> Connector:
    return CsvConnector(path) if str(path).lower().endswith(".csv") else JsonlConnector(path)


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", text.lower())).strip()


def pseudonymize(author: str | None) -> str | None:
    if not author:
        return None
    return hashlib.sha256(f"{AUTHOR_SALT}|{author}".encode()).hexdigest()[:12]


def _parse_dt(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _parse_bool(value) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def to_mention(raw: dict, study: Study) -> Mention:
    source = str(raw["source"])
    source_id = str(raw["source_id"])
    text = str(raw.get("text") or "").strip()
    if not text:
        raise ValueError(f"empty text for {source}:{source_id}")
    product_id = str(raw["product_id"])
    product = study.product(product_id)
    if product is None:
        raise ValueError(f"unknown product_id {product_id!r} for study {study.id}")

    rating = raw.get("rating")
    rating = float(rating) if rating not in (None, "") else None
    scale = float(raw.get("rating_scale") or 5)
    title = str(raw.get("title") or "").strip()

    return Mention(
        id=stable_id(study.id, source, source_id),
        study_id=study.id,
        source=source,
        source_id=source_id,
        url=raw.get("url") or None,
        product_id=product_id,
        brand=product.brand,
        author_hash=pseudonymize(raw.get("author")),
        verified_purchase=_parse_bool(raw.get("verified_purchase")),
        posted_at=_parse_dt(str(raw["posted_at"])),
        rating=rating,
        rating_norm=None if rating is None else round((rating - 1) / (scale - 1), 4),
        title=title,
        text=text,
        language=raw.get("language") or "en",
        region=raw.get("region") or None,
        text_hash=hashlib.sha256(normalize_text(f"{title} {text}").encode()).hexdigest()[:16],
    )


def ingest(records: Iterable[dict], study: Study) -> tuple[list[Mention], list[str]]:
    """Normalize records and collapse syndicated duplicates (same text, different source).

    Returns (mentions, errors).
    """
    by_hash: dict[str, Mention] = {}
    errors: list[str] = []
    for i, raw in enumerate(records):
        try:
            m = to_mention(raw, study)
        except (KeyError, ValueError) as e:
            errors.append(f"record {i}: {e}")
            continue
        key = f"{m.product_id}|{m.text_hash}"
        if key in by_hash:
            first = by_hash[key]
            if m.source != first.source and m.source not in first.also_seen_on:
                first.also_seen_on.append(m.source)
            continue
        by_hash[key] = m
    return list(by_hash.values()), errors
