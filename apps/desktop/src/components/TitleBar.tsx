import { Tooltip } from "radix-ui";

// Schlanke eigene Titelzeile (titleBarStyle Overlay, native Traffic-Lights
// links freigehalten): App-Identität links, zentrierter, rein visueller
// Command-Palette-Platzhalter (Zukunfts-Feature, ohne Funktion),
// Settings-Zugang rechts. Kein Icon-Rail.
export function TitleBar() {
  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center border-b border-(--pc-titleBar-border) bg-(--pc-titleBar-background) pl-[84px] pr-2"
    >
      <div data-tauri-drag-region className="flex flex-1 items-center gap-2">
        <AppMark />
        <span className="text-[13px] font-medium text-(--pc-titleBar-foreground)">
          Panecrew
        </span>
      </div>
      <div
        aria-hidden="true"
        className="flex h-6 w-72 max-w-[40vw] items-center justify-center gap-1.5 rounded-md border border-(--pc-titleBar-border) bg-(--pc-pane-background) text-[11px] text-(--pc-descriptionForeground)"
      >
        <SearchIcon />
        <span className="truncate">Suchen oder Befehl ausführen</span>
      </div>
      <div
        data-tauri-drag-region
        className="flex flex-1 items-center justify-end"
      >
        <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label="Settings"
            className="flex size-7 items-center justify-center rounded-md text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) focus-visible:outline-1 focus-visible:outline-(--pc-focusBorder)"
          >
            <GearIcon />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            align="end"
            sideOffset={4}
            className="rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) px-2 py-1 text-[11px] text-(--pc-foreground) shadow-lg"
          >
            Settings
          </Tooltip.Content>
        </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    </header>
  );
}

// App-Marke: 2×2-Pane-Raster, eine Zelle trägt den Fokus-Akzent.
function AppMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="0" y="0" width="6" height="6" rx="1.5" fill="var(--pc-descriptionForeground)" />
      <rect x="8" y="0" width="6" height="6" rx="1.5" fill="var(--pc-focusBorder)" />
      <rect x="0" y="8" width="6" height="6" rx="1.5" fill="var(--pc-descriptionForeground)" />
      <rect x="8" y="8" width="6" height="6" rx="1.5" fill="var(--pc-descriptionForeground)" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.6v1.9M8 12.5v1.9M1.6 8h1.9M12.5 8h1.9M3.5 3.5l1.35 1.35M11.15 11.15l1.35 1.35M12.5 3.5l-1.35 1.35M4.85 11.15L3.5 12.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="5" cy="5" r="3.4" />
      <path d="m7.6 7.6 2.6 2.6" />
    </svg>
  );
}
