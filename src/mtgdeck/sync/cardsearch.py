"""Card search by description for the phone app: a language model turns "what the card should do" into Scryfall
search syntax; the phone then asks Scryfall itself. The one AI feature the owner asked for on purpose (2026-10-13).

The model is reached through an OpenAI-compatible ``/chat/completions`` endpoint – by default OpenCode Go
(``https://opencode.ai/inference/go/v1``, API key from the OpenCode console). The key lives only on the sync
server: set in the phone's settings (stored in the server's SQLite) or by environment (``MTG_AI_KEY``,
``MTG_AI_MODEL``, ``MTG_AI_URL``; these win). Standard library only (``urllib``), because the server image installs
the package without httpx.

Colour identity and card type are not left to the model: ``compose()`` adds them as fixed filters
(``id<=…``, ``t:…``) plus ``f:commander``.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
import uuid
from typing import Any, Callable

DEFAULT_URL = "https://opencode.ai/inference/go/v1"
DEFAULT_MODEL = "deepseek-v4-flash"
TIMEOUT = 45
MAX_TEXT = 400
MAX_QUERY = 300
PER_MINUTE = 12  # searches per device and minute
USER_AGENT = "mtgdeckbuilder-cardsearch/1"

COLORS = "WUBRG"
TYPES = {"creature": "Kreatur", "instant": "Spontanzauber", "sorcery": "Hexerei", "artifact": "Artefakt",
         "enchantment": "Verzauberung", "planeswalker": "Planeswalker", "land": "Land", "battle": "Schlacht"}  # fmt: skip

PROMPT = """You turn a short description of a Magic: The Gathering card into one Scryfall search query.
The user plays Commander and writes in German or English. Card texts on Scryfall are English Oracle texts.

Rules:
- Answer with JSON only: {"query": "...", "broader": "...", "explain": "..."}.
- "query": a precise Scryfall query for what the card should DO. Use o:"..." (Oracle text, quote phrases; use ~ for
  the card's own name), o:/regex/ when wording varies, kw: for keywords, otag: for Scryfall's function tags
  (e.g. otag:removal, otag:ramp, otag:draw, otag:tutor, otag:board-wipe, otag:sacrifice-outlet, otag:recursion,
  otag:mana-rock, otag:counterspell), t: for subtypes the user names (t:elf, t:equipment), pow/tou/cmc/mv
  comparisons (mv<=3) when asked, and OR with parentheses for alternatives.
- Do NOT add colour, colour identity, card type or format filters for colours and the card types creature, instant,
  sorcery, artifact, enchantment, planeswalker, land, battle – the app adds those itself.
- "broader": a looser version of the same idea (fewer conditions, otag: instead of exact wording) in case the
  precise one finds nothing.
- "explain": one short German sentence saying what the query looks for.
- Never invent card names. Keep queries short."""


class SearchError(Exception):
    """A German message for the phone; ``status`` is the HTTP status the route answers with."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def config(stored: dict[str, Any] | None = None) -> dict[str, Any]:
    """The effective settings: environment first, then what was set in the app, then the defaults."""
    stored = stored or {}
    key = os.environ.get("MTG_AI_KEY") or stored.get("key") or ""
    return {
        "key": key,
        "model": os.environ.get("MTG_AI_MODEL") or stored.get("model") or DEFAULT_MODEL,
        "url": (os.environ.get("MTG_AI_URL") or stored.get("url") or DEFAULT_URL).rstrip("/"),
        "from_env": bool(os.environ.get("MTG_AI_KEY")),
    }


def public(cfg: dict[str, Any]) -> dict[str, Any]:
    """What a device may see: never the key itself."""
    key = cfg["key"]
    return {"configured": bool(key), "model": cfg["model"], "url": cfg["url"], "from_env": cfg["from_env"],
            "key_hint": f"…{key[-4:]}" if len(key) >= 8 else ""}  # fmt: skip


def clean_query(text: Any) -> str:
    """One line of Scryfall syntax, without filters the app sets itself and without anything else."""
    q = " ".join(str(text or "").split())[:MAX_QUERY]
    q = re.sub(r"(?<![\w\"])-?(?:f|format|legal)[:=]\w+", "", q, flags=re.I)  # the app adds f:commander
    return " ".join(q.split())


def compose(query: str, colors: list[str] | str | None = None, types: list[str] | None = None) -> str:
    """The model's query plus the fixed filters: colour identity (fits into a deck of these colours), types, Commander."""
    parts = [f"({query})" if " or " in query.lower() else query] if query else []
    picked = [c for c in COLORS if c in "".join(colors or []).upper()]
    if colors and "C" in "".join(colors).upper() and not picked:
        parts.append("id:c")
    elif picked:
        parts.append(f"id<={''.join(picked).lower()}")
    kinds = [t for t in (types or []) if t in TYPES]
    if len(kinds) == 1:
        parts.append(f"t:{kinds[0]}")
    elif kinds:
        parts.append("(" + " OR ".join(f"t:{t}" for t in kinds) + ")")
    parts.append("f:commander")
    return " ".join(p for p in parts if p)


def _json_from(text: str) -> dict[str, Any]:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)
    m = re.search(r"\{.*\}", text, flags=re.S)
    if not m:
        raise SearchError("Die KI hat keine Suche geliefert – bitte anders beschreiben.")
    try:
        got = json.loads(m.group(0))
    except ValueError:
        raise SearchError("Die KI hat keine Suche geliefert – bitte anders beschreiben.") from None
    return got if isinstance(got, dict) else {}


