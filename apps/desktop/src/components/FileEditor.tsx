import { openPath } from "@tauri-apps/plugin-opener";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";
import type { FileEditorState } from "../explorer/fileEditorState";

// Die Editorfläche des Mini-Editors (.scratch/explorer-file-io/, Ticket 03).
// In diesem Schritt ausschließlich LESEND — Editieren, Speichern, Dirty-
// Zustand und Konflikterkennung sind Ticket 04 und stehen hier bewusst noch
// nicht vor.
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
export function FileEditor({
  state,
  onClose,
}: {
  state: FileEditorState;
  onClose: () => void;
}) {
  // Ohne offene Datei gibt es keine Fläche: App.tsx rendert diese Komponente
  // bedingungslos und stellt die Bedingung damit genau einmal — hier.
  if (state.status === "idle") return null;

  const name = fileNameFromPath(state.path);

  return (
    <section
      aria-label={`Datei ${name}`}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-(--pc-pane-activeBorder) bg-(--pc-pane-background)"
    >
      <header className="flex h-6 shrink-0 items-center gap-2 border-b border-(--pc-paneHeader-border) pl-3 pr-1 text-(length:--pc-chrome-fontSizeSmall) font-medium tracking-wide text-(--pc-paneHeader-activeForeground)">
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <ChromeTooltip label="Datei schließen" align="end">
          <button
            type="button"
            aria-label="Datei schließen"
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
        <textarea
          readOnly
          // wrap="off" statt weichem Umbruch: Quelltext hat eigene Zeilen, und
          // ein umgebrochener Block verschiebt jede Zeilennummer, die man im
          // Terminal daneben gerade liest. Umgebrochen wird also nicht,
          // gescrollt wird waagerecht.
          wrap="off"
          // Rote Schlangenlinien unter jedem Bezeichner wären in Quelltext
          // reines Rauschen.
          spellCheck={false}
          aria-label={`Inhalt von ${name}`}
          value={state.content}
          // Die Schrift des Terminals, nicht die des Chromes: der Text steht
          // exakt dort, wo eine Sekunde vorher Terminalausgabe stand, und in
          // derselben Zeilenbox. Padding ebenfalls das der Terminalfläche
          // (px-3 py-2), damit die erste Spalte beim Umschalten nicht springt.
          // tabSize 4 statt der Browser-Vorgabe 8, die Quelltext auseinander-
          // reißt.
          style={{
            fontFamily: "var(--pc-terminal-fontFamily)",
            fontSize: "var(--pc-terminal-fontSize)",
            lineHeight: "var(--pc-terminal-lineHeight)",
            tabSize: 4,
          }}
          // select-text/cursor-text gegen die App-weiten `user-select: none`
          // und `cursor: default` aus App.css: hier ist Text zum Lesen und
          // Kopieren da. Kein eigener Fokusring — das Feld ist fokussierbar
          // und zeigt dann seinen Cursor, wie jede Editorfläche; ein Ring um
          // die halbe Pane wäre der lautere und zugleich unschärfere Hinweis.
          className="min-h-0 flex-1 cursor-text resize-none select-text overflow-auto whitespace-pre bg-transparent px-3 py-2 text-(--pc-foreground) outline-none"
        />
      )}
    </section>
  );
}

// Bewusst nur eine Zeile Text und kein Skelett/Spinner: gelesen wird von der
// lokalen Platte, der Zustand ist im Normalfall nach einem Frame vorbei. Eine
// animierte Attrappe würde in dieser Zeit mehr flackern als sie erklärt.
function LoadingNotice() {
  return (
    <p className="flex min-h-0 flex-1 items-center justify-center p-8 text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)">
      Wird geladen …
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
            Datei konnte nicht geöffnet werden
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
          In externem Editor öffnen
        </button>
      </div>
    </div>
  );
}

/** Letztes Segment eines Dateipfads (POSIX wie Windows). Dieselbe Regel wie
 * `projectNameFromPath` in `types/project.ts`, bewusst nicht von dort
 * importiert: dessen Name macht eine Aussage über ein Projekt, und was hier
 * benannt wird, ist eine Datei. */
function fileNameFromPath(path: string): string {
  const segments = path.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? path;
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
