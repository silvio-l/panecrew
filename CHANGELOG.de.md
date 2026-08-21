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

**Nightly-Versionsnummern (2026-08-20, ersetzt das frühere von Hand
hochgezählte `0.1.0-nightly.N`-Schema):** die Überschrift muss die Version
tragen, die der Build tatsächlich bekommt — `0.1.<Commit-Anzahl>`, ohne
`-nightly`-Suffix, mit ` (Nightly)` nach dem Datum außerhalb der eckigen
Klammern, z. B. `## [0.1.394] - 2026-08-20 (Nightly)`. Das ist dieselbe
`MAJOR.MINOR.<git rev-list --count HEAD>`-Zahl, die der Release-Workflow für
`CFBundleShortVersionString`/den Über-Dialog berechnet (s.
`release-nightly.yml` → "Nightly-Pseudoversion setzen") — vorher trug das
Changelog eine eigene, davon unabhängige von Hand gezählte Nummer, die nie
zu dem passte, was die App selbst anzeigte. Da der Changelog-Commit laut
Konvention immer der letzte Commit vor dem Tag-Push ist, ist die Zahl
`git rev-list --count HEAD` *vor* diesem Commit, plus 1. Stable-Überschriften
sind davon nicht betroffen — `app-v{X.Y.Z}`-Tags sind schon die echte
Version.

**Nur App-Inhalte (2026-08-16)**: Dieses Changelog wird mit der Desktop-App
ausgeliefert (der Updater verlinkt auf den GitHub-Release, der wiederum
hierher zeigt) und wird gelesen als "was hat sich in der App geändert, die
ich gerade installiere" — kein projektweites Changelog. Commits unter
`apps/website` (Marketing-Website-Texte, SEO, Guides, Layout) bekommen hier
nie einen Stichpunkt, auch wenn das Gate `website` weiterhin in der
`coverage`-Liste des Releases verlangt, sobald der Diff diesen Pfad berührt
(das Gate prüft Modul-Abdeckung rein mechanisch, nicht den Freitext — das
Modul muss trotzdem erfasst sein, taucht im menschlich lesbaren Text aber
nie auf).

## [0.1.400] - 2026-08-21 (Nightly)
### Behoben
- Behoben, dass das macOS-Release-Signing sporadisch hängen blieb, weil das
  Signaturzertifikat im selben Build in zwei getrennte Keychains importiert wurde.

## [0.1.397] - 2026-08-20 (Nightly)
### Behoben
- Einen Fehler behoben, bei dem eine in einem Pane gestartete
  Coding-Agent-CLI-Sitzung PaneCrews eigene Umgebungsmarker erben und sich
  fälschlich für eine verwaltete Kindsitzung halten konnte, wodurch sie
  ihren eigenen Gesprächsverlauf stillschweigend nicht mehr speicherte.

## [0.1.0-nightly.15] - 2026-08-20
### Behoben
- Einen Fehler behoben, bei dem die App direkt beim Start abstürzen
  konnte — eine Hintergrund-Abhängigkeit versuchte, eine Bibliothek zu
  laden, die das Betriebssystem blockierte, wodurch der Start abbrach,
  bevor sich ein Fenster öffnete.
- Den "Fortsetzen"-Button an einem pausierten Terminal-Tab behoben, der
  wenige Sekunden nach dem Pausieren wirkungslos wurde.

## [0.1.0-nightly.14] - 2026-08-19
### Hinzugefügt
- Tippt man am Zeilenanfang (oder nach einem Leerzeichen) in einem
  Terminal `://`, öffnet sich jetzt ein durchsuchbares Befehls-Popup:
  eingebaute Befehle wie das Anlegen des Snippet-Ordners eines Projekts,
  plus die eigenen wiederverwendbaren Text-Snippets aus Projekt- und
  Nutzer-Snippet-Dateien, eingefügt anstelle des getippten Texts.
- Jeder Terminal-Tab kann jetzt mit einem bestimmten CLI-Tool-Adapter
  starten statt immer mit der Standard-Shell — wählbar über ein Dropdown
  neben dem "Neuer Tab"-Button.
- Öffnet man ein Bild (PNG, JPEG, GIF, SVG, WebP) oder Video (MP4, WebM)
  in einem Datei-Tab, wird jetzt eine Vorschau statt Rohtext oder
  Binär-Datenmüll angezeigt.
