"""Precons from MTGJSON and the staged upgrade plan."""

import pytest
from fastapi.testclient import TestClient

from mtgdeck import precons, storage
from mtgdeck.gui.app import app


async def test_search_filters_commander_decks():
    items = await precons.search()
    assert [p["file"] for p in items] == ["GraveTroupe_C99", "OldGuard_C98"]  # newest first, no intro packs, broken rows skipped
    assert [p["name"] for p in await precons.search("grave 2024")] == ["Grave Troupe"]
    assert await precons.search("c98") == [items[1]]


async def test_load_and_import():
    p = await precons.load("GraveTroupe_C99")
    assert p["commanders"] == ["Meren of Clan Nel Toth"] and p["card_count"] == 100
    with pytest.raises(ValueError):
        await precons.load("../etc/passwd")
    saved = await precons.import_precon("GraveTroupe_C99")
    deck = storage.load(saved["slug"])
    assert deck["bracket"] == 2 and deck["precon"]["code"] == "C99" and deck["validation"]["stats"]["card_count"] == 99 and deck["validation"]["legal"]
    cats = {c["name"]: c["category"] for c in deck["cards"]}
    assert cats["Forest"] == "Land" and cats["Cultivate"] == "Ramp"
    assert deck["history"][0]["note"] == "Importiert: Precon „Grave Troupe“"
    again = await precons.import_precon("GraveTroupe_C99")
    assert again["slug"] != saved["slug"]  # a second import does not overwrite the first


def test_routes():
    client = TestClient(app)
    assert client.get("/api/precons", params={"q": "old"}).json()[0]["code"] == "C98"
    p = client.get("/api/precons/GraveTroupe_C99").json()
    assert p["commander_images"]["Meren of Clan Nel Toth"]
    assert client.get("/api/precons/Missing_X").status_code == 404
    r = client.post("/api/precons/import", json={"file": "GraveTroupe_C99"})
    assert r.status_code == 200 and client.get(f"/api/decks/{r.json()['slug']}").json()["precon"]["name"] == "Grave Troupe"
