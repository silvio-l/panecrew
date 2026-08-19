import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { ContextMenu, DropdownMenu } from "radix-ui";
import {
  CHROME_FOCUS_RING,
  CHROME_MENU_CONTENT_CLASS,
  CHROME_MENU_ITEM_CLASS,
  CHROME_MENU_SEPARATOR_CLASS,
  ChromeTooltip,
} from "./ChromeTooltip";
import { isMacPlatform } from "../shortcuts/platform";
import { formatChord, SHORTCUTS, terminalTabSelectId } from "../shortcuts/registry";
import { useDetectedToolId } from "../terminal/useDetectedTool";
import { markTabViewed, useTerminalAwaitingAttention } from "../terminal/terminalActivity";
import { useTabResourceGuard } from "../terminal/resourceGuard";
import { resolveToolIcon } from "../terminal/toolIcons";
import { ADAPTERS } from "../terminal/adapters";

// Ticket 35: die Optionen des Adapter-Dropdowns neben dem "+"-Knopf —
// eingebaute Shell (`id: null`) plus die feste `ADAPTERS`-Liste aus
// `adapters.ts`. `labelKey` zeigt auf dieselben `paneTabs.tool.*`-Strings,
// die auch die Tool-Badges der Chips selbst nutzen (Kopfkommentar dieser
// Datei) — keine zweite Übersetzung für dieselben Namen. Modulweit statt je
// Render neu gebaut, da rein statisch.
const ADAPTER_PICKER_OPTIONS: readonly { id: string | null; labelKey: string }[] = [
  { id: null, labelKey: "paneTabs.tool.shell" },
  ...ADAPTERS.map((adapter) => ({ id: adapter.id, labelKey: `paneTabs.tool.${adapter.id}` })),
];