- Der Code-Editor im Datei-Tab hat jetzt Syntax-Highlighting und
  Zeilennummern für TypeScript/JavaScript, Rust, JSON, CSS und Markdown.
- Explorer-Kopfzeile und Pane-Statusleiste zeigen jetzt den git-Branch,
  die Anzahl geänderter Dateien, Ahead/Behind-Status und Worktree-Infos
  des aktuellen Projekts.

### Geändert
- Die "fertig, wartet auf dich"-Tab-Markierung ist jetzt eine Karte, die
  sichtbar aus der Tab-Zeile herauswächst, statt eine leicht zu
  übersehende Hervorhebung.

### Behoben
- Terminal-Tabs werden nicht mehr stillschweigend am rechten Pane-Rand
  abgeschnitten, sobald zu viele offen sind — die Tab-Zeile scrollt jetzt
  horizontal (auch per Mausrad), und der aktive oder neu geöffnete Tab
  scrollt automatisch ins Bild.
- Textauswahl per Maus-Drag kopiert jetzt auch dann korrekt in die
  Zwischenablage, wenn der Drag außerhalb der Pane endet.
- Das Hovern über eine Zeile im "Zuletzt verwendet"-Bereich der
  Projektauswahl öffnet keinen Tooltip mehr, der den Mausweg zu den
  darunterliegenden Zeilen blockierte.

## [0.1.0-nightly.13] - 2026-08-17
### Geändert
- Terminal-Tabs bleiben jetzt während der gesamten Denk-/Arbeitsphase eines
  Tools als "aktiv" markiert, statt bei Ausgabepausen kurzzeitig auf
  "inaktiv" zu springen; die Tab-Markierung bedeutet jetzt "fertig, wartet
  auf dich" statt "ungelesen" und verschwindet in dem Moment, in dem du
  wieder auf den Tab schaust.
- Das Schließen einer Terminal-Pane oder eines Tabs beendet jetzt
  zuverlässig jeden Prozess, den sie gestartet hat, nicht nur die Shell
  selbst — ein im Hintergrund laufender Dev-Server oder CLI-Agent kann
  danach nicht mehr unsichtbar weiterlaufen.
- Das Über-Fenster öffnet sich jetzt sofort wieder, statt sich jedes Mal
  neu aufzubauen.
- Geringerer Hintergrund-CPU-/Akkuverbrauch durch die Terminal-Tool-
  Erkennung, besonders bei vielen offenen Tabs.
- App-Start und das Wiederherstellen von Fenstern aus der letzten Sitzung
  sind beide schneller, besonders mit mehreren offenen Fenstern.

### Behoben
- Der Splash Screen — und das Hauptfenster dahinter — konnte auf Mehr-
  Monitor-Setups außermittig oder komplett auf dem falschen Monitor
  erscheinen. Beide zentrieren sich jetzt immer korrekt auf dem Monitor,
  auf dem die App startet.
- Das Layout eines Fensters (offene Projekte, geteilte Panes, welche Pane
  fokussiert war) konnte gelegentlich nicht gespeichert werden, wenn das
  Fenster sehr kurz nach einer Änderung geschlossen wurde.

## [0.1.0-nightly.12] - 2026-08-17
### Hinzugefügt
- Ein geführter Erststart-Assistent: Sprache und Theme auswählen (wird
  sofort beim Klicken live übernommen), bei Bedarf macOS' Vollzugriff-
  Berechtigung erteilen, dann direkt ins erste Projekt starten. Ersetzt den
  bisherigen einzelnen Hinweis und funktioniert jetzt unabhängig davon, wie
  voll das Grid bereits ist.
- Leere Projekt-Slots zeigen bei Hover ein "Zuletzt verwendet"-Panel direkt
  im Slot an, plus einen Eintrag, um nach einem noch nicht gelisteten
  Projekt zu suchen.

### Behoben
- Rechtsklick auf einen Terminal-Tab und Auswahl von "Umbenennen" oder
  "Schließen" konnte stillschweigend nichts bewirken.
- "Einführung neu starten" in den Einstellungen ließ das Einstellungsfenster
  über dem dadurch ausgelösten Assistenten offen; es schließt sich jetzt
  selbst.
