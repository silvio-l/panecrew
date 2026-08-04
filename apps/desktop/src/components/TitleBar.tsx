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
      {/* data-tauri-drag-region wirkt nur auf dem Element selbst (keine
          Vererbung an Kinder): Dekoratives wird pointer-events-none, damit
          jeder Mousedown auf einem attributierten Hintergrund-Segment landet. */}
      <div data-tauri-drag-region className="flex flex-1 items-center gap-2">
        <AppMark />
        <span className="pointer-events-none text-[13px] font-medium text-(--pc-titleBar-foreground)">
          PaneCrew
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

// App-Marke: 14px-Neuzeichnung des App-Icon-Emblems ("Verzahnung") — Chevron
// (>), dessen unterer Arm über eine diagonale Gehrungsfuge in den Cursor-Block
// (_) übergeht: Butt-Caps stehen senkrecht zur Arm-Achse, die linke Blockkante
// ist parallel dazu angeschrägt, dazwischen ~1px Fuge. Bewusst monochrom in
// Titelzeilen-Textfarbe (kein Amber wie im App-Icon: kollidiert mit
// ANSI-Yellow-Semantik der Terminal-Panes) — die Wiedererkennung trägt allein
// die verzahnte Geometrie. Block-Kanten pixel-gesnappt (y 11–13, x bis 13),
// damit der Cursor bei echten 14px scharf bleibt.
function AppMark() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="pointer-events-none"
    >
      <path
        d="M2.1 1.4 L9.5 5.2 L2.1 9"
        fill="none"
        stroke="var(--pc-titleBar-foreground)"
        strokeWidth="2.4"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
      <path d="M4.3 11 H13 V13 H5.34 Z" fill="var(--pc-titleBar-foreground)" />
    </svg>
  );
}

// Eindeutiges Zahnrad (gezahnter Ring + Nabe, Feather-"settings"-Form) — die
// frühere Kreis-plus-Strahlen-Variante wurde als Sonne/Theme-Toggle gelesen.
function GearIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
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
