// Deklarative Quelle für PaneCrews Tastaturkürzel — dieselben Einträge
// treiben sowohl die Laufzeit-Erkennung (matchesShortcut) als auch die
// generierte Referenz in docs/shortcuts.md (siehe
// apps/desktop/scripts/generate-shortcuts-docs.ts), analog zum
// clap/clap-markdown-Muster in src-tauri/src/cli.rs: ein Eintrag ändern,
// beides zieht nach, nie zwei Stellen von Hand synchron halten.
//
// `codes` statt `key`: KeyboardEvent.code beschreibt die physische
// Tastenposition unabhängig vom Tastaturlayout, KeyboardEvent.key dagegen das
// Zeichen, das dieses Layout daraus macht. Bei Plus und Minus geht das
// international auseinander, und zwar auf zwei verschiedene Arten:
//
// - Plus sitzt auf einer deutschen Tastatur auf einer eigenen Taste rechts
//   neben dem Ü (Code "BracketRight"), auf einer US-Tastatur teilen sich
//   "="/"+" eine Taste ("Equal") zusammen mit Shift.
// - Minus sitzt auf einer deutschen Tastatur NICHT in der Ziffernreihe
//   (dort liegt an dieser Stelle "ß", Code "Minus") — das Minuszeichen ist
//   dort stattdessen die Taste zwischen "." und der rechten Umschalttaste,
//   also an der Position, die eine US-Tastatur für "/" benutzt (Code
//   "Slash"). Ohne diesen Code hätte das Kürzel auf deutschen Tastaturen nur
//   für Plus funktioniert, nicht für Minus — genau der gemeldete Fehler.
//
// Deshalb pro Aktion mehrere codes: die US-Position, die deutsche ISO-Position
// und die Zifferblock-Variante decken beide Layouts ab, ohne dass die
// Zeichenausgabe von Shift irgendeine Rolle spielt (die Chord-Erkennung selbst
// bestimmt per `shift`, nicht das Ergebnis-Zeichen).
type ShortcutScope = "app" | "pane";

/** Die drei Zoomstufen. Eigener Typ, weil daran seit dem Mini-Editor eine
 * Verhaltensfrage hängt und nicht nur die Darstellung: `zoomAction()` weiter
 * unten unterscheidet damit Zoom-Kürzel von allem anderen. */
type ZoomGlyph = "+" | "-" | "0";

/** Ziffer 1-9 — Terminal-Tab-Wahl, dieselbe Zahl, die der Tab-Chip selbst
 * zeigt (PaneTabs.tsx), deshalb selbsterklärend ohne eigene Legende. */
type DigitGlyph = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** Anzeigeglyph fürs generierte Dokument — unabhängig vom Matching. */
type ShortcutGlyph = ZoomGlyph | "S" | "N" | "W" | DigitGlyph | "↵";

export interface ShortcutDefinition {
  readonly id: string;
  /** Deutschsprachige Beschreibung — dieselbe Sprache wie der Rest der UI. */
  readonly description: string;
  readonly scope: ShortcutScope;
  readonly glyph: ShortcutGlyph;
  /** Physische Tastenposition(en), die diese Aktion auslösen — siehe oben. */
  readonly codes: readonly string[];
  /** true = mit Shift (App-weiter Zoom), false = ohne (nur aktive Pane). */
  readonly shift: boolean;
}

const PLUS_CODES = ["Equal", "BracketRight", "NumpadAdd"] as const;
const MINUS_CODES = ["Minus", "Slash", "NumpadSubtract"] as const;
const ZERO_CODES = ["Digit0", "Numpad0"] as const;

/** Id des Speichern-Kürzels — `FileEditor.tsx` schlägt seine Definition damit
 * nach, statt den Akkord ein zweites Mal zu beschreiben. */
export const SAVE_FILE_SHORTCUT_ID = "pane.saveFile";

/** Id des Fokus-Modus-Kürzels (Ticket 19) — `App.tsx`s Fenster-Capture-
 * Listener schlägt seine Definition damit nach, aus demselben Grund wie
 * `SAVE_FILE_SHORTCUT_ID` oben. */
export const TOGGLE_FOCUS_MODE_SHORTCUT_ID = "pane.toggleFocusMode";

/** Id des Neues-Fenster-Kürzels (Ticket 27) — `useNewWindowShortcut.ts`
 * schlägt seine Definition damit nach, aus demselben Grund wie
 * `SAVE_FILE_SHORTCUT_ID` oben. Dasselbe Kürzel wie VS Codes eigenes
 * "Neues Fenster" (⌘N/Ctrl+N). */
export const NEW_WINDOW_SHORTCUT_ID = "app.newWindow";

