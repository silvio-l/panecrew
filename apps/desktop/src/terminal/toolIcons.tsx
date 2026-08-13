import type { ComponentType } from "react";
import {
  ClaudeIcon,
  CodexIcon,
  CopilotIcon,
  GeminiIcon,
  OpenCodeIcon,
  ShellIcon,
} from "./toolBadgeIcons";

// Ordnet die kanonische Tool-ID aus `pty_detect_tool` (Rust-Backend,
// tool_detect.rs matcht bereits Prozessname UND Argumente gegen bekannte
// Tools und liefert direkt eine ID aus `TOOL_BY_ID` unten statt eines rohen
// Binärnamens) einem anzeigbaren Icon zu — reines Mapping, kennt selbst
// nichts vom Prozessbaum. `resolveToolIcon` liefert `null` für alles
// Unbekannte (auch für IDs, die das Backend gar nicht mehr liefert),
// PaneTabs.tsx zeichnet dann bewusst gar kein Icon statt eines
// Platzhalters (Task-Vorgabe: kein Icon für unbekannte Prozesse).
//
// Nachtrag 2026-08-13, noch später (Nutzer-Feedback, zweite Runde: "echte
// Tool-Icons, nicht einfach nur in Buchstaben"): die vorige Fassung dieser
// Datei zeichnete ein einzelnes Buchstaben-Monogramm als Text-Glyph, danach
// kurz eigene Freihand-SVG-Pfade. Die eigentlichen Icon-Komponenten sitzen
// jetzt in `toolBadgeIcons.tsx` (Pfaddaten-Herkunft und Lizenzen dort im
// Kopfkommentar) — eigene Datei aus technischem Grund: eine Datei, die
// sowohl React-Komponenten als auch reine Daten/Funktionen exportiert,
// bricht Vites Fast-Refresh (`react-refresh/only-export-components`);
// dieselbe Trennung wie `explorerIcons.tsx`/dessen Aufrufer.
//
// Nachtrag, dritte Runde (Nutzer-Entscheid: echte Marken-Icons, keine
// generischen "Solo"-Icons mehr): die Hersteller-Tools rendern jetzt die
// echten Marken-Glyphen aus dem Simple-Icons-Set (CC0, Herkunft und
// Nominativ-Begründung im Kopfkommentar von `toolBadgeIcons.tsx`), und die
// Badge-Farben unten sind die dort pro Glyph dokumentierten offiziellen
// Markenfarben statt der bisherigen Annäherungen.

export interface ToolIconInfo {
  /** Vektor-Icon aus `toolBadgeIcons.tsx` — für die Hersteller-Tools das
   * echte Marken-Glyph aus dem Simple-Icons-Set, Herkunft/Lizenz und die
   * Nominativ-Begründung im Kopfkommentar dort. */
  Icon: ComponentType;
  /** i18n-Schlüssel unter `paneTabs.tool.*`, für Tooltip/aria-label. */
  labelKey: string;
  /** Tailwind-Klassen für Hintergrund+Text der gefüllten Badge — der
   * Hex-Wert ist die von Simple Icons pro Glyph dokumentierte offizielle
   * Markenfarbe (`hex`-Feld in deren `data/simple-icons.json`), keine eigene
   * Annäherung mehr. Der Glyph-Vordergrund ist auf jeder dieser Flächen
   * `text-white` (als Grafik-Element gemessen: schwächster Fall 3.1:1 auf
   * dem warmen Orangeton, alle anderen deutlich darüber — über der
   * 3:1-Non-Text-Schwelle; `text-black` wäre erst bei einer sehr hellen
   * Markenfarbe nötig, die keiner der Einträge hat). Ausnahme unten beim
   * Eintrag ohne Simple-Icons-Glyph. `null` für die neutrale, ungefüllte
   * Shell-Variante: eine bloße Shell hat keinen Hersteller, dem eine Farbe
   * zustünde. */
  badgeClassName: string | null;
}

// Objektschlüssel sind die kanonischen Tool-IDs, die `tool_detect.rs` selbst
// vergibt (dort bereits gegen Prozessname UND Argumente geprüft — funktional
// nötig, keine werbliche Nennung, brandlint-ok je Zeile unten).
const TOOL_BY_ID: Record<string, ToolIconInfo> = {
  claude: { // brandlint-ok: kanonische Tool-ID aus tool_detect.rs, Objektschlüssel
    Icon: ClaudeIcon,
    labelKey: "paneTabs.tool.claude", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    badgeClassName: "bg-[#D97757] text-white",
  },
  gemini: { // brandlint-ok: kanonische Tool-ID aus tool_detect.rs, Objektschlüssel
    Icon: GeminiIcon,
    labelKey: "paneTabs.tool.gemini", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    badgeClassName: "bg-[#8E75B2] text-white",
  },
  copilot: { // brandlint-ok: kanonische Tool-ID aus tool_detect.rs, Objektschlüssel
    Icon: CopilotIcon,
    labelKey: "paneTabs.tool.copilot", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    badgeClassName: "bg-[#000000] text-white",
  },
  codex: { // brandlint-ok: kanonische Tool-ID aus tool_detect.rs, Objektschlüssel
    Icon: CodexIcon,
    labelKey: "paneTabs.tool.codex", // brandlint-ok: Binärname/Tool-ID, kein Werbetext
    // Einziger Hersteller-Eintrag ohne Simple-Icons-Glyph (s.
    // toolBadgeIcons.tsx) — Icon UND Farbton bleiben deshalb die generische
    // Fassung der vorigen Runde: Annäherung, keine dokumentierte Markenfarbe.
    badgeClassName: "bg-[#10A37F] text-white",
  },
  opencode: {
    Icon: OpenCodeIcon,
    labelKey: "paneTabs.tool.opencode",
    badgeClassName: "bg-[#000000] text-white",
  },
  shell: {
    Icon: ShellIcon,
    labelKey: "paneTabs.tool.shell",
    badgeClassName: null,
  },
};

export function resolveToolIcon(toolId: string | null): ToolIconInfo | null {
  if (toolId === null) return null;
  return TOOL_BY_ID[toolId] ?? null;
}
