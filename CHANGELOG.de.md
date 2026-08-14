# Changelog

Jeder Eintrag hier ist **Voraussetzung fürs Release-CI**, nicht nur Doku: Ein
Tag-Push (`app-v*` für Stable, der rollierende `nightly-latest` für Nightly)
löst lokal `tools/changelog-gate/check.py` aus, das den Eintrag ganz oben
gegen den echten `git diff` seit dem letzten Kanal-Tag prüft — fehlt ein
betroffenes Modul in der Coverage-Liste, oder passt der Diff-Hash nicht mehr
zum tatsächlichen Diff (weil seither neuer Code dazukam), schlägt der
Release-Push fehl. Kein Autogenerator: der Freitext muss inhaltlich
geschrieben werden. Mechanismus und Begründung: `docs/decisions.md` →
"Auto-Update via GitHub Releases", Punkt 5.

Diese Datei enthält bewusst **nur den für Menschen geschriebenen Teil** —
kurz, nutzerorientiert, ohne Dateipfade. Die für das Gate maschinell
benötigten Metadaten (Coverage-Liste je Version, Diff-Hash, zuletzt
veröffentlichter Commit je Kanal) stehen ausschließlich lokal in
`tools/changelog-gate/release-state.json` (`tools/` ist komplett gitignored
— dieser Stand landet nie auf GitHub, s. `docs/decisions.md`).

**Zweisprachig seit 2026-08-14**: diese Datei (`CHANGELOG.de.md`) ist die
deutsche Fassung, `CHANGELOG.md` die englische — inhaltlich identisch, das
Gate prüft beide gegen denselben, sprachunabhängigen State-Eintrag (Coverage/
Diff-Hash hängen am Code-Diff, nicht an der Formulierung). Ein neuer Eintrag
muss in beiden Dateien angelegt werden, mit derselben Versionsüberschrift.

## Format

    ## [X.Y.Z] - JJJJ-MM-TT
    ### Hinzugefügt / Geändert / Behoben
    - Kurzer, für Menschen verständlicher Stichpunkt pro Änderung.

- Neueste Version steht oben (umgekehrt chronologisch); das Gate liest nur
  die **erste** `## [...]`-Versionsüberschrift der Datei und schlägt dafür
  in `release-state.json` die passende Coverage/Hash-Aufzeichnung nach.

## [0.1.0-nightly.4] - 2026-08-15
### Hinzugefügt
- CI: geschlossene, nicht gemergte Pull-Request-Branches werden jetzt
  automatisch aufgeräumt.
- Der Datei-Explorer aktualisiert sich jetzt automatisch, wenn sich Dateien
  oder Ordner außerhalb der App auf der Festplatte ändern.

### Geändert
- Die Tastaturkürzel-Referenz und die zugrundeliegenden Beschreibungen sind
  jetzt auf Englisch.
- Internes Compliance-Tooling (Markennamen-Linter, OSS-Allowlist-Marker-
  Skript, Doku-Generator, Release-Treiber-Installer) ist aus dem öffentlich
  getrackten Baum entfernt — reines Dev-Tooling, keine funktionale Änderung
  für Nutzer.
- Lesbarkeits-Durchgang auf der Marketing-Website: verbesserte Typografie
  und Kontrast, außerdem ein paar überzogene Feature-Aussagen korrigiert.
- Marketing-Website: das Seitenlayout skaliert jetzt proportional statt auf
  eine feste Breite begrenzt zu sein.
- Mehrere Performance-Verbesserungen: Tool-Erkennung, Settings-Zugriffe,
  Tastatureingaben im Datei-Editor und Grid-Layout-Übergänge sind jetzt
  schneller und lösen keine unnötigen Neu-Renderings im Hintergrund mehr
  aus.

### Behoben
- Terminal-Panes konnten nach längerem Offenhalten mehrerer Tabs statt
  lesbarem Text nur noch korrupte, einzelne Buchstabenfragmente anzeigen —
  Ursache war, dass die App den begrenzten Vorrat gleichzeitiger
  GPU-beschleunigter Terminal-Renderer der Browser-Engine erschöpfte, indem
  jeder Tab seinen Renderer auch im verborgenen Zustand am Leben hielt;
  Renderer sind jetzt nur noch für den gerade sichtbaren Tab aktiv.