- Ein Neustart der Einführung auf einem Grid mit bereits offenem Projekt
  bietet nicht mehr an, es stillschweigend zu ersetzen.
- Manche Benachrichtigungen (der Schließen-Bestätigungsdialog,
  Menü-Aktionen wie "Ordner öffnen") konnten fälschlich in jedem offenen
  Fenster statt nur im betroffenen auslösen.
- Das Ressourcen-Popover in der Titelleiste eines zweiten Fensters
  gruppiert seine Terminal-Tabs jetzt korrekt nach Pane statt eine flache,
  unbeschriftete Liste zu zeigen.

## [0.1.0-nightly.11] - 2026-08-16
### Hinzugefügt
- Erststart-Onboarding: Beim ersten Mal, wenn zwei Panes gleichzeitig
  nebeneinander offen sind, erscheint kurz ein Hinweis direkt im Grid und
  verschwindet wieder, sobald er ausprobiert wurde. Die Einstellungen haben
  eine neue Kategorie "Hilfe" (macOS) mit einem Button, um den Hinweis
  erneut zu zeigen, sowie direkten Links in die Systemeinstellungen zu
  Vollzugriff, Dateien & Ordner sowie Datenschutz & Sicherheit für die
  Berechtigungen, die PaneCrew braucht.

### Geändert
- Neuinstallationen starten jetzt standardmäßig im dunklen Theme statt der
  Systemeinstellung zu folgen.

### Behoben
- Der Fokuswechsel zwischen Panes konnte die App auch nach dem letzten Fix
  weiterhin gelegentlich kurzzeitig einfrieren lassen (Beachball unter
  macOS): ein Neustart der Dateiüberwachung führte einen vollständigen,
  unbegrenzten Verzeichnis-Scan auf dem Hauptthread aus. Das läuft jetzt im
  Hintergrund.
- Schnelles Schließen und erneutes Öffnen von Terminal-Tabs konnte sehr
  selten einen verwaisten Shell-Prozess hinterlassen, nachdem das
  zugehörige Fenster geschlossen wurde; ein großes Einfügen in ein Terminal
  konnte das ganze Fenster kurz einfrieren lassen, während es an die Shell
  gesendet wurde.
- Ein veraltetes internes Flag konnte sehr selten ein leeres Geisterfenster
  offen lassen, nachdem die App beendet und sofort wieder gestartet wurde.
- Jedes offene Fenster prüfte fortlaufend jeden Terminal-Tab darauf, welches
  CLI-Tool läuft — auch minimiert oder im Hintergrund. Diese Prüfung pausiert
  jetzt, solange ein Fenster nicht sichtbar ist.
- Das Ziehen am Größengriff des Explorer-Panels konnte sich bei vielen
  offenen Panes träge anfühlen, weil jede Mausbewegung das ganze Grid neu
  gerendert hat; jetzt löst nur noch die endgültige Breite ein Rerendern aus.
- PaneCrew schrieb bei jedem Pane-Klick die komplette Sitzungsdatei neu,
  selbst wenn sich nichts geändert hatte, und zwei gleichzeitig offene
  Fenster konnten sich beim Speichern sehr selten gegenseitig überschreiben.
  Beides behoben.
- Bei einer Neuinstallation konnte die App kurz mit 100% Zoom erscheinen,
  bevor sie sich auf ihren eigentlichen Standardwert einpendelte.

## [0.1.0-nightly.10] - 2026-08-16
### Geändert
- Das Fenster-Ressourcenverbrauchs-Popover in der Titelleiste listet jetzt
  alle offenen Fenster auf, nicht mehr nur das gerade betrachtete.

### Behoben
- Der Fokuswechsel zwischen Panes konnte die App kurzzeitig einfrieren
  lassen (Beachball unter macOS): eine Hintergrundprüfung baute die
  komplette native Menüleiste weit öfter neu, als nötig. Sie baut jetzt nur
  noch neu, wenn sich tatsächlich etwas geändert hat.
- Das Menü "Zuletzt geöffnete Projekte" konnte nach dem Öffnen oder
  Schließen von Projekten hinterherhinken oder veraltete Einträge zeigen —
  behoben durch dieselbe Änderung wie oben.
