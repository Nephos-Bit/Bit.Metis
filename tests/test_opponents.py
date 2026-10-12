"""Opponent decks ("Gegnerdecks"): commander + observations, linked from the game log, used in prompts."""

from __future__ import annotations

from conftest import deck_lines
from fastapi.testclient import TestClient

from mtgdeck import games, opponents, storage
from mtgdeck.gui import app as gui

ATRAXA = "Atraxa, Praetors' Voice"


def _deck(name: str = "Meren Test", **extra) -> str:
    storage.save({"name": name, "commanders": ["Meren of Clan Nel Toth"], "bracket": 3, "currency": "eur",
                  "cards": [{"name": ln.split(" ", 1)[1], "qty": int(ln.split(" ", 1)[0])} for ln in deck_lines()], **extra})  # fmt: skip
    return storage.slug(name)


async def test_create_update_notes_and_delete():
    o = await opponents.create(["atraxa, praetors' voice"], label="Tims Atraxa", player="Tim", tags=["combo", "nope", "wipes"],
                               bracket=4, note="Gewinnt mit Doubling Season")  # fmt: skip
    assert o["commanders"] == [ATRAXA] and o["tags"] == ["combo", "wipes"] and o["bracket"] == 4
    assert o["color_identity"] == ["W", "U", "B", "G"] and o["image"]
    assert opponents.title(o) == f"Tims Atraxa ({ATRAXA})"
    o = await opponents.update(o["id"], add_note="Viele Counter", tags=["counters"], bracket=None)
    assert [n["text"] for n in o["notes"]] == ["Gewinnt mit Doubling Season", "Viele Counter"]
    assert o["tags"] == ["counters"] and o["bracket"] is None
    o = await opponents.update(o["id"], remove_note=o["notes"][0]["id"])
    assert len(o["notes"]) == 1
    o = await opponents.update(o["id"], commanders=[ATRAXA, "Krenko, Mob Boss"], label="Tims Partner")  # a partner adds its colours
    assert o["commanders"] == [ATRAXA, "Krenko, Mob Boss"] and o["color_identity"] == ["W", "U", "B", "R", "G"]
    o = await opponents.update(o["id"], commanders=[ATRAXA])
    assert o["color_identity"] == ["W", "U", "B", "G"] and o["label"] == "Tims Partner"
    try:
        await opponents.create(["Gibt es nicht"])
        raise AssertionError("unknown commander accepted")
    except ValueError as exc:
        assert "nicht gefunden" in str(exc)
    assert [d["slug"] for d in storage.list_decks()] == []  # decks/.opponents.json is not a deck
    opponents.delete(o["id"])
    assert opponents.all_opponents() == []


def test_game_links_opponents_and_records():
    slug = _deck()
    with TestClient(gui.app) as client:
        r = client.post(f"/api/decks/{slug}/games", json={
            "result": "loss", "opponents": ["Atraxa, Praetors' Voice", "", "Krenko, Mob Boss"],
            "opponent_notes": ["Combo in Zug 6", "", ""], "issues": ["combo"]}).json()
        game = r["game"]
        assert game["opponents"] == [ATRAXA, "Krenko, Mob Boss"]
        assert all(game["opponent_ids"])  # both remembered as new opponent decks
        atraxa = opponents.get(game["opponent_ids"][0])
        assert atraxa["notes"][0]["text"] == "Combo in Zug 6" and atraxa["notes"][0]["game_id"] == game["id"]

        # second game: chosen by id, same deck again; no duplicate created
        client.post(f"/api/decks/{slug}/games", json={"result": "win", "opponents": [ATRAXA], "opponent_ids": [atraxa["id"]]})
        # third: typed commander matches the existing deck
        client.post(f"/api/decks/{slug}/games", json={"result": "win", "opponents": [ATRAXA]})
        # without remembering, unknown commanders stay plain names
        client.post(f"/api/decks/{slug}/games", json={"result": "draw", "opponents": ["Sol Ring"], "remember_opponents": False})
        assert client.post(f"/api/decks/{slug}/games", json={"result": "win", "issues": ["bogus"]}).status_code == 400

        data = client.get("/api/opponents").json()
        assert [o["commanders"][0] for o in data["opponents"]] == [ATRAXA, "Krenko, Mob Boss"]
        rec = data["opponents"][0]["record"]
        assert (rec["games"], rec["wins"], rec["losses"]) == (3, 2, 1)
        assert rec["per_deck"][0]["slug"] == slug and rec["history"][0]["result"] == "win"
        assert data["tags"]["combo"] == "Combo"
        assert len(games.games(slug)) == 4


def test_gui_routes():
    with TestClient(gui.app) as client:
        r = client.post("/api/opponents", json={"commanders": ["Krenko, Mob Boss"], "player": "Ana", "tags": ["tokens"], "note": "Sehr schnell"})
        assert r.status_code == 200
        oid = r.json()["id"]
        assert r.json()["tag_labels"] == ["Token-Schwärme"]
        assert client.post("/api/opponents", json={"commanders": []}).status_code == 400
        r = client.patch(f"/api/opponents/{oid}", json={"label": "Anas Goblins", "note": "Krenko + Skirk Prospector"}).json()
        assert r["title"] == "Anas Goblins (Krenko, Mob Boss)" and len(r["notes"]) == 2 and r["player"] == "Ana"
        assert client.get(f"/api/opponents/{oid}").json()["label"] == "Anas Goblins"
        assert client.delete(f"/api/opponents/{oid}").json() == {"deleted": oid}
        assert client.get(f"/api/opponents/{oid}").status_code == 404


async def test_deck_shows_built_against():
    slug = _deck("Meta Deck")
    k = await opponents.create(["Krenko, Mob Boss"], label="Anas Goblins")
    storage.set_extra(slug, "built_against", [k["id"], "gone0000"])
    with TestClient(gui.app) as client:
        deck = client.get(f"/api/decks/{slug}").json()
    assert deck["built_against_info"] == [{"id": k["id"], "title": "Anas Goblins (Krenko, Mob Boss)"}]