- Unter macOS war ein minimiertes oder verstecktes PaneCrew-Fenster nur noch
  über die System-Exposé-Übersicht wiederzufinden — die App führt jetzt ein
  laufend aktuelles „Fenster"-Menü mit allen offenen Fenstern, ein Klick
  bringt das gewählte Fenster nach vorn.
- Die App konnte ohne sichtbares Fenster (nur mit Dock-Icon) hängen bleiben,
  wenn beim Schließen des letzten Inhalts-Fensters gerade das
  Einstellungen-Fenster offen war.
- Das Schließen eines Terminal-Tabs beendet jetzt zuverlässig alle davon
  gestarteten Prozesse; zuvor konnten Kindprozesse im Hintergrund
  weiterlaufen, nachdem der Tab geschlossen wurde.
- Die „Kopiert"-Bestätigung im Terminal konnte auch dann erscheinen, wenn
  das Kopieren tatsächlich fehlgeschlagen war, und kopierter Text konnte
  eine ungewollte führende Einrückung übernehmen.

## [0.1.0-nightly.3] - 2026-08-14
### Behoben
- Ein Klick auf „Installieren & Neustarten" konnte trotz zuvor erfolgreich
  gefundenem Update mit „Konnte nicht geprüft werden" scheitern: der
  Download-Link zeigte auf einen GitHub-API-Endpunkt mit engem anonymem
  Anfrage-Limit statt auf den unlimitierten öffentlichen Download-Link. Die
  Fehlermeldung im Über-Fenster und im Update-Banner unterscheidet jetzt
  außerdem korrekt zwischen einer fehlgeschlagenen Prüfung und einer
  fehlgeschlagenen Installation, mit Möglichkeit zum erneuten Versuch.
- Eine per Tab-Vervollständigung eingefügte Datei-/Ordnerpfad-Ergänzung mit
  Backslash vor einem Leerzeichen wurde im Terminal-Eingabefeld nicht mehr
  korrekt escaped.

## [0.1.0-nightly.2] - 2026-08-14
### Hinzugefügt
- Ein vollständiges Einstellungsfenster: Farbthema wählen, Zoomstufe und
  Terminal-Schriftgröße live anpassen, Grid-Vorlage per Piktogramm auswählen.
- Zusätzliche Fenster: ⌘N/Strg+N öffnet ein weiteres PaneCrew-Fenster, das
  Position, Größe und offene Projekte eigenständig über einen Neustart hinweg
  merkt.
- Terminal-Tabs zeigen jetzt echte Marken-Icons des erkannten CLI-Tools,
  lassen sich per Kontextmenü umbenennen/schließen und melden
  Hintergrundaktivität über ein Ungelesen-Signal.
- Panes und Terminal-Tabs lassen sich per Drag & Drop verschieben, tauschen
  und in neue, leere Slots ziehen, mit Zeiger-Vorschau und sichtbarer
  Ziel-Markierung.

### Geändert
- Fokus-Modus rotiert jetzt zuverlässig automatisch durch Panes/Tabs, mit
  Countdown-Anzeige im Pane-Header.
- Der Datei-Explorer lädt Ordner jetzt sparsam pro Verzeichnis nach, statt
  beim Öffnen den kompletten Projektbaum auf einmal einzulesen — spürbar
  schneller bei großen Projekten.
- Der Nightly-Kanal ist jetzt voll funktionsfähig: automatische
  Update-Prüfung ist aktiv, jeder Nightly-Build bekommt eine eigene, stets
  steigende Versionsnummer, und es wird nur noch für Apple-Silicon-Macs
  gebaut (kein Rosetta-Hinweis mehr auf Apple-Chip-Geräten).
- Kleinere Verbesserungen an der Marketing-Website (u. a. echte
  Tool-Logos, SEO-Feintuning).

### Behoben
- Ein per Drag zwischen Panes verschobener Terminal-Tab verlor dabei seine
  laufende Sitzung — das passiert jetzt nicht mehr.

## [0.1.0] - 2026-08-13
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
