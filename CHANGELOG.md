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

Die Coverage-/Hash-Metadaten fürs Gate stehen in einem HTML-Kommentar direkt
unter der Versionsüberschrift — beim Rendern (GitHub, jeder Markdown-Viewer)
unsichtbar, damit sichtbar nur der eigentliche, für Menschen geschriebene
Eintrag bleibt:

    ## [X.Y.Z] - JJJJ-MM-TT
    <!--
    coverage:
      - modul-a
      - modul-b
    diff_hash: <von check.py berechneter sha256-Hex-Digest>
    -->
    ### Hinzugefügt / Geändert / Behoben
    - Kurzer, für Menschen verständlicher Stichpunkt pro Änderung.

- `coverage` muss **jedes** Modul enthalten, das der reale Diff seit dem
  letzten Tag dieses Kanals berührt (Pfad→Modul-Mapping:
  `tools/changelog-gate/module_map.json`; ein noch nicht gemappter Pfad wird
  automatisch sein eigenes Ad-hoc-Modul und muss trotzdem abgedeckt sein).
- `diff_hash` wird nicht von Hand geschrieben — `check.py` gibt ihn bei einem
  Fehlschlag aus, der Wert wird 1:1 in den Eintrag übernommen. Ändert sich der
  Diff danach nochmal, muss der Hash neu übernommen werden.
- Neueste Version steht oben (umgekehrt chronologisch); das Gate liest nur
  den **ersten** `## [...]`-Block der Datei.
- Der sichtbare Teil ist bewusst kurz, nutzerorientiert und ohne Dateipfade —
  was sich für jemanden ändert, der die App benutzt, nicht wie es intern
  gebaut ist.

## [0.1.0] - 2026-08-13
<!--
coverage:
  - about
  - chrome
  - ci
  - cli
  - docs
  - explorer
  - harness
  - i18n
  - icons
  - meta
  - pty
  - release-config
  - session
  - splash
  - testing
  - theme
  - tooling
  - updater
  - website
diff_hash: 39a51addaf14d7b0de3d961e77a43a75330f21a39dc80400baba2fb3714d6011
-->
Erster Release. PaneCrew kann ab jetzt:

- Bis zu vier Projekte gleichzeitig in einem festen Grid öffnen, jedes mit
  einem echten, unabhängigen Terminal.
- Einen Datei-Explorer anzeigen, der automatisch dem gerade fokussierten
  Terminal folgt.
- Sitzungen (offene Projekte, Layout) über einen App-Neustart hinweg merken.
- Direkt mit einem Projektpfad starten (`panecrew <pfad>`), ohne über die
  Projektauswahl zu gehen.
- Eigene und aus VS-Code importierte Farbthemen anzeigen. <!-- brandlint-ok: benennt die reale Importquelle des Theme-Mappers, keine Werbung -->
- Sich selbst automatisch aktualisieren, über einen Stable- und einen
  separat kennzeichneten Nightly-Kanal.
