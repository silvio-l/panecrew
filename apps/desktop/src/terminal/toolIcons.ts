// Ordnet die kanonische Tool-ID aus `pty_detect_tool` (Rust-Backend,
// tool_detect.rs matcht bereits Prozessname UND Argumente gegen bekannte
// Tools und liefert direkt eine ID aus `TOOL_BY_ID` unten statt eines rohen
// Binärnamens) einem anzeigbaren Icon zu — reines
// Mapping, kennt selbst nichts vom Prozessbaum. `resolveToolIcon` liefert
// `null` für alles Unbekannte (auch für IDs, die das Backend gar nicht mehr
// liefert), PaneTabs.tsx zeichnet dann bewusst gar kein Icon statt eines
// Platzhalters (Task-Vorgabe: kein Icon für unbekannte Prozesse).

export interface ToolIconInfo {
  /** Ein einzelnes Zeichen, in der Terminalschrift gesetzt — ein eigenes
   * Monogramm, kein kopiertes Marken-Logo (Lizenz-/Trademark-Vorsicht: echte
   * Hersteller-Logos sind geschütztes Bildmaterial, ein Buchstabe in
   * Herstellerfarbe ist es nicht). */
  glyph: string;
  /** i18n-Schlüssel unter `paneTabs.tool.*`, für Tooltip/aria-label. */
  labelKey: string;
  /** Tailwind-Klassen für Hintergrund+Text der gefüllten Badge, angelehnt an
   * die öffentlich bekannte Akzentfarbe des jeweiligen Herstellers (keine
   * exakt zertifizierte Markenfarbe, nur eine plausible Annäherung) — `null`
   * für die neutrale, ungefüllte Shell-Variante: eine bloße Shell hat keinen
   * Hersteller, dem eine Farbe zustünde. */
  badgeClassName: string | null;
}

// Objektschlüssel sind die kanonischen Tool-IDs, die `tool_detect.rs` selbst
// vergibt (dort bereits gegen Prozessname UND Argumente geprüft — funktional
// nötig, keine werbliche Nennung, brandlint-ok je Zeile unten).
const TOOL_BY_ID: Record<string, ToolIconInfo> = {
  claude: { // brandlint-ok: kanonische Tool-ID aus tool_detect.rs, Objektschlüssel
    glyph: "C", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    labelKey: "paneTabs.tool.claude", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    badgeClassName: "bg-[#D97757] text-white",
  },
  gemini: { // brandlint-ok: kanonische Tool-ID aus tool_detect.rs, Objektschlüssel
    glyph: "G", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    labelKey: "paneTabs.tool.gemini", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    badgeClassName: "bg-[#4C8DF6] text-white",
  },
  copilot: { // brandlint-ok: kanonische Tool-ID aus tool_detect.rs, Objektschlüssel
    glyph: "H", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    labelKey: "paneTabs.tool.copilot", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    badgeClassName: "bg-[#8957E5] text-white",
  },
  codex: { // brandlint-ok: kanonische Tool-ID aus tool_detect.rs, Objektschlüssel
    glyph: "X", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    labelKey: "paneTabs.tool.codex", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    badgeClassName: "bg-[#10A37F] text-white",
  },
  opencode: {
    glyph: "O",
    labelKey: "paneTabs.tool.opencode",
    badgeClassName: "bg-[#22C55E] text-white",
  },
  shell: {
    glyph: "$",
    labelKey: "paneTabs.tool.shell",
    badgeClassName: null,
  },
};

export function resolveToolIcon(toolId: string | null): ToolIconInfo | null {
  if (toolId === null) return null;
  return TOOL_BY_ID[toolId] ?? null;
}