// Tab-Leiste einer Pane (Ticket 18): N Terminal-Tabs (je eine eigene PTY,
// durchnummeriert) plus höchstens ein File-Tab, immer hinter allen
// Terminal-Tabs. Ersetzt den früheren reinen Zwei-Wege-Umschalter zwischen
// "Terminal" und "Datei" (2026-08-12) — der Unterschied ist jetzt N statt 1
// Terminal-Tab, das File-Tab-Verhalten (nur sichtbar, wenn eine Datei offen
// ist, kein X in dieser Leiste — das Schließen bleibt FileEditor.tsx' eigenem
// Knopf vorbehalten) ist unverändert.
//
// Wird jetzt UNBEDINGT gerendert (vorher nur, solange eine Datei offen war):
// die "+"-Schaltfläche zum Öffnen eines weiteren Terminal-Tabs muss auch ohne
// offene Datei erreichbar sein.
//
// Idiom wie TemplateSwitcher.tsx: `role="group"` + `aria-pressed` statt
// `role="tablist"`/`"tab"`.
//
// Nachtrag 2026-08-13 (Nutzerbeschwerde, reine Maus-Bedienung nicht möglich):
// der Chip war ursprünglich ein 20×20-Icon-Knopf, dessen Zahl beim Hovern
// komplett durch ein `absolute inset-0`-Schließkreuz ersetzt wurde — jedes
// Überfahren machte den GANZEN Chip zum Schließen-Knopf, ein Wechsel per Maus
// war so nicht möglich. Ein späterer Zwischenstand reservierte dem Kreuz
// stattdessen einen eigenen, schmalen Bereich am Chip-Rand — dieser Weg ist
// inzwischen selbst wieder abgelöst (s. u., Nachtrag "Schließen per
// Kontextmenü"), aus demselben Grund: die Trefferfläche eines 24px hohen
// Chips bleibt für ein zusätzliches Schließkreuz grundsätzlich knapp.
// Zusätzlich trägt der Tooltip jetzt den Akkord aus der Kürzel-Registry
// (Cmd/Strg+1..9, `usePtyTerminal.ts`s Pane-Kürzel-Zweig) — der Weg von der
// Maus zur Tastatur muss sich aus der UI selbst erschließen, nicht aus
// docs/shortcuts.md.
//
// Nachtrag 2026-08-13, später (Impeccable-Critique, zwei gemeldete Mängel:
// Klickfläche weiterhin zu klein, Aktiv/Inaktiv kaum unterscheidbar):
// - Chip-Höhe `h-5`→`h-6` (die volle, im Pane-Header ohnehin schon reservierte
//   24px-Zeile statt nur 20px davon — kein zusätzlicher Platzbedarf) für
//   TerminalTabChip, den Datei-Tab UND den „+"-Knopf einheitlich; Letzterer
//   läuft jetzt über `--pc-paneControl-size` statt einer eigenen Fixgröße, wie
//   der gleichrangige Schließen-Knopf im Header (Token-Konsistenz).
//
// Nachtrag 2026-08-13, noch später (Nutzer-Feedback nach dem WebKit-Fix am
// Knopf-Reset, s. App.css): der Farbpunkt vor der Nummer ist ersatzlos
// gestrichen. Er sollte ursprünglich Terminal-Busy/Idle andeuten — dafür gibt
// es aber keine verlässliche Quelle (die Projekt-Leitlinien schließen
// heuristisches Output-Parsing für v0.1 explizit aus, und Prozesslast wäre ohnehin kein
// brauchbarer Ersatz: ein wartender CLI-Agent hängt meist in Netzwerk-I/O,
// die CPU liegt nahe null genau dann, wenn „beschäftigt" das eigentlich
// interessante Signal wäre — false-idle exakt im relevanten Moment). Ohne
// belastbare Bedeutung war der Punkt nur dekorativ und blieb trotzdem als
// State-Signal lesbar, was er nicht war. Der Kontrast zwischen aktivem und
// inaktivem Tab, den der Punkt nie getragen hat, kommt jetzt stattdessen vom
// Fokus-Akzent selbst (s. Kommentar an TerminalTabChip) — der Wegfall schafft
// zusätzlich ~6px + Gap Breite pro Chip.
//
// Direction-Contract-Korrektur (2026-08-13, User-Entscheidung): der eine
// Akzent (`--pc-focusBorder`) war bislang exklusiv dem Pane-Fokus vorbehalten
// ("ein zweiter Ort in derselben Farbe würde 'welche Pane ist fokussiert' zur
// Suchaufgabe machen"). Der Nutzer hat diese Regel bewusst gelockert: der
// Akzent darf jetzt zusätzlich sparsam auf dem aktiven Tab erscheinen (s.
// `.impeccable/direction-contract-desktop.md` → „Akzent auf Tabs erlaubt"),
// solange Pane-Fokus und aktiver Tab in FORM unterscheidbar bleiben, nicht
// nur im Farbton — TerminalPane.tsx' Fokus-Signal ist die volle
// Header-Hairline bei 45% Deckkraft, hier ist es eine deckende 1px-Box mit
// verdoppelter Unterkante an einem einzelnen Chip.
//
// Nachtrag 2026-08-13, noch später (Nutzer-Entscheidung nach Abnahme der
// Aktiv/Inaktiv-Kontrastfassung — "die Hervorhebung des aktiven Tabs finde
// ich so jetzt gut gelungen"): DREI weitere, gleichzeitig verlangte
// Änderungen an `TerminalTabChip`:
//
// 1. Das ❯ vor der Nummer ist ERSATZLOS entfernt, aus beiden Tab-Arten
//    (auch `PaneTab`, für dasselbe geteilte Idiom, s. Kommentar dort). Der
//    Nutzer nannte es redundant zum ❯, das an derselben Stelle bereits
//    fensterweit ganz vorn im Pane-Header steht (TerminalPane.tsx/
//    FileEditor.tsx) — EIN „hier bist du" pro Blick genügt, ein zweites
//    direkt daneben ist Rauschen.
// 2. Das Schließkreuz ist ERSATZLOS entfernt. Schließen läuft jetzt
//    ausschließlich über das Kontextmenü (Rechtsklick, s. u.) plus
//    Mittelklick als Browser-Tab-übliche Abkürzung (`onAuxClick`) — beides
//    setzt eine bewusste, gezielte Handlung voraus, ein winziges Kreuz direkt
//    neben der Nummer keine mehr. `onCloseTerminalTab` (App.tsx) bleibt dabei
//    unverändert der bereits bestehende, rückfragegesicherte Pfad
//    (`closeTerminalTabGuarded`, `ConfirmDialog.tsx`) — dieser Umbau ändert
//    nur den WEG dorthin, nicht die Sicherung selbst.
// 3. Ein Kontextmenü (Radix `ContextMenu`, dasselbe Textmenü-Idiom wie
//    ExplorerPanel.tsx/TerminalPane.tsx, `CHROME_MENU_*`-Klassen) bietet
//    "Schließen" und "Umbenennen". Zugleich gilt ab hier app-weit: das
//    native Kontextmenü des Webviews ist grundsätzlich AUS (s.
//    `chrome/nativeContextMenuPolicy.ts`, in jedem Fenster-Entry-Point
//    installiert) — ein Kontextmenü existiert nur noch an den Stellen, an
//    denen die App selbst eins eingerichtet hat, dieser Chip ist eine davon.
//
// Nachtrag 2026-08-13, noch später (Tool-Icon-Erkennung, Nutzer-Vorgabe:
// Prozessbaum statt Terminal-Ausgabe, `tool_detect.rs`): der Zeile 51-62
// oben entfernte Farbpunkt bekommt hier KEIN Comeback — dieser Nachtrag ist
// ein eigenes, neues Signal mit eigener Bedeutung (welches CLI-Tool läuft),
// nicht der alte Busy/Idle-Punkt in neuer Form. `useDetectedToolId` pollt
// `pty_detect_tool` alle 2s (das Rust-Backend liefert bereits eine
// kanonische Tool-ID, keinen rohen Binärnamen — es matcht selbst gegen
// Prozessname UND volle Argumente, s. `tool_detect.rs`s Kopfkommentar zum
// Node-Shebang-Problem), `resolveToolIcon` (toolIcons.tsx) bildet sie auf ein
// Icon ab (s. u. für die genaue Herkunft, dritte Runde) oder liefert `null`
// — dann wird bewusst gar kein Icon gezeichnet, statt eines Platzhalters für
// "unbekannt". Sitzt VOR der Zahl, in derselben Zeile.
//
// Nachtrag 2026-08-13, noch später (Nutzer-Feedback nach erstem Dogfood-Test:
// "nicht bloß so ein Buchstabe", gern in Herstellerfarbe): erkannte Tools
// bekommen eine gefüllte Badge in einer an den jeweiligen Hersteller
// angelehnten Akzentfarbe statt reinem `currentColor`. Nur die unerkannte
// Shell (`$`) bleibt ungefüllt/`currentColor`, da sie keinen Hersteller hat,
// dem eine Farbe zustünde — sie folgt weiterhin automatisch dem
// Aktiv/Inaktiv-Kontrast der Zahl statt einer zweiten Farblogik.
//
// Nachtrag 2026-08-13, noch später (Nutzer-Feedback, zweite Runde: "echte
// Tool-Icons, nicht einfach nur in Buchstaben"): das Buchstaben-Monogramm
// ist jetzt ein eigenes kleines Vektor-Icon je Tool (`toolIcons.tsx`,
// dieselbe Pfad-als-JSX-Bauweise wie `explorerIcons.tsx`) — Badge auf 16px
// angehoben (vorher 14px), dieselbe `GLYPH_SIZE` wie die Datei-Icons im
// Explorer, damit ein Vektor-Icon darin ebenso viel Luft hat wie dort. Die
// Badge blendet beim ERSTEN Erscheinen (Tool gerade erkannt) statt hart
// aufzupoppen mit `pc-overlay-in` ein (App.css, dieselbe 150ms-Kurve wie
// Tooltip/Menü-Öffnen) — ein React-Mount, keine Radix-Presence, deshalb
// `animation` statt `transition` (dieselbe Begründung wie im App.css-
// Kommentar zu `pc-overlay-in`: eine reine `transition`-Klasse feuert nicht
// beim Erst-Mount, nur bei einer Zustandsänderung eines bereits vorhandenen
// Elements).
//
// Nachtrag 2026-08-13, noch später (Nutzer-Widerspruch, dritte Runde: "echte
// Tool-Icons, nicht immer wieder diese Solo-Icons... richtige Tool-Icons
// passen von den Firmen, lizenztechnisch unproblematisch"): die generischen
// Konzept-Icons der zweiten Runde sind für Claude/Gemini/Copilot/OpenCode // brandlint-ok: welche Tool-IDs jetzt ein echtes Marken-Glyph bekommen, funktionale Nennung
// jetzt echte, wiedererkennbare Marken-Glyphen aus dem Simple-Icons-Set
// (CC0-Lizenz, reine Icon-Glyphen ohne Wortmarke — Herkunft, Lizenz und die
// Nominativ-Begründung dazu ausführlich im Kopfkommentar von
// `toolBadgeIcons.tsx`) statt eigener abstrakter Formen, mit den dort
// dokumentierten offiziellen Markenfarben statt vorheriger Annäherungen.
// Einzige Ausnahme: Codex hat im Quell-Set kein Marken-Glyph (weder das Tool // brandlint-ok: dokumentiert das Fehlen eines Marken-Glyphs für diese Tool-ID
// Code-Klammern der vorigen Runde — dasselbe gilt unverändert für die Shell.
//
// Nachtrag 2026-08-13, noch später (Needs-Attention, Task #13, Nutzer-
// Entscheidung "1a"): der oben (Zeile 51-64) ersatzlos gestrichene Punkt
// bekommt hier ein Comeback — aber mit tatsächlich belastbarer Bedeutung
// statt der damaligen reinen Dekoration. Unterschied zur damaligen
// Begründung ("keine verlässliche Quelle"): terminalActivity.ts liest keine
// Prozesslast und keinen Ausgabe-INHALT (bleibt innerhalb der Projekt-
// Leitlinie gegen heuristisches Output-Parsing), sondern zählt echte, per
// xterm.js committete Zeilen im PTY-Output selbst — ein Tab, der gerade
// Zeilen committet, PRODUZIERT nachweislich neue Ausgabe, unabhängig davon,
// ob die CPU dabei nahe null liegt. Selber Amber-Akzent wie der aktive Tab
// kam nicht infrage — der Akzent bedeutet dort bereits "das ist der
// ausgewählte Tab", eine zweite Bedeutung in derselben Farbe auf einem
// ANDEREN (inaktiven) Chip wäre nicht mehr unterscheidbar. Stattdessen
// derselbe `bg-current`-Punkt wie `DirtyMark` (unten), aber blinkend
// (`pc-clock-blink`, dasselbe HUD-Blink-Idiom wie die TitleBar-Uhr und die
// leeren ProjectPicker-Slots) — Form UND Bewegung tragen das Signal, keine
// zweite Akzentfarbe.
//
// Korrektur 2026-08-13, noch später (Nutzer-Fund: zwei Terminals liefen im
// Hintergrund, kein Badge erschien): die erste Fassung zeigte den Punkt nur
// auf `!active` — einem Tab, der innerhalb der EIGENEN Pane gerade nicht
// ausgewählt ist. Das übersah PaneCrews eigentliche Prämisse ("ein Grid
// gleichzeitig sichtbarer Panes, kein Tab-Switcher", Projekt-Leitlinie): die eigene
// Begründung von damals ("ein Tab in einer unfokussierten Pane bliebe für
// den Nutzer ebenso unsichtbar") war schlicht falsch — eine unfokussierte
// Pane STEHT im Grid, ihre Tab-Leiste ist die ganze Zeit sichtbar, nur ihr
// gerade ausgewählter Tab (`active===true`) hielt das Badge fälschlich
// unterdrückt. `paneFocused` (PaneCell, PaneGrid.tsx — dort ohnehin schon im
// Scope) liefert jetzt den fehlenden zweiten Faktor: unterdrückt wird das
// Badge nur noch für den Tab, den der Nutzer GERADE tatsächlich ansieht
// (ausgewählt UND die Pane hat den Grid-Fokus) — jeder andere strömende Tab,
// ob in einer fremden Pane oder nur ein weiterer Tab derselben Pane, zeigt
// es. `active` selbst bleibt unverändert die reine Auswahl-Optik (die volle
// Akzent-Box unten) — nur die Badge-Bedingung bezieht `paneFocused` mit ein,
// sonst verschwände "welcher Tab ist hier ausgewählt" sobald man den
// Pane-Fokus verlässt.
//
// Umbau 2026-08-13, noch später (Nutzer-Neuspezifikation nach Abnahme des
// Hintergrund-Pane-Fixes): das bis dahin blinkende `bg-current`-Badge
// ("aktiv im Hintergrund", reine Streaming-Anzeige, s. Korrektur oben) wird
// hier durch ein persistentes "ungelesen"-Signal ersetzt.
//
// Umbau 2026-08-17 (Nutzer-Bugreport: Aktivitätserkennung "funktioniert
// noch nicht sinnvoll", insbesondere innerhalb von Claude Code): das // brandlint-ok: functional reference to the specific tool tested, not marketing
// "ungelesen"-Signal von 2026-08-13 war das falsche Modell — es erschien bei
// jedem neuen Hintergrund-Output und blieb bestehen bis zum Ansehen,
// UNABHÄNGIG von weiterer Aktivität in der Zwischenzeit (ein durchgehend
// streamender Tab zeigte denselben Punkt wie ein längst fertiger). Der
// Nutzer wollte tatsächlich das Gegenteil, wörtliches Zitat auf Rückfrage
// (Option "1a"): der Marker soll erscheinen, wenn eine Pane FERTIG/STILL ist
// (nichts mehr passiert), und wieder verschwinden, sobald neuer Output
// kommt. `useTerminalAwaitingAttention` (terminalActivity.ts, dortiger
// Kopfkommentar für die vollständige Herleitung inkl. des Root-Cause-Funds
// zur Spinner-Lücke) liefert genau dieses Signal, live aus dem aktuellen
// Zustand abgeleitet statt als eigener, manuell zu invalidierender Flag:
//
// 1. Der zugrundeliegende Zustand (`busy`/`hasBeenActive` in
//    terminalActivity.ts) treibt den kleinen Punkt — in `--pc-icon-red`.
//    Dieselbe Farbe wie ConfirmDialog.tsx' Gefahren-Icon und
//    ExplorerPanel.tsx' Alarm-Rahmen (beide bereits "hier ist etwas, das
//    Aufmerksamkeit braucht"), bewusst NICHT `--pc-terminal-ansiRed`: die
//    dortige Datei trennt eigens einen Chrome-Rot-Ton vom
//    Terminal-Inhalts-Rot, genau die Trennung, die ein Notiz-Punkt in der
//    Tab-Leiste (Chrome, kein Terminal-Inhalt) braucht, um nicht als
//    ANSI-Fehlerfarbe gelesen zu werden.
// 2. Zusätzlich hebt sich der ganze Chip beim false→true-Übergang optisch an
//    ("Karteireiter, der ein Stück herausgezogen wird", Nutzer-Zitat) — ein
//    persistenter `-translate-y` + Schatten, kein einmaliger Flash, bleibt
//    also so lange angehoben, wie der Marker aktiv ist, und sinkt animiert
//    wieder ab, sobald er verschwindet (motion-safe: reduzierte Bewegung
//    bekommt nur den Sprung ohne Animation, s. dortiger Kommentar).
// 3. Der false→true-Übergang löst zusätzlich EINMALIG den
//    `pc-attention-flash`-Wasch über den ganzen Chip aus (App.css, dortiger
//    Kommentar zur Hüllkurve/Farbwahl) — per `key`-Neumount erkannt
//    (`flashKey` unten), derselbe Mechanismus wie am Tool-Icon-Badge.
//
// `markTabViewed` (terminalActivity.ts) läuft aus einem Effekt, sobald
// `active && paneFocused` wahr wird — dieselbe Kombination, die den
// Hintergrund-Pane-Fund behoben hat, jetzt zusätzlich als "der Nutzer hat
// diesen Tab gerade tatsächlich geöffnet"-Signal wiederverwendet, statt eine
// zweite, abweichende Definition von "angesehen" einzuführen.
//
// Nachtrag 2026-08-13, noch später (Nutzer-Zusatzwunsch: "wäre es glaube ich
// ganz cool, wenn einmal der Slot selbst, also das Pane, kurz mit aufleuchtet,
// plus das betroffene Tab, so dass man es halt auch wirklich wahrnimmt"): der
// `pc-attention-flash`-Aufblitz oben (Punkt 2) bleibt nicht mehr auf den Chip
// beschränkt — `onTabAttentionFlash` (optional, s. `PaneTabsProps`) meldet
// denselben false→true-Übergang zusätzlich nach außen. TerminalPane.tsx und
// FileEditor.tsx (BEIDE, nicht nur eine — welche der beiden gerade sichtbar
// ist, hängt an `showingFile`, s. `viewedTabId`-Kommentar in
// terminalActivity.ts) fangen ihn lokal auf und waschen ihre eigene
// `<section>` mit demselben Keyframe, statt eine zweite, eigene Animation zu
// erfinden — dieselbe "vorhandenes Muster wiederverwenden"-Linie wie der
// Chip-Flash selbst. Absichtlich NICHT über den Pane-Rahmen (`border-color`):
// der trägt bereits den Fokus, ein zweites Signal in derselben Fläche wäre
// als "diese Pane hat jetzt den Fokus" lesbar, nicht als "hier kam etwas
// rein" — bleibt bei reiner Flächenfarbe wie am Chip.
//
// Nachtrag 2026-08-13, Fokus-Leiterbahn (PCB-Metapher, s. FocusTrace.tsx —
// zwei minimale Ergänzungen an BEIDEN Tab-Arten, sonst bleibt die Box+
// doppelte-Unterkante-Optik unverändert):
// 1. STUB: der aktive Chip einer FOKUSSIERTEN Pane trägt einen 2px-Amber-Steg
//    unter seiner Unterkante, der sie optisch mit der Header-Hairline
//    darunter verbindet — "auf die Leitung gelötet". Nur bei Pane-Fokus:
//    ohne bestromte Leitung gibt es nichts, woran der Steg hinge.
// 2. DÄMPFUNG: in unfokussierten Panes fällt das Akzent-Amber des aktiven
//    Tabs auf dieselbe 45%-Abschwächung, die der Pane-Header für seine
//    Fokus-Hairline nutzt (`border-(--pc-pane-activeBorder)/45`,
//    TerminalPane.tsx) — der aktive Tab bleibt als Auswahl lesbar, aber nur
//    die fokussierte Pane spricht in voller Sättigung.
//
// Umbenennen (`renameTerminalTab`, `gridState.ts`) zeigt den eigenen Namen
// als ANHANG im bestehenden Tooltip (`am besten als Tooltip"`, Nutzer-Zitat,
// selbst als bevorzugte von zwei genannten Optionen) — bewusst NICHT als
// Chip, der beim Hover breiter wird: der Chip sitzt in einer `shrink-0`-
// Gruppe (Kopfkommentar weiter oben, "soll nie unter Platzdruck geraten"),
// ein einzelner wachsender Chip darin verschöbe seine Nachbarn im laufenden
// Betrieb — genau der Sprung, den `shrink-0` an dieser Stelle verhindern
// soll. Die Eingabe selbst (`TerminalTabRenameField` unten) ist ein
// `absolute` positioniertes Feld unterhalb des Chips (Widget-Material wie
// `ConfirmDialog.tsx`), nimmt also am Flex-Layout gar nicht erst teil.
//
// Rework 2026-08-19 — the waiting tab as a card pulled out of a card file
// (user: "it should look like an index card being pulled part way out", and:
// the 3px nudge "reads as nothing"). Three separate defects, one metaphor:
//
// 1. IT NOW GROWS, it no longer just moves. A card of unchanged size that
//    shifts by 3px reads as a wobble, not as being pulled. The chip's height
//    is now `1.5rem + --pc-tab-pull` (`.pc-tabcard`, App.css) and grows to
//    30px while the marker is on. All of that growth goes UPWARD, because the
//    tab row is bottom-aligned (`items-end` plus a fixed `h-6` on the group
//    above; the 18px "+" button opts back out with `self-center`). The bottom
//    edge therefore never moves — it stays welded to the header hairline,
//    which is both the physical point of the metaphor (the card is still in
//    the box) and the pixel-alignment fix already paid for once in the
//    "die Linien liegen nicht ganz sauber" correction above. The contents ride
//    the pull as a rigid body (`.pc-tabcard__label`), so the number does not
//    appear to sink into a growing box.
//
// 2. IT CAN ESCAPE THE PANE AT ALL. The pane `<section>` was `overflow-hidden`
//    with its header flush against the top edge — there was literally zero
//    headroom, so the old 3px lift was shaved down to about one visible pixel.
//    That is the real reason it "did nothing", and no amount of extra offset
//    would have helped. The pane now clips with `.pc-pane-clip` (App.css), a
//    `clip-path` with a negative top inset that opens a window above the
//    header and keeps the other three sides (and the rounded bottom corners)
//    clipping exactly as before. Deliberately NOT `overflow-clip-margin`, the
//    textbook answer: WebKit has never shipped it, and this app runs in
//    WKWebView on macOS. The pulled card pokes into the workspace gutter that
//    already exists between panes, so nothing in the layout shifts at rest —
//    no permanent padding was added to the header.
//
// 3. THE ELEVATION IS THEME-AWARE. The old shadow was a hardcoded
//    `rgba(0,0,0,0.35)` that only ever knew the dark theme. It is now
//    `--pc-lift-elevation` (theme.css), built like `--pc-glass-elevation`:
//    shared geometry up top, the colour (`--pc-lift-shadow`) per theme. Two
//    downward-offset layers with negative spread, no upward reach and no
//    inset sheen — depth, never glow, and never tinted with the one accent.
//
// The extra cue on top of the (still present) red dot is the pull itself plus
// its elevation — geometry and depth, no second colour. The dot additionally
// breathes (`pc-attention-breathe`, 2.4s, never down to zero): the only looping
// motion here, and the only part gated behind `prefers-reduced-motion` besides
// the pull and the label ride. With motion reduced, the card still sits there
// pulled out, shadow and all; only the travel between the two states is
// instant.
//
// Korrektur 2026-08-19, noch am selben Tag (Nutzer-Fund am laufenden Build:
// „so optisch wirklich schön finde ich das ehrlich gesagt nicht"): der erste
// Anlauf trug zusätzlich einen REITER — eine 2px-Leiste in `--pc-icon-red` an
// der Oberkante der Karte, als Spiegelbild der verdoppelten Unterkante des
// aktiven Tabs. Ersatzlos gestrichen. Die Idee stimmte auf dem Papier (gleicher
// Signalton wie der Punkt statt einer vierten Farbe, unterscheidbar durch
// Position statt durch Farbe), im echten Bild kippte sie das Ergebnis: auf
// einem ~24×30px-Chip standen damit DREI rote Flächen dicht beieinander — der
// Punkt, die Leiste und, je nach Tab, das ohnehin schon rot eingefärbte
// Tool-Icon-Badge. Zusammen mit der jetzt spürbar höheren, beschatteten Karte
// las sich das Ganze als „dieser Tab ist rot", also als Fehler/Alarm, statt als
// „diese Karte wartet ruhig, mit einem kleinen roten Marker". Die Lehre ist
// nicht „zu viel Rot" im Sinne von Sättigung, sondern FLÄCHENANTEIL: auf einer
// so kleinen Fläche addieren sich zwei kleine Signale in derselben Farbe nicht,
// sie verschmelzen zu einer eingefärbten Fläche. Der Auszug selbst ist der
// zweite Hinweis — Geometrie und Tiefe tragen ihn, ohne dem Chip Farbe
// hinzuzufügen; genau die Aufteilung, die der Direction Contract für den Akzent
// schon verlangt, hier nur auf das Attention-Rot angewandt. Nichts trat an die
// Stelle des Reiters: der Punkt ist wieder das einzige farbige Signal, und die
// Atmung ist der einzige nicht-farbliche Zusatz.
//
// Correction 2026-08-19, third pass the same day — the waiting card is AMBER
// now, and that reverses a rule both passes above defended. User, on the
// running build: "I'd prefer the tab get the colour area-wide, the orange
// tone." The two paragraphs above both concluded, correctly on their own terms,
// that the one app accent is reserved for focus and the active tab and that
// the pull must therefore stay colourless card stock. The product owner is the
// design authority here and overrode that knowingly, for this one state. Kept
// as a dated reversal instead of a rewrite, because the reasoning it overrides
// is still the reason everything else in this file behaves the way it does.
//
// Two things had to be solved for it, and they are the actual work of this
// pass:
//
// A. THE ACCENT NOW MEANS TWO THINGS, so shape has to separate them. A
//    background pane's selected tab can be `active` AND `isAwaitingAttention`
//    at once (`isTabAwaitingAttention`, terminalActivity.ts: the marker only
//    clears for the VIEWED tab of the focused pane), so both signals can land
//    on one 24px chip. They stay legible because they use the accent
//    differently: the active tab is OUTLINED (1px keyline + /14 wash, resting
//    height), the waiting card is FILLED (solid face, 6px taller, shadowed),
//    and a chip that is both wears the solid face plus its selection keyline
//    re-inked in `--pc-pane-background`. Filled = wants you, outlined =
//    selected, both = both. That is the same shape-not-hue separation the
//    "Akzent auf Tabs erlaubt" correction already established for pane focus
//    vs. active tab, extended by one term.
//
// B. EVERYTHING ON THE FACE FLIPS TO ONE INK. `--pc-pane-background` — label,
//    attention dot, resource-warn dot, selection keyline, and a hairline around
//    the tool badge. One rule, no per-element judgement calls, and it is safe
//    in both themes by construction because it is the ground the accent was
//    tuned against (WCAG 2.1 relative luminance, measured against the two
//    token pairs: 7.82:1 dark `#121314` on `#e59656`, 5.49:1 light `#ffffff`
//    on `#a05605`). It also removes three separate collisions the amber face
//    would otherwise have caused: `--pc-icon-red` on amber (1.04:1 in the light
//    theme — the dot would have been gone, not just dim),
//    `--pc-status-warn` (dark `#e8a33d`, amber on amber), and the tool badges'
//    warm brand fills, `#D97757` above all — the very badge that helped tip the
//    round before this one into "this tab is red". The dot losing its red is
//    the point, not a regression: the card face is the colour signal now, and
//    the FLÄCHENANTEIL lesson from the paragraph above says a second colour on
//    a chip this small merges instead of adding.
//
// The clearance the card needs grew with it: the workspace gutter is 12px, not
// 8px, and `.pc-pane-clip`'s window follows it exactly (App.css) — at 8px the
// raised card had ~2px of air left to the pane above, which did not clip but
// read as cramped ("the gap is too tight", same session). Both values live in
// App.css; nothing else hardcodes the gutter (`GridSplitters.tsx` measures it,
// `splitRatios.ts` takes it as a parameter).

