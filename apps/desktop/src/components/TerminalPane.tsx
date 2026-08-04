import { useState } from "react";
import type { ReactNode } from "react";
import { ContextMenu, Tooltip } from "radix-ui";
import { usePtyTerminal } from "../terminal/usePtyTerminal";
import type { Project } from "../types/project";

// Echte, PTY-gestützte Terminal-Pane: sehr dünner Header (eine schlanke
// Textzeile, 24px Klickfläche) mit dem Projektnamen, darunter das
// xterm.js-Terminal. Der Fokus-Akzent (Ring + Glow + hellerer Header-Text)
// bleibt aus dem Direction Contract erhalten, obwohl es in diesem Ticket nur
// eine Pane gibt — er ist die Kernmechanik, die Ticket 03 mit dem echten Grid
// wieder trägt.
//
// Die Zoom-Buttons (volle Breite/Höhe/maximieren) sind hier bewusst ENTFERNT
// statt nur ausgeblendet: bei genau einer Pane ist jede Stufe ein No-Op, die
// Steuerung hätte also keinen ehrlichen Zustand, und ungenutzter Code wider-
// spricht der Knip-Regel des Repos. Ticket 03 baut sie gegen die dann echte
// Grid-Geometrie neu auf; die alten Icons stehen in der Git-Historie. Der
// freigewordene Header-Slot trägt jetzt eine Aktion, die es in diesem Ticket
// wirklich gibt: die Pane schließen (→ pty_kill, zurück zum Projekt-Picker).
export function TerminalPane({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  // Destrukturiert statt als Objekt weitergereicht: der Hook gibt neben den
  // Aktionen auch containerRef zurück, und die React-Compiler-Regel
  // react-hooks/refs wertet jeden Property-Zugriff auf so ein Objekt während
  // des Renderns als Ref-Zugriff.
  const { containerRef, copySelection, paste, clear, focus, hasSelection } =
    usePtyTerminal(project.path);
  const [selectionAvailable, setSelectionAvailable] = useState(false);

  return (
    <section
      aria-label={`Terminal ${project.name}`}
      onMouseDown={focus}
      // flex-1: die Pane war im alten 2x2-Grid ein Grid-Item und wurde vom
      // Raster gestreckt. Als einziges Kind eines Spalten-Flex-Containers muss
      // sie die Höhe jetzt selbst einfordern, sonst schrumpft sie auf ihren
      // Inhalt und der FitAddon misst eine 0-hohe Box.
      className="group/pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-(--pc-pane-activeBorder) bg-(--pc-pane-background) shadow-[0_0_0_1px_var(--pc-pane-activeBorder),0_0_24px_var(--pc-pane-activeGlow)]"
    >
      <header className="flex h-6 shrink-0 items-center gap-2 border-b border-(--pc-paneHeader-border) pl-3 pr-1 text-(length:--pc-chrome-fontSizeSmall) font-medium tracking-wide text-(--pc-paneHeader-activeForeground)">
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              aria-label="Pane schließen"
              onClick={onClose}
              className="flex size-(--pc-paneControl-size) shrink-0 items-center justify-center rounded-(--pc-paneControl-radius) text-(--pc-paneHeader-foreground) opacity-0 transition-[opacity,color,background-color] hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-paneHeader-activeForeground) focus-visible:opacity-100 focus-visible:outline-1 focus-visible:outline-(--pc-focusBorder) group-hover/pane:opacity-100"
            >
              <CloseIcon />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="bottom"
              align="end"
              sideOffset={4}
              className="z-20 rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) px-2 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground) shadow-lg"
            >
              Pane schließen
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
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
