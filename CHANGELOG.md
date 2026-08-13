# Changelog

Jeder Eintrag hier ist **Voraussetzung fürs Release-CI**, nicht nur Doku: Ein
Tag-Push (`app-v*` für Stable, der rollierende `nightly-latest` für Nightly)
löst `tools/changelog-gate/check.py` aus, das den Eintrag ganz oben gegen den
echten `git diff` seit dem letzten Kanal-Tag prüft — fehlt ein betroffenes
Modul in `coverage`, oder passt `diff_hash` nicht mehr zum tatsächlichen
Diff (weil seither neuer Code dazukam), schlägt der Release-Build fehl.
Kein Autogenerator: der Freitext muss inhaltlich geschrieben werden.
Mechanismus und Begründung: `docs/decisions.md` → "Auto-Update via GitHub
Releases", Punkt 5.

## Format

```
## [X.Y.Z] - JJJJ-MM-TT
---
coverage:
  - modul-a
  - modul-b
diff_hash: <von check.py berechneter sha256-Hex-Digest>
---
Freitext-Beschreibung der Änderungen seit dem letzten Release dieses Kanals.
```

- `coverage` muss **jedes** Modul enthalten, das der reale Diff seit dem
  letzten Tag dieses Kanals berührt (Pfad→Modul-Mapping:
  `tools/changelog-gate/module_map.json`; ein noch nicht gemappter Pfad wird
  automatisch sein eigenes Ad-hoc-Modul und muss trotzdem abgedeckt sein).
- `diff_hash` wird nicht von Hand geschrieben — `check.py` gibt ihn bei einem
  Fehlschlag aus, der Wert wird 1:1 in den Eintrag übernommen. Ändert sich der
  Diff danach nochmal, muss der Hash neu übernommen werden.
- Neueste Version steht oben (umgekehrt chronologisch); das Gate liest nur
  den **ersten** `## [...]`-Block der Datei.

Es gab noch keinen getaggten Release (weder Stable noch Nightly) — der erste
Eintrag hier entsteht mit dem ersten `app-v*`- bzw. Nightly-Tag.