/** Id des Terminal-Tab-Schließen-Kürzels — `usePtyTerminal.ts`s Pane-Kürzel-
 * Zweig schlägt seine Definition damit nach, aus demselben Grund wie
 * `SAVE_FILE_SHORTCUT_ID` oben. Browser-übliches Cmd/Strg+W, hier ohne
 * Kollisionsrisiko: PaneCrew ist ein natives Tauri-Fenster, kein Browser-Tab,
 * den dieselbe Kombination sonst schlösse. */
export const CLOSE_TERMINAL_TAB_SHORTCUT_ID = "pane.closeTerminalTab";

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: "app.zoomIn",
    description: "Gesamte Oberfläche vergrößern",
    scope: "app",
    glyph: "+",
    codes: PLUS_CODES,
    shift: true,
  },
  {
    id: "app.zoomOut",
    description: "Gesamte Oberfläche verkleinern",
    scope: "app",
    glyph: "-",
    codes: MINUS_CODES,
    shift: true,
  },
  {
    id: "app.zoomReset",
    description: "Oberflächen-Zoom zurücksetzen",
    scope: "app",
    glyph: "0",
    codes: ZERO_CODES,
    shift: true,
  },
  {
    // Einziger Buchstaben-Chord im "app"-Scope neben dem Ziffernblock der
    // Zoom-Trias — `useAppZoom.ts`s Listener filtert `scope === "app"`
    // deshalb zusätzlich über `zoomAction(def) !== null`, sonst würde dieses
    // Kürzel dort fälschlich als Zoom-Aktion interpretiert (Glyph "N" ist
    // weder "+" noch "0", würde also als "-" fehlgedeutet).
    id: NEW_WINDOW_SHORTCUT_ID,
    description: "Neues PaneCrew-Fenster öffnen",
    scope: "app",
    glyph: "N",
    codes: ["KeyN"],
    shift: false,
  },
  {
    id: "pane.zoomIn",
    description: "Schrift der aktiven Terminal-Pane vergrößern",
    scope: "pane",
    glyph: "+",
    codes: PLUS_CODES,
    shift: false,
  },
  {
    id: "pane.zoomOut",
    description: "Schrift der aktiven Terminal-Pane verkleinern",
    scope: "pane",
    glyph: "-",
    codes: MINUS_CODES,
    shift: false,
  },
  {
    id: "pane.zoomReset",
    description: "Schriftgröße der aktiven Terminal-Pane zurücksetzen",
    scope: "pane",
    glyph: "0",
    codes: ZERO_CODES,
    shift: false,
  },
  {
    // Genau EIN Code, anders als bei +/-/0: die Mehrfach-Codes oben gibt es
    // nur, weil die Satzzeichen auf QWERTZ und QWERTY an verschiedenen
    // physischen Positionen sitzen. Buchstabentasten tun das nicht — "KeyS"
    // ist auf beiden Layouts dieselbe Taste.
    id: SAVE_FILE_SHORTCUT_ID,
    description: "Geöffnete Datei speichern",
    scope: "pane",
    glyph: "S",
    codes: ["KeyS"],
    shift: false,
  },
  {
    // Genau EIN Code wie beim Speichern-Kürzel oben — "Enter"/"NumpadEnter"
    // sitzen auf beiden Layouts an derselben physischen Position, kein
    // Mehrfach-Code nötig. `App.tsx`s Fenster-Capture-Listener wertet dieses
    // Kürzel VOR jeder Terminal-Pane aus (`stopPropagation`), damit Cmd+Return
    // nie zusätzlich als Absenden bei der Shell ankommt.
    id: TOGGLE_FOCUS_MODE_SHORTCUT_ID,
    description: "Fokus-Modus umschalten (Pane maximieren/verlassen)",
    scope: "pane",
    glyph: "↵",
    codes: ["Enter", "NumpadEnter"],
    shift: false,
  },
  {
    // Genau EIN Code wie beim Speichern-Kürzel oben. Läuft über denselben
    // rückfragegesicherten Pfad wie Rechtsklick-Kontextmenü/Mittelklick
    // (`closeTerminalTabGuarded`, App.tsx) — dieses Kürzel ist nur ein
    // weiterer WEG dorthin, keine zweite, ungeschützte Schließ-Logik. Der
    // letzte verbleibende Terminal-Tab bleibt davon ausgenommen (dieselbe
    // `terminalTabs.length > 1`-Bedingung wie das Kontextmenü, s.
    // PaneTabs.tsx), eine Pane kann über dieses Kürzel also nie leer werden.
    id: CLOSE_TERMINAL_TAB_SHORTCUT_ID,
    description: "Aktiven Terminal-Tab schließen",
    scope: "pane",
    glyph: "W",
    codes: ["KeyW"],
    shift: false,
  },
  // Terminal-Tab N der aktiven Pane anzeigen (Ticket 18-Nachtrag, Maus-only-
  // Beschwerde): neun Definitionen statt einer parametrisierten, weil
  // ShortcutDefinition keine Nummer trägt, nur `codes` — dieselbe Bauart wie
  // die Zoom-Trias oben, nur neunmal statt dreimal. `terminalTabSelectId` und
  // `terminalTabSelectNumber` unten sind die einzige Stelle, die die
  // Nummerierung aus der Id zurückgewinnt, damit sie nirgends ein zweites Mal
  // von Hand geführt wird.
  ...Array.from({ length: 9 }, (_, index): ShortcutDefinition => {
    const number = index + 1;
    return {
      id: terminalTabSelectId(number),
      description: `Terminal-Tab ${number} der aktiven Pane anzeigen`,
      scope: "pane",
      glyph: String(number) as ShortcutGlyph,
      codes: [`Digit${number}`, `Numpad${number}`],
      shift: false,
    };
  }),
];

