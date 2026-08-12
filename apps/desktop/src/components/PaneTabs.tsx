import { CHROME_FOCUS_RING } from "./ChromeTooltip";

// Zwei-Tab-Umschalter zwischen der Terminal- und der Datei-Ansicht EINER
// Pane (Nutzerwunsch 2026-08-12): mit offener Datei zeigten Terminal und
// Datei bis dahin dieselbe Fläche ohne Weg zurück außer dem endgültigen
// Schließen der Datei — ein Blick ins Terminal daneben ging nur über
// "Datei schließen" und erneutes Öffnen. Existiert deshalb nur, solange in
// dieser Pane wirklich eine Datei offen ist (`tabs`-Prop der Aufrufer ist
// dann `null`); ohne offene Datei bleibt der Header wie zuvor eine reine
// Namenszeile.
//
// Idiom wie TemplateSwitcher.tsx: `role="group"` + `aria-pressed` statt
// `role="tablist"`/`"tab"`, dieselbe neutrale Auswahlfüllung
// (--pc-list-activeSelectionBackground), NIE der Fokus-Akzent — der gehört
// laut Direction Contract ausschließlich dem Pane-Fokus, ein zweiter Ort in
// derselben Farbe würde "welche Pane ist fokussiert" zur Suchaufgabe machen.
export function PaneTabs({
  active,
  fileName,
  fileDirty,
  onSelectTerminal,
  onSelectFile,
}: {
  active: "terminal" | "file";
  fileName: string;
  fileDirty: boolean;
  onSelectTerminal: () => void;
  onSelectFile: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Ansicht wählen"
      className="flex min-w-0 shrink items-center gap-px rounded-(--pc-paneControl-radius) border border-(--pc-pane-border) p-px"
    >
      <PaneTab label="Terminal" active={active === "terminal"} onClick={onSelectTerminal} />
      <PaneTab
        label={fileName}
        dirty={fileDirty}
        active={active === "file"}
        onClick={onSelectFile}
      />
    </div>
  );
}

function PaneTab({
  label,
  dirty,
  active,
  onClick,
}: {
  label: string;
  dirty?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-5 max-w-32 min-w-0 shrink items-center gap-1 rounded-(--pc-paneControl-radius) px-1.5 text-(length:--pc-chrome-fontSizeSmall) font-medium transition-colors ${
        active
          ? "bg-(--pc-list-activeSelectionBackground) text-(--pc-foreground)"
          : "text-(--pc-paneHeader-foreground) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground)"
      } ${CHROME_FOCUS_RING}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {dirty && <DirtyMark />}
    </button>
  );
}

// Aus FileEditor.tsx hierher verschoben (2026-08-12): der Ungespeichert-Punkt
// sitzt jetzt im Datei-Tab statt in einer eigenen Namenszeile — beide Header
// (TerminalPane.tsx und FileEditor.tsx) binden denselben Tab ein, es gibt also
// nur noch eine Stelle, die ihn zeichnet.
//
// Im Ton der Zeile, in der er steht (`bg-current`), nicht in einer eigenen
// Farbe — dieselbe Lesart wie in jedem Editor mit Tabs, und die einzige, die
// hier funktioniert: die Git-Deko im Explorer hat ihre beiden Töne bereits mit
// Bedeutung belegt (geändert/nicht versioniert), ein dritter Farbfleck daneben
// würde als dritter Git-Zustand gelesen. Ungespeichert ist aber keine Aussage
// über das Repository, sondern darüber, wo der Text gerade liegt: nur im
// Speicher.
//
// Der sichtbare Punkt ist `aria-hidden`, das Wort steht daneben in `sr-only`
// — Farbe und Form allein dürfen die Information nicht tragen.
function DirtyMark() {
  return (
    <span className="flex shrink-0 items-center">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      <span className="sr-only">, ungespeichert</span>
    </span>
  );
}
