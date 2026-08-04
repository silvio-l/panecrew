import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Tooltip } from "radix-ui";
import type { AnsiColor, Project, TermLine } from "../mock/projects";

// Zoom-Stufen einer Pane: volle Zeilenbreite, volle Spaltenhöhe, ganzes Grid.
export type PaneZoom = "width" | "height" | "max";

// Mock-Terminal-Pane: sehr dünner Header (eine schlanke Textzeile, 24px
// Klickfläche) plus Platzhalter-Ausgabe im ui-monospace-Register. Der Inhalt
// wird später durch ein echtes xterm.js-Terminal ersetzt; Header- und
// Fokus-Mechanik bleiben. Fokus wird nie nur über Farbe kommuniziert:
// Akzent-Ring + Glow + hellerer Header-Text plus Explorer-Echo.
// Die Zoom-Kontrollen erscheinen bei Hover im Header (Fenster-Chrome-Konvention);
// die aktive Stufe zeigt das Restore-Glyph und togglet zurück, Escape ebenso.
export function TerminalPane({
  project,
  focused,
  onFocus,
  zoom,
  onToggleZoom,
  style,
}: {
  project: Project;
  focused: boolean;
  onFocus: () => void;
  zoom: PaneZoom | null;
  onToggleZoom: (mode: PaneZoom) => void;
  style?: CSSProperties;
}) {
  return (
    <section
      onMouseDown={onFocus}
      aria-label={`Terminal ${project.name}`}
      style={style}
      className={`group/pane flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-(--pc-pane-background) transition-[border-color,box-shadow] duration-150 ${
        focused
          ? "border-(--pc-pane-activeBorder) shadow-[0_0_0_1px_var(--pc-pane-activeBorder),0_0_24px_var(--pc-pane-activeGlow)]"
          : "border-(--pc-pane-border)"
      }`}
    >
      <header
        className={`flex h-6 shrink-0 items-center gap-2 border-b border-(--pc-paneHeader-border) pl-3 pr-1 text-[11px] font-medium tracking-wide ${
          focused
            ? "text-(--pc-paneHeader-activeForeground)"
            : "text-(--pc-paneHeader-foreground)"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        <span
          className={`flex items-center gap-px text-(--pc-paneHeader-foreground) transition-opacity ${
            zoom
              ? "opacity-100"
              : "opacity-0 focus-within:opacity-100 group-hover/pane:opacity-100"
          }`}
        >
          <ZoomButton
            mode="width"
            active={zoom === "width"}
            onToggle={onToggleZoom}
          />
          <ZoomButton
            mode="height"
            active={zoom === "height"}
            onToggle={onToggleZoom}
          />
          <ZoomButton
            mode="max"
            active={zoom === "max"}
            onToggle={onToggleZoom}
          />
        </span>
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

const ZOOM_LABEL: Record<PaneZoom, string> = {
  width: "Volle Breite",
  height: "Volle Höhe",
  max: "Maximieren",
};

function ZoomButton({
  mode,
  active,
  onToggle,
}: {
  mode: PaneZoom;
  active: boolean;
  onToggle: (mode: PaneZoom) => void;
}) {
  const label = active ? "Zurück zum Raster (Esc)" : ZOOM_LABEL[mode];
  const Icon = active ? RestoreIcon : ZOOM_ICON[mode];
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={() => onToggle(mode)}
          className={`flex size-[18px] items-center justify-center rounded-[4px] transition-colors hover:bg-(--pc-list-hoverBackground) focus-visible:outline-1 focus-visible:outline-(--pc-focusBorder) ${
            active
              ? "text-(--pc-focusBorder)"
              : "hover:text-(--pc-paneHeader-activeForeground)"
          }`}
        >
          <Icon />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          align="end"
          sideOffset={4}
          className="z-20 rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) px-2 py-1 text-[11px] text-(--pc-foreground) shadow-lg"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ZoomIconSvg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function ExpandWidthIcon() {
  return (
    <ZoomIconSvg>
      <path d="M2.2 6h7.6M4.2 3.8 2 6l2.2 2.2M7.8 3.8 10 6 7.8 8.2" />
    </ZoomIconSvg>
  );
}

function ExpandHeightIcon() {
  return (
    <ZoomIconSvg>
      <path d="M6 2.2v7.6M3.8 4.2 6 2l2.2 2.2M3.8 7.8 6 10l2.2-2.2" />
    </ZoomIconSvg>
  );
}

function MaximizeIcon() {
  return (
    <ZoomIconSvg>
      <rect x="2" y="2" width="8" height="8" rx="1" />
    </ZoomIconSvg>
  );
}

function RestoreIcon() {
  return (
    <ZoomIconSvg>
      <rect x="2" y="4" width="6" height="6" rx="1" />
      <path d="M4.2 2h5.3a.5.5 0 0 1 .5.5v5.3" />
    </ZoomIconSvg>
  );
}

const ZOOM_ICON: Record<PaneZoom, () => ReactElement> = {
  width: ExpandWidthIcon,
  height: ExpandHeightIcon,
  max: MaximizeIcon,
};

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