/** Id-Schema der neun Terminal-Tab-Kürzel — von `terminalTabSelectNumber`
 * unten umgekehrt. Exportiert, damit PaneTabs.tsx denselben Namen zum
 * Nachschlagen in `SHORTCUTS` verwendet statt ihn nachzubauen. */
export function terminalTabSelectId(number: number): string {
  return `pane.selectTerminalTab${number}`;
}

const TERMINAL_TAB_SELECT_ID_PATTERN = /^pane\.selectTerminalTab([1-9])$/;

/**
 * Die Tab-Nummer, die dieses Kürzel auswählt — `null` für jedes andere.
 * Gleiche Rolle wie `zoomAction` daneben: `usePtyTerminal.ts`s
 * Pane-Kürzel-Zweig behandelt beide Aktionsarten nebeneinander, keine darf
 * über bloßes Ausschließen der anderen erraten werden.
 */
export function terminalTabSelectNumber(def: ShortcutDefinition): number | null {
  const match = TERMINAL_TAB_SELECT_ID_PATTERN.exec(def.id);
  return match ? Number(match[1]) : null;
}

/**
 * Welche Zoom-Wirkung ein Kürzel hat — `null` für jedes, das gar keins ist.
 *
 * Existiert seit dem Speichern-Kürzel und ist der Grund, warum es kein
 * stilles Eigentor wurde: der Tastatur-Handler der Terminal-Pane nahm bis
 * dahin JEDEN Treffer mit `scope: "pane"` als Zoom entgegen und leitete die
 * Richtung aus dem Glyph ab („alles, was nicht 0 oder + ist, ist minus") —
 * Cmd+S hätte dort also die Pane-Schrift verkleinert und wäre nie bei der
 * Shell angekommen. Die Zuordnung ist deshalb jetzt vollständig statt
 * erschöpfend geraten.
 */
export function zoomAction(
  def: ShortcutDefinition,
): "in" | "out" | "reset" | null {
  switch (def.glyph) {
    case "+":
      return "in";
    case "-":
      return "out";
    case "0":
      return "reset";
    default:
      return null;
  }
}

/** Die Teilmenge von KeyboardEvent, die das Matching tatsächlich braucht. */
export interface ShortcutKeyEvent {
  readonly code: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

/**
 * Prüft eine Tastenkombination gegen eine Definition. `isMac` entscheidet,
 * ob Cmd (mac) oder Strg (Windows/Linux) der geforderte Primärmodifikator
 * ist; der jeweils andere darf nicht zusätzlich gedrückt sein, sonst würde
 * z. B. ein versehentliches Ctrl+Cmd+Plus auf dem Mac mitzählen.
 */
export function matchesShortcut(
  event: ShortcutKeyEvent,
  def: ShortcutDefinition,
  isMac: boolean,
): boolean {
  const primaryPressed = isMac ? event.metaKey : event.ctrlKey;
  const otherModifierPressed = isMac ? event.ctrlKey : event.metaKey;
  return (
    primaryPressed &&
    !otherModifierPressed &&
    !event.altKey &&
    event.shiftKey === def.shift &&
    def.codes.includes(event.code)
  );
}

/** Menschenlesbare Chord-Darstellung für die generierte Referenz. */
export function formatChord(
  def: ShortcutDefinition,
  platform: "mac" | "other",
): string {
  if (platform === "mac") {
    return `${def.shift ? "⇧" : ""}⌘${def.glyph}`;
  }
  return `Ctrl+${def.shift ? "Shift+" : ""}${def.glyph}`;
}
