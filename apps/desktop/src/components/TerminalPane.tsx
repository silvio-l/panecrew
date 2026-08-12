import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";
import { PaneTabs } from "./PaneTabs";
import type { PaneDropRegistration } from "../terminal/useWebviewFileDrop";
import { usePtyTerminal } from "../terminal/usePtyTerminal";

// Echte, PTY-gestützte Terminal-Pane: sehr dünner Header (eine schlanke
// Textzeile, 24px Klickfläche) mit dem Projektnamen, darunter das
// xterm.js-Terminal. Der Fokus-Akzent aus dem Direction Contract — seit dem
// Widerruf des Glows der 1px-Rahmen plus der aufgehellte Header-Text — ist die
// Kernmechanik, die mit dem echten Grid überhaupt erst etwas unterscheidet:
// bei einer einzigen Pane war "fokussiert" keine Aussage.
//
// `paneId`/`projectPath`/`projectName` kommen jetzt vom Grid-Store
// (`PaneGrid.tsx`) statt aus einer eigenen Erzeugung hier — eine Pane weiß
// nichts mehr über ihre Slot-Zuordnung, sie bekommt sie gereicht.
export function TerminalPane({
  paneId,
  projectPath,
  projectName,
  focused,
  tabs,
  dropTargets,
  onClose,
  onFocus,
}: {
  paneId: string;
  projectPath: string;
  projectName: string;
  /** Genau eine Pane im ganzen Grid ist das (`state.focusedPaneId`). Trägt
   * zwei der drei Fokussignale: den Akzentrahmen und den aufgehellten
   * Header-Text; das dritte ist das Akzent-Echo im Explorer-Kopf. */
  focused: boolean;
  /** `null`, solange in dieser Pane keine Datei offen ist — der Header bleibt
   * dann die reine Namenszeile von vorher. Sobald eine Datei offen ist,
   * bekommen beide Header (dieser hier UND FileEditor.tsx) denselben
   * Tab-Umschalter mit denselben Handlern gereicht (PaneGrid.tsx hält
   * `activeView` als einzige Wahrheit) — 2026-08-12, Nutzerwunsch, zwischen
   * Terminal und Datei hin- und herschalten zu können, ohne die Datei zu
   * schließen. */
  tabs: {
    activeView: "terminal" | "file";
    fileName: string;
    fileDirty: boolean;
    onSelectTerminal: () => void;
    onSelectFile: () => void;
  } | null;
  /** Grid-weite Drag-Drop-Registrierung (`useWebviewFileDrop.ts`) — diese
   * Pane trägt sich hier ein, damit ein Drop auf ihrer Fläche bei ihr
   * landet. */
  dropTargets: PaneDropRegistration;
  onClose: () => void;
  /** Schreibt `paneId` als `focusedPaneId` in den Grid-Store (Fokus-Ring +
   * Explorer-Pfad hängen daran) — getrennt vom hook-eigenen `focus()` unten,
   * das nur xterm.js' DOM-Fokus setzt und den Grid-Store nie erreicht. */
  onFocus: () => void;
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
    spawning,
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
      onMouseDown={() => {
        onFocus();
        focus();
      }}
      // React bubblet Fokus-Events synthetisch auch bei nativ nicht-
      // bubblenden `focus` (siehe React-Doku zu onFocus/onFocusCapture) —
      // fängt jeden Weg, wie xterm.js' verstecktes Helper-Textarea den
      // DOM-Fokus bekommt: Tab-Navigation, Kontextmenü-Interaktion, nicht
      // nur den Mausklick oben. `onFocus` (Grid-Store) ist No-Op-sicher bei
      // bereits fokussierter Pane, doppeltes Feuern kostet also nichts.
      onFocusCapture={onFocus}
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
      // Der Rahmen ist damit das einzige Element der Pane, das die Farbe
      // wechselt — und weil ihn jede Pane trägt, nur eben in zwei Tönen,
      // springt die Breite beim Fokuswechsel nicht (ein Rahmen, der nur bei
      // Fokus da ist, verschöbe das Terminal darin um 1px).
      className={`group/pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-(--pc-pane-background) ${
        focused ? "border-(--pc-pane-activeBorder)" : "border-(--pc-pane-border)"
      }`}
    >
      {/* Zweites Fokussignal: der Projektname der aktiven Pane steht im
          Akzent, die der übrigen im gedimmten Header-Ton. Bei einer einzelnen
          Pane war das nicht unterscheidbar — mit sieben Templates und bis zu
          vier Panes ist es der Unterschied, den man ohne Suchen liest. */}
      <header
        className={`flex h-6 shrink-0 items-center gap-2 border-b border-(--pc-paneHeader-border) pl-3 pr-1 text-(length:--pc-chrome-fontSizeSmall) font-medium tracking-wide ${
          focused
            ? "text-(--pc-paneHeader-activeForeground)"
            : "text-(--pc-paneHeader-foreground)"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{projectName}</span>
        {tabs && (
          <PaneTabs
            active={tabs.activeView}
            fileName={tabs.fileName}
            fileDirty={tabs.fileDirty}
            onSelectTerminal={tabs.onSelectTerminal}
            onSelectFile={tabs.onSelectFile}
          />
        )}
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
        {/* Eigener position:relative-Rahmen nur für den Ladehinweis unten:
            der bezieht sich per `absolute inset-0` auf DIESE Box, nicht auf
            den Terminal-Container selbst — der bleibt unverändert das
            Flex-Item, das den restlichen Platz der Pane einnimmt. */}
        <div className="relative min-h-0 flex-1">
          <ContextMenu.Trigger asChild>
            {/* xterm.js hängt sein DOM hier hinein; das Padding rechnet der
                FitAddon aus der Container-Box heraus. */}
            <div
              ref={containerRef}
              className="absolute inset-0 overflow-hidden px-3 py-2"
            />
          </ContextMenu.Trigger>
          {/* Nur Text, kein Spinner — derselbe Grundsatz wie
              FileEditor.tsx' LoadingNotice: der Normalfall ist ein einzelner
              Frame, spürbar wird es erst, wenn mehrere Panes beim
              Sitzungs-Restore gleichzeitig spawnen (2026-08-12).
              `pointer-events-none`, weil er über der (noch leeren)
              Terminalfläche schwebt, ohne ihre künftige Bedienbarkeit
              vorwegzunehmen. Kein `aria-hidden`: für wen den Bildschirm nicht
              sieht, ist dieser Text das einzige Signal, dass die Pane
              überhaupt startet. */}
          {spawning && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 py-2 text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)">
              Terminal wird gestartet …
            </p>
          )}
        </div>
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