interface TerminalTabInfo {
  tabId: string;
  /** 1-basiert, aus der Position in `Pane.terminalTabs` (gridState.ts trägt
   * keine Nummerierung selbst — reine Anzeigeableitung des Aufrufers). */
  number: number;
  /** Nutzer-Umbenennung (`renameTerminalTab`) — `null` heißt "kein eigener
   * Name", der Chip zeigt dann nur seine Nummer. */
  label: string | null;
}

/** Props dieser Komponente, als eigener Typ — TerminalPane.tsx und
 * FileEditor.tsx binden beide denselben Tab-Zustand derselben Pane ein
 * (Kopfkommentar) und reichen deshalb dasselbe Objekt einfach durch, statt
 * jedes Feld einzeln zu wiederholen. */
/** Der Zug eines Terminal-Tabs in eine andere Pane (Ticket 32) — er lebt in
 * `PaneGrid.tsx` (dort sind Ziele und Wirkung bekannt), hier hängen nur der
 * Griff und die Quell-Optik daran. Nicht exportiert: `PaneGrid.tsx` baut das
 * Objekt strukturell als Teil von `PaneTabsProps` (dieselbe Linie wie
 * `TerminalTabInfo` oben). */
interface PaneTabDrag {
  /** An `onPointerDown` des Chips. */
  start: (tabId: string, event: ReactPointerEvent<HTMLElement>) => void;
  /** Ob der unmittelbar folgende Klick noch zum eben beendeten Zug gehört —
   * ohne diese Abfrage würde jeder erfolgreiche Zug nebenbei den Quell-Tab
   * auswählen (das Pointer-Capture führt den Klick zum Chip zurück). */
  consumeClick: () => boolean;
  /** Welcher Tab DIESER Pane gerade gezogen wird, sonst `null`. */
  draggingTabId: string | null;
  /** Ob die Tabs dieser Pane überhaupt ziehbar sind — falsch beim letzten
   * verbleibenden Tab (dieselbe Untergrenze wie `closable`) und im
   * Fokus-Modus. Steuert allein die Ankündigung (`cursor-grab`); die
   * eigentliche Sperre sitzt in `start`. */
  draggable: boolean;
}

