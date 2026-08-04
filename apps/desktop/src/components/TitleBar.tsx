import { Tooltip } from "radix-ui";

// Schlanke eigene Titelzeile (titleBarStyle Overlay, native Traffic-Lights
// links freigehalten): App-Identität links, zentrierter, rein visueller
// Command-Palette-Platzhalter (Zukunfts-Feature, ohne Funktion),
// Settings-Zugang rechts. Kein Icon-Rail.
export function TitleBar() {
  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 border-b border-(--pc-titleBar-border) bg-(--pc-app-background) pl-[84px]"
    >
      {/* Zwei Farbebenen wie in echtem VS Code (Beleg: docs/agents/
          vscode-theming-research.md §8): der native, nicht-CSS-abgedeckte
          Fensterhintergrund rund um die Ampeln kommt aus editor.background
          (= --pc-app-background, hier die pl-[84px]-Zone des <header>), das
          gemalte Titelzeilen-Div aus titleBar.activeBackground (der Wrapper). */}
      <div
        data-tauri-drag-region
        className="flex flex-1 items-center bg-(--pc-titleBar-background) pr-2"
      >
        {/* data-tauri-drag-region wirkt nur auf dem Element selbst (keine
            Vererbung an Kinder): Dekoratives wird pointer-events-none, damit
            jeder Mousedown auf einem attributierten Hintergrund-Segment landet. */}
        <div data-tauri-drag-region className="flex flex-1 items-center gap-2">
          <AppMark />
          <span className="pointer-events-none text-(length:--pc-chrome-fontSize) font-medium text-(--pc-titleBar-foreground)">
            PaneCrew
          </span>
        </div>
        <div
          aria-hidden="true"
          className="flex h-6 w-72 max-w-[40vw] items-center justify-center gap-1.5 rounded-md border border-(--pc-titleBar-searchBorder) bg-(--pc-titleBar-searchBackground) text-(length:--pc-chrome-fontSizeSmall) text-(--pc-titleBar-searchForeground)"
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
                className="rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) px-2 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground) shadow-lg"
              >
                Settings
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
      </div>
    </header>
  );
}

// App-Marke: pixelgenaue Vektor-Parität zum echten App-Icon ("K3H —
// Verzahnung, Amber") — Chevron, dessen unterer Arm über eine diagonale
// Gehrungsfuge in den Cursor-Block übergeht, mit dem echten Amber/Gold-
// Verlauf und weichem Glow. Bewusste Kurskorrektur (2026-08-04): die frühere
// monochrome Titelzeilen-Fassung wich absichtlich vom Icon ab (ANSI-Yellow-
// Kollisionsrisiko); auf expliziten Wunsch ersetzt durch 1:1-Farbparität,
// als eigenständige SVG-Quelle (nicht aus dem Master-PNG exportiert) neu
// vermessen und iterativ gegen den Master abgeglichen. Gleiche SVG-Definition
// ist Ursprung des aktuellen Icon-Masters (icons/source/panecrew-mark.svg) —
// eine einzige Quelle für In-App-Marke und OS-Icons, kein Auseinanderdriften.
function AppMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 1600 1600"
      aria-hidden="true"
      className="pointer-events-none"
    >
      <defs>
        <radialGradient
          id="pcMarkChevron"
          gradientUnits="userSpaceOnUse"
          cx="1330"
          cy="780"
          r="900"
        >
          <stop offset="0" stopColor="#FEF2DE" />
          <stop offset="0.15" stopColor="#FEF0D8" />
          <stop offset="0.35" stopColor="#FFE9C8" />
          <stop offset="0.56" stopColor="#FFD394" />
          <stop offset="0.67" stopColor="#FFCE8C" />
          <stop offset="0.8" stopColor="#FEBE63" />
          <stop offset="0.88" stopColor="#FDB14B" />
          <stop offset="1" stopColor="#FCAD43" />
        </radialGradient>
        <linearGradient
          id="pcMarkBlock"
          gradientUnits="userSpaceOnUse"
          x1="106"
          y1="0"
          x2="569"
          y2="0"
        >
          <stop offset="0" stopColor="#FBB84E" />
          <stop offset="0.15" stopColor="#FEBE64" />
          <stop offset="0.5" stopColor="#FEE0B6" />
          <stop offset="0.82" stopColor="#FFF2DE" />
          <stop offset="1" stopColor="#FFF5E2" />
        </linearGradient>
        <mask id="pcMarkGapMask" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1600">
          <rect width="1600" height="1600" fill="#ffffff" />
          <polygon points="569,1208 749,1218 555,1485 368,1485" fill="#000000" />
        </mask>
        <filter id="pcMarkGlow" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="30" result="b1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="70" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
          </feMerge>
        </filter>
      </defs>
      <g mask="url(#pcMarkGapMask)">
        <g filter="url(#pcMarkGlow)" opacity="0.5" fill="#FFA929">
          <path d="M800 115 L1494 810 L819 1485 L555 1485 L749 1218 L1157 810 L632 283 Z" />
          <path d="M106 1208 L569 1208 L368 1485 L106 1485 Z" />
        </g>
      </g>
      <path
        fill="url(#pcMarkChevron)"
        d="M800 115 L1494 810 L819 1485 L555 1485 L749 1218 L1157 810 L632 283 Z"
      />
      <path fill="url(#pcMarkBlock)" d="M106 1208 L569 1208 L368 1485 L106 1485 Z" />
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
