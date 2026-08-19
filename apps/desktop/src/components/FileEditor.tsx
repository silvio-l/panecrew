import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  UIEvent as ReactUIEvent,
} from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";
import { FocusModeButton } from "./FocusModeButton";
import { PaneTabs, type PaneTabsProps } from "./PaneTabs";
import { languageForPath, tokenizeLines, type LanguageId, type Token, type TokenKind } from "./syntaxHighlight";
import type { FileEditorState } from "../explorer/fileEditorState";
import { fileNameFromPath } from "../explorer/filePath";
import { isMacPlatform } from "../shortcuts/platform";
import {
  matchesShortcut,
  SAVE_FILE_SHORTCUT_ID,
  SHORTCUTS,
  terminalTabSelectNumber,
} from "../shortcuts/registry";

// Die Editorfläche des Mini-Editors (.scratch/explorer-file-io/, Tickets 03
// und 04): lesen, ändern, zurückschreiben. Die Zustandsmaschine dahinter liegt
// vollständig in `explorer/fileEditorState.ts` — hier wird sie nur angezeigt
// und bedient, es gibt in dieser Datei keinen zweiten Wahrheitsstand über
// „geändert" oder „gespeichert".
//
// PLATZIERUNG (Nutzerentscheidung 2026-08-06, Ergänzung am Ticket): Diese
// Fläche übernimmt vorübergehend das Rechteck der Terminal-Pane, statt neben
// ihr zu stehen. Kein Split, kein Drawer, kein Overlay — der gepinnte
// Direction Contract in App.tsx weist die „editor-shell-with-terminal-drawer"-
// Vorgabe ausdrücklich zurück, und nur das Übernehmen des Rechtecks übersteht
// das kommende Raster unverändert: jede Pane hat dann unabhängig entweder ihr
// Terminal oder eine Datei offen, ohne neues app-globales Chrome. App.tsx hält
// die Terminal-Pane dabei gemountet und blendet sie nur aus (`hidden`) — ein
// Unmount würde über den Cleanup von `usePtyTerminal` `pty_kill` auslösen und
// die echte Shell-Sitzung töten.
//
// Optik ist deshalb 1:1 das Pane-Idiom aus TerminalPane.tsx (gleicher Radius,
// gleicher Aktiv-Rahmen, gleiche h-6-Kopfzeile in denselben Tokens): Was hier
// steht, ist nicht ein zweites Fenster neben der Pane, sondern dieselbe Pane
// mit anderem Inhalt.
//
// RENDER-ISOLATION (Ticket 05, Performance-Audit, 2026-08-14): die eigentliche
// Eingabefläche (`EditorBuffer` unten) ist unkontrolliert statt an
// `state.content` gebunden — Details/Begründung an `EditorBuffer` selbst.
export function FileEditor({
  state,
  focused,
  maximized,
  projectName,
  tabs,
  onEdit,
  onSave,
  onClose,
  onHeaderPointerDown,
  onToggleFocusMode,
  focusModeHud,
  jumpToLine,
  onJumpApplied,
}: {
  state: FileEditorState;
  /** Dieselbe Pane-Fokus-Aussage wie in TerminalPane.tsx (`state.focusedPaneId`
   * im Grid-Store) — diese Fläche ersetzt nur deren Inhalt, nicht deren
   * Fokus-Semantik. Ohne diesen Prop zeigte JEDE offene Datei unbedingt den
   * Akzentrahmen, auch in unfokussierten Panes (2026-08-12,
   * Nutzerbeobachtung: alle Panes wirken gleichzeitig „aktiv"). */
  focused: boolean;
  /** Ob GENAU DIESE Pane gerade den Fokus-Modus trägt (Ticket 19) — steuert
   * nur `FocusModeButton.tsx`, dieselbe Bedeutung wie in TerminalPane.tsx. */
  maximized: boolean;
  /** Derselbe Projektname wie im Terminal-Header daneben (2026-08-13-
   * Nachtrag) — vorher zeigte dieser Kopf ihn gar nicht (als redundant
   * verworfen, s. Git-Historie), aber genau das ließ die Tab-Leiste beim
   * Öffnen/Schließen einer Datei zwischen zwei Kopfzeilen-Layouts springen.
   * Jetzt trägt dieser Kopf dieselbe erste Zone wie TerminalPane.tsx, Position
   * an Position — die Redundanz ist der Preis für stehende Tab-Chips. */
  projectName: string;
  /** Tab-Leiste dieser Pane (PaneTabs.tsx) — dasselbe Objekt wie an
   * TerminalPane.tsx derselben Pane (PaneGrid.tsx hält den Tab-Zustand als
   * einzige Wahrheit), 2026-08-12/Ticket 18. Enthält u. a. den Wechsel
   * zurück zu einem Terminal-Tab, ohne die Datei zu schließen — anders als
   * `onClose` unten (verwirft die Datei) ist das ein reiner Wechsel der
   * Ansicht. */
  tabs: PaneTabsProps;
  onEdit: (content: string) => void;
  /** `content` (Ticket 05, Performance-Audit): der aktuelle Textarea-Stand,
   * gelesen über `bufferRef` unten — seit derselbe Puffer unkontrolliert ist
   * (s. `EditorBuffer`), ist das die einzig verlässliche Quelle, nicht
   * `state.content` (das bleibt seit demselben Ticket ab dem zweiten
   * Tastendruck einer Sitzung zurück, s. `usePaneFileEditors.ts`s
   * `editContent`). */
  onSave: (options?: { force?: boolean; content?: string }) => void;
  onClose: () => void;
  /** Griff für den Slot-Tausch (Ticket 20) — identisch zu TerminalPane.tsx:
   * beide Kopfzeilen sind dieselbe Zone derselben Pane, eine Pane mit
   * offener Datei muss sich genauso ziehen lassen wie eine mit Terminal. */
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Ticket 19: derselbe Aufruf wie in TerminalPane.tsx — maximiert diese
   * Pane oder verlässt den Fokus-Modus, je nach `maximized`. */
  onToggleFocusMode: () => void;
  /** Fertig gerenderter `<FocusModeHud>` (oder `null`) — `PaneGrid.tsx`
   * berechnet Slot-Position/Gesamtzahl/Rotationszustand zentral EINMAL pro
   * Zelle statt sie hier UND in TerminalPane.tsx doppelt herzuleiten; diese
   * Fläche platziert das fertige Element nur noch an derselben Stelle im
   * Header wie dort. */
  focusModeHud: ReactNode;
  /** Ticket 26 (Inhaltssuche): eine noch nicht angewendete Sprungzeile aus
   * `usePaneFileEditors.ts`s `open(path, line)`, `null` ohne offenen
   * Sprungwunsch. Angewendet wird sie erst, sobald `state.status` „ready"
   * ist — vorher existiert der Puffer noch nicht, an dem sich Zeile 1 als
   * Position festmachen ließe. */
  jumpToLine: number | null;
  /** Meldet einen angewendeten Sprung an den Hook zurück (setzt `jumpToLine`
   * dort auf `null`) — sonst liefe derselbe Sprung bei jedem weiteren Render
   * dieser Fläche erneut. */
  onJumpApplied: () => void;
}) {
  const { t } = useTranslation();
  // Pane-weiter Aufblitz (PaneTabs.tsx' Kopfkommentar, Nachtrag zum
  // Pane-Aufblitz) — dieselbe Mechanik wie TerminalPane.tsx, VOR dem
  // frühen `return` unten, da Hooks nicht bedingt aufgerufen werden dürfen.
  const [paneFlashKey, setPaneFlashKey] = useState(0);
  // Ticket 05 (Performance-Audit): Ref auf die (seit diesem Ticket
  // unkontrollierte) Textarea in `EditorBuffer` unten — der einzige Weg, den
  // GERADE getippten Stand für Speichern/Strg+S zu lesen, seit nicht mehr
  // jeder Tastendruck den React-Zustand nachführt (`state.content` kann
  // hinter ihm zurückbleiben, s. `usePaneFileEditors.ts`s `editContent`).
  const bufferRef = useRef<HTMLTextAreaElement | null>(null);

  // Ticket 26 (Inhaltssuche): wendet einen offenen Sprungwunsch an, sobald
  // der Puffer wirklich existiert — `EditorBuffer` ist unkontrolliert
  // (Ticket 05) und trägt ihren Text erst ab dem Commit dieses "ready"-
  // Renders im DOM, der Ref davor ist leer. Exakte Positionsrechnung statt
  // bloßem "ins Sichtfeld scrollen": `EditorBuffer` setzt `wrap="off"`
  // (Begründung dort), also entspricht eine sichtbare Bildschirmzeile immer
  // genau einer logischen Zeile, und `getComputedStyle` liefert die
  // tatsächliche Zeilenhöhe in Pixeln (der Puffer setzt sie selbst über
  // `--pc-terminal-lineHeight`, oft ein einheitenloser Multiplikator — erst
  // die berechnete Form ist ein fester Pixelwert).
  useEffect(() => {
    if (jumpToLine === null) return;
    if (state.status !== "ready") return;
    const textarea = bufferRef.current;
    if (!textarea) return;

    const lines = textarea.value.split("\n");
    const targetIndex = Math.min(Math.max(jumpToLine - 1, 0), lines.length - 1);
    let charOffset = 0;
    for (let i = 0; i < targetIndex; i++) {
      charOffset += (lines[i]?.length ?? 0) + 1;
    }
    const lineLength = lines[targetIndex]?.length ?? 0;
    textarea.focus();
    textarea.setSelectionRange(charOffset, charOffset + lineLength);

    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight);
    if (!Number.isNaN(lineHeight)) {
      textarea.scrollTop = Math.max(
        0,
        targetIndex * lineHeight - textarea.clientHeight / 2 + lineHeight / 2,
      );
    }

    onJumpApplied();
  }, [jumpToLine, state.status, onJumpApplied]);

  // Ohne offene Datei gibt es keine Fläche: App.tsx rendert diese Komponente
  // bedingungslos und stellt die Bedingung damit genau einmal — hier.
  if (state.status === "idle") return null;

  const name = fileNameFromPath(state.path);
  const saving = state.status === "saving";
  // Exakt die Bedingung, unter der `save()` im Hook etwas tut (siehe
  // `fileEditorState.ts`s `startSaving`): ein sauberes „ready" hat nichts zu
  // schreiben, ein fehlgeschlagener Versuch dagegen sehr wohl.
  const canSave =
    state.status === "save-error" || (state.status === "ready" && state.dirty);
  // Solange nur geladen wird oder das Laden gescheitert ist, gibt es gar
  // keinen Puffer — dann fehlt der Knopf ganz, statt ausgegraut einen Text zu
  // behaupten, den es nicht gibt. Ausgegraut heißt hier „im Moment nichts zu
  // schreiben", nicht „nichts vorhanden". Als Positivliste statt Negativliste
  // (Ticket 38): "media" ist ein reiner Lesemodus ohne Puffer, ein
  // Ausschlusslistenzweig hätte den Knopf dafür fälschlich weiter gezeigt.
  const hasBuffer =
    state.status === "ready" ||
    state.status === "saving" ||
    state.status === "save-error";

  // Cmd/Strg+S über dieselbe Registry wie jedes andere Kürzel — kein zweiter
  // Key-Handling-Pfad. Der Handler hängt an DIESER Fläche statt am `window`:
  // Scope „pane" heißt hier wörtlich, dass die Taste nur wirkt, solange der
  // Tastaturfokus in der Fläche steht; im Terminal daneben gehört Cmd+S
  // unverändert der Shell (dafür sorgt `zoomAction` in usePtyTerminal.ts).
  //
  // Bewusst am <section> und nicht nur an der Textarea: so greift das Kürzel
  // auch, während der Speichern-Knopf oder „Trotzdem überschreiben" den Fokus
  // hat — Tastenereignisse aus den Kindern blubbern hierher.
  //
  // Nachtrag 2026-08-13: Cmd/Strg+1..9 wechselt jetzt AUCH von hier aus zu
  // einem Terminal-Tab — der Tooltip in PaneTabs.tsx verspricht den Akkord
  // pro Chip, unabhängig davon, ob gerade eine Datei oder ein Terminal
  // sichtbar ist. Ohne diesen Zweig hätte das Kürzel genau dann nichts getan,
  // wenn eine Datei offen ist — derselbe „ich weiß nicht, wie ich wechsle"-
  // Fall, nur eine Ansicht weiter.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const shortcut = SHORTCUTS.find((def) =>
      matchesShortcut(event, def, isMacPlatform()),
    );
    if (!shortcut) return;
    if (shortcut.id === SAVE_FILE_SHORTCUT_ID) {
      // Auch dann, wenn es gerade nichts zu speichern gibt: der Webview hat
      // auf dieser Taste eine eigene Vorstellung („Seite sichern unter …"),
      // und die will man in einem Editor nie sehen. `onSave` ist in dem Fall
      // ein No-Op.
      event.preventDefault();
      onSave({ content: bufferRef.current?.value });
      return;
    }
    const tabNumber = terminalTabSelectNumber(shortcut);
    if (tabNumber === null) return;
    const target = tabs.terminalTabs.find((tab) => tab.number === tabNumber);
    if (!target) return;
    event.preventDefault();
    tabs.onSelectTerminalTab(target.tabId);
  };

  return (
    <section
      aria-label={t("fileEditor.fileAria", { name })}
      onKeyDown={onKeyDown}
      // `group/pane`: allein für den Fokus-Modus-Knopf unten
      // (`FocusModeButton.tsx`, dieselbe hover-enthüllte Mechanik wie in
      // TerminalPane.tsx' Kopf) — der Schließen-Knopf dieser Fläche bleibt
      // bewusst dauerhaft sichtbar (Begründung dort), reagiert also NICHT auf
      // diese Gruppe.
      // `pc-pane-clip` statt `overflow-hidden`: Begründung 1:1 wie in
      // TerminalPane.tsx (der herausgezogene Tab-Chip braucht Luft über der
      // Kopfzeile) — beide Flächen tragen dieselbe Tab-Leiste, also muss auch
      // dieser Zuschnitt an beiden gleich sein.
      className={`group/pane pc-pane-clip relative flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border bg-(--pc-pane-background) transition-colors ${
        focused ? "border-(--pc-pane-activeBorder)" : "border-(--pc-pane-border)"
      }`}
    >
      {paneFlashKey > 0 && (
        // z-20, NICHT -z-10 wie am Chip: hier gibt es zwar keine xterm-
        // Fläche, aber dasselbe Argument wie TerminalPane.tsx gilt für die
        // Textarea/den Editorinhalt darunter — ein negativer z-index läge in
        // der Malreihenfolge vor jedem normalen Inhalt (CSS2.1 Anhang E,
        // Schritt 2 vs. 3/6) und bliebe darunter unsichtbar. Gleiche
        // Begründung wie dort, aus Konsistenzgründen dupliziert statt
        // extrahiert (zwei Zeilen, kein gemeinsamer Zustand).
        <span
          key={paneFlashKey}
          aria-hidden="true"
          // `rounded-t-[7px]`: gleiche Nachrüstung wie in TerminalPane.tsx —
          // der neue `clip-path` rundet die oberen Ecken nicht mehr für
          // absolut positionierte Kinder mit.
          className="pointer-events-none absolute inset-0 z-20 animate-[pc-attention-flash_1400ms_ease-out] rounded-t-[7px]"
        />
      )}
      {/* Header-Hairline im gedimmten Amber bei Fokus — Schaltung und
          Begründung 1:1 wie in TerminalPane.tsx' Header (inkl. der seit dem
          Widerruf der 0ms-Zustandswechsel-Regel ergänzten `transition-colors`,
          `.impeccable/direction-contract-desktop.md` → „Zustandswechsel:
          „hart 0ms" aufgehoben"). */}
      <header
        onPointerDown={onHeaderPointerDown}
        // `cursor-grab` wie im Terminal-Kopf (Begründung dort).
        className={`flex h-6 shrink-0 cursor-grab items-center gap-2 border-b pl-3 pr-1 text-(length:--pc-chrome-fontSizeSmall) font-medium tracking-wide transition-colors ${
          focused
            ? "border-(--pc-pane-activeBorder)/45 text-(--pc-paneHeader-activeForeground)"
            : "border-(--pc-paneHeader-border) text-(--pc-paneHeader-foreground)"
        }`}
      >
        {/* Derselbe Tab-Umschalter wie im Terminal-Header daneben (2026-08-12)
            — er trägt den Dateinamen samt Ungespeichert-Punkt jetzt selbst,
            eine zusätzliche Namenszeile daneben wäre dieselbe Information ein
            zweites Mal. Layout seit 2026-08-13 Position-für-Position wie
            TerminalPane.tsx' Kopf (Begründung am `projectName`-Prop oben). */}
        {/* Prompt-Chevron der fokussierten Pane — Position-für-Position wie
            in TerminalPane.tsx' Kopf (Begründung dort). */}
        <span
          aria-hidden="true"
          className="w-2 shrink-0 font-(family-name:--pc-terminal-fontFamily)"
        >
          {focused ? "❯" : ""}
        </span>
        {/* Terminalschrift wie in TerminalPane.tsx' Kopf (TUI-Runde
            2026-08-13) — beide Köpfe derselben Pane müssen im selben
            Register sprechen. */}
        <span className="min-w-0 shrink truncate font-(family-name:--pc-terminal-fontFamily)">
          {projectName}
        </span>
        <PaneTabs {...tabs} onTabAttentionFlash={() => setPaneFlashKey((key) => key + 1)} />
        <div aria-hidden="true" className="min-w-0 flex-1" />
        {focusModeHud}
        <FocusModeButton maximized={maximized} onToggle={onToggleFocusMode} />
        {hasBuffer && (
          <button
            type="button"
            disabled={!canSave}
            aria-busy={saving}
            onClick={() => onSave({ content: bufferRef.current?.value })}
            // Farbe/Deckkraft in EINE Klasse verzweigt statt zwei
            // gleichrangige Utilities nebeneinander (dieselbe Regel wie in
            // ExplorerPanel.tsx: sonst entscheidet die Reihenfolge im
            // erzeugten Stylesheet).
            //
            // Der ausgegraute Zustand bleibt bewusst LESBAR (der gedämpfte
            // Header-Ton, nicht der fast unsichtbare Rahmenton der
            // Explorer-Kopfzeile): dieser Knopf ist die einzige sichtbare
            // Antwort auf „wie schreibe ich das zurück", und die darf auch
            // dann auffindbar sein, wenn gerade nichts zu speichern ist.
            className={`flex h-5 shrink-0 items-center rounded-(--pc-paneControl-radius) px-1.5 transition-[color,background-color] ${
              canSave
                ? "text-(--pc-foreground) hover:bg-(--pc-list-hoverBackground)"
                : "text-(--pc-paneHeader-foreground)"
            } ${CHROME_FOCUS_RING}`}
          >
            {/* Eine Zeile Text statt eines Spinners — dieselbe Entscheidung
                wie im Ladezustand weiter unten: geschrieben wird auf die
                lokale Platte, der Zustand ist im Normalfall nach einem Frame
                vorbei. */}
            {saving ? t("fileEditor.saving") : t("fileEditor.save")}
          </button>
        )}
        <ChromeTooltip label={t("fileEditor.closeFile")} align="end">
          <button
            type="button"
            aria-label={t("fileEditor.closeFile")}
            onClick={onClose}
            // Anders als das X der Terminal-Pane NICHT hover-enthüllt
            // (`opacity-0` … `group-hover`): dort ist Schließen eine
            // Zusatzhandlung an einer Fläche, in der man ohnehin arbeitet,
            // hier ist es der einzige Weg zurück zum Terminal, das diese
            // Fläche gerade verdeckt. Derselbe Grundsatz wie im Über-Fenster:
            // bei einem Zustand, der etwas anderes ersetzt, ist der sichtbare
            // Ausgang Pflicht, nicht Zierde.
            className={`flex size-(--pc-paneControl-size) shrink-0 items-center justify-center rounded-(--pc-paneControl-radius) text-(--pc-paneHeader-foreground) transition-[color,background-color] hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
          >
            <CloseIcon />
          </button>
        </ChromeTooltip>
      </header>

      {state.status === "loading" ? (
        <LoadingNotice />
      ) : state.status === "load-error" ? (
        <LoadErrorNotice path={state.path} message={state.message} />
      ) : state.status === "media" ? (
        <MediaPreview kind={state.kind} mime={state.mime} base64={state.base64} name={name} />
      ) : (
        <>
          {/* ÜBER der Textarea, nicht an ihrer Stelle: anders als beim
              Ladefehler gibt es hier bereits Inhalt, und der ist genau das,
              was nicht verloren gehen darf. Die Meldung schiebt sich deshalb
              davor, statt den Puffer zu ersetzen — er bleibt sichtbar und
              änderbar. */}
          {state.status === "save-error" && (
            <SaveErrorNotice
              message={state.message}
              conflict={state.conflict}
              onSave={(options) =>
                onSave({ ...options, content: bufferRef.current?.value })
              }
            />
          )}
          <EditorBuffer
            ref={bufferRef}
            ariaLabel={t("fileEditor.contentAria", { name })}
            initialContent={state.content}
            saving={saving}
            language={languageForPath(state.path)}
            onEdit={onEdit}
          />
        </>
      )}
    </section>
  );
}

/** Wie viele zusätzliche Zeilen ober-/unterhalb des sichtbaren Ausschnitts
 * mitgerendert werden — reine Sicherheitsmarge gegen einen sichtbaren
 * Leerstreifen für den einen Frame zwischen Scroll-Event und Re-Render. */
const OVERSCAN_LINES = 8;

/**
 * Sichtbarer Zeilenbereich aus Scroll-Position + Zeilenhöhe (Ticket 39) —
 * dieselbe Grundannahme wie beim Sprung-Effekt oben: `wrap="off"` macht eine
 * Bildschirmzeile IMMER zu genau einer logischen Zeile, deshalb reicht reine
 * Arithmetik statt einer DOM-Messung pro Zeile. Das ist der Grund, warum
 * Gutter und Highlight-Overlay unten trotz voller Datei-Tokenisierung pro
 * Tastendruck (s. `tokenizeLines`-Kommentar) nicht bei jeder großen Datei
 * einfrieren: React reconciled nur diese paar Dutzend Zeilen zu Elementen,
 * nie die ganze Datei.
 */
function visibleLineRange(
  scrollTop: number,
  clientHeight: number,
  lineHeight: number,
  totalLines: number,
): { start: number; end: number } {
  if (lineHeight <= 0 || totalLines === 0) return { start: 0, end: totalLines };
  const first = Math.floor(scrollTop / lineHeight);
  const visibleCount = Math.ceil(clientHeight / lineHeight) + 1;
  return {
    start: Math.max(0, first - OVERSCAN_LINES),
    end: Math.min(totalLines, first + visibleCount + OVERSCAN_LINES),
  };
}

/** S. Kopfkommentar `syntaxHighlight.ts` zur Kontrast-Herleitung dieser vier
 * Zuordnungen — jede Farbe ist ein existierendes, bereits als Fließtext
 * geprüftes Token, keine hier neu erfundene. */
const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: "text-(--pc-foreground)",
  comment: "text-(--pc-descriptionForeground)",
  string: "text-(--pc-gitDecoration-untrackedResourceForeground)",
  keyword: "text-(--pc-gitDecoration-modifiedResourceForeground)",
};

/** Zeilennummern-Spalte, IMMER sichtbar (auch bei nicht erkannter Extension
 * — Akzeptanzkriterium des Tickets), als Geschwister der Textarea statt in
 * ihrer eigenen Scroll-Box (s. Kopfkommentar `EditorBuffer`): so bleibt
 * `textarea.clientHeight` unverändert und der Sprung-Effekt oben braucht
 * keine Anpassung. Folgt der Textarea-Scrollposition rein per `transform`
 * statt eigenem Scrollen — dieselbe gefensterte Technik wie im
 * Highlight-Overlay, aus demselben Grund (Kosten skalieren mit dem
 * sichtbaren statt dem gesamten Puffer). */
function LineGutter({
  totalLines,
  start,
  end,
  lineHeight,
  scrollTop,
}: {
  totalLines: number;
  start: number;
  end: number;
  lineHeight: number;
  scrollTop: number;
}) {
  const digits = Math.max(2, String(totalLines).length);
  const numbers: number[] = [];
  for (let i = start; i < end; i++) numbers.push(i + 1);

  return (
    <div
      aria-hidden="true"
      className="shrink-0 select-none overflow-hidden border-r border-(--pc-paneHeader-border) bg-transparent py-2 text-right font-(family-name:--pc-terminal-fontFamily) text-(--pc-descriptionForeground)"
      style={{ width: `calc(${digits}ch + 1rem)`, fontSize: "var(--pc-terminal-fontSize)" }}
    >
      <div style={{ transform: `translateY(${start * lineHeight - scrollTop}px)` }}>
        {numbers.map((n) => (
          <div key={n} className="pr-2" style={{ height: lineHeight, lineHeight: `${lineHeight}px` }}>
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Farbige Syntax-Fläche HINTER der (transparent gestellten) Textarea —
 * dieselbe, seit react-simple-code-editor/CodeMirror <6 etablierte
 * Overlay-Technik: die Textarea führt weiter Eingabe/Cursor/Auswahl/
 * Scrollen exakt wie zuvor, dieses `<pre>` malt nur die Farbe darunter.
 * `pointer-events-none`, da jede Interaktion weiter der Textarea gehört. */
function HighlightOverlay({
  tokenLines,
  start,
  end,
  lineHeight,
  scrollTop,
  scrollLeft,
}: {
  tokenLines: readonly (readonly Token[])[];
  start: number;
  end: number;
  lineHeight: number;
  scrollTop: number;
  scrollLeft: number;
}) {
  const visible = tokenLines.slice(start, end);

  return (
    <pre
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 m-0 overflow-hidden whitespace-pre px-3 py-2 font-(family-name:--pc-terminal-fontFamily)"
      style={{
        fontSize: "var(--pc-terminal-fontSize)",
        lineHeight: "var(--pc-terminal-lineHeight)",
        tabSize: 4,
      }}
    >
      <div style={{ transform: `translate(${-scrollLeft}px, ${start * lineHeight - scrollTop}px)` }}>
        {visible.map((tokens, idx) => (
          <div key={start + idx} style={{ height: lineHeight, lineHeight: `${lineHeight}px` }}>
            {tokens.length === 0
              ? " "
              : tokens.map((token, tokenIdx) => (
                  <span key={tokenIdx} className={TOKEN_CLASS[token.kind]}>
                    {token.text}
                  </span>
                ))}
          </div>
        ))}
      </div>
    </pre>
  );
}

/**
 * Die eigentliche Eingabefläche (Ticket 05, Performance-Audit) —
 * UNCONTROLLED statt vorher `value={state.content}`: der Browser führt den
 * Text selbst, React schreibt ihn nur EINMAL beim Mounten hinein
 * (`defaultValue`). `onEdit` (= `usePaneFileEditors.ts`s `editContent`)
 * bleibt zwar an jedem Tastendruck verdrahtet, tut dort aber ab dem ZWEITEN
 * Tastendruck einer bereits "dirty" Sitzung nichts mehr (Kommentar dort) —
 * vorher ersetzte JEDER Tastendruck den GESAMTEN Pane-übergreifenden
 * Editor-Zustand und riss damit das ganze Grid (jede Pane, jeden Tab-Chip,
 * den Explorer-Baum) in einen Re-Render.
 *
 * Bleibt über die gesamte Lebensdauer EINES offenen Puffers eingehängt
 * (ready → saving → save-error → ready …, auch über eine reine
 * Umbenennung hinweg, die nur `state.path` ändert) — nur ein ECHTER
 * Dateiwechsel hängt sie ab und frisch wieder ein: `FileEditor.tsx` rendert
 * bei einem neuen `open()` erst den "loading"-Zweig (dieser Zweig hier
 * verschwindet ganz), dann bei Erfolg diesen Zweig neu — und GENAU dann darf
 * `defaultValue` auch wirklich neu greifen (sie wirkt sonst nur beim
 * allerersten Mount, DOM-Standardverhalten für unkontrollierte Felder).
 *
 * Der aktuelle Text ist für den Aufrufer nur noch über die weitergereichte
 * Ref erreichbar (`FileEditor.tsx`s `bufferRef`, gelesen bei Speichern/
 * Strg+S) — die DOM-`value` einer Textarea ist dafür ohnehin die einzig
 * verlässliche Quelle, sobald nicht mehr jeder Tastendruck den
 * React-Zustand nachführt.
 *
 * SYNTAX-HIGHLIGHTING + ZEILENNUMMERN (Ticket 39): eine ZWEITE, rein lokale
 * `content`-Kopie kommt hier trotzdem hinzu — anders als `state.content`
 * oben treibt sie NICHTS außerhalb dieser Komponente an (kein `onEdit`-Ersatz,
 * kein Zustand in `usePaneFileEditors.ts`), sie steuert nur das eigene
 * Gutter/Overlay unten. `useState(initialContent)` wertet den Startwert nur
 * beim Mounten aus — exakt dieselbe Lebensdauer-Klammer wie `defaultValue`
 * an der Textarea (s. Absatz oben), ein Re-Sync-Effekt aus `state.content`
 * wäre also nicht nur unnötig, sondern GEFÄHRLICH: `state.content` bleibt ab
 * dem zweiten Tastendruck bewusst veraltet stehen und würde frisch getippten
 * Text überschreiben. Ein `useState` hier kostet nichts Neues an
 * Re-Render-Reichweite (React-Grundsatz: State-Änderung rendert den
 * State-Besitzer und dessen Kinder — das war und bleibt allein diese
 * Komponente), nur DAS war an Ticket 05 teuer, dass `onEdit` den State EINE
 * Ebene höher hielt und damit das GANZE Grid mitriss.
 *
 * Volle Datei-Tokenisierung SYNCHRON bei jedem Tastendruck (kein Debounce):
 * mit transparent gestellter Textarea-Schrift (s. `HighlightOverlay`) ist
 * das Overlay die einzige sichtbar gemalte Kopie des Texts — ein Debounce
 * ließe frisch getippte Zeichen für die Debounce-Dauer unsichtbar werden,
 * genau das Einfrieren, das Ticket 39 ausschließt. Der teure Teil ist ohnehin
 * nicht das Tokenisieren selbst (reines Scannen, keine DOM-Arbeit, s.
 * `syntaxHighlight.ts`), sondern das Rendern — deshalb rendern Gutter und
 * Overlay unten nur den sichtbaren Zeilenausschnitt (`visibleLineRange`),
 * nicht die gesamte `tokenLines`-Liste.
 */
const EditorBuffer = forwardRef<
  HTMLTextAreaElement,
  {
    ariaLabel: string;
    initialContent: string;
    saving: boolean;
    language: LanguageId | null;
    onEdit: (content: string) => void;
  }
>(function EditorBuffer({ ariaLabel, initialContent, saving, language, onEdit }, forwardedRef) {
  const [content, setContent] = useState(initialContent);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewport, setViewport] = useState({ clientHeight: 0, lineHeight: 16 });
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = (node: HTMLTextAreaElement | null) => {
    localRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  // Misst Zeilenhöhe (kann sich mit der Terminal-Zoomstufe ändern,
  // usePtyTerminal.ts' `zoomAction`) und Viewport-Höhe (Pane-Resize per
  // Schnittkanten-Zug) — ein ResizeObserver deckt beides ab, ohne einen
  // eigenen `window.resize`-Listener zu brauchen.
  useEffect(() => {
    const node = localRef.current;
    if (!node) return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(node).lineHeight);
      setViewport({
        clientHeight: node.clientHeight,
        lineHeight: Number.isNaN(lineHeight) ? 16 : lineHeight,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const tokenLines = useMemo(() => tokenizeLines(content, language), [content, language]);
  const totalLines = tokenLines.length;
  const { start, end } = visibleLineRange(scrollTop, viewport.clientHeight, viewport.lineHeight, totalLines);

  const handleScroll = (event: ReactUIEvent<HTMLTextAreaElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
    setScrollLeft(event.currentTarget.scrollLeft);
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <LineGutter
        totalLines={totalLines}
        start={start}
        end={end}
        lineHeight={viewport.lineHeight}
        scrollTop={scrollTop}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <HighlightOverlay
          tokenLines={tokenLines}
          start={start}
          end={end}
          lineHeight={viewport.lineHeight}
          scrollTop={scrollTop}
          scrollLeft={scrollLeft}
        />
        <textarea
          ref={setRefs}
          // Nur während des Schreibens gesperrt, und zwar nicht aus Vorsicht:
          // `edit()` in fileEditorState.ts nimmt aus „saving" heraus keine
          // Änderung an (der Puffer ist in dem Moment gerade unterwegs zur
          // Platte). Ohne dieses readOnly schluckte das Feld die Tastendrücke
          // dieser einen Zwischenzeit stillschweigend.
          readOnly={saving}
          defaultValue={initialContent}
          onChange={(event) => {
            setContent(event.target.value);
            onEdit(event.target.value);
          }}
          onScroll={handleScroll}
          // wrap="off" statt weichem Umbruch: Quelltext hat eigene Zeilen, und
          // ein umgebrochener Block verschiebt jede Zeilennummer, die man im
          // Terminal daneben gerade liest. Umgebrochen wird also nicht,
          // gescrollt wird waagerecht.
          wrap="off"
          // Rote Schlangenlinien unter jedem Bezeichner wären in Quelltext reines
          // Rauschen.
          spellCheck={false}
          aria-label={ariaLabel}
          // Die Schrift des Terminals, nicht die des Chromes: der Text steht
          // exakt dort, wo eine Sekunde vorher Terminalausgabe stand, und in
          // derselben Zeilenbox. Padding ebenfalls das der Terminalfläche
          // (px-3 py-2), damit die erste Spalte beim Umschalten nicht springt.
          // tabSize 4 statt der Browser-Vorgabe 8, die Quelltext auseinanderreißt.
          style={{
            fontFamily: "var(--pc-terminal-fontFamily)",
            fontSize: "var(--pc-terminal-fontSize)",
            lineHeight: "var(--pc-terminal-lineHeight)",
            tabSize: 4,
          }}
          // select-text/cursor-text gegen die App-weiten `user-select: none`
          // und `cursor: default` aus App.css: hier ist Text zum Lesen,
          // Kopieren und Ändern da. Kein eigener Fokusring — das Feld ist
          // fokussierbar und zeigt dann seinen Cursor, wie jede Editorfläche;
          // ein Ring um die halbe Pane wäre der lautere und zugleich
          // unschärfere Hinweis. caret im Terminal-Cursor-Ton: dieselbe „hier
          // schreibst du"-Aussage wie der Amber-Block im Terminal nebenan
          // (theme.css, Akzent-Investition 2026-08-13).
          //
          // `text-transparent` statt `text-(--pc-foreground)` (Ticket 39):
          // die sichtbare Farbe kommt jetzt vom `HighlightOverlay` dahinter,
          // diese Textarea bleibt nur noch für Eingabe/Cursor/Auswahl/
          // Scrollen zuständig. `absolute inset-0` deckungsgleich mit dem
          // Overlay im selben `relative`-Elternelement statt eigener
          // Flex-Breite — beide MÜSSEN exakt dieselbe Größe haben, das ist
          // robuster als zwei getrennte Flex-Rechnungen synchron zu halten.
          className="absolute inset-0 z-10 cursor-text resize-none select-text overflow-auto whitespace-pre bg-transparent px-3 py-2 text-transparent caret-(--pc-terminal-cursor) outline-none"
        />
      </div>
    </div>
  );
});

// Ein fehlgeschlagenes Speichern — als Band über dem Puffer, nicht an seiner
// Stelle (Begründung am Aufrufer). Gleiche Aufteilung wie TreeErrorNotice im
// Explorer: das Rot trägt das Warndreieck, der Text steht im vollen
// Vordergrund, und die Meldung ist der ROHTEXT aus Rust. Der unterscheidet die
// Fälle bereits genauer, als eine eigene Formulierung es könnte („Datei wurde
// außerhalb von PaneCrew geändert" gegen eine Rechte- oder Plattenmeldung).
//
// Genau EINE Aktion, und sie hängt am Fall: Bei einem Stamp-Konflikt ist
// „erneut versuchen" sinnlos — derselbe veraltete Stand träfe auf dieselbe
// veränderte Datei und schlüge identisch fehl. Umgekehrt wäre „trotzdem
// überschreiben" bei einem Rechteproblem eine Behauptung, die die Aktion nicht
// einlösen kann. Zwei Knöpfe nebeneinander hießen also immer, dass einer
// davon in die Irre führt.
function SaveErrorNotice({
  message,
  conflict,
  onSave,
}: {
  message: string;
  conflict: boolean;
  onSave: (options?: { force?: boolean }) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex shrink-0 items-start gap-2 border-b border-(--pc-paneHeader-border) bg-(--pc-widget-background) px-3 py-2"
    >
      {/* mt-0.5 zieht die 16px-Glyphe auf die optische Grundlinie der
          13px-Zeile daneben. */}
      <span className="mt-0.5 flex shrink-0">
        <WarningIcon />
      </span>
      <p className="min-w-0 flex-1 select-text break-words text-(length:--pc-chrome-fontSize) leading-relaxed text-(--pc-foreground)">
        {message}
      </p>
      <button
        type="button"
        // `force` ist genau die Unterscheidung, die der Knopf beschriftet:
        // erzwungen wird nur beim Konflikt (der Hook holt dafür den aktuellen
        // Platten-Stamp frisch), sonst ist es eine schlichte Wiederholung.
        onClick={() => onSave({ force: conflict })}
        className={`flex h-7 shrink-0 items-center rounded-md border border-(--pc-pane-border) px-2.5 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
      >
        {conflict ? t("fileEditor.overwriteAnyway") : t("fileEditor.retry")}
      </button>
    </div>
  );
}