- Das Öffnen eines Projekts über das Menü "Zuletzt geöffnete Projekte" oder
  Cmd+O konnte stillschweigend ersetzen, was gerade in der fokussierten
  Pane lief. Es öffnet jetzt nur noch in eine leere Pane; sind alle Panes
  bereits belegt, fragt PaneCrew stattdessen nach, ob das Projekt in einem
  neuen Fenster geöffnet werden soll.

## [0.1.0-nightly.9] - 2026-08-16
### Behoben
- Die Speicherwarnung in der Titelleiste konnte auf Rechnern mit weniger
  Gesamt-RAM viel zu leicht auslösen (und auf solchen mit mehr zu spät): die
  Schwelle war ein Prozentsatz des System-Gesamt-RAMs statt eines absoluten
  Werts. Jetzt fest 6GB (Warnung) / 12GB (kritisch), unabhängig vom
  Gesamt-RAM der Maschine.

## [0.1.0-nightly.8] - 2026-08-16
### Behoben
- Absturz beim Start behoben, der mit nightly.7 eingeführt wurde: die App
  konnte komplett nicht mehr starten (Absturz noch vor dem ersten Fenster),
  weil das Anwendungsmenü zu früh in Tauris eigener Startsequenz gebaut
  wurde.

## [0.1.0-nightly.7] - 2026-08-16
### Hinzugefügt
- Split-Pane-Tastenkürzel (Strg/Cmd+Umschalt+5): teilt die aktuell fokussierte
  Kachel, indem das Grid auf das nächstgrößere Layout wächst und das Projekt
  dieser Kachel in den neu entstandenen Slot wandert.
- Trennlinien zwischen benachbarten Slots lassen sich jetzt per Drag oder
  Pfeiltasten verschieben, um das Größenverhältnis zwischen ihnen anzupassen,
  ohne das Grid-Layout selbst zu ändern; ein Doppelklick setzt eine Trennlinie
  auf ihren Standardwert zurück.
- Command Palette (⌘⇧P), auch über das Suchfeld in der Titelleiste erreichbar,
  für schnellen Layout-Wechsel oder Sprung zu Ordner öffnen, Einstellungen
  oder der Tastenkürzel-Referenz.
- Ablage-Menü: "Ordner öffnen" (⌘O), ein Untermenü "Zuletzt geöffnete
  Projekte", "Neues Fenster" und "Alle Fenster schließen".
- Eine In-App-Referenz aller Tastenkürzel, erreichbar über das Menü.
- Leere Grid-Slots zeigen jetzt app-weit eine Liste zuletzt geöffneter
  Projekte statt nur eines leeren Pickers.
- Die Vor/Zurück-Pfeile in der Titelleiste navigieren jetzt den Kachel-Fokus
  sowohl im Grid- als auch im Fokus-Modus.

### Geändert
- Neuinstallationen starten jetzt standardmäßig auf Englisch, statt
  automatisch der Systemsprache zu folgen.
- Intern: eine für einen einzelnen Bug gebaute Wegwerf-Debug-Erfassung wurde
  durch dauerhaftes Produktions-Logging (Backend + Frontend) in eine
  rotierende Log-Datei ersetzt — erleichtert die Diagnose künftiger
  Bug-Reports ohne Live-Konsolen-Übergabe.

### Behoben
- Speicheranzeige in der Titelleiste: der Gesamt-RAM-Wert zählt jetzt auch
  Kindprozesse der Terminals mit, nicht mehr nur die Shells selbst.
- Strg+K zum Leeren des Terminals kollidiert unter Windows/Linux nicht mehr
  mit dem Readline-Kürzel kill-line.
- Cmd+W schließt jetzt nur noch den aktuellen Terminal-Tab statt des ganzen
  Fensters.
- Ein Fenster schließen (über den Schließen-Button oder Cmd+Q) fragt jetzt
  nach, wenn noch Terminal-Sitzungen laufen.
- Datei-Explorer: der `.git`-Ordner ist nicht mehr unsichtbar — er wurde
  bisher identisch zu `node_modules` gefiltert.
- Der Explorer-Baum zeigt jetzt wirklich alles, inklusive `.git` und
  `node_modules`/`target` gemeinsam.
- Datei-Explorer: "Pfad kopieren" im Kontextmenü landet jetzt tatsächlich in
  der Zwischenablage.
