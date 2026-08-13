import { useTranslation } from "react-i18next";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";
import { isMacPlatform } from "../shortcuts/platform";
import { formatChord, SHORTCUTS, terminalTabSelectId } from "../shortcuts/registry";

// Tab-Leiste einer Pane (Ticket 18): N Terminal-Tabs (je eine eigene PTY,
// durchnummeriert und über einen kleinen Farbpunkt unterscheidbar) plus
// höchstens ein File-Tab, immer hinter allen Terminal-Tabs. Ersetzt den
// früheren reinen Zwei-Wege-Umschalter zwischen "Terminal" und "Datei"
// (2026-08-12) — der Unterschied ist jetzt N statt 1 Terminal-Tab, das
// File-Tab-Verhalten (nur sichtbar, wenn eine Datei offen ist, kein X in
// dieser Leiste — das Schließen bleibt FileEditor.tsx' eigenem Knopf
// vorbehalten) ist unverändert.
//
// Wird jetzt UNBEDINGT gerendert (vorher nur, solange eine Datei offen war):
// die "+"-Schaltfläche zum Öffnen eines weiteren Terminal-Tabs muss auch ohne
// offene Datei erreichbar sein.
//
// Idiom wie TemplateSwitcher.tsx: `role="group"` + `aria-pressed` statt
// `role="tablist"`/`"tab"`, dieselbe neutrale Auswahlfüllung
// (--pc-list-activeSelectionBackground), NIE der Fokus-Akzent — der gehört
// laut Direction Contract ausschließlich dem Pane-Fokus, ein zweiter Ort in
// derselben Farbe würde "welche Pane ist fokussiert" zur Suchaufgabe machen.
//
// Farbpunkt-Palette: die drei ohnehin schon vorhandenen, nicht-semantischen
// Datei-Icon-Töne (--pc-icon-blue/purple/gray, Seti-Schema) statt neu
// hergeleiteter Werte — bewusst OHNE Rot/Gelb/Grün, die im Terminalinhalt
// direkt darunter als ANSI-Fehler/Warnung/Erfolg gelesen werden, und ohne den
// Fokus-Akzent, der laut Direction Contract dem Pane-Rahmen vorbehalten
// bleibt. Die Nummer trägt die Information primär (s. DirtyMark unten), der
// Punkt ist nur Verstärkung — bei mehr als drei Tabs wiederholt sich die
// Palette, das ist bewusst kein Problem.
//
// Nachtrag 2026-08-13 (Nutzerbeschwerde, reine Maus-Bedienung nicht möglich):
// der Chip war ursprünglich ein 20×20-Icon-Knopf, dessen Zahl beim Hovern
// komplett durch ein `absolute inset-0`-Schließkreuz ersetzt wurde — jedes
// Überfahren machte den GANZEN Chip zum Schließen-Knopf, ein Wechsel per Maus
// war so nicht möglich. `TerminalTabChip` unten reserviert dem Kreuz
// stattdessen einen eigenen, schmalen Bereich am Chip-Rand (immer da, nur bei
// Hover/Fokus sichtbar); Zahl und Punkt bleiben unbedingt sichtbar und
// bedienen den Tab-Wechsel im übrigen, größeren Bereich des Chips.
// Zusätzlich trägt der Tooltip jetzt den Akkord aus der Kürzel-Registry
// (Cmd/Strg+1..9, `usePtyTerminal.ts`s Pane-Kürzel-Zweig) — der Weg von der
// Maus zur Tastatur muss sich aus der UI selbst erschließen, nicht aus
// docs/shortcuts.md.
const TAB_ACCENT_DOT_CLASSES = [
  "bg-(--pc-icon-blue)",
  "bg-(--pc-icon-purple)",
  "bg-(--pc-icon-gray)",
] as const;

interface TerminalTabInfo {
  tabId: string;
  /** 1-basiert, aus der Position in `Pane.terminalTabs` (gridState.ts trägt
   * keine Nummerierung selbst — reine Anzeigeableitung des Aufrufers). */
  number: number;
}

/** Props dieser Komponente, als eigener Typ — TerminalPane.tsx und
 * FileEditor.tsx binden beide denselben Tab-Zustand derselben Pane ein
 * (Kopfkommentar) und reichen deshalb dasselbe Objekt einfach durch, statt
 * jedes Feld einzeln zu wiederholen. */
export interface PaneTabsProps {
  terminalTabs: readonly TerminalTabInfo[];
  activeTerminalTabId: string;
  showingFile: boolean;
  /** `null`, solange in dieser Pane keine Datei offen ist — dann gibt es
   * keinen File-Tab in der Leiste. */
  fileName: string | null;
  fileDirty: boolean;
  onSelectTerminalTab: (tabId: string) => void;
  onOpenTerminalTab: () => void;
  onCloseTerminalTab: (tabId: string) => void;
  onSelectFile: () => void;
}