export interface PaneTabsProps {
  terminalTabs: readonly TerminalTabInfo[];
  activeTerminalTabId: string;
  /** Ob die EIGENE Pane gerade den Grid-Fokus trägt (`PaneCell`s `focused`
   * in PaneGrid.tsx) — unabhängig von `activeTerminalTabId`, das nur die
   * Tab-Auswahl INNERHALB dieser Pane trägt. Alleine für die
   * Needs-Attention-Unterdrückung auf dem ausgewählten Tab gebraucht (s.
   * Kopfkommentar dieser Datei, Korrektur zum Hintergrund-Pane-Fund) — die
   * Auswahl-Optik selbst (`active` an den Chips) bleibt davon unberührt. */
  paneFocused: boolean;
  showingFile: boolean;
  /** `null`, solange in dieser Pane keine Datei offen ist — dann gibt es
   * keinen File-Tab in der Leiste. */
  fileName: string | null;
  fileDirty: boolean;
  onSelectTerminalTab: (tabId: string) => void;
  /** `adapterId` (Ticket 35): omitted für den einfachen "+"-Klick (löst den
   * `terminal.defaultAdapter`-Default auf, s. `useGrid.ts`), explizit
   * gesetzt vom Adapter-Dropdown daneben — `null` für die eingebaute Shell,
   * sonst eine feste `adapters.ts`-Id. */
  onOpenTerminalTab: (adapterId?: string | null) => void;
  onCloseTerminalTab: (tabId: string) => void;
  /** Browser-übliches "Andere Tabs schließen" (Kontextmenü) — schließt alle
   * Terminal-Tabs AUSSER `tabId` in einem Zug, EIN gemeinsamer Guard statt
   * einer Rückfrage pro Tab (s. App.tsx' `closeOtherTerminalTabsGuarded`). */
  onCloseOtherTerminalTabs: (tabId: string) => void;
  /** Browser-übliches "Tabs rechts schließen" (Kontextmenü) — schließt alle
   * Terminal-Tabs rechts von `tabId` in einem Zug, EIN gemeinsamer Guard
   * statt einer Rückfrage pro Tab (s. App.tsx' `closeTerminalTabsToRightGuarded`). */
  onCloseTerminalTabsToRight: (tabId: string) => void;
  /** Kontextmenü-Aktion "Umbenennen" — `label: null` löscht den Namen wieder
   * (leeres/unverändertes Eingabefeld committen, s. `TerminalTabRenameField`). */
  onRenameTerminalTab: (tabId: string, label: string | null) => void;
  onSelectFile: () => void;
  /** Tab-Verschieben zwischen Panes (Ticket 32). */
  tabDrag: PaneTabDrag;
  /** Wo ein gerade schwebender Tab-Zug HIER landen würde — `null`, solange
   * kein Zug über dieser Pane schwebt. `index` ist der Einfüge-Slot in der
   * aktuellen Chip-Reihe (0 = vor dem ersten Chip … `länge` = hinter dem
   * letzten; beim Umsortieren innerhalb der eigenen Pane zählt der gezogene
   * Chip mit), `number` die Nummer, die der Tab NACH dem Drop trüge (beim
   * Umsortieren nach rechts nicht `index + 1` — der eigene Chip löst sich ja
   * heraus; die Umrechnung macht `PaneGrid.tsx`, das Quelle und Ziel kennt).
   * Rendert einen Platzhalter-Chip an genau dieser Stelle (s.
   * `IncomingTabSlot` unten): die präzise Antwort auf "wo genau würde er
   * einsortiert", Nutzer-Befund zum Tab-Zug ("nicht an eine ganz bestimmte
   * Stelle" droppen zu können). */
  incomingTab?: { index: number; number: number } | null;
  /** Der zuletzt per Zug angekommene Tab (PaneGrid.tsx setzt es beim Drop) —
   * sein Chip quittiert die Ankunft mit einem einmaligen, kurzen
   * `pc-drop-settle`-Wasch (App.css). `nonce` unterscheidet zwei Züge
   * desselben Tabs (key-Neumount startet die Animation erneut). */
  dropSettle?: { tabId: string; nonce: number } | null;
  /** Optional: meldet den false→true-Übergang von `unread` zusätzlich zum
   * eigenen Chip-Aufblitz nach außen — TerminalPane.tsx/FileEditor.tsx
   * nutzen das für den Pane-weiten Aufblitz (s. Kopfkommentar dieser Datei,
   * Nachtrag zum Pane-Aufblitz). Ohne Angabe passiert nichts zusätzlich. */
  onTabAttentionFlash?: (tabId: string) => void;
}

