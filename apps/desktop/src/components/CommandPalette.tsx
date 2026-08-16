import { useMemo, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { CHROME_FOCUS_RING } from "./ChromeTooltip";

/** Ein Eintrag der Befehlspalette — App.tsx baut die Liste, diese Komponente
 * kennt nur Anzeige/Filter/Tastaturnavigation, keine der Handlungen selbst
 * (dasselbe Formen-statt-Anlass-Prinzip wie `ConfirmDialog.tsx`). */
export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  /** Fertig formatierter Chord (z. B. "⌘,"), falls der Befehl auch über ein
   * Tastaturkürzel erreichbar ist — aus `registry.ts`s `SHORTCUTS` via
   * `formatChord` gebaut, dort wo App.tsx die Liste zusammenstellt. */
  readonly shortcut?: string;
  readonly run: () => void;
}

// Erster der zehn Referenz-Editor-Menüaudit-Punkte. Einfacher Teilstring-
// Filter statt Fuzzy-Matching (dieselbe Suchklasse wie ExplorerPanel.tsx'
// Baumfilter — kein Fuzzy dort, keins hier, konsistent statt zweier
// verschiedener Sucherfahrungen in derselben App) — die Befehlsliste ist kurz
// genug, dass ein Fuzzy-Ranking keinen echten Mehrwert brächte, aber eine
// zweite Sortierlogik zum Pflegen wäre.
export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly PaletteCommand[];
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Text und Auswahl gehören der EINEN Öffnung — ein zweites Öffnen soll
  // nicht die letzte Sucheingabe von zuvor zeigen, dieselbe Erwägung wie bei
  // `TreeFilterRow`s eigenem "beim Schließen verwirft, nicht nur versteckt".
  // Angepasst WÄHREND des Renderns, nicht in einem Effekt — derselbe Trick
  // wie `useFocusRotation.ts`s `lastMaximizedPaneId`
  // (react-hooks/set-state-in-effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return commands;
    return commands.filter((command) => command.label.toLowerCase().includes(needle));
  }, [commands, query]);

  // Der Filtertext kann die vorher aktive Zeile aus der Liste werfen — ohne
  // diesen Gleichlauf zeigte die Auswahlmarkierung auf eine Position, die
  // jetzt einen ANDEREN Eintrag trägt, oder auf gar keinen mehr. Derselbe
  // Render-Zeit-Trick wie oben bei `wasOpen`.
  const [lastFiltered, setLastFiltered] = useState(filtered);
  if (filtered !== lastFiltered) {
    setLastFiltered(filtered);
    setActiveIndex((current) => Math.min(current, Math.max(filtered.length - 1, 0)));
  }

  const run = (command: PaletteCommand) => {
    onOpenChange(false);
    command.run();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-(--pc-dialog-overlayBackground) animate-[pc-overlay-fade-in_150ms_ease-out]" />
        <Dialog.Content
          // Weiter oben als die übrigen Dialoge dieser App (top-[20vh] statt
          // top-1/2) — dieselbe Platzierungskonvention wie im Referenz-Editor:
          // eine Befehlspalette ist ein flüchtiger Umweg zwischen zwei
          // Tastenanschlägen, sie soll nicht die Bildschirmmitte verdecken,
          // in der gerade ein Terminal steht.
          className="fixed left-1/2 top-[20vh] z-50 flex max-h-[min(24rem,calc(100vh-24vh-2rem))] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-(--pc-widget-border) bg-(--pc-widget-background) shadow-lg outline-none animate-[pc-overlay-in_150ms_ease-out]"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Radix fokussiert sonst den Content selbst — die Eingabe ist der
            // einzig sinnvolle erste Fokus einer Befehlspalette.
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">{t("commandPalette.title")}</Dialog.Title>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("commandPalette.placeholder")}
            aria-label={t("commandPalette.title")}
            aria-activedescendant={
              filtered.length > 0 ? `command-palette-item-${activeIndex}` : undefined
            }
            role="combobox"
            aria-expanded
            aria-controls="command-palette-list"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const command = filtered[activeIndex];
                if (command) run(command);
              }
            }}
            className="w-full border-b border-(--pc-widget-border) bg-transparent px-3 py-2.5 text-(length:--pc-chrome-fontSizeLarge) text-(--pc-foreground) outline-none placeholder:text-(--pc-descriptionForeground)"
          />
          <ul id="command-palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-center text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)">
                {t("commandPalette.empty")}
              </li>
            ) : (
              filtered.map((command, index) => (
                <li
                  key={command.id}
                  id={`command-palette-item-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                >
                  <button
                    type="button"
                    onClick={() => run(command)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex w-full items-center justify-between gap-4 rounded-sm px-2 py-1.5 text-left text-(length:--pc-chrome-fontSize) transition-colors ${
                      index === activeIndex
                        ? "bg-(--pc-list-activeSelectionBackground) text-(--pc-foreground)"
                        : "text-(--pc-foreground) hover:bg-(--pc-list-hoverBackground)"
                    } ${CHROME_FOCUS_RING}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{command.label}</span>
                    {command.shortcut && (
                      <span className="shrink-0 font-(family-name:--pc-terminal-fontFamily) text-(--pc-descriptionForeground)">
                        {command.shortcut}
                      </span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
