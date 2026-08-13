// Die Vektor-Icons für die Tool-Erkennungs-Badges (toolIcons.tsx) — dritte
// Fassung (Nutzer-Entscheid, dritte Runde): die Hersteller-Tools tragen jetzt
// die ECHTEN, wiedererkennbaren Marken-Glyphen statt generischer
// Konzept-Icons ("keine Solo-Icons mehr"). Nur die zwei Einträge ohne
// Marken-Gegenstück im Quell-Set (s. Zuordnung unten) behalten die
// Lucide-Pfade der vorigen Fassung.
//
// HERKUNFT UND LIZENZ — MARKEN-GLYPHEN
// Pfaddaten wörtlich aus simple-icons/simple-icons, Branch `develop`,
// Verzeichnis `icons/` (https://github.com/simple-icons/simple-icons).
// Lizenz: CC0 1.0 Universal — an der Quelle geprüft
// (https://raw.githubusercontent.com/simple-icons/simple-icons/develop/LICENSE.md).
// CC0 verlangt keine Attribution; dieser Block dokumentiert die Herkunft
// trotzdem, im selben Stil wie explorerIcons.tsx für Seti-UI. Das Projekt
// dokumentiert zu jedem Glyph auch die offizielle Markenfarbe — die steht in
// toolIcons.tsx (`badgeClassName`), nicht hier.
//
// HERKUNFT UND LIZENZ — VERBLEIBENDE GENERISCHE GLYPHEN
// `CodexIcon` und `ShellIcon` weiterhin wörtlich aus lucide-icons/lucide,
// Branch `main`, Verzeichnis `icons/`
// (https://github.com/lucide-icons/lucide). Lizenz: ISC, Copyright (c) 2026
// Lucide Icons and Contributors — an der Quelle geprüft
// (https://raw.githubusercontent.com/lucide-icons/lucide/main/LICENSE).
// `code.svg` und `terminal.svg` stammen ursprünglich aus dem Feather-Projekt
// und stehen laut derselben LICENSE-Datei zusätzlich unter der MIT License,
// Copyright (c) 2013-present Cole Bemis. Beide Lizenzen verlangen denselben
// Hinweis: Copyright- und Lizenztext bleiben erhalten — mit diesem Block
// plus PaneCrews eigener MIT-Lizenz erfüllt.
//
// WARUM ECHTE MARKEN-GLYPHEN JETZT DOCH GEHEN
// Die vorige Fassung wich bewusst auf generische Konzept-Icons aus, aus
// Sorge, ein Original-Logo neben dem eigenen Produktnamen würde eine
// Partnerschaft suggerieren. Der Unterschied hier: Simple Icons liefert
// unter CC0 die reinen Icon-Glyphen (keine Wortmarken/Logo-Lockups) genau
// für diesen Anwendungsfall — "welche Marke / welches Tool ist das" — und
// die Badge setzt das Glyph nominativ ein: sie identifiziert das im Terminal
// LAUFENDE Fremd-Tool, sie macht das fremde Zeichen nicht zum Teil der
// eigenen Markenidentität. Dieses Interoperabilitäts-Badge-Muster
// (nominative fair use) ist in Entwickler-Tools etabliert und ein anderes
// Risiko als das Kopieren einer kompletten Markenidentität. Es sind aber
// bewusst wieder die ECHTEN, wiedererkennbaren Marken-Glyphen — nicht mehr
// abstrakt.
//
// ZUORDNUNG TOOL-ID → GLYPH (Slug = Dateiname unter `icons/` an der Quelle)
// claude → Slug `claudecode` (das produktspezifische CLI-Glyph; das Set führt daneben auch `claude`, gleiche Markenfarbe) — brandlint-ok: Slug-/Herkunftsangabe für das real gerenderte Marken-Glyph, funktionale Nennung
// gemini → Slug `googlegemini` — brandlint-ok: Slug-/Herkunftsangabe für das real gerenderte Marken-Glyph, funktionale Nennung
// copilot → Slug `githubcopilot` — brandlint-ok: Slug-/Herkunftsangabe für das real gerenderte Marken-Glyph, funktionale Nennung
// codex → KEIN Eintrag im Quell-Set (weder das Tool noch dessen Hersteller; nur ein gleichnamig anmutendes RL-Toolkit-Icon eines anderen Produkts) — bleibt Lucide `code.svg`, generische spitze Klammern — brandlint-ok: dokumentiert das Fehlen eines Marken-Glyphs für diese Tool-ID
// opencode → Slug `opencode` (das Set führt das echte Identity-Mark des Tools)
// shell → Lucide `terminal.svg`, bewusst generisch: die neutrale
//   Fallback-Kategorie hat keinen Hersteller, dessen Marke zu zeigen wäre.
//
// WARUM currentColor
// Wie explorerIcons.tsx: die Farbe kommt aus dem umgebenden Badge
// (toolIcons.tsx' `badgeClassName`, `text-white` bzw. der neutrale
// Chip-Vordergrund für die Shell), nicht aus einem eigenen Hex-Wert in der
// Pfaddatei. Die Simple-Icons-Quellen sind reine Füll-Pfade (fill, kein
// stroke) in einer 24er-viewBox — die zwei verbliebenen Lucide-Glyphen
// bleiben dagegen stroke-basiert, wie ihre Quelldateien.

const VIEWBOX = "0 0 24 24";
/** Feste Kantenlänge statt Vererbung aus dem Elternelement — dieselbe
 * Bauweise wie `PlusIcon` in PaneTabs.tsx: ein HUD-Glyph in dieser Größe
 * bleibt bei jeder Zoomstufe der Chrome-Schrift gleich scharf. Beide
 * Quell-Sets zeichnen in einer 24er-viewBox, dargestellt bei 10px
 * Kantenlänge, wie die Badge es schon für die vorige Fassung vorsah. */
const ICON_SIZE = 10;

/** Gemeinsame Hülle der fill-basierten Marken-Glyphen aus Simple Icons. */
function BrandGlyph({ d }: { d: string }) {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox={VIEWBOX}
      aria-hidden="true"
      fill="currentColor"
    >
      <path d={d} />
    </svg>
  );
}

// Slug `claudecode` — brandlint-ok: Herkunftsangabe des Marken-Glyphs, funktionale Nennung
export function ClaudeIcon() {
  return (
    <BrandGlyph d="M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5z" />
  );
}

// Slug `googlegemini` — brandlint-ok: Herkunftsangabe des Marken-Glyphs, funktionale Nennung
export function GeminiIcon() {
  return (
    <BrandGlyph d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
  );
}

// Slug `githubcopilot` — brandlint-ok: Herkunftsangabe des Marken-Glyphs, funktionale Nennung
export function CopilotIcon() {
  return (
    <BrandGlyph d="M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z" />
  );
}

// Kein Marken-Glyph im Quell-Set (s. Zuordnung oben) — weiterhin Lucide
// `code.svg`, generische spitze Klammern.
export function CodexIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox={VIEWBOX}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </svg>
  );
}

// Slug `opencode` — das echte Identity-Mark des Tools, kein generisches
// Sechseck mehr.
export function OpenCodeIcon() {
  return <BrandGlyph d="M22 24H2V0h20zM17 4.8H7v14.4h10z" />;
}

// Lucide `terminal.svg` — bewusst generisch, s. Zuordnung oben.
export function ShellIcon() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox={VIEWBOX}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19h8" />
      <path d="m4 17 6-6-6-6" />
    </svg>
  );
}