def ask_model(cfg: dict[str, Any], messages: list[dict[str, str]]) -> str:
    """One chat completion; the answer's text."""
    body = json.dumps({"model": cfg["model"], "messages": messages, "temperature": 0.2, "max_tokens": 1500}).encode()
    req = urllib.request.Request(f"{cfg['url']}/chat/completions", data=body, method="POST", headers={
        "Authorization": f"Bearer {cfg['key']}", "Content-Type": "application/json", "Accept": "application/json",
        "User-Agent": USER_AGENT, "x-opencode-session": uuid.uuid4().hex})  # fmt: skip
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise SearchError("Der OpenCode-Schlüssel wird nicht angenommen – in den Einstellungen prüfen.", 502) from None
        if exc.code == 402:
            raise SearchError("OpenCode meldet: kein Guthaben. Dieser Schlüssel nutzt dein Pay-as-you-go-Guthaben, "
                              "nicht das Go-Abo – Guthaben aufladen oder einen Go-Schlüssel nehmen.", 402) from None
        if exc.code == 429:
            raise SearchError("Das Nutzungslimit deines OpenCode-Abos ist gerade erreicht – später noch einmal.", 429) from None
        if exc.code == 404:
            raise SearchError(f"Das Modell „{cfg['model']}“ gibt es dort nicht – in den Einstellungen ändern.", 502) from None
        raise SearchError(f"Die KI antwortet mit Fehler {exc.code}.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise SearchError("Die KI ist gerade nicht erreichbar.", 504) from None
    except ValueError:
        raise SearchError("Unerwartete Antwort der KI.") from None
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise SearchError("Unerwartete Antwort der KI.") from None


def describe(text: str, colors: list[str] | None, types: list[str] | None, cfg: dict[str, Any],
             ask: Callable[[dict[str, Any], list[dict[str, str]]], str] = ask_model) -> dict[str, Any]:  # fmt: skip
    """A description → ``{query, broader, explain}`` (both queries with the fixed filters)."""
    text = " ".join(str(text or "").split())[:MAX_TEXT]
    if len(text) < 3:
        raise SearchError("Beschreib kurz, was die Karte tun soll.", 400)
    if not cfg.get("key"):
        raise SearchError("Die KI-Kartensuche ist noch nicht eingerichtet – Einstellungen → Kartensuche mit KI.", 409)
    got = _json_from(ask(cfg, [{"role": "system", "content": PROMPT}, {"role": "user", "content": text}]))
    query, broader = clean_query(got.get("query")), clean_query(got.get("broader"))
    if not query and not broader:
        raise SearchError("Die KI hat keine Suche geliefert – bitte anders beschreiben.")
    full = compose(query or broader, colors, types)
    wide = compose(broader, colors, types) if broader else ""
    return {"query": full, "broader": wide if wide != full else "", "explain": str(got.get("explain") or "")[:200]}