// Bewusst nur eine Zeile Text und kein Skelett/Spinner: gelesen wird von der
// lokalen Platte, der Zustand ist im Normalfall nach einem Frame vorbei. Eine
// animierte Attrappe würde in dieser Zeit mehr flackern als sie erklärt.
function LoadingNotice() {
  const { t } = useTranslation();
  return (
    <p className="flex min-h-0 flex-1 items-center justify-center p-8 text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)">
      {t("common.loading")}
    </p>
  );
}

// Aufbau des Leerzustands aus ProjectPicker.tsx (zentrierte Spalte, 16px-
// Überschrift, gedämpfter Erklärsatz, ein einziger gerahmter Knopf) — plus dem
// roten Warndreieck, das TreeErrorNotice im Explorer schon führt. Das Dreieck
// ist hier der ganze Unterschied und nicht Dekoration: ohne es läse ein
// abgelehnter Lesevorgang wie ein neutraler Leerzustand.
//
// Die Überschrift benennt die Kategorie, der Satz darunter ist der ROHTEXT aus
// Rust — er unterscheidet die Fälle bereits genau („zu groß für den Editor"
// mit Byte-Zahl, „kein UTF-8-Text", „Ordner können nicht im Editor geöffnet
// werden") und wird deshalb nicht umformuliert. Der Dateiname steht nicht
// nochmal darin: den trägt die Kopfzeile dieser Fläche zwei Zeilen darüber.
function LoadErrorNotice({
  path,
  message,
}: {
  path: string;
  message: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      // Zentriert über `m-auto` am Kind, NICHT über `justify-center` am
      // Scroll-Container: sobald der Inhalt in einer flach gezogenen Pane
      // höher wird als die Box, schneidet zentriertes justify-content oben ab
      // und der abgeschnittene Teil ist nicht mehr erreichbar. Auto-Margins
      // fallen in dem Fall einfach auf 0 zurück.
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-8"
    >
      <div className="m-auto flex flex-col items-center gap-5 text-center">
        <div className="flex flex-col items-center gap-1.5">
          <WarningIcon />
          <h2 className="text-(length:--pc-chrome-fontSizeLarge) font-semibold text-(--pc-foreground)">
            {t("fileEditor.openFailed")}
          </h2>
          <p className="max-w-96 select-text text-(length:--pc-chrome-fontSize) leading-relaxed text-(--pc-descriptionForeground)">
            {message}
          </p>
        </div>
        {/* Der Ausweg, nicht bloß die Diagnose: was PaneCrew nicht anzeigen
            kann (Bild, Binärdatei, zu großes Log), öffnet das System in dem
            Programm, das es dafür ohnehin führt.

            `openPath` braucht eine EIGENE Berechtigung: das Set
            `opener:default` enthält nur `allow-open-url`,
            `allow-reveal-item-in-dir` und `allow-default-urls` — für
            `open_path` prüft das Plugin zusätzlich einen Pfad-Scope, der ohne
            Eintrag leer ist und damit jeden Pfad ablehnt. Der passende Eintrag
            steht deshalb in `src-tauri/capabilities/default.json`. */}
        <button
          type="button"
          onClick={() => {
            void openPath(path).catch((error: unknown) => {
              console.error(
                "PaneCrew: Datei konnte nicht extern geöffnet werden",
                error,
              );
            });
          }}
          className={`flex h-8 shrink-0 items-center gap-2 rounded-md border border-(--pc-pane-border) bg-(--pc-explorer-background) px-3.5 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
        >
          <ExternalIcon />
          {t("fileEditor.openExternally")}
        </button>
      </div>
    </div>
  );
}

// Image/video render mode (Ticket 38) — a mode of the existing file tab, not
// a separate tab kind (CONTEXT.md's browser-tab _Avoid_ note), so this only
// replaces the content area below the header; open/close/tab chip stay
// exactly as they are for a text file. The base64 payload comes straight
// from usePaneFileEditors.ts's explorer_read_media call and is rendered as a
// data: URL — no asset: protocol scope exists in
// src-tauri/capabilities/default.json (unlike `openPath` above, which needed
// one), and a data: URL needs none, so this stays self-contained.
function MediaPreview({
  kind,
  mime,
  base64,
  name,
}: {
  kind: "image" | "video";
  mime: string;
  base64: string;
  name: string;
}) {
  const src = `data:${mime};base64,${base64}`;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
      {kind === "image" ? (
        <img src={src} alt={name} className="max-h-full max-w-full object-contain" />
      ) : (
        <video src={src} controls className="max-h-full max-w-full" />
      )}
    </div>
  );
}

// Wie in TerminalPane.tsx und About.tsx: das Schließkreuz steht in jeder Datei
// für sich. Eine gemeinsame Icon-Datei gibt es im Chrome bewusst nicht — die
// Glyphen sind je an ihre Größe und Strichstärke angepasst, hier an die 11px-
// Kopfzeile der Pane.
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

// Dasselbe Warndreieck wie im Explorer (ExplorerPanel.tsx → TreeErrorNotice),
// gleiche Maße und gleiche Strichstärke. --pc-icon-red ist ein reiner
// Chrome-Icon-Ton und kollidiert deshalb nicht mit der ANSI-Palette echter
// Terminalausgabe; als Grafikobjekt liegt er über den geforderten 3:1, als
// Fließtext täte er es nicht — deshalb trägt hier das Icon das Rot und die
// Überschrift daneben den vollen Vordergrund.
function WarningIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="shrink-0 text-(--pc-icon-red)"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.13 2.4a1 1 0 0 1 1.74 0l5.26 9.6a1 1 0 0 1-.87 1.5H2.74a1 1 0 0 1-.87-1.5l5.26-9.6Z" />
      <path d="M8 6.1v3.4" />
      <path d="M8 11.4h.01" />
    </svg>
  );
}

// Pfeil aus einem angeschnittenen Rahmen heraus — die verbreitete Lesart für
// „verlässt diese Anwendung". Strichsprache der übrigen Bediensymbole des
// Chromes (16er-Box, 1.26, currentColor, runde Enden). Der Rahmen ist oben
// rechts geöffnet, statt den Pfeil zu kreuzen: zwei Konturen an derselben
// Stelle verschmieren bei 14px zu einem Fleck.
function ExternalIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.26"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-(--pc-descriptionForeground)"
    >
      <path d="M9.25 2.75h4v4" />
      <path d="M13.25 2.75 7.5 8.5" />
      <path d="M12.5 9.75v3a.5.5 0 0 1-.5.5H3.25a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5h3" />
    </svg>
  );
}
