import type { AnsiColor, Project, TermLine } from "../mock/projects";

// Mock-Terminal-Pane: sehr dünner Header (eine schlanke Textzeile, 24px
// Klickfläche) plus Platzhalter-Ausgabe im ui-monospace-Register. Der Inhalt
// wird später durch ein echtes xterm.js-Terminal ersetzt; Header- und
// Fokus-Mechanik bleiben. Fokus wird nie nur über Farbe kommuniziert:
// Akzent-Ring + Glow + hellerer Header-Text plus Explorer-Echo.
export function TerminalPane({
  project,
  focused,
  onFocus,
}: {
  project: Project;
  focused: boolean;
  onFocus: () => void;
}) {
  return (
    <section
      onMouseDown={onFocus}
      aria-label={`Terminal ${project.name}`}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-(--pc-pane-background) transition-[border-color,box-shadow] duration-150 ${
        focused
          ? "border-(--pc-pane-activeBorder) shadow-[0_0_0_1px_var(--pc-pane-activeBorder),0_0_24px_var(--pc-pane-activeGlow)]"
          : "border-(--pc-pane-border)"
      }`}
    >
      <header
        className={`flex h-6 shrink-0 items-center border-b border-(--pc-paneHeader-border) px-3 text-[11px] font-medium tracking-wide ${
          focused
            ? "text-(--pc-paneHeader-activeForeground)"
            : "text-(--pc-paneHeader-foreground)"
        }`}
      >
        <span className="truncate">{project.name}</span>
      </header>
      <div className="pc-term min-h-0 flex-1 select-text overflow-hidden px-3.5 py-2 text-(--pc-terminal-foreground)">
        {project.terminal.map((line, i) => (
          <TerminalLine key={i} line={line} />
        ))}
        <div className="whitespace-pre">
          <span style={{ color: ANSI_COLOR.brightBlack }}>$ </span>
          <span
            className={
              focused
                ? "inline-block h-[13px] w-[7px] translate-y-[2px] animate-[pc-cursor-blink_1.1s_steps(1)_infinite] bg-(--pc-terminal-cursor)"
                : "inline-block h-[13px] w-[7px] translate-y-[2px] bg-(--pc-terminal-cursor) opacity-30"
            }
          />
        </div>
      </div>
    </section>
  );
}

function TerminalLine({ line }: { line: TermLine }) {
  if (line.length === 0) return <div>&nbsp;</div>;
  return (
    <div className="truncate whitespace-pre">
      {line.map((seg, i) => (
        <span key={i} style={seg.color ? { color: ANSI_COLOR[seg.color] } : undefined}>
          {seg.text}
        </span>
      ))}
    </div>
  );
}

const ANSI_COLOR: Record<AnsiColor, string> = {
  red: "var(--pc-terminal-ansiRed)",
  green: "var(--pc-terminal-ansiGreen)",
  yellow: "var(--pc-terminal-ansiYellow)",
  blue: "var(--pc-terminal-ansiBlue)",
  magenta: "var(--pc-terminal-ansiMagenta)",
  cyan: "var(--pc-terminal-ansiCyan)",
  brightBlack: "var(--pc-terminal-ansiBrightBlack)",
  brightRed: "var(--pc-terminal-ansiBrightRed)",
  brightGreen: "var(--pc-terminal-ansiBrightGreen)",
  brightYellow: "var(--pc-terminal-ansiBrightYellow)",
  brightBlue: "var(--pc-terminal-ansiBrightBlue)",
  brightCyan: "var(--pc-terminal-ansiBrightCyan)",
};