export function PaneTabs({
  terminalTabs,
  activeTerminalTabId,
  paneFocused,
  showingFile,
  fileName,
  fileDirty,
  onSelectTerminalTab,
  onOpenTerminalTab,
  onCloseTerminalTab,
  onCloseOtherTerminalTabs,
  onCloseTerminalTabsToRight,
  onRenameTerminalTab,
  onSelectFile,
  tabDrag,
  incomingTab = null,
  dropSettle = null,
  onTabAttentionFlash,
}: PaneTabsProps) {
  const { t } = useTranslation();
  // Höchstens EIN Umbenennen-Feld gleichzeitig offen, über die ganze Leiste
  // hinweg — dieselbe Alleinstellung wie ExplorerPanel.tsx' `isRenaming`
  // (dort pfadgeschlüsselt, hier tabId-geschlüsselt). Lebt bewusst hier statt
  // in `App.tsx`/`gridState.ts`: rein transiente UI-Absicht, kein
  // persistierter Zustand.
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  return (
    <div
      role="group"
      aria-label={t("paneTabs.selectView")}
      // `shrink-0` statt `shrink` (2026-08-13): diese Gruppe soll nie unter
      // Platzdruck geraten, das übernimmt der Spacer im Pane-Header
      // (TerminalPane.tsx/FileEditor.tsx) — sonst kann derselbe Sprung, den
      // der Spacer zwischen Terminal- und Datei-Ansicht behebt, innerhalb
      // EINER Ansicht wiederkehren, sobald ein Tab hinzukommt.
      //
      // Korrektur 2026-08-13, noch später (Nutzer-Fund per Screenshot: "die
      // Linien liegen nicht ganz sauber"): die eigene Umrandung dieser
      // Gruppe (`rounded border p-px`) ist ersatzlos gestrichen. Sie war rein
      // dekorativ — jeder Chip zeichnet ohnehin schon seine eigene komplette
      // Box (TerminalTabChip/PaneTab unten) — und war zugleich die Ursache
      // des gemeldeten Fehlers: mit eigenem 1px-Rahmen UND 1px-Padding kam
      // diese Gruppe auf 24px (Chip-Höhe) + 4px = 28px, vier Pixel mehr als
      // der sie umschließende `h-6`-Header (TerminalPane.tsx/FileEditor.tsx).
      // `items-center` zentrierte den Überstand je zur Hälfte über und unter
      // den Header hinaus — die eigene Unterkante dieser Gruppe lag dadurch
      // ~1px UNTER der Header-eigenen `border-b`-Hairline (Fokus-Signal,
      // 45% Deckkraft amber), zwei unabhängig positionierte Linien im selben
      // Pixel-Streifen, sichtbar leicht versetzt. Ohne eigene Randbox füllt
      // die Gruppe exakt die Chip-Höhe (24px) und damit exakt die
      // Header-Höhe — nur noch EINE Linie an dieser Kante, die der Chips
      // selbst (aktiv: volle Akzent-Box; inaktiv: gedämpfte 1px-Kontur).
      //
      // Nachtrag 2026-08-19 (Karteikarten-Umbau, s. Kopfkommentar):
      // `items-end` statt `items-center`, dazu explizit `h-6`. Der wartende
      // Chip wird jetzt HÖHER als seine Nachbarn (24px → 30px), und nur eine
      // untenbündige Reihe lässt dieses Wachstum vollständig nach oben gehen
      // — mit `items-center` hätte es sich wieder je zur Hälfte auf beide
      // Kanten verteilt und die Unterkante genau um die 1px verschoben, die
      // der Absatz darüber teuer geradegezogen hat. Das `h-6` hält die Gruppe
      // dabei auf Chiphöhe, obwohl ein Kind zeitweise darüber hinausragt:
      // ohne feste Höhe wüchse die Gruppe mit dem Chip mit und säße als
      // 30px-Block wieder mittig im 24px-Header — derselbe Fehler, nur an
      // einer Ebene höher.
      className="flex h-6 min-w-0 shrink-0 items-end gap-px"
    >
      {/* Der Platzhalter des schwebenden Tab-Zugs steht AN seinem Einfüge-
          Slot zwischen den Chips (flatMap statt map), nicht mehr fix am Ende
          — die Leiste zeigt exakt die Reihenfolge, die ein Loslassen jetzt
          ergäbe. Sein fester Key hält ihn beim Wandern zwischen den Slots
          als dasselbe Element (kein Neumount pro Position). */}
      {terminalTabs.flatMap((tab, i) => [
        ...(incomingTab !== null && incomingTab.index === i
          ? [<IncomingTabSlot key="incoming-tab" number={incomingTab.number} />]
          : []),
        <TerminalTabChip
          key={tab.tabId}
          tabId={tab.tabId}
          number={tab.number}
          label={tab.label}
          active={!showingFile && tab.tabId === activeTerminalTabId}
          paneFocused={paneFocused}
          // Der letzte verbleibende Terminal-Tab lässt sich nicht schließen
          // (gridState.ts' closeTerminalTab ist an dieser Stelle ohnehin ein
          // No-Op) — der Menüpunkt entfällt dafür ganz, statt wirkungslos
          // anklickbar zu bleiben.
          closable={terminalTabs.length > 1}
          otherTabsCount={terminalTabs.length - 1}
          tabsToRightCount={terminalTabs.length - 1 - i}
          draggable={tabDrag.draggable}
          dragging={tabDrag.draggingTabId === tab.tabId}
          renaming={tab.tabId === renamingTabId}
          onAttentionFlash={
            onTabAttentionFlash ? () => onTabAttentionFlash(tab.tabId) : undefined
          }
          settleNonce={dropSettle?.tabId === tab.tabId ? dropSettle.nonce : null}
          onPointerDown={(event) => tabDrag.start(tab.tabId, event)}
          onSelect={() => {
            // Der Abschlussklick eines Zugs darf den Quell-Tab nicht
            // nebenbei auswählen (s. `PaneTabDrag.consumeClick`).
            if (tabDrag.consumeClick()) return;
            onSelectTerminalTab(tab.tabId);
          }}
          onClose={() => onCloseTerminalTab(tab.tabId)}
          onCloseOthers={() => onCloseOtherTerminalTabs(tab.tabId)}
          onCloseTabsToRight={() => onCloseTerminalTabsToRight(tab.tabId)}
          onStartRename={() => setRenamingTabId(tab.tabId)}
          onCommitRename={(label) => {
            onRenameTerminalTab(tab.tabId, label);
            setRenamingTabId(null);
          }}
          onDiscardRename={() => setRenamingTabId(null)}
        />,
      ])}
      {incomingTab !== null && incomingTab.index >= terminalTabs.length && (
        <IncomingTabSlot key="incoming-tab" number={incomingTab.number} />
      )}
      <ChromeTooltip label={t("paneTabs.openTerminalTab")}>
        <button
          type="button"
          aria-label={t("paneTabs.openTerminalTab")}
          onClick={() => onOpenTerminalTab()}
          // `self-center` hält diesen Knopf da, wo er immer saß: er ist mit
          // 18px (`--pc-paneControl-size`) kleiner als die 24px-Chips, das
          // untenbündige `items-end` der Gruppe (2026-08-19) würde ihn sonst
          // um 3px nach unten fallen lassen und aus der Kopfzeilenmitte
          // kippen. Die Chips brauchen die Unterkante als Bezug, dieses
          // Bedienelement die Mitte — beides gleichzeitig geht nur, indem
          // genau dieses eine Kind ausschert.
          className={`flex size-(--pc-paneControl-size) shrink-0 self-center items-center justify-center rounded-(--pc-paneControl-radius) text-(--pc-paneHeader-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
        >
          <PlusIcon />
        </button>
      </ChromeTooltip>
      {/* Ticket 35: Dropdown neben dem "+"-Knopf — der Klick selbst startet
          immer schon den `terminal.defaultAdapter`-Default (Knopf oben),
          dieses Menü bietet die Alternativen dazu an, genau wie im Ticket
          gefordert ("ein Dropdown daneben"). Eigener Trigger statt eines
          Untermenüs am "+"-Knopf: der bleibt so ein einfacher, sofortiger
          Klick ohne Menü-Umweg für den häufigen Fall. */}
      <DropdownMenu.Root>
        <ChromeTooltip label={t("paneTabs.chooseAdapter")}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={t("paneTabs.chooseAdapter")}
              className={`flex size-(--pc-paneControl-size) shrink-0 self-center items-center justify-center rounded-(--pc-paneControl-radius) text-(--pc-paneHeader-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
            >
              <ChevronDownIcon />
            </button>
          </DropdownMenu.Trigger>
        </ChromeTooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={`min-w-40 ${CHROME_MENU_CONTENT_CLASS}`}>
            {ADAPTER_PICKER_OPTIONS.map((option) => (
              <DropdownMenu.Item
                key={option.id ?? "shell"}
                onSelect={() => onOpenTerminalTab(option.id)}
                className={CHROME_MENU_ITEM_CLASS}
              >
                {t(option.labelKey)}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {fileName !== null && (
        <PaneTab
          label={fileName}
          dirty={fileDirty}
          active={showingFile}
          paneFocused={paneFocused}
          onClick={onSelectFile}
        />
      )}
    </div>
  );
}

// Ein einzelner Terminal-Tab: nur die Nummer, mittig, IMMER sichtbar
// (Kopfkommentar). Schließen und Umbenennen laufen beide über das
// Kontextmenü (Rechtsklick) — Schließen zusätzlich über Mittelklick
// (`onAuxClick`), dasselbe Idiom wie Browser-Tabs, das die Entwickler-
// Zielgruppe dieser App aus jedem Chrome-artigen Werkzeug kennt.
function TerminalTabChip({
  tabId,
  number,
  label,
  active,
  paneFocused,
  closable,
  otherTabsCount,
  tabsToRightCount,
  draggable,
  dragging,
  renaming,
  settleNonce,
  onAttentionFlash,
  onPointerDown,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseTabsToRight,
  onStartRename,
  onCommitRename,
  onDiscardRename,
}: {
  tabId: string;
  number: number;
  label: string | null;
  active: boolean;
  paneFocused: boolean;
  closable: boolean;
  /** Zahl der ANDEREN Terminal-Tabs derselben Pane — `0` blendet den
   * Browser-üblichen "Andere Tabs schließen"-Menüpunkt aus, sonst zählt sein
   * Label die tatsächliche Anzahl vor (dasselbe Prinzip wie `closable`
   * unten). Deckungsgleich mit `closable`s Bedingung (`> 1` Tab insgesamt),
   * aber als eigene Zahl geführt statt aus `closable` zurückgerechnet — der
   * Elter kennt die Gesamtzahl ohnehin schon (s. `PaneTabs`' `terminalTabs.
   * length - 1`). */
  otherTabsCount: number;
  /** Zahl der Terminal-Tabs rechts von diesem Chip — `0` blendet den
   * Browser-üblichen "Tabs rechts schließen"-Menüpunkt ganz aus (leere
   * Aktion sonst, s. `closable` oben für dasselbe Prinzip beim einzelnen
   * Schließen), sonst zählt sein Label die tatsächliche Anzahl vor. */
  tabsToRightCount: number;
  /** Ob dieser Chip als Zieh-Griff angekündigt wird (Ticket 32). */
  draggable: boolean;
  /** Ob GENAU DIESER Chip gerade gezogen wird — er tritt dann zurück, wie
   * die gezogene Pane beim Slot-Tausch. */
  dragging: boolean;
  renaming: boolean;
  /** Nicht-`null`, wenn dieser Tab gerade per Zug hier angekommen ist —
   * startet den einmaligen `pc-drop-settle`-Wasch (s. `PaneTabsProps.
   * dropSettle`). */
  settleNonce: number | null;
  onAttentionFlash?: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onSelect: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseTabsToRight: () => void;
  onStartRename: () => void;
  onCommitRename: (label: string | null) => void;
  onDiscardRename: () => void;
}) {
  const { t } = useTranslation();
  const baseLabel = t("paneTabs.terminalTab", { number });
  const toolIcon = resolveToolIcon(useDetectedToolId(tabId));
  const toolLabel = toolIcon ? t(toolIcon.labelKey) : null;
  // Derived live from terminalActivity.ts' module state (this file's header
  // comment, Umbau 2026-08-17) — true once this tab has done real work and
  // then fallen silent, false again the instant new output arrives or the
  // user looks at it via `markTabViewed` below.
  const isAwaitingAttention = useTerminalAwaitingAttention(tabId);
  // Pro-Tab-Ressourcen-Eskalationskette (`resource_guard.rs`): "warn" ist die
  // einzige Stufe, die dieser Chip selbst zeigt — "paused"/"terminated"
  // übernimmt `TabResourceBanner.tsx` in der Terminalfläche, hier reicht ein
  // stiller Hinweis, kein Alarm.
  const isResourceWarn = useTabResourceGuard(tabId).status === "warn";
  const isViewed = active && paneFocused;
  // `markTabViewed` meldet "der Nutzer sieht diesen Tab gerade tatsächlich"
  // an terminalActivity.ts, sobald Auswahl UND Pane-Fokus zusammenfallen —
  // dieselbe Kombination wie zuvor die reine Badge-Unterdrückung, jetzt
  // zusätzlich der einzige Weg, den Marker sofort zu löschen statt erst über
  // die nächste Aktivität abzuwarten.
  useEffect(() => {
    if (isViewed) markTabViewed(tabId);
  }, [isViewed, tabId]);
  // Fires the one-shot flash effect (App.css' `pc-attention-flash`) exactly
  // on the false→true transition of `isAwaitingAttention`, not on every
  // re-render while it's already true — a `key` remount per transition
  // restarts the `animation` fresh each time (same pattern as the tool icon
  // badge, see `pc-overlay-in` in the header comment above). Also drives the
  // persistent "lifted" resting state further below for as long as the
  // marker stays active, not just the one-shot flash.
  const wasAwaitingAttentionRef = useRef(isAwaitingAttention);
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (isAwaitingAttention && !wasAwaitingAttentionRef.current) {
      setFlashKey((key) => key + 1);
      onAttentionFlash?.();
    }
    wasAwaitingAttentionRef.current = isAwaitingAttention;
  }, [isAwaitingAttention, onAttentionFlash]);
  const needsAttentionLabel = isAwaitingAttention
    ? t("paneTabs.awaitingAttentionLabel")
    : null;
  const resourceWarnLabel = isResourceWarn ? t("resourceGuard.warnTabSuffix") : null;
  // Nur die Zahlen 1-9 haben ein Kürzel (registry.ts) — ein zehnter Tab wäre
  // ohnehin am Rand dessen, was in eine Pane-Kopfzeile passt, und bekommt
  // schlicht keinen Akkord im Tooltip.
  const shortcut = SHORTCUTS.find((def) => def.id === terminalTabSelectId(number));
  const chordLabel = shortcut
    ? `${baseLabel} (${formatChord(shortcut, isMacPlatform() ? "mac" : "other")})`
    : baseLabel;
  // Der eigene Name UND das erkannte Tool hängen sich als Anhang an den
  // Tooltip, statt ihn zu ersetzen — die Nummer bleibt die verlässliche,
  // immer gültige Kennung (Cmd/Strg+1..9 bleibt positionsbasiert), beides
  // andere ist zusätzlicher Kontext. Siehe Kopfkommentar dieser Datei zur
  // "am besten als Tooltip"-Entscheidung.
  const suffixParts = [label, toolLabel, needsAttentionLabel, resourceWarnLabel].filter(
    (part): part is string => part !== null,
  );
  // Der Mittelklick-Hinweis hängt sich NUR an den sichtbaren Tooltip, nicht
  // an `ariaLabel` (Punkt c) der User-Anfrage, "Tabster"-Optimierung ohne
  // Schließkreuz): die Geste existiert schon länger (`onAuxClick` oben), war
  // aber nirgends kommuniziert. Für Screenreader-Nutzer ist ein
  // Maus-only-Gesten-Hinweis dagegen reine Ablenkung, keine zusätzliche
  // Information — sie haben mit dem Kontextmenü ohnehin den vollwertigen Weg.
  // Nur wenn überhaupt schließbar (letzter verbleibender Tab, s. `closable`
  // oben), sonst wäre der Hinweis für eine wirkungslose Geste irreführend.
  const tooltipSuffixParts = closable
    ? [...suffixParts, t("paneTabs.middleClickCloseHint")]
    : suffixParts;
  const tooltipLabel =
    tooltipSuffixParts.length === 0
      ? chordLabel
      : `${chordLabel} — ${tooltipSuffixParts.join(" · ")}`;
  const ariaLabel =
    suffixParts.length === 0 ? baseLabel : `${baseLabel}: ${suffixParts.join(" · ")}`;
  // Radix' ContextMenu.Content hält seinen FocusScope-Trap bis zum Ende des
  // eigenen Schließvorgangs aktiv (in der echten App bis zum Ablauf der
  // `CHROME_MENU_CONTENT_CLASS`-Austrittsanimation) — ein Fokussieren des neu
  // eingehängten Umbenennen-Felds VOR diesem Zeitpunkt (z. B. direkt aus dem
  // Menüpunkt-`onSelect`) würde vom Trap augenblicklich zurückgeworfen. Statt
  // die Absicht sofort umzusetzen, hält `onSelect` hier nur eine Absicht fest
  // und `ContextMenu.Content`s eigener `onCloseAutoFocus` — Radix' offizieller
  // Hook für "nach dem Schließen selbst fokussieren", garantiert erst NACH
  // dem Trap-Abbau zu feuern — setzt sie danach um.
  //
  // "Schließen" braucht denselben Umweg: `onClose` mündet in App.tsx'
  // `closeTerminalTabGuarded`, das eine zweite Focus-trap-Overlay einhängt
  // (`ConfirmDialog`s `AlertDialog`, fokussiert per Default den
  // Abbrechen-Button) — synchron aus `onSelect` heraus kollidiert das mit
  // demselben noch aktiven ContextMenu-Trap wie beim Umbenennen-Feld oben,
  // nur einen Hop weiter unten. Ein gemeinsamer Absicht-Ref statt zweier
  // getrennter Booleans, weil immer nur einer der beiden Menüpunkte gewählt
  // werden kann.
  const pendingActionRef = useRef<
    "rename" | "close" | "closeOthers" | "closeToRight" | null
  >(null);

  // Während des Umbenennens bewusst OHNE `ChromeTooltip`-Hülle: der Tooltip
  // triggert auf Hover, und die Maus steht nach dem Menüpunkt-Klick fast
  // immer noch genau über dem Chip — ohne diesen Zweig läge der Tooltip-Text
  // sichtbar über dem frisch fokussierten Eingabefeld.
  const trigger = (
    <ContextMenu.Trigger asChild>
      {/* `pc-tabcard` (App.css) besitzt die Höhe dieses Chips — 24px in Ruhe,
          `+ --pc-tab-pull` im herausgezogenen Zustand — statt eines festen
          `h-6`; sie ist der Wert, auf den der Auszug addiert. Die Kartenfläche
          (opaker Grund) sitzt hier auf der Hülle und nicht auf dem Knopf, damit
          dessen eigener Hintergrund (Akzent-Lasur des aktiven Tabs,
          Hover-Füllung) und seine `-z-10`-Wasch-Flächen weiterhin DARÜBER malen
          können — Begründung im App.css-Block.
          Beim Umbenennen bewusst NICHT herausgezogen: dann rendert statt des
          Knopfs nur das absolut positionierte Eingabefeld, die Hülle bliebe als
          leere, 30px hohe Kartenfläche im Kopf stehen. */}
      <span
        className={`group/tab pc-tabcard relative flex shrink-0 items-stretch rounded-t-(--pc-paneControl-radius) ${
          isAwaitingAttention && !renaming ? "pc-tabcard--pulled" : ""
        }`}
      >
        {renaming ? (
          <TerminalTabRenameField
            number={number}
            initialValue={label ?? ""}
            onCommit={onCommitRename}
            onDiscard={onDiscardRename}
          />
        ) : (
          <button
            type="button"
            onPointerDown={onPointerDown}
            onClick={onSelect}
            onAuxClick={(event) => {
              // Mittelklick (button === 1) schließt, wie in jedem
              // Browser — nur wenn überhaupt schließbar (letzter
              // verbleibender Tab, s. `closable` oben).
              if (event.button === 1 && closable) {
                event.preventDefault();
                onClose();
              }
            }}
            aria-pressed={active}
            aria-label={ariaLabel}
            // Messhaken für die Einfüge-Position des Tab-Zugs
            // (`PaneGrid.tsx`' `terminalTabInsertionIndex`): die Chip-Mitten
            // entscheiden, vor oder hinter welchem Chip ein Drop landete.
            // Ein data-Attribut wie `data-pane-id`, kein aria-Merkmal — für
            // Screenreader ist der Chip weiterhin nur ein Knopf.
            data-terminal-tab-chip={tabId}
            // `border-b-2` IMMER gesetzt (Farbe verzweigt, nicht die Kante
            // selbst) — sonst würde die 2px-Zeile beim Aktivwerden neu
            // reserviert und die Zahl spränge einen Frame lang nach oben.
            // Nur oben gerundet (`rounded-t-*`, nicht `rounded-*`): eine
            // volle Rundung hätte die harte Unterkante an den beiden
            // unteren Ecken gebrochen, dort wo die 2px-Unterkante auf die
            // 1px-Seiten trifft — sichtbar als heller Verlaufs-Artefakt
            // (Design-Hook-Fund `border-accent-on-rounded`). Unten eckig
            // umgeht das, weil der Breitenunterschied dort nie auf eine
            // Kurve trifft.
            //
            // `px-3` symmetrisch (2026-08-13, nach Wegfall des
            // Schließkreuz-Randbereichs): ohne reservierten Platz rechts
            // braucht die Zentrierung der Zahl kein asymmetrisches
            // Padding mehr, `min-w-6` hält die Trefferfläche trotzdem über
            // der WCAG-2.5.8-Mindestgröße für einstellige Nummern.
            //
            // Aktiv: volle Box statt nur einer Unterkante (Nutzer-Fund:
            // „nur der orange Border unten sieht nicht so toll aus …
            // deutlicher als aktiv erkennbar") — 1px `--pc-pane-
            // activeBorder` rundum, `border-b-2` verdoppelt nur die
            // Unterkante als zusätzliches Gewicht, dazu eine warme
            // Akzent-Lasur als Füllung (`/14`) statt der vorigen
            // neutralen Auswahlfüllung. Derselbe Token wie
            // TerminalPane.tsx' Fokus-Hairline (nicht `--pc-focusBorder`
            // direkt — das ist der strikte Fokusring-Ton; `--pc-pane-
            // activeBorder` ist der dafür vorgesehene Chrome-Zwilling,
            // hier korrekt mit `--pc-paneHeader-activeForeground`
            // gepaart, derselben Paarung wie im Pane-Header).
            // Inaktiv: jetzt mit sichtbarer, dauerhafter 1px-Box in
            // gedämpftem Grau statt `border-transparent` — Nutzer-Fund:
            // ohne Kontur las sich ein inaktiver Tab gar nicht mehr als
            // Tab, nur noch als schwebender Text. Erst bei Hover hellt
            // Rand UND Füllung auf.
            // `cursor-grab`/`opacity-50` (Ticket 32): dieselbe Ankündigung
            // und derselbe Rückzug wie beim Pane-Header-Griff — ein Chip, der
            // nirgendwo hinkann (letzter Tab, Fokus-Modus), kündigt sich auch
            // nicht als Griff an. Während des Zugs `cursor-grabbing`: das
            // Pointer-Capture hält den Zeiger am Chip, dessen Cursor gilt
            // also für den ganzen Zug — die geschlossene Hand ist das
            // systemübliche "ich halte gerade etwas".
            //
            // `isAwaitingAttention` (2026-08-17, Auszug-Umbau 2026-08-19, s.
            // Kopfkommentar): der Chip steht heraus, solange der Marker aktiv
            // ist — "als würde man diese Karteikarte ein bisschen rausziehen",
            // Nutzer-Zitat zur gewünschten Optik. Geometrie und Kartenfläche
            // liegen an der `pc-tabcard`-Hülle (App.css), hier bleibt, was
            // wirklich diesem Knopf gehört: seine Erhebung, seine Tinte und
            // seine Randlinie (Amber-Fassung, Korrektur 2026-08-19 im
            // Kopfkommentar). `--pc-lift-
            // elevation` (theme.css) statt des vorigen, hart notierten
            // `rgba(0,0,0,0.35)` — der kannte nur das Dark-Theme und lag im
            // Light-Theme als schwarzer Klotz unter der Karte. `box-shadow`
            // steht schon in der Transition-Liste dieses Knopfs, das Ein- und
            // Ausblenden läuft also ohne weiteres Zutun mit dem Auszug
            // zusammen. Bewusst keine Akzentfarbe IM SCHATTEN: die Karte
            // darüber ist inzwischen selbst vollflächig Amber, ein amber
            // getönter Schatten daran läse sich als Glühen statt als Tiefe —
            // und Tiefe ist genau der Anteil, den der Schatten hier beiträgt.
            //
            // `isolate`: dieser Knopf spannt seinen eigenen Stacking-Context
            // auf, damit die beiden `-z-10`-Wasch-Flächen weiter unten
            // garantiert IN ihm bleiben — direkt über seiner eigenen Fläche,
            // unter seiner Beschriftung. Vorher hing das daran, dass der
            // wartende Chip zufällig ein `-translate-y` (und damit einen
            // Stacking-Context) trug; ohne diesen Ersatz wären die Flächen mit
            // dem Wegfall des Translate hinter den nächsten opaken Grund
            // gerutscht und unsichtbar geworden — was `pc-drop-settle`, das
            // nie ein Translate hatte, ohnehin schon war.
            className={`relative flex h-full min-w-6 isolate items-center justify-center rounded-t-(--pc-paneControl-radius) border border-b-2 px-3 text-(length:--pc-chrome-fontSizeSmall) transition-[color,background-color,border-color,transform,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              dragging ? "cursor-grabbing" : draggable ? "cursor-grab" : ""
            } ${dragging ? "opacity-50" : ""} ${
              // Drei Zweige, kein Anhängen: seit die wartende Karte eine
              // Amber-Fläche trägt (Korrektur 2026-08-19, Kopfkommentar A/B),
              // setzt sie `text-`, `border-` und konkurriert um `bg-` — dieselben
              // Eigenschaften wie die beiden Auswahl-Zweige darunter. Zwei
              // Utilities für dieselbe Eigenschaft in einer Klassenliste
              // entscheidet nicht die Reihenfolge hier, sondern die im erzeugten
              // Stylesheet; der Wartezustand ERSETZT den Farbzweig deshalb, statt
              // ihn zu ergänzen. Aus demselben Grund fällt auf der Karte auch das
              // Hover-Paar des inaktiven Chips weg: eine graue Randlinie, die beim
              // Überfahren auf einer vollflächigen Amber-Karte auftaucht, wäre
              // genau das nächste Bildschirmfoto.
              //
              // Die Abschwächung auf /45 in unfokussierten Panes gilt bewusst nur
              // für die Auswahl, nicht für den Wartezustand: „wartet auf dich" ist
              // per Definition ein Zustand von Tabs, die man gerade NICHT ansieht
              // (`isTabAwaitingAttention`, terminalActivity.ts) — ein gedämpfter
              // Marker wäre ein Marker, der nie in voller Stärke vorkommt.
              isAwaitingAttention
                ? `shadow-[var(--pc-lift-elevation)] text-(--pc-pane-background) hover:bg-(--pc-pane-background)/10 ${
                    active
                      ? "border-(--pc-pane-background) font-semibold"
                      : "border-(--pc-pane-activeBorder) font-medium"
                  }`
                : active
                  ? `${
                      paneFocused
                        ? "border-(--pc-pane-activeBorder)"
                        : "border-(--pc-pane-activeBorder)/45"
                    } bg-(--pc-pane-activeBorder)/14 font-semibold text-(--pc-paneHeader-activeForeground)`
                  : "border-(--pc-paneHeader-border) font-medium text-(--pc-paneHeader-foreground) hover:border-(--pc-pane-border) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground)"
            } ${CHROME_FOCUS_RING}`}
          >
            {active && paneFocused && <TraceStub />}
            {settleNonce !== null && (
              // Ankunfts-Quittung nach einem Tab-Zug: derselbe key-Neumount-
              // Mechanismus wie der Attention-Flash direkt darunter, nur mit
              // der kurzen pc-drop-settle-Kurve (App.css) — die Handlung war
              // die eigene, sie braucht Bestätigung, keinen Alarm.
              <span
                key={`settle-${String(settleNonce)}`}
                aria-hidden="true"
                data-drop-settle=""
                className="pointer-events-none absolute inset-0 -z-10 animate-[pc-drop-settle_300ms_ease-out] rounded-t-(--pc-paneControl-radius)"
              />
            )}
            {flashKey > 0 && (
              <span
                key={flashKey}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 animate-[pc-attention-flash_1400ms_ease-out] rounded-t-(--pc-paneControl-radius)"
              />
            )}
            {/* `pc-tabcard__label` (App.css): der Inhalt fährt den Auszug als
                starrer Körper mit — die wachsende Box hebt ihn von allein nur
                um die Hälfte. */}
            <span className="pc-tabcard__label flex items-center gap-1">
              {isAwaitingAttention && (
                <span
                  aria-hidden="true"
                  data-attention-dot=""
                  className="pc-tabcard__dot size-1.5 shrink-0 rounded-full bg-(--pc-pane-background)"
                />
              )}
              {isResourceWarn && (
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${
                    // Auf der Amber-Karte hätte `--pc-status-warn` im Dark-Theme
                    // (#e8a33d) praktisch keinen Kontrast mehr — dieselbe Tinte
                    // wie jede andere Marke darauf.
                    isAwaitingAttention
                      ? "bg-(--pc-pane-background)"
                      : "bg-(--pc-status-warn)"
                  }`}
                />
              )}
              {toolIcon && (
                <span
                  aria-hidden="true"
                  className={`flex size-4 shrink-0 animate-[pc-overlay-in_150ms_ease-out] items-center justify-center rounded-[3px] transition-colors ${
                    toolIcon.badgeClassName ?? "border border-current/35"
                  } ${
                    // Markenfarben der Tool-Badges sind warm (Claude #D97757 vorn // brandlint-ok: funktionale Farbwert-Begründung, kein Marketing
                    // weg) und verschmieren auf der Amber-Karte zur Fläche. Eine
                    // Haarlinie in der Kartentinte trennt sie wieder ab —
                    // `outline` statt `border`, damit die 16px-Box nicht kleiner
                    // wird. Der Fallback ohne Markenfläche braucht sie nicht:
                    // dessen `border-current` IST bereits die Tinte.
                    isAwaitingAttention && toolIcon.badgeClassName
                      ? "outline-1 outline-(--pc-pane-background)"
                      : ""
                  }`}
                >
                  <toolIcon.Icon />
                </span>
              )}
              {/* Terminalschrift + tabular-nums statt der Chrome-Schrift:
                  die Nummer ist HUD-Readout wie die Slot-Nummern der leeren
                  Slots (ProjectPicker.tsx) und bleibt bei jedem Wert gleich
                  breit. */}
              <span className="font-(family-name:--pc-terminal-fontFamily) tabular-nums">
                {number}
              </span>
            </span>
          </button>
        )}
      </span>
    </ContextMenu.Trigger>
  );

  return (
    <ContextMenu.Root>
      {renaming ? trigger : <ChromeTooltip label={tooltipLabel}>{trigger}</ChromeTooltip>}
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={`min-w-40 ${CHROME_MENU_CONTENT_CLASS}`}
          // Ersetzt Radix' Standardverhalten (Fokus zurück auf den Trigger)
          // durch die oben beschriebene Übergabe ans Umbenennen-Feld, sofern
          // "Umbenennen" der Menüpunkt war, der das Schließen ausgelöst hat.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const action = pendingActionRef.current;
            pendingActionRef.current = null;
            if (action === "rename") {
              onStartRename();
            } else if (action === "close") {
              onClose();
            } else if (action === "closeOthers") {
              onCloseOthers();
            } else if (action === "closeToRight") {
              onCloseTabsToRight();
            }
          }}
        >
          <ContextMenu.Item
            onSelect={() => {
              pendingActionRef.current = "rename";
            }}
            className={CHROME_MENU_ITEM_CLASS}
          >
            {t("paneTabs.renameTerminalTab", { number })}
          </ContextMenu.Item>
          {/* Trennt "Umbenennen" von der Schließen-Gruppe darunter, dasselbe
              Idiom wie ExplorerPanel.tsx/TerminalPane.tsx' Kontextmenüs —
              erst ab hier geht es um Tabs, die verschwinden. */}
          {(closable || tabsToRightCount > 0) && (
            <ContextMenu.Separator className={CHROME_MENU_SEPARATOR_CLASS} />
          )}
          {closable && (
            <ContextMenu.Item
              onSelect={() => {
                pendingActionRef.current = "close";
              }}
              className={CHROME_MENU_ITEM_CLASS}
            >
              {t("paneTabs.closeTerminalTab", { number })}
            </ContextMenu.Item>
          )}
          {otherTabsCount > 0 && (
            <ContextMenu.Item
              onSelect={() => {
                pendingActionRef.current = "closeOthers";
              }}
              className={CHROME_MENU_ITEM_CLASS}
            >
              {t("paneTabs.closeOtherTerminalTabs", { count: otherTabsCount })}
            </ContextMenu.Item>
          )}
          {tabsToRightCount > 0 && (
            <ContextMenu.Item
              onSelect={() => {
                pendingActionRef.current = "closeToRight";
              }}
              className={CHROME_MENU_ITEM_CLASS}
            >
              {t("paneTabs.closeTerminalTabsToRight", { count: tabsToRightCount })}
            </ContextMenu.Item>
          )}
          {/* Eigene Trenngruppe: anders als "Schließen" oben bleibt der Tab
              nach diesem Punkt BESTEHEN (nur der Prozess stirbt, dieselbe
              Terminated-Anzeige wie Tier 4 der Ressourcen-Eskalationskette,
              s. `resource_guard.rs`s `resource_guard_kill_manual`) — eine
              andere Handlungsklasse als alles darüber, deshalb sichtbar
              abgesetzt statt in dieselbe Gruppe gemischt. Kein
              pendingActionRef-Umweg nötig: `invoke` öffnet keine zweite
              Fokus-Trap-Fläche wie `onClose`/`onStartRename`, kollidiert also
              nicht mit dem noch aktiven ContextMenu-Trap. */}
          <ContextMenu.Separator className={CHROME_MENU_SEPARATOR_CLASS} />
          <ContextMenu.Item
            onSelect={() => {
              void invoke("resource_guard_kill_manual", { tabId }).catch(() => {
                // Best-effort wie jeder andere PTY-Kill-Aufruf im Frontend
                // (s. `ptyBackend.ts`s `reportIpcFailure`) — ein bereits
                // toter/unbekannter Tab ist kein Nutzerfehler.
              });
            }}
            className={CHROME_MENU_ITEM_CLASS}
          >
            {t("paneTabs.killTerminalTab", { number })}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// Ersetzt die Nummer durch ein `absolute` positioniertes Eingabefeld
// unterhalb des Chips (Widget-Material wie `ConfirmDialog.tsx` — dieselben
// `--pc-widget-*`-Töne) — nimmt bewusst NICHT am Flex-Layout der Tab-Gruppe
// teil (Begründung: Kopfkommentar dieser Datei). Enter committet, Escape UND
// Blur verwerfen (kein `RenameField`-artiges Commit-on-Blur: ein Klick weg
// vom Feld ist hier eher ein "ich hab's mir anders überlegt" als ein
// "fertig", anders als bei ExplorerPanel.tsx' Dateiumbenennung). Leeres oder
// unverändertes Feld committet als "kein Name" (`label: null`) — so lässt
// sich ein vergebener Name über dasselbe Feld auch wieder löschen.
function TerminalTabRenameField({
  number,
  initialValue,
  onCommit,
  onDiscard,
}: {
  number: number;
  initialValue: string;
  onCommit: (label: string | null) => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const commit = () => {
    const trimmed = value.trim();
    onCommit(trimmed === "" ? null : trimmed);
  };

  return (
    <div className="absolute left-0 top-full z-20 mt-1 w-36 rounded-md border border-(--pc-widget-border) bg-(--pc-widget-background) p-1 shadow-lg">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={t("paneTabs.renameTerminalTabFieldLabel", { number })}
        placeholder={t("paneTabs.terminalTab", { number })}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onDiscard();
          }
        }}
        onBlur={onDiscard}
        className={`w-full rounded bg-transparent px-1.5 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground) outline-none ${CHROME_FOCUS_RING}`}
      />
    </div>
  );
}

function PaneTab({
  label,
  dirty,
  active,
  paneFocused,
  onClick,
}: {
  label: string;
  dirty?: boolean;
  active: boolean;
  paneFocused: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // Dieselbe Aktiv-Signalisierung wie TerminalTabChip (volle 1px-Box,
      // verdoppelte Unterkante, Akzent-Lasur, gepaartes Foreground-Token,
      // seit der Leiterbahn-Runde auch Stub + 45%-Dämpfung) — ein Bauteil,
      // ein Idiom, s. Kopfkommentar dieser Datei. Kein
      // ❯-Präfix (2026-08-13 mitentfernt, s. Kopfkommentar "Nachtrag …noch
      // später") — dasselbe Idiom auf beiden Tab-Arten heißt auch: beide
      // verlieren dasselbe Signal, nicht nur eine. Nur oben gerundet, aus
      // demselben Grund wie dort (siehe Kommentar an TerminalTabChip).
      className={`relative flex h-6 max-w-32 min-w-0 shrink items-center gap-1 rounded-t-(--pc-paneControl-radius) border border-b-2 px-1.5 text-(length:--pc-chrome-fontSizeSmall) transition-colors ${
        active
          ? `${
              paneFocused
                ? "border-(--pc-pane-activeBorder)"
                : "border-(--pc-pane-activeBorder)/45"
            } bg-(--pc-pane-activeBorder)/14 font-semibold text-(--pc-paneHeader-activeForeground)`
          : "border-(--pc-paneHeader-border) font-medium text-(--pc-paneHeader-foreground) hover:border-(--pc-pane-border) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground)"
      } ${CHROME_FOCUS_RING}`}
    >
      {active && paneFocused && <TraceStub />}
      <span className="min-w-0 truncate">{label}</span>
      {dirty && <DirtyMark />}
    </button>
  );
}

// Der Platzhalter-Chip eines schwebenden Tab-Zugs (Ticket 32, Politur-Runde
// nach Nutzer-Befund): steht exakt dort in der Leiste, wo `moveTerminalTab`
// den Tab einhängen würde — seit der Präzisions-Runde am zeigergenauen
// Einfüge-Slot zwischen den Chips (`incomingTab.index`, s. `PaneTabsProps`),
// nicht mehr fix am Ende — und trägt bereits die Nummer, die er dort bekäme:
// die Leiste zeigt ihre eigene Zukunft, statt sie den Nutzer raten zu lassen. Chip-Maße wie ein echter
// `TerminalTabChip` (h-6, min-w-6, px-3, oben gerundet), aber als leere
// Fassung im PCB-Duktus: 1px gestrichelte Amber-Kontur in der 45%-Dämpfung
// (ein angekündigter, noch nicht bestromter Footprint — dieselbe Abstufung
// wie die Kandidaten-Ecken des Drop-HUDs) mit hauchdünner Akzent-Lasur.
// Bewusst KEINE verdoppelte Unterkante und kein Löt-Steg: beides ist die
// Sprache des AKTIVEN Tabs, dieser hier existiert noch gar nicht.
//
// `aria-hidden` wie das Drop-HUD selbst (ein Zeiger-Zug ist reine
// Zeigerführung); `data-incoming-tab` ist der Test-Haken, ein verstecktes
// Deko-Element hat keine Rolle, über die es sich sonst greifen ließe. Das
// Erscheinen ist ein harter Schnitt wie beim Drop-HUD — sein Auftauchen IST
// der Zustandswechsel. Dass der „+"-Knopf dabei einen Chip weit nach rechts
// rückt, ist kein Layout-Sprung, sondern die Vorschau selbst: genau so sähe
// die Leiste nach dem Loslassen aus.
function IncomingTabSlot({ number }: { number: number }) {
  return (
    <span
      aria-hidden="true"
      data-incoming-tab=""
      className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-t-(--pc-paneControl-radius) border border-dashed border-(--pc-pane-activeBorder)/45 bg-(--pc-pane-activeBorder)/8 px-3 text-(length:--pc-chrome-fontSizeSmall)"
    >
      <span className="font-(family-name:--pc-terminal-fontFamily) tabular-nums text-(--pc-pane-activeBorder)/70">
        {number}
      </span>
    </span>
  );
}

// Der Löt-Steg der Fokus-Leiterbahn (Kopfkommentar, Leiterbahn-Nachtrag):
// 2px breit, mittig unter dem Chip, reicht 2px über dessen Unterkante hinaus
// in die Header-Hairline. Positioniert relativ zur Padding-Box des Knopfs —
// `-bottom-1` (-4px) überdeckt deshalb erst die eigene 2px-Unterkante
// (border-b-2, dort farbgleich unsichtbar) und ragt dann 2px darunter heraus.
// `data-trace-stub` ist der Test-Haken (PaneTabs.test.tsx): ein rein
// dekoratives, aria-verstecktes Element hat keine Rolle, über die es sich
// sonst greifen ließe.
function TraceStub() {
  return (
    <span
      aria-hidden="true"
      data-trace-stub=""
      className="pointer-events-none absolute -bottom-1 left-1/2 h-1 w-0.5 -translate-x-1/2 bg-(--pc-pane-activeBorder)"
    />
  );
}

// Aus FileEditor.tsx hierher verschoben (2026-08-12): der Ungespeichert-Punkt
// sitzt jetzt im Datei-Tab statt in einer eigenen Namenszeile — beide Header
// (TerminalPane.tsx und FileEditor.tsx) binden denselben Tab ein, es gibt also
// nur noch eine Stelle, die ihn zeichnet.
//
// Im Ton der Zeile, in der er steht (`bg-current`), nicht in einer eigenen
// Farbe — dieselbe Lesart wie in jedem Editor mit Tabs, und die einzige, die
// hier funktioniert: die Git-Deko im Explorer hat ihre beiden Töne bereits mit
// Bedeutung belegt (geändert/nicht versioniert), ein dritter Farbfleck daneben
// würde als dritter Git-Zustand gelesen. Ungespeichert ist aber keine Aussage
// über das Repository, sondern darüber, wo der Text gerade liegt: nur im
// Speicher.
//
// Der sichtbare Punkt ist `aria-hidden`, das Wort steht daneben in `sr-only`
// — Farbe und Form allein dürfen die Information nicht tragen.
function DirtyMark() {
  const { t } = useTranslation();
  return (
    <span className="flex shrink-0 items-center">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      <span className="sr-only">{t("common.unsavedSuffix")}</span>
    </span>
  );
}

function PlusIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 2v8M2 6h8" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4.5 6 8l3-3.5" />
    </svg>
  );
}