- Datei-Explorer: ein Refresh lässt bereits aufgeklappte Unterordner nicht
  mehr sichtbar kurz zu- und wieder aufklappen.
- Geistertext der Inline-Autovervollständigung fügt sich nicht mehr an der
  falschen Cursorposition ein.
- Windows: zwei reale Compile-Bugs behoben, aufgedeckt durch einen neuen
  Windows-CI-Matrix-Job für die Rust-Testsuite.

## [0.1.0-nightly.6] - 2026-08-15
### Hinzugefügt
- Ein Rechtsklick auf das Dock-Icon zeigt unter macOS jetzt ein natives Menü
  mit "Neues Fenster" plus einer laufend aktuellen Liste aller offenen
  Fenster — wie bei anderen Mac-Apps mit mehreren Fenstern üblich.
- Die Suche im Datei-Explorer durchsucht jetzt auch Dateiinhalte, nicht nur
  Datei-/Ordnernamen — Treffer-Zeilen zeigen eine Vorschau und springen per
  Klick direkt zur genauen Zeile (mit markierter Fundstelle).

### Geändert
- Die Werkzeugleiste des Datei-Explorers steht jetzt in einer eigenen Zeile
  über dem Projektnamen statt mit ihm um Platz zu konkurrieren, ihre Icons
  sind jetzt dauerhaft sichtbar statt nur bei Hover.

## [0.1.0-nightly.5] - 2026-08-15
### Hinzugefügt
- Die Titelleiste zeigt jetzt eine laufende RAM/CPU-Anzeige für PaneCrew und
  seine Terminal-Sitzungen, mit einer Hover-Übersicht pro Pane/Tab
  (Prozentwerte plus absolute MB/GB) und Warn-/Kritisch-Farbzuständen.
- Außer Kontrolle geratene Terminal-Sitzungen werden jetzt automatisch
  abgefangen: ein Tab mit übermäßigem Speicherverbrauch wird zuerst markiert,
  dann wird nur der einzelne größte Verursacher-Prozess pausiert (nicht
  beendet), sodass er fortsetzbar bleibt — erst bei wiederholter oder
  anhaltender Überlastung wird gezielt nur dieser eine Prozess beendet, und
  nur als letztes Mittel der ganze Tab. Ein so beendeter Tab zeigt einen
  klaren Grund und eine Neustart-Option, statt kommentarlos zu verschwinden.
- Terminal-Ausgaben erkennen jetzt URLs und absolute Dateipfade als klickbare
  Links.
- Marketing-Website: neuer Guide zum gleichzeitigen Arbeiten mit mehreren
  Terminal-Fenstern und CLI-Agent-Sitzungen.

### Geändert
- Standard-Zoomstufe auf 1,2x und Standard-Terminal-Schriftgröße auf 14
  angehoben, für bessere Lesbarkeit direkt nach der Installation.
- Neue Fenster positionieren sich jetzt korrekt bei mehreren Monitoren, statt
  gelegentlich an der falschen Stelle zu landen.
- Werte in der Titelleiste (Zoom, Uhr, Ressourcenanzeige, Icon-Buttons) sind
  jetzt durchgehend sauber vertikal zentriert und optisch getrennt.
- Marketing-Website: visueller Redesign-Pass und ein geteiltes
  Navigation/Footer-Stylingsystem über alle Seiten hinweg.
- Intern: ein Test, der ungewollt bei jedem Testlauf echte Dateien in den
  System-Papierkorb verschob, läuft jetzt nicht mehr standardmäßig —
  reine Entwicklungsangelegenheit, keine Auswirkung für Nutzer.
- Intern: veraltete Release-Workflow-Dokumentation korrigiert und die
  Standard-Berechtigungen des Repository-Actions-Tokens gefixt, die den
  automatischen Nightly-Release-Schritt stillschweigend blockiert hatten —
  reine Entwicklungsangelegenheit, keine Auswirkung für Nutzer.

### Behoben
- Der Kontextmenü-Eintrag "Tab schließen" tat sichtbar nichts; dazu kam
  außerdem eine Option zum Batch-Schließen mehrerer Tabs.
- Kopieren mit Cmd+C konnte dem kopierten Text ungewollte zusätzliche
  Einrückung hinzufügen.

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
