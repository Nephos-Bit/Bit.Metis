"""EDHREC slugs: how EDHREC names commanders in its URLs (links to EDHREC pages, deck import)."""

from __future__ import annotations

import re
import unicodedata


def slugify(name: str) -> str:
    """EDHREC slug for a card name: 'Atraxa, Praetors' Voice' -> 'atraxa-praetors-voice'."""
    name = name.split(" // ")[0]  # double-faced cards use the front face
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    name = re.sub(r"['’,.!?:\"]", "", name.lower())
    return re.sub(r"[^a-z0-9]+", "-", name).strip("-")


def commander_slug(commanders: list[str]) -> str:
    """Partner pairs are listed with both slugs in alphabetical order."""
    return "-".join(sorted(slugify(c) for c in commanders if c))
