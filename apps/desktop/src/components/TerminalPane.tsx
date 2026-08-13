import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import { useTranslation } from "react-i18next";
import {
  CHROME_FOCUS_RING,
  CHROME_MENU_CONTENT_CLASS,
  CHROME_MENU_ITEM_CLASS,
  CHROME_MENU_SEPARATOR_CLASS,
  ChromeTooltip,
} from "./ChromeTooltip";
import { FocusModeButton } from "./FocusModeButton";
import { PaneTabs, type PaneTabsProps } from "./PaneTabs";
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
// Wie lange die Kopiert-Bestätigung oben rechts im Terminal steht: lang genug
// zum Lesen eines Wortes, kurz genug, dass sie nie als Zustand missverstanden
// wird. Erscheinen und Verschwinden sind harte Schnitte (Design-Kanon:
// Zustandswechsel bei 0ms) — die Mikroanimation ist die Zeitlichkeit selbst,
// kein Easing.
const COPY_FLASH_MS = 1200;

export function TerminalPane({
  paneId,
  tabId,
  projectPath,
  projectName,
  focused,
  maximized,
  active,
  dropTarget,
  tabs,
  dropTargets,
  onClose,
  onFocus,
  onToggleFocusMode,
  focusModeHud,
}: {
  /** Die Pane, zu der dieser Terminal-Tab gehört — trägt weiterhin
   * `data-pane-id` (Drop-Routing, `useWebviewFileDrop.ts`) und geht in
   * `onFocus`/`onClose` (Pane-weite Aktionen, nicht Tab-weite). */
  paneId: string;
  /** DIESER Terminal-Tab — seit Ticket 18 die PTY-Identität statt `paneId`
   * (eine Pane kann mehrere `TerminalPane`-Mounts gleichzeitig haben, je
   * einen pro Terminal-Tab). Geht 1:1 in `usePtyTerminal`. */
  tabId: string;
  projectPath: string;
  projectName: string;
  /** Genau eine Pane im ganzen Grid ist das (`state.focusedPaneId`). Trägt
   * zwei der drei Fokussignale: den Akzentrahmen und den aufgehellten
   * Header-Text; das dritte ist das Akzent-Echo im Explorer-Kopf. */
  focused: boolean;
  /** Ob GENAU DIESE Pane gerade den Fokus-Modus trägt (Ticket 19) — steuert
   * nur den Header-Knopf (`FocusModeButton.tsx`), das Ein-/Ausblenden der
   * ANDEREN Panes entscheidet `PaneGrid.tsx`. */
  maximized: boolean;
  /** Ob DIESER Terminal-Tab gerade der sichtbare der Pane ist. Getrennt von
   * `focused` (Pane-Ebene): mehrere `TerminalPane`-Mounts derselben Pane
   * stehen gleichzeitig im DOM (PaneGrid.tsx blendet die inaktiven nur aus,
   * s. dortige Begründung), aber nur der aktive darf sich als Drop-Ziel
   * eintragen — sonst gewinnt beim Registrieren zufällig der zuletzt
   * gemountete, auch wenn er gerade unsichtbar ist. */
  active: boolean;
  /** Ob ein Datei-Drag gerade über der Pane schwebt (`useWebviewFileDrop.ts`
   * trifft mit derselben Mathematik wie den späteren Drop) — schaltet das
   * Drop-Ziel-HUD über der Terminalfläche ein. Pane-weit, nicht tab-weit:
   * sichtbar wird es nur im aktiven Tab, die inaktiven liegen unter
   * `visibility: hidden` (PaneGrid.tsx). */
  dropTarget: boolean;
  /** Tab-Leiste dieser Pane (PaneTabs.tsx) — TerminalPane.tsx UND
   * FileEditor.tsx binden hier dasselbe Objekt ein (PaneGrid.tsx hält den
   * Tab-Zustand als einzige Wahrheit), 2026-08-12/Ticket 18. */
  tabs: PaneTabsProps;
  /** Grid-weite Drag-Drop-Registrierung (`useWebviewFileDrop.ts`) — diese
   * Pane trägt sich hier ein, damit ein Drop auf ihrer Fläche bei ihr
   * landet. */
  dropTargets: PaneDropRegistration;
  onClose: () => void;
  /** Schreibt `paneId` als `focusedPaneId` in den Grid-Store (Fokus-Ring +
   * Explorer-Pfad hängen daran) — getrennt vom hook-eigenen `focus()` unten,
   * das nur xterm.js' DOM-Fokus setzt und den Grid-Store nie erreicht. */
  onFocus: () => void;
  /** Ticket 19: derselbe Aufruf maximiert diese Pane oder verlässt den
   * Fokus-Modus, je nach `maximized` — die Entscheidung trifft `PaneGrid.tsx`
   * zentral (`onToggleFocusMode`-Kommentar dort). */
  onToggleFocusMode: () => void;
  /** Fertig gerenderter `<FocusModeHud>` (oder `null`) — `PaneGrid.tsx`
   * berechnet Slot-Position/Gesamtzahl/Rotationszustand zentral EINMAL pro
   * Zelle statt sie hier UND in `FileEditor.tsx` doppelt herzuleiten; diese
   * Pane platziert das Ergebnis nur noch im Header (zwischen Tab-Leiste und
   * Fokus-Knopf, `FocusModeHud.tsx`s Kopfkommentar begründet die Andockung
   * dort statt einer freischwebenden Fläche). */
  focusModeHud: ReactNode;
}) {
  const { t } = useTranslation();
  // Destrukturiert statt als Objekt weitergereicht: der Hook gibt neben den
  // Aktionen auch containerRef zurück, und die React-Compiler-Regel
  // react-hooks/refs wertet jeden Property-Zugriff auf so ein Objekt während
  // des Renderns als Ref-Zugriff.
  const selectTerminalTabByNumber = (number: number) => {
    const target = tabs.terminalTabs.find((tab) => tab.number === number);
    if (target) tabs.onSelectTerminalTab(target.tabId);
  };
  // Kopiert-Bestätigung: das Kontextmenü schließt sich beim Kopieren sofort,
  // und das System quittiert einen Zwischenablage-Schreibvorgang mit nichts —
  // ohne dieses Readout bleibt "hat das jetzt geklappt?" eine Vertrauensfrage.
  // Vor dem Hook-Aufruf definiert, weil der Hook selbst sie braucht: Kopieren
  // per Tastenkombination (Ctrl/Cmd+C) läuft komplett innerhalb von xterm.js
  // ab und hat sonst keinen Weg zurück zu dieser Live-Region.
  const [copiedFlash, setCopiedFlash] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );
  const notifyCopied = () => {
    setCopiedFlash(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(
      () => setCopiedFlash(false),
      COPY_FLASH_MS,
    );
  };
  const {
    containerRef,
    copySelection,
    paste,
    clear,
    focus,
    hasSelection,
    insertDroppedPaths,
    spawning,
  } = usePtyTerminal(tabId, projectPath, selectTerminalTabByNumber, notifyCopied);
  const [selectionAvailable, setSelectionAvailable] = useState(false);
  const copyWithFeedback = () => {
    copySelection();
    notifyCopied();
  };

  useEffect(() => {
    if (!active) return;
    dropTargets.register(paneId, insertDroppedPaths);
    return () => dropTargets.unregister(paneId);
  }, [active, paneId, dropTargets, insertDroppedPaths]);

  // Tab-Wechsel mountet keinen neuen Terminal-Tab (PaneGrid.tsx hält alle
  // gleichzeitig gemountet, nur ausgeblendet) — ohne diesen Effekt bleibt der
  // DOM-Fokus im vorher aktiven Tab hängen, auch wenn der Wechsel per
  // Tastatur kam und die Maus das Terminal nie berührt hat. Reagiert bewusst
  // nur auf einen echten false→true-Übergang (per Ref verfolgt), nicht auf
  // `active` selbst: sonst riefe jede Pane, deren aktiver Tab beim initialen
  // Mount (Sitzungs-Restore mit mehreren Panes) bereits `active` ist, hier
  // ebenfalls focus() — die zuletzt gemountete Pane gewönne den DOM-Fokus,
  // unabhängig davon, welche Pane vorher `focusedPaneId` im Grid-Store trug.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) focus();
    wasActive.current = active;
  }, [active, focus]);

  return (
    <section
      aria-label={t("terminalPane.terminalAria", { projectName })}
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
      className={`group/pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-(--pc-pane-background) transition-colors ${
        focused ? "border-(--pc-pane-activeBorder)" : "border-(--pc-pane-border)"
      }`}
    >
      {/* Zweites Fokussignal: der Projektname der aktiven Pane steht im
          Akzent, die der übrigen im gedimmten Header-Ton. Bei einer einzelnen
          Pane war das nicht unterscheidbar — mit sieben Templates und bis zu
          vier Panes ist es der Unterschied, den man ohne Suchen liest.
          Seit der Akzent-Investition (2026-08-13) zieht auch die Hairline
          unter dem Header mit: gedimmtes Amber (45 %) statt Neutralgrau —
          dritter Baustein desselben Signals, bewusst unter der Deckkraft des
          Rahmens, damit der weiterhin die erste Antwort auf „wo ist der
          Fokus?" bleibt. Nimmt seit dem Widerruf der 0ms-Zustandswechsel-Regel
          (`.impeccable/direction-contract-desktop.md` → „Zustandswechsel:
          „hart 0ms" aufgehoben") dieselbe `transition-colors` wie der
          Pane-Rahmen an. FileEditor.tsx' Header spiegelt exakt dieselbe
          Schaltung. */}
      <header
        className={`flex h-6 shrink-0 items-center gap-2 border-b pl-3 pr-1 text-(length:--pc-chrome-fontSizeSmall) font-medium tracking-wide transition-colors ${
          focused
            ? "border-(--pc-pane-activeBorder)/45 text-(--pc-paneHeader-activeForeground)"
            : "border-(--pc-paneHeader-border) text-(--pc-paneHeader-foreground)"
        }`}
      >
        {/* Drei-Zonen-Header (2026-08-13-Nachtrag, Ticket 18): Name und
            Tab-Leiste sitzen fest nebeneinander, der Leerraum liegt IMMER im
            Spacer danach — nie zwischen Name und Tabs. FileEditor.tsx' Kopf
            spiegelt exakt dieselbe Reihenfolge (bis auf den Speichern-Knopf
            statt nichts vor dem Schließen-Kreuz), sonst würde beim Öffnen/
            Schließen einer Datei zwischen zwei Layouts umgeschaltet und die
            Chips sprängen sichtbar (genau der gemeldete Fehler — vorher stand
            hier `flex-1` an DIESEM Namen, wodurch jede Größenänderung der
            Tab-Leiste ihn stauchte und die Chips mitzog). Ohne `flex-1` wächst
            der Name nie über seinen Textinhalt hinaus, `shrink` lässt ihn nur
            bei echtem Platzmangel trunkieren. */}
        {/* Viertes Fokussignal, HUD-Sprache: das Prompt-Chevron vor dem
            Namen — dieselbe Aussage wie das ❯ im ASCII-Emblem der leeren
            Slots und der Amber-Cursor im Terminal darunter: hier landet die
            Eingabe. Fester Platz statt bedingtem Mount, damit der Name beim
            Fokuswechsel nicht springt; unfokussiert bleibt die Stelle leer. */}
        <span
          aria-hidden="true"
          className="w-2 shrink-0 font-(family-name:--pc-terminal-fontFamily)"
        >
          {focused ? "❯" : ""}
        </span>
        {/* Terminalschrift statt Chrome-Schrift (2026-08-13, TUI-Runde): mit
            dem ❯ davor liest sich der Kopf als Prompt-Zeile — dieselbe
            Register-Entscheidung wie im Explorer-Kopf, beide Namen benennen
            dasselbe Projekt und müssen im selben Ton sprechen. */}
        <span className="min-w-0 shrink truncate font-(family-name:--pc-terminal-fontFamily)">
          {projectName}
        </span>
        <PaneTabs {...tabs} />
        <div aria-hidden="true" className="min-w-0 flex-1" />
        {focusModeHud}
        <FocusModeButton maximized={maximized} onToggle={onToggleFocusMode} />
        <ChromeTooltip label={t("terminalPane.closePane")} align="end">
          <button
            type="button"
            aria-label={t("terminalPane.closePane")}
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
              überhaupt startet.
              Präzision statt Zentrierung (2026-08-13, „messerscharf"-Goal):
              der Hinweis steht in der TERMINALSCHRIFT exakt an der Position,
              an der gleich die erste Prompt-Zeile erscheint (dasselbe
              px-3 py-2 wie der xterm-Container, dieselbe Zeilenbox) — der
              Übergang vom Platzhalter zur echten Shell ist damit ein
              Textwechsel in derselben Zelle, kein Layoutsprung von der
              Flächenmitte an den Rand. */}
          {spawning && (
            <p
              className="pointer-events-none absolute inset-0 px-3 py-2 font-(family-name:--pc-terminal-fontFamily) text-(--pc-descriptionForeground)"
              style={{
                fontSize: "var(--pc-terminal-fontSize)",
                lineHeight: "var(--pc-terminal-lineHeight)",
              }}
            >
              {t("terminalPane.starting")}
              {/* Statischer Amber-Block im Ton des echten Terminal-Cursors
                  (--pc-terminal-cursor, bewusst NICHT der Chrome-Akzent):
                  der Platzhalter zeigt die Zelle, in der gleich der Prompt
                  steht, inklusive des Cursors, der dort stehen wird. Kein
                  Blinken — der echte xterm-Cursor blinkt auch nicht
                  (cursorBlink ist nicht gesetzt), und der Platzhalter darf
                  nicht lebendiger wirken als das Terminal danach. */}
              <span aria-hidden="true" className="text-(--pc-terminal-cursor)">
                {" ▊"}
              </span>
            </p>
          )}
          {/* Drop-Ziel-HUD: erscheint, sobald ein Datei-Drag über dieser Pane
              schwebt, und wandert beim Ziehen von Pane zu Pane mit — dieselbe
              Treffermathematik wie der Drop selbst (useWebviewFileDrop.ts),
              das HUD verspricht also exakt, was ein Loslassen tut. Amber ist
              hier Einladung, dieselbe Semantik wie die Sucher-Ecken der
              leeren Slots (App.css, .pc-hud-corner-Kommentar) — kein zweiter
              Fokus-Ort: während eines nativen Drags gibt es keinen
              konkurrierenden Zeiger-Zustand. Harte Schnitte, kein Easing;
              `aria-hidden`, weil ein nativer Datei-Drag reine Zeigerführung
              ist. `pointer-events-none` versteht sich: die Fläche gehört
              weiter dem Terminal. */}
          {active && dropTarget && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10"
            >
              {/* 4px nach innen gerückt: direkt auf der Kante würden die
                  Ecken bei fokussierter Pane mit deren Amber-Rahmen zu einer
                  verdickten Ecke verschmelzen — abgesetzt lesen sie sich als
                  eigenes Instrument über dem Inhalt. */}
              <div className="absolute inset-1">
                <span className="pc-hud-corner pc-hud-corner--invite pc-hud-corner--tl" />
                <span className="pc-hud-corner pc-hud-corner--invite pc-hud-corner--tr" />
                <span className="pc-hud-corner pc-hud-corner--invite pc-hud-corner--bl" />
                <span className="pc-hud-corner pc-hud-corner--invite pc-hud-corner--br" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span
                  className="flex items-center gap-1.5 rounded-(--pc-paneControl-radius) border border-(--pc-pane-activeBorder)/45 bg-(--pc-pane-background)/90 py-1 pl-2 font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.25em] uppercase"
                  // Tracking-Ausgleich wie beim Sprachchip der TitleBar:
                  // letter-spacing hängt rechts am letzten Glyph, ohne den
                  // Abzug stünde das Wort nicht mittig in seiner Plakette.
                  style={{ paddingRight: "calc(0.5rem - 0.25em)" }}
                >
                  <span className="text-(--pc-pane-activeBorder)">⇣</span>
                  <span className="text-(--pc-descriptionForeground)">
                    {t("terminalPane.dropHint")}
                  </span>
                </span>
              </div>
            </div>
          )}
          {/* Dauerhaft gemountete Live-Region (nur ihr Inhalt kommt und
              geht): eine erst beim Kopieren eingehängte role="status"-Region
              würde von Screenreadern unzuverlässig angekündigt.
              Dieselbe Chip-Sprache wie das Drop-Ziel-HUD oben (Rahmen +
              Terminalschrift + Tracking-Ausgleich), aber als BESTÄTIGUNG statt
              Einladung deutlich kräftiger gefasst: voll deckender statt
              45%-Amber-Rahmen, Vordergrundtext statt gedimmtem
              Beschreibungston — das ursprüngliche Readout ging in der übrigen
              Chrome unter (Nutzer-Feedback 2026-08-13). Kein Fade-in/Glow:
              Erscheinen/Verschwinden bleiben der harte 0ms-Schnitt aus
              COPY_FLASH_MS oben, die Mikroanimation IST diese Zeitlichkeit. */}
          <div
            role="status"
            className="pointer-events-none absolute top-2 right-2 z-10"
          >
            {copiedFlash && (
              <span
                className="flex items-center gap-1.5 rounded-(--pc-paneControl-radius) border border-(--pc-pane-activeBorder) bg-(--pc-pane-background)/90 py-1 pl-2 font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.25em] uppercase text-(--pc-foreground)"
                style={{ paddingRight: "calc(0.5rem - 0.25em)" }}
              >
                <span aria-hidden="true" className="text-(--pc-pane-activeBorder)">
                  ✓
                </span>
                {t("terminalPane.copied")}
              </span>
            )}
          </div>
        </div>
        <ContextMenu.Portal>
          <ContextMenu.Content
            // Radix gäbe den Fokus sonst an den Trigger-Container zurück, nicht
            // an xterms versteckte Textarea — die Eingabe wäre danach tot.
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              focus();
            }}
            className={`min-w-40 ${CHROME_MENU_CONTENT_CLASS}`}
          >
            <TerminalMenuItem
              onSelect={copyWithFeedback}
              disabled={!selectionAvailable}
            >
              {t("terminalPane.copy")}
            </TerminalMenuItem>
            <TerminalMenuItem onSelect={paste}>
              {t("terminalPane.paste")}
            </TerminalMenuItem>
            <ContextMenu.Separator className={CHROME_MENU_SEPARATOR_CLASS} />
            <TerminalMenuItem onSelect={clear}>
              {t("terminalPane.clear")}
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
      className={CHROME_MENU_ITEM_CLASS}
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
