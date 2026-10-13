"""Card search by description for the phone app: a language model turns "what the card should do" into Scryfall
search syntax; the phone then asks Scryfall itself. The one AI feature the owner asked for on purpose (2026-10-13).

The model is Claude, reached through the Claude API's Messages endpoint (``POST /v1/messages``) with an API key
from the Claude Console. The key lives only on the sync server: set in the phone's settings (stored in the server's
SQLite) or by environment (``MTG_AI_KEY``, ``MTG_AI_MODEL``; these win; ``MTG_AI_URL`` only points tests at a fake
server). Raw HTTP with the standard library (``urllib``), because the server image installs the package without
extra dependencies.

Colour identity and card type are not left to the model: ``compose()`` adds them as fixed filters
(``id<=…``, ``t:…``) plus ``f:commander``.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Callable

DEFAULT_URL = "https://api.anthropic.com/v1"
DEFAULT_MODEL = "claude-haiku-5-5"  # the small, cheap one is enough for turning a sentence into a query
# What the phone offers, cheapest first. ``think`` = the request fields that keep thinking (and its tokens) small:
# Haiku turns it off, Sonnet 5.5 rejects "disabled" and uses "between_tools", Opus 5.5 can't turn it off – low effort.
MODELS = {
    "claude-haiku-5-5": {"label": "Claude Haiku 5.5", "note": "Schnell und günstig – reicht fast immer",
                         "cost": "≈ 0,03 Cent pro Suche", "think": {"thinking": {"type": "disabled"}}},
    "claude-sonnet-5-5": {"label": "Claude Sonnet 5.5", "note": "Genauer bei verzwickten Beschreibungen",
                          "cost": "≈ 0,5 Cent pro Suche", "think": {"thinking": {"type": "between_tools"}}},
    "claude-opus-5-5": {"label": "Claude Opus 5.5", "note": "Am gründlichsten, aber langsamer",
                        "cost": "≈ 2 Cent pro Suche", "think": {"output_config": {"effort": "low"}}},
}  # fmt: skip
API_VERSION = "2023-06-01"
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
    """The effective settings: environment first, then what was set in the app (key, model), then the defaults."""
    stored = stored or {}
    key = os.environ.get("MTG_AI_KEY") or stored.get("key") or ""
    return {
        "key": key,
        "model": os.environ.get("MTG_AI_MODEL") or stored.get("model") or DEFAULT_MODEL,
        "url": (os.environ.get("MTG_AI_URL") or DEFAULT_URL).rstrip("/"),
        "from_env": bool(os.environ.get("MTG_AI_KEY")),
    }


def public(cfg: dict[str, Any]) -> dict[str, Any]:
    """What a device may see: never the key itself."""
    key = cfg["key"]
    return {"configured": bool(key), "model": cfg["model"], "from_env": cfg["from_env"],
            "key_hint": f"…{key[-4:]}" if len(key) >= 8 else "",
            "models": [{"id": k, **{f: m[f] for f in ("label", "note", "cost")}} for k, m in MODELS.items()]}  # fmt: skip


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


def ask_model(cfg: dict[str, Any], text: str) -> str:
    """One Claude message with the search prompt; the answer's text."""
    think = MODELS.get(cfg["model"], {}).get("think", {})  # another model (set by environment): its defaults
    body = json.dumps({"model": cfg["model"], "max_tokens": 4096, "system": PROMPT, **think,
                       "messages": [{"role": "user", "content": text}]}).encode()  # fmt: skip
    req = urllib.request.Request(f"{cfg['url']}/messages", data=body, method="POST", headers={
        "x-api-key": cfg["key"], "anthropic-version": API_VERSION, "content-type": "application/json",
        "accept": "application/json", "user-agent": USER_AGENT})  # fmt: skip
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise SearchError("Der Claude-API-Schlüssel wird nicht angenommen – in den Einstellungen prüfen.", 502) from None
        if exc.code == 402:
            raise SearchError("Die Claude Console meldet: kein Guthaben – unter „Billing“ aufladen.", 402) from None
        if exc.code == 429:
            raise SearchError("Das Limit deines Claude-API-Kontos ist gerade erreicht – später noch einmal.", 429) from None
        if exc.code == 404:
            raise SearchError(f"Das Modell „{cfg['model']}“ gibt es nicht – in den Einstellungen ändern.", 502) from None
        if exc.code in (500, 529):
            raise SearchError("Claude ist gerade überlastet – gleich noch einmal.", 503) from None
        raise SearchError(f"Die KI antwortet mit Fehler {exc.code}.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise SearchError("Die KI ist gerade nicht erreichbar.", 504) from None
    except ValueError:
        raise SearchError("Unerwartete Antwort der KI.") from None
    if not isinstance(data, dict) or not isinstance(data.get("content"), list):
        raise SearchError("Unerwartete Antwort der KI.")
    if data.get("stop_reason") == "refusal":
        raise SearchError("Dazu liefert die KI keine Suche – bitte anders beschreiben.")
    return "".join(b.get("text", "") for b in data["content"] if isinstance(b, dict) and b.get("type") == "text")


# Words that don't change what a description asks for. Negations ("nicht", "kein", "ohne", "not", "no") stay.
_FILLER = set("""der die das den dem des ein eine einen einem einer eines und wenn wann sobald dann ich du er sie es wir
    mir mich mein meine meinen meinem meiner meines dein deine sich soll sollte sollen kann könnte will möchte bitte
    etwas mal so also irgendwie gerne immer jede jeder jedes jedem jeden
    a an the and i my me you your it its is are be that which when whenever then should can could would will please
    some any""".split())  # fmt: skip


def _stem(word: str) -> str:
    """A rough stem so "zieht", "ziehe" and "ziehen" or "Karte" and "Karten" meet; short words stay as they are."""
    if len(word) > 4:
        for end in ("en", "er", "es", "st", "e", "t", "n", "s"):
            if word.endswith(end):
                return word[: -len(end)]
    return word


def _gist(text: str) -> str:
    """The words of a description without case, punctuation, order, filler words and endings."""
    words = re.findall(r"[\w+/-]+", str(text or "").lower()[:MAX_TEXT])
    return " ".join(sorted({_stem(w) for w in words if w not in _FILLER}))


def cache_key(text: str, cfg: dict[str, Any]) -> str:
    """The same description – also reworded, as long as the same words remain – with the same model and prompt
    = one answer. Colours and types are not part of it: ``finish()`` adds them, so changing them costs nothing."""
    return hashlib.sha256("\n".join([_gist(text), cfg["model"], PROMPT]).encode()).hexdigest()


def translate(text: str, cfg: dict[str, Any], ask: Callable[[dict[str, Any], str], str] = ask_model) -> dict[str, Any]:
    """A description → the model's ``{query, broader, explain}`` without the fixed filters (what gets cached)."""
    text = " ".join(str(text or "").split())[:MAX_TEXT]
    if len(text) < 3:
        raise SearchError("Beschreib kurz, was die Karte tun soll.", 400)
    if not cfg.get("key"):
        raise SearchError("Die KI-Kartensuche ist noch nicht eingerichtet – Einstellungen → Suche mit KI.", 409)
    got = _json_from(ask(cfg, text))
    query, broader = clean_query(got.get("query")), clean_query(got.get("broader"))
    if not query and not broader:
        raise SearchError("Die KI hat keine Suche geliefert – bitte anders beschreiben.")
    return {"query": query or broader, "broader": broader, "explain": str(got.get("explain") or "")[:200]}


def finish(raw: dict[str, Any], colors: list[str] | None, types: list[str] | None, *, cached: bool = False) -> dict[str, Any]:
    """The model's answer plus colour identity, types and ``f:commander``."""
    full = compose(raw.get("query") or "", colors, types)
    wide = compose(raw["broader"], colors, types) if raw.get("broader") else ""
    return {"query": full, "broader": wide if wide != full else "", "explain": raw.get("explain") or "", "cached": cached}


def describe(text: str, colors: list[str] | None, types: list[str] | None, cfg: dict[str, Any],
             ask: Callable[[dict[str, Any], str], str] = ask_model) -> dict[str, Any]:  # fmt: skip
    """A description → ``{query, broader, explain, cached}`` (both queries with the fixed filters), uncached."""
    return finish(translate(text, cfg, ask), colors, types)
