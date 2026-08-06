import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";
import type { PaneDropRegistration } from "../terminal/useWebviewFileDrop";
import { usePtyTerminal } from "../terminal/usePtyTerminal";

// Echte, PTY-gestützte Terminal-Pane: sehr dünner Header (eine schlanke
// Textzeile, 24px Klickfläche) mit dem Projektnamen, darunter das
// xterm.js-Terminal. Der Fokus-Akzent (Ring + Glow + hellerer Header-Text)
// bleibt aus dem Direction Contract erhalten — er ist die Kernmechanik, die
// Ticket 03 mit dem echten Grid wieder trägt.
//
// `paneId`/`projectPath`/`projectName` kommen jetzt vom Grid-Store
// (`PaneGrid.tsx`) statt aus einer eigenen Erzeugung hier — eine Pane weiß
// nichts mehr über ihre Slot-Zuordnung, sie bekommt sie gereicht.
export function TerminalPane({
  paneId,
  projectPath,
  projectName,
  focused,
  dropTargets,
  onClose,
}: {
  paneId: string;
  projectPath: string;
  projectName: string;
  /** Noch ohne sichtbare Wirkung (Schritt 5 des Plans) — die
   * fokussiert/unfokussiert-Token-Anwendung über N Panes ist Teil des
   * Opus-Durchgangs (Schritt 8), NICHT bereits erledigt. Bis dahin trägt der
   * Rahmen unten unbedingt den Aktiv-Ton, unabhängig vom tatsächlichen
   * Fokus. */
  focused: boolean;
  /** Grid-weite Drag-Drop-Registrierung (`useWebviewFileDrop.ts`) — diese
   * Pane trägt sich hier ein, damit ein Drop auf ihrer Fläche bei ihr
   * landet. */
  dropTargets: PaneDropRegistration;
  onClose: () => void;
}) {
  // Destrukturiert statt als Objekt weitergereicht: der Hook gibt neben den
  // Aktionen auch containerRef zurück, und die React-Compiler-Regel
  // react-hooks/refs wertet jeden Property-Zugriff auf so ein Objekt während
  // des Renderns als Ref-Zugriff.
  const {
    containerRef,
    copySelection,
    paste,
    clear,
    focus,
    hasSelection,
    insertDroppedPaths,
  } = usePtyTerminal(paneId, projectPath);
  const [selectionAvailable, setSelectionAvailable] = useState(false);

  useEffect(() => {
    dropTargets.register(paneId, insertDroppedPaths);
    return () => dropTargets.unregister(paneId);
  }, [paneId, dropTargets, insertDroppedPaths]);

  return (
    <section
      aria-label={`Terminal ${projectName}`}
      aria-current={focused ? "true" : undefined}
      data-pane-id={paneId}
      onMouseDown={focus}
      // flex-1: die Pane war im alten 2x2-Grid ein Grid-Item und wurde vom
      // Raster gestreckt. Als einziges Kind eines Spalten-Flex-Containers muss
      // sie die Höhe jetzt selbst einfordern, sonst schrumpft sie auf ihren
      // Inhalt und der FitAddon misst eine 0-hohe Box.
      // Fokus trägt allein der 1px-Rahmen im Akzent (gegen
      // --pc-pane-border der unfokussierten Panes). Der frühere Aufbau hatte
      // drei Signale übereinander: diesen Rahmen, einen zweiten 1px-Ring in
      // derselben Farbe und einen 24px-Glow. Nutzerentscheidung 2026-08-05,
      // die die eigene frühere Freigabe („luminous glow", comp-2) widerruft —
      // und deckungsgleich mit dem Craft Floor, für den ein farbiger Schein
      // ohne Versatz Dekoration ist, keine Tiefe. Das Echo im Explorer-Kopf
      // und der hellere Header-Text bleiben als zweites und drittes Signal.
      //
      // TODO(Schritt 8, Opus): `focused` bedingt hier zwischen
      // `--pc-pane-activeBorder` und `--pc-pane-border` (unfokussiert) —
      // heute hart auf den Aktiv-Ton verdrahtet, siehe `focused`-Prop-Doc.
      className="group/pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-(--pc-pane-activeBorder) bg-(--pc-pane-background)"
    >
      <header className="flex h-6 shrink-0 items-center gap-2 border-b border-(--pc-paneHeader-border) pl-3 pr-1 text-(length:--pc-chrome-fontSizeSmall) font-medium tracking-wide text-(--pc-paneHeader-activeForeground)">
        <span className="min-w-0 flex-1 truncate">{projectName}</span>
        <ChromeTooltip label="Pane schließen" align="end">
          <button
            type="button"
            aria-label="Pane schließen"
            onClick={onClose}
            // Hover hellt auf den normalen Vordergrund auf, NICHT auf den
            // Akzent: der gehört laut Direction Contract allein dem Fokus, und
            // ein Knopf, der beim Überfahren die Fokusfarbe annimmt, behauptet
            // einen Zustand, den er nicht herstellt.
            className={`flex size-(--pc-paneControl-size) shrink-0 items-center justify-center rounded-(--pc-paneControl-radius) text-(--pc-paneHeader-foreground) opacity-0 transition-[opacity,color,background-color] hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) focus-visible:opacity-100 group-hover/pane:opacity-100 ${CHROME_FOCUS_RING}`}
          >
            <CloseIcon />
          </button>
        </ChromeTooltip>
      </header>

      <ContextMenu.Root
        onOpenChange={(open) => {
          if (open) setSelectionAvailable(hasSelection());
        }}
      >
        <ContextMenu.Trigger asChild>
          {/* xterm.js hängt sein DOM hier hinein; das Padding rechnet der
              FitAddon aus der Container-Box heraus. */}
          <div
            ref={containerRef}
            className="min-h-0 flex-1 overflow-hidden px-3 py-2"
          />
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            // Radix gäbe den Fokus sonst an den Trigger-Container zurück, nicht
            // an xterms versteckte Textarea — die Eingabe wäre danach tot.
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              focus();
            }}
            className="z-30 min-w-40 rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) p-1 text-(length:--pc-chrome-fontSize) text-(--pc-foreground) shadow-lg"
          >
            <TerminalMenuItem
              onSelect={copySelection}
              disabled={!selectionAvailable}
            >
              Kopieren
            </TerminalMenuItem>
            <TerminalMenuItem onSelect={paste}>
              Einfügen
            </TerminalMenuItem>
            <ContextMenu.Separator className="my-1 h-px bg-(--pc-titleBar-border)" />
            <TerminalMenuItem onSelect={clear}>
              Terminal leeren
            </TerminalMenuItem>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </section>
  );
}

function TerminalMenuItem({
  onSelect,
  disabled,
  children,
}: {
  onSelect: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <ContextMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className="flex h-7 cursor-default select-none items-center rounded px-2 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-(--pc-list-hoverBackground) data-[disabled]:text-(--pc-descriptionForeground) data-[disabled]:opacity-50"
    >
      {children}
    </ContextMenu.Item>
  );
}

function CloseIcon() {
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
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}
