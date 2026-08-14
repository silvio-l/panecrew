import { forwardRef, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";
import { FocusModeButton } from "./FocusModeButton";
import { PaneTabs, type PaneTabsProps } from "./PaneTabs";
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
  // schreiben", nicht „nichts vorhanden".
  const hasBuffer =
    state.status !== "loading" && state.status !== "load-error";

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
      className={`group/pane relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-(--pc-pane-background) transition-colors ${
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
          className="pointer-events-none absolute inset-0 z-20 animate-[pc-attention-flash_1400ms_ease-out]"
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
            onEdit={onEdit}
          />
        </>
      )}
    </section>
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
 */
const EditorBuffer = forwardRef<
  HTMLTextAreaElement,
  {
    ariaLabel: string;
    initialContent: string;
    saving: boolean;
    onEdit: (content: string) => void;
  }
>(function EditorBuffer({ ariaLabel, initialContent, saving, onEdit }, ref) {
  return (
    <textarea
      ref={ref}
      // Nur während des Schreibens gesperrt, und zwar nicht aus Vorsicht:
      // `edit()` in fileEditorState.ts nimmt aus „saving" heraus keine
      // Änderung an (der Puffer ist in dem Moment gerade unterwegs zur
      // Platte). Ohne dieses readOnly schluckte das Feld die Tastendrücke
      // dieser einen Zwischenzeit stillschweigend.
      readOnly={saving}
      defaultValue={initialContent}
      onChange={(event) => onEdit(event.target.value)}
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
      // select-text/cursor-text gegen die App-weiten `user-select: none` und
      // `cursor: default` aus App.css: hier ist Text zum Lesen, Kopieren und
      // Ändern da. Kein eigener Fokusring — das Feld ist fokussierbar und
      // zeigt dann seinen Cursor, wie jede Editorfläche; ein Ring um die
      // halbe Pane wäre der lautere und zugleich unschärfere Hinweis. caret
      // im Terminal-Cursor-Ton: dieselbe „hier schreibst du"-Aussage wie der
      // Amber-Block im Terminal nebenan (theme.css, Akzent-Investition
      // 2026-08-13).
      className="min-h-0 flex-1 cursor-text resize-none select-text overflow-auto whitespace-pre bg-transparent px-3 py-2 text-(--pc-foreground) caret-(--pc-terminal-cursor) outline-none"
    />
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
