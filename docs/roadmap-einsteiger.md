# Roadmap: Einsteiger-Features

Stand: 29.09.2026. Ziel: Wer mit Commander anfängt, soll Karten verstehen, sein Deck am Tisch erklären
können und gezielt besser werden. Jede Phase wird einzeln getestet, committet und gepusht.

## Phase A – Karten verstehen

- [x] Glossar (`glossary.py`): Schlüsselwörter und Fähigkeitswörter mit einer Zeile Deutsch
      (Trample, Ward, Cascade, Flash, Convoke, …) plus Commander-Begriffe (Commander-Steuer,
      Farbidentität, Game Changer, Ramp, Removal, Wipe, …); Route `/api/glossary`.
- [x] Kartentext auf Deutsch: `/api/cards/text?name=&lang=de` liefert Oracle-Text, gedruckten deutschen
      Text (sofern es einen deutschen Druck gibt) und die Schlüsselwörter der Karte.
- [x] Große Kartenansicht: Text neben dem Bild (Deutsch/Englisch umschaltbar), Schlüsselwörter mit
      Erklärung beim Hovern/Antippen.
- [x] Glossar-Seite zum Nachschlagen (Suche), erreichbar über Strg+K und die Seitenleiste.

## Phase B – Deck-Check als Ampel

- [x] `health.py`: pro Bereich grün/gelb/rot mit Zahl, Richtwert und „Warum ist das wichtig?“ –
      Länder (abhängig vom Manawert und Ramp), Ramp, Kartenzug, Removal, Board Wipes, Manakurve,
      Siegbedingungen (Kategorie „Win Condition“ oder Combos).
- [x] Deck-Ansicht: Panel „Deck-Check“ oben neben der Kartenliste.
- [x] „Beheben“: Kandidaten für die Rolle ansehen (passend zu den Farben) und in den
      Bearbeiten-Modus übernehmen.

## Phase C – Rule-0-Text

- [x] Rule-0-Text (`rule0.py`) aus der Prüfung: Stufe, Spielweise, Game Changer, Combos,
      Tutoren, Extra Turns, Tempo – zum Kopieren und als Vollbild zum Vorzeigen.
- [x] Tab „Rule 0“; „Drucken / als PDF“ druckt genau eine Seite (Druck-Stylesheet).

## Phase D – Spiele festhalten

- [x] Partien pro Deck (`decks/.games/<slug>.json`): Ergebnis, gegnerische Commander, Zug, Probleme als
      Schnellwahl („zu wenig Länder“, „kein Removal“, „zu langsam“, …), beste Karte, Notiz, Deck-Version.
- [x] Statistik: Siege/Niederlagen, häufigste Probleme, Bilanz pro Version.

## Phase E – Einstieg über Precons

- [x] Precon-Liste von MTGJSON (DeckList + Deck-Dateien, gecacht), Suche nach Name, Set-Kürzel, Jahr
      (die DeckList enthält keine Commander; die zeigt die Vorschau). MTGJSON war aus der Entwicklungsumgebung
      nicht erreichbar – das Format ist nach MTGJSON v5 umgesetzt und defensiv geparst.
- [x] Einstieg „Starterdeck (Precon)“ in „Neues Deck“ → Deck wird importiert und geprüft.

## Zusatz – Deck-Import per Link

- [x] Importer für Archidekt (inkl. Kategorien, ohne Maybe-/Sideboard), Moxfield (v3, dann v2; blockiert →
      Hinweis auf den Text-Export), MTGGoldfish, TappedOut, Deckstats, EDHREC-Durchschnittsdecks; eingefügte Listen.
- [x] Vorschau: Name, Quelle, Kartenzahl, nicht erkannte Karten, Commander-Auswahl (Kandidaten aus der Liste,
      vorausgewählt per Hinweis), Bracket automatisch geschätzt oder gewählt.
- [x] „Neues Deck“: Einstiege Link · Liste einfügen · Starterdeck.
- [x] Die Seiten waren aus der Entwicklungsumgebung nicht erreichbar – Formate nach den öffentlichen Endpunkten
      umgesetzt und defensiv geparst, offline mit Mocks getestet.

## Abschluss

- [x] README und CLAUDE.md.
- [x] Browser-Prüfung aller neuen Abläufe (hell, dunkel, Handy), Tests offline grün.
