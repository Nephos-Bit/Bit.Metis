"""Blacklist and proxy/budget handling."""

from conftest import deck_lines, save_deck
from fastapi.testclient import TestClient

from mtgdeck import blacklist, storage
from mtgdeck.gui import app as gui
from mtgdeck.validate import validate_deck

MEREN = ["Meren of Clan Nel Toth"]


async def test_blacklist_add_remove_and_file_format():
    r = await blacklist.update(add=["sol ring", "Cultivate", "Nonexistent Card"])
    assert r["added"] == ["Sol Ring", "Cultivate"]  # resolved to Oracle names
    assert r["not_found"] == ["Nonexistent Card"]
    assert blacklist.load() == ["Cultivate", "Sol Ring"]
    text = blacklist.BLACKLIST_FILE.read_text()
    assert text.startswith("#") and "Sol Ring\n" in text

    r = await blacklist.update(remove=["SOL RING"])
    assert r["removed"] == ["SOL RING"]
    assert blacklist.load() == ["Cultivate"]


async def test_blacklisted_card_is_a_validation_error():
    await blacklist.update(add=["Sol Ring"])
    r = await validate_deck(MEREN, deck_lines(), 2)
    assert not r["legal"]
    assert any("Blacklist" in e and "Sol Ring" in e for e in r["errors"])


async def test_budget_warning_and_proxy():
    extra = ["1 Demonic Tutor"]  # everything costs 0.50 in the mock -> ~31 EUR total
    over = await validate_deck(MEREN, deck_lines(extra), 4, budget=10)
    assert any("Budget überschritten" in w for w in over["warnings"])
    assert over["price_total"] > 10

    proxy = await validate_deck(MEREN, deck_lines(extra), 4, budget=10, proxy=True)
    assert not any("Budget" in w for w in proxy["warnings"])
    assert proxy["proxy"] is True and proxy["budget"] is None


async def test_save_deck_stores_proxy_flag():
    cards = [{"name": line.split(" ", 1)[1], "qty": int(line.split(" ", 1)[0])} for line in deck_lines()]
    r = (await save_deck(**{
        "name": "Proxy Deck", "commanders": MEREN, "cards": cards, "bracket": 2, "budget": 5, "proxy": True,
    }))  # fmt: skip
    assert r["proxy"] is True and r["legal"]
    deck = storage.load("proxy-deck")
    assert deck["proxy"] is True and deck["budget"] is None


def test_gui_blacklist_routes():
    client = TestClient(gui.app)
    assert client.post("/api/blacklist", json={"add": ["Sol Ring"]}).json()["added"] == ["Sol Ring"]
    assert client.get("/api/blacklist").json()["cards"] == ["Sol Ring"]
    client.post("/api/blacklist", json={"remove": ["Sol Ring"]})
    assert client.get("/api/blacklist").json()["cards"] == []