export function PaneTabs({
  terminalTabs,
  activeTerminalTabId,
  showingFile,
  fileName,
  fileDirty,
  onSelectTerminalTab,
  onOpenTerminalTab,
  onCloseTerminalTab,
  onSelectFile,
}: PaneTabsProps) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("paneTabs.selectView")}
      // `shrink-0` statt `shrink` (2026-08-13): diese Gruppe soll nie unter
      // Platzdruck geraten, das übernimmt der Spacer im Pane-Header
      // (TerminalPane.tsx/FileEditor.tsx) — sonst kann derselbe Sprung, den
      // der Spacer zwischen Terminal- und Datei-Ansicht behebt, innerhalb
      // EINER Ansicht wiederkehren, sobald ein Tab hinzukommt.
      className="flex min-w-0 shrink-0 items-center gap-px rounded-(--pc-paneControl-radius) border border-(--pc-pane-border) p-px"
    >
      {terminalTabs.map((tab) => (
        <TerminalTabChip
          key={tab.tabId}
          number={tab.number}
          // Modulo hält den Index immer in Bereich — der Fallback greift nie,
          // hält TS aber ohne `as` zufrieden (noUncheckedIndexedAccess).
          dotClassName={
            TAB_ACCENT_DOT_CLASSES[(tab.number - 1) % TAB_ACCENT_DOT_CLASSES.length] ??
            TAB_ACCENT_DOT_CLASSES[0]
          }
          active={!showingFile && tab.tabId === activeTerminalTabId}
          // Der letzte verbleibende Terminal-Tab lässt sich nicht schließen
          // (gridState.ts' closeTerminalTab ist an dieser Stelle ohnehin ein
          // No-Op) — die Schaltfläche verschwindet dafür ganz, statt
          // wirkungslos anklickbar zu bleiben.
          closable={terminalTabs.length > 1}
          onSelect={() => onSelectTerminalTab(tab.tabId)}
          onClose={() => onCloseTerminalTab(tab.tabId)}
        />
      ))}
      <ChromeTooltip label={t("paneTabs.openTerminalTab")}>
        <button
          type="button"
          aria-label={t("paneTabs.openTerminalTab")}
          onClick={onOpenTerminalTab}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-(--pc-paneControl-radius) text-(--pc-paneHeader-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
        >
          <PlusIcon />
        </button>
      </ChromeTooltip>
      {fileName !== null && (
        <PaneTab
          label={fileName}
          dirty={fileDirty}
          active={showingFile}
          onClick={onSelectFile}
        />
      )}
    </div>
  );
}

// Ein einzelner Terminal-Tab: Farbpunkt + Nummer, IMMER sichtbar (2026-08-13,
// s. Kopfkommentar) — das Schließkreuz bekommt einen eigenen, festen
// Randbereich (`pr-4` am Auswahlknopf, UNBEDINGT, auch wenn `closable` false
// ist — sonst würde der letzte verbleibende Tab schmaler als alle anderen,
// derselbe Breitensprung, den dieser ganze Umbau beheben sollte, nur jetzt
// ausgelöst durch Schließen statt durch Hover). Das Kreuz
// selbst liegt `absolute` darüber und gewinnt dort dank positionierten
// Stapelkontexts jeden Klick, ohne dem Auswahlknopf seine übrige Fläche
// streitig zu machen. Ein `<span>` als gemeinsamer ChromeTooltip-Trigger um
// beide Knöpfe: der Tooltip nennt den Tab samt Tastaturakkord, das
// Schließkreuz trägt sein eigenes `aria-label` für Screenreader unabhängig
// davon.
function TerminalTabChip({
  number,
  dotClassName,
  active,
  closable,
  onSelect,
  onClose,
}: {
  number: number;
  dotClassName: string;
  active: boolean;
  closable: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const label = t("paneTabs.terminalTab", { number });
  // Nur die Zahlen 1-9 haben ein Kürzel (registry.ts) — ein zehnter Tab wäre
  // ohnehin am Rand dessen, was in eine Pane-Kopfzeile passt, und bekommt
  // schlicht keinen Akkord im Tooltip.
  const shortcut = SHORTCUTS.find((def) => def.id === terminalTabSelectId(number));
  const tooltipLabel = shortcut
    ? `${label} (${formatChord(shortcut, isMacPlatform() ? "mac" : "other")})`
    : label;
  return (
    <ChromeTooltip label={tooltipLabel}>
      <span className="group/tab relative flex h-5 shrink-0 items-stretch">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={active}
          aria-label={label}
          className={`flex h-full items-center gap-1 rounded-(--pc-paneControl-radius) pl-1.5 pr-4 text-(length:--pc-chrome-fontSizeSmall) font-medium transition-colors ${
            active
              ? "bg-(--pc-list-activeSelectionBackground) text-(--pc-foreground)"
              : "text-(--pc-paneHeader-foreground) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground)"
          } ${CHROME_FOCUS_RING}`}
        >
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dotClassName}`} />
          {/* Terminalschrift + tabular-nums statt der Chrome-Schrift: die
              Nummer ist HUD-Readout wie die Slot-Nummern der leeren Slots
              (ProjectPicker.tsx) und bleibt bei jedem Wert gleich breit. */}
          <span className="font-(family-name:--pc-terminal-fontFamily) tabular-nums">
            {number}
          </span>
        </button>
        {closable && (
          <button
            type="button"
            onClick={(event) => {
              // Ohne dieses Stoppen bubblet der Klick zum span-Trigger hoch
              // und lässt Radix den Tooltip erneut öffnen/schließen —
              // sichtbar als Flackern beim Schließen.
              event.stopPropagation();
              onClose();
            }}
            aria-label={t("paneTabs.closeTerminalTab", { number })}
            className={`absolute inset-y-0 right-0.5 my-auto flex size-3.5 items-center justify-center rounded-(--pc-paneControl-radius) text-(--pc-paneHeader-foreground) opacity-0 transition-[opacity,color,background-color] hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) group-hover/tab:opacity-100 focus-visible:opacity-100 ${CHROME_FOCUS_RING}`}
          >
            <CloseIcon />
          </button>
        )}
      </span>
    </ChromeTooltip>
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
  const { t } = useTranslation();
  return (
    <span className="flex shrink-0 items-center">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      <span className="sr-only">{t("common.unsavedSuffix")}</span>
    </span>
  );
}

function PlusIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 2v8M2 6h8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="10"
      height="10"
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
