import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu } from "radix-ui";
import {
  CHROME_FOCUS_RING,
  CHROME_MENU_CONTENT_CLASS,
  CHROME_MENU_ITEM_CLASS,
  ChromeTooltip,
} from "./ChromeTooltip";
import { isMacPlatform } from "../shortcuts/platform";
import { formatChord, SHORTCUTS, terminalTabSelectId } from "../shortcuts/registry";

// Tab-Leiste einer Pane (Ticket 18): N Terminal-Tabs (je eine eigene PTY,
// durchnummeriert) plus höchstens ein File-Tab, immer hinter allen
// Terminal-Tabs. Ersetzt den früheren reinen Zwei-Wege-Umschalter zwischen
// "Terminal" und "Datei" (2026-08-12) — der Unterschied ist jetzt N statt 1
// Terminal-Tab, das File-Tab-Verhalten (nur sichtbar, wenn eine Datei offen
// ist, kein X in dieser Leiste — das Schließen bleibt FileEditor.tsx' eigenem
// Knopf vorbehalten) ist unverändert.
//
// Wird jetzt UNBEDINGT gerendert (vorher nur, solange eine Datei offen war):
// die "+"-Schaltfläche zum Öffnen eines weiteren Terminal-Tabs muss auch ohne
// offene Datei erreichbar sein.
//
// Idiom wie TemplateSwitcher.tsx: `role="group"` + `aria-pressed` statt
// `role="tablist"`/`"tab"`.
//
// Nachtrag 2026-08-13 (Nutzerbeschwerde, reine Maus-Bedienung nicht möglich):
// der Chip war ursprünglich ein 20×20-Icon-Knopf, dessen Zahl beim Hovern
// komplett durch ein `absolute inset-0`-Schließkreuz ersetzt wurde — jedes
// Überfahren machte den GANZEN Chip zum Schließen-Knopf, ein Wechsel per Maus
// war so nicht möglich. Ein späterer Zwischenstand reservierte dem Kreuz
// stattdessen einen eigenen, schmalen Bereich am Chip-Rand — dieser Weg ist
// inzwischen selbst wieder abgelöst (s. u., Nachtrag "Schließen per
// Kontextmenü"), aus demselben Grund: die Trefferfläche eines 24px hohen
// Chips bleibt für ein zusätzliches Schließkreuz grundsätzlich knapp.
// Zusätzlich trägt der Tooltip jetzt den Akkord aus der Kürzel-Registry
// (Cmd/Strg+1..9, `usePtyTerminal.ts`s Pane-Kürzel-Zweig) — der Weg von der
// Maus zur Tastatur muss sich aus der UI selbst erschließen, nicht aus
// docs/shortcuts.md.
//
// Nachtrag 2026-08-13, später (Impeccable-Critique, zwei gemeldete Mängel:
// Klickfläche weiterhin zu klein, Aktiv/Inaktiv kaum unterscheidbar):
// - Chip-Höhe `h-5`→`h-6` (die volle, im Pane-Header ohnehin schon reservierte
//   24px-Zeile statt nur 20px davon — kein zusätzlicher Platzbedarf) für
//   TerminalTabChip, den Datei-Tab UND den „+"-Knopf einheitlich; Letzterer
//   läuft jetzt über `--pc-paneControl-size` statt einer eigenen Fixgröße, wie
//   der gleichrangige Schließen-Knopf im Header (Token-Konsistenz).
//
// Nachtrag 2026-08-13, noch später (Nutzer-Feedback nach dem WebKit-Fix am
// Knopf-Reset, s. App.css): der Farbpunkt vor der Nummer ist ersatzlos
// gestrichen. Er sollte ursprünglich Terminal-Busy/Idle andeuten — dafür gibt
// es aber keine verlässliche Quelle (die Projekt-Leitlinien schließen
// heuristisches Output-Parsing für v0.1 explizit aus, und Prozesslast wäre ohnehin kein
// brauchbarer Ersatz: ein wartender CLI-Agent hängt meist in Netzwerk-I/O,
// die CPU liegt nahe null genau dann, wenn „beschäftigt" das eigentlich
// interessante Signal wäre — false-idle exakt im relevanten Moment). Ohne
// belastbare Bedeutung war der Punkt nur dekorativ und blieb trotzdem als
// State-Signal lesbar, was er nicht war. Der Kontrast zwischen aktivem und
// inaktivem Tab, den der Punkt nie getragen hat, kommt jetzt stattdessen vom
// Fokus-Akzent selbst (s. Kommentar an TerminalTabChip) — der Wegfall schafft
// zusätzlich ~6px + Gap Breite pro Chip.
//
// Direction-Contract-Korrektur (2026-08-13, User-Entscheidung): der eine
// Akzent (`--pc-focusBorder`) war bislang exklusiv dem Pane-Fokus vorbehalten
// ("ein zweiter Ort in derselben Farbe würde 'welche Pane ist fokussiert' zur
// Suchaufgabe machen"). Der Nutzer hat diese Regel bewusst gelockert: der
// Akzent darf jetzt zusätzlich sparsam auf dem aktiven Tab erscheinen (s.
// `.impeccable/direction-contract-desktop.md` → „Akzent auf Tabs erlaubt"),
// solange Pane-Fokus und aktiver Tab in FORM unterscheidbar bleiben, nicht
// nur im Farbton — TerminalPane.tsx' Fokus-Signal ist die volle
// Header-Hairline bei 45% Deckkraft, hier ist es eine deckende 1px-Box mit
// verdoppelter Unterkante an einem einzelnen Chip.
//
// Nachtrag 2026-08-13, noch später (Nutzer-Entscheidung nach Abnahme der
// Aktiv/Inaktiv-Kontrastfassung — "die Hervorhebung des aktiven Tabs finde
// ich so jetzt gut gelungen"): DREI weitere, gleichzeitig verlangte
// Änderungen an `TerminalTabChip`:
//
// 1. Das ❯ vor der Nummer ist ERSATZLOS entfernt, aus beiden Tab-Arten
//    (auch `PaneTab`, für dasselbe geteilte Idiom, s. Kommentar dort). Der
//    Nutzer nannte es redundant zum ❯, das an derselben Stelle bereits
//    fensterweit ganz vorn im Pane-Header steht (TerminalPane.tsx/
//    FileEditor.tsx) — EIN „hier bist du" pro Blick genügt, ein zweites
//    direkt daneben ist Rauschen.
// 2. Das Schließkreuz ist ERSATZLOS entfernt. Schließen läuft jetzt
//    ausschließlich über das Kontextmenü (Rechtsklick, s. u.) plus
//    Mittelklick als Browser-Tab-übliche Abkürzung (`onAuxClick`) — beides
//    setzt eine bewusste, gezielte Handlung voraus, ein winziges Kreuz direkt
//    neben der Nummer keine mehr. `onCloseTerminalTab` (App.tsx) bleibt dabei
//    unverändert der bereits bestehende, rückfragegesicherte Pfad
//    (`closeTerminalTabGuarded`, `ConfirmDialog.tsx`) — dieser Umbau ändert
//    nur den WEG dorthin, nicht die Sicherung selbst.
// 3. Ein Kontextmenü (Radix `ContextMenu`, dasselbe Textmenü-Idiom wie
//    ExplorerPanel.tsx/TerminalPane.tsx, `CHROME_MENU_*`-Klassen) bietet
//    "Schließen" und "Umbenennen". Zugleich gilt ab hier app-weit: das
//    native Kontextmenü des Webviews ist grundsätzlich AUS (s.
//    `chrome/nativeContextMenuPolicy.ts`, in jedem Fenster-Entry-Point
//    installiert) — ein Kontextmenü existiert nur noch an den Stellen, an
//    denen die App selbst eins eingerichtet hat, dieser Chip ist eine davon.
//
// Umbenennen (`renameTerminalTab`, `gridState.ts`) zeigt den eigenen Namen
// als ANHANG im bestehenden Tooltip (`am besten als Tooltip"`, Nutzer-Zitat,
// selbst als bevorzugte von zwei genannten Optionen) — bewusst NICHT als
// Chip, der beim Hover breiter wird: der Chip sitzt in einer `shrink-0`-
// Gruppe (Kopfkommentar weiter oben, "soll nie unter Platzdruck geraten"),
// ein einzelner wachsender Chip darin verschöbe seine Nachbarn im laufenden
// Betrieb — genau der Sprung, den `shrink-0` an dieser Stelle verhindern
// soll. Die Eingabe selbst (`TerminalTabRenameField` unten) ist ein
// `absolute` positioniertes Feld unterhalb des Chips (Widget-Material wie
// `ConfirmDialog.tsx`), nimmt also am Flex-Layout gar nicht erst teil.

interface TerminalTabInfo {
  tabId: string;
  /** 1-basiert, aus der Position in `Pane.terminalTabs` (gridState.ts trägt
   * keine Nummerierung selbst — reine Anzeigeableitung des Aufrufers). */
  number: number;
  /** Nutzer-Umbenennung (`renameTerminalTab`) — `null` heißt "kein eigener
   * Name", der Chip zeigt dann nur seine Nummer. */
  label: string | null;
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
  /** Kontextmenü-Aktion "Umbenennen" — `label: null` löscht den Namen wieder
   * (leeres/unverändertes Eingabefeld committen, s. `TerminalTabRenameField`). */
  onRenameTerminalTab: (tabId: string, label: string | null) => void;
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
  onRenameTerminalTab,
  onSelectFile,
}: PaneTabsProps) {
  const { t } = useTranslation();
  // Höchstens EIN Umbenennen-Feld gleichzeitig offen, über die ganze Leiste
  // hinweg — dieselbe Alleinstellung wie ExplorerPanel.tsx' `isRenaming`
  // (dort pfadgeschlüsselt, hier tabId-geschlüsselt). Lebt bewusst hier statt
  // in `App.tsx`/`gridState.ts`: rein transiente UI-Absicht, kein
  // persistierter Zustand.
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
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
          label={tab.label}
          active={!showingFile && tab.tabId === activeTerminalTabId}
          // Der letzte verbleibende Terminal-Tab lässt sich nicht schließen
          // (gridState.ts' closeTerminalTab ist an dieser Stelle ohnehin ein
          // No-Op) — der Menüpunkt entfällt dafür ganz, statt wirkungslos
          // anklickbar zu bleiben.
          closable={terminalTabs.length > 1}
          renaming={tab.tabId === renamingTabId}
          onSelect={() => onSelectTerminalTab(tab.tabId)}
          onClose={() => onCloseTerminalTab(tab.tabId)}
          onStartRename={() => setRenamingTabId(tab.tabId)}
          onCommitRename={(label) => {
            onRenameTerminalTab(tab.tabId, label);
            setRenamingTabId(null);
          }}
          onDiscardRename={() => setRenamingTabId(null)}
        />
      ))}
      <ChromeTooltip label={t("paneTabs.openTerminalTab")}>
        <button
          type="button"
          aria-label={t("paneTabs.openTerminalTab")}
          onClick={onOpenTerminalTab}
          className={`flex size-(--pc-paneControl-size) shrink-0 items-center justify-center rounded-(--pc-paneControl-radius) text-(--pc-paneHeader-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
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

// Ein einzelner Terminal-Tab: nur die Nummer, mittig, IMMER sichtbar
// (Kopfkommentar). Schließen und Umbenennen laufen beide über das
// Kontextmenü (Rechtsklick) — Schließen zusätzlich über Mittelklick
// (`onAuxClick`), dasselbe Idiom wie Browser-Tabs, das die Entwickler-
// Zielgruppe dieser App aus jedem Chrome-artigen Werkzeug kennt.
function TerminalTabChip({
  number,
  label,
  active,
  closable,
  renaming,
  onSelect,
  onClose,
  onStartRename,
  onCommitRename,
  onDiscardRename,
}: {
  number: number;
  label: string | null;
  active: boolean;
  closable: boolean;
  renaming: boolean;
  onSelect: () => void;
  onClose: () => void;
  onStartRename: () => void;
  onCommitRename: (label: string | null) => void;
  onDiscardRename: () => void;
}) {
  const { t } = useTranslation();
  const baseLabel = t("paneTabs.terminalTab", { number });
  // Nur die Zahlen 1-9 haben ein Kürzel (registry.ts) — ein zehnter Tab wäre
  // ohnehin am Rand dessen, was in eine Pane-Kopfzeile passt, und bekommt
  // schlicht keinen Akkord im Tooltip.
  const shortcut = SHORTCUTS.find((def) => def.id === terminalTabSelectId(number));
  const chordLabel = shortcut
    ? `${baseLabel} (${formatChord(shortcut, isMacPlatform() ? "mac" : "other")})`
    : baseLabel;
  // Der eigene Name hängt sich an den Tooltip an, statt ihn zu ersetzen — die
  // Nummer bleibt die verlässliche, immer gültige Kennung (Cmd/Strg+1..9
  // bleibt positionsbasiert), der Name ist zusätzlicher Kontext. Siehe
  // Kopfkommentar dieser Datei zur "am besten als Tooltip"-Entscheidung.
  const tooltipLabel = label === null ? chordLabel : `${chordLabel} — ${label}`;
  const ariaLabel = label === null ? baseLabel : `${baseLabel}: ${label}`;
  // Radix' ContextMenu.Content hält seinen FocusScope-Trap bis zum Ende des
  // eigenen Schließvorgangs aktiv (in der echten App bis zum Ablauf der
  // `CHROME_MENU_CONTENT_CLASS`-Austrittsanimation) — ein Fokussieren des neu
  // eingehängten Umbenennen-Felds VOR diesem Zeitpunkt (z. B. direkt aus dem
  // Menüpunkt-`onSelect`) würde vom Trap augenblicklich zurückgeworfen. Statt
  // die Absicht sofort umzusetzen, hält `onSelect` hier nur eine Absicht fest
  // und `ContextMenu.Content`s eigener `onCloseAutoFocus` — Radix' offizieller
  // Hook für "nach dem Schließen selbst fokussieren", garantiert erst NACH
  // dem Trap-Abbau zu feuern — setzt sie danach um.
  const pendingRenameRef = useRef(false);

  // Während des Umbenennens bewusst OHNE `ChromeTooltip`-Hülle: der Tooltip
  // triggert auf Hover, und die Maus steht nach dem Menüpunkt-Klick fast
  // immer noch genau über dem Chip — ohne diesen Zweig läge der Tooltip-Text
  // sichtbar über dem frisch fokussierten Eingabefeld.
  const trigger = (
    <ContextMenu.Trigger asChild>
      <span className="group/tab relative flex h-6 shrink-0 items-stretch">
        {renaming ? (
          <TerminalTabRenameField
            number={number}
            initialValue={label ?? ""}
            onCommit={onCommitRename}
            onDiscard={onDiscardRename}
          />
        ) : (
          <button
            type="button"
            onClick={onSelect}
            onAuxClick={(event) => {
              // Mittelklick (button === 1) schließt, wie in jedem
              // Browser — nur wenn überhaupt schließbar (letzter
              // verbleibender Tab, s. `closable` oben).
              if (event.button === 1 && closable) {
                event.preventDefault();
                onClose();
              }
            }}
            aria-pressed={active}
            aria-label={ariaLabel}
            // `border-b-2` IMMER gesetzt (Farbe verzweigt, nicht die Kante
            // selbst) — sonst würde die 2px-Zeile beim Aktivwerden neu
            // reserviert und die Zahl spränge einen Frame lang nach oben.
            // Nur oben gerundet (`rounded-t-*`, nicht `rounded-*`): eine
            // volle Rundung hätte die harte Unterkante an den beiden
            // unteren Ecken gebrochen, dort wo die 2px-Unterkante auf die
            // 1px-Seiten trifft — sichtbar als heller Verlaufs-Artefakt
            // (Design-Hook-Fund `border-accent-on-rounded`). Unten eckig
            // umgeht das, weil der Breitenunterschied dort nie auf eine
            // Kurve trifft.
            //
            // `px-3` symmetrisch (2026-08-13, nach Wegfall des
            // Schließkreuz-Randbereichs): ohne reservierten Platz rechts
            // braucht die Zentrierung der Zahl kein asymmetrisches
            // Padding mehr, `min-w-6` hält die Trefferfläche trotzdem über
            // der WCAG-2.5.8-Mindestgröße für einstellige Nummern.
            //
            // Aktiv: volle Box statt nur einer Unterkante (Nutzer-Fund:
            // „nur der orange Border unten sieht nicht so toll aus …
            // deutlicher als aktiv erkennbar") — 1px `--pc-pane-
            // activeBorder` rundum, `border-b-2` verdoppelt nur die
            // Unterkante als zusätzliches Gewicht, dazu eine warme
            // Akzent-Lasur als Füllung (`/14`) statt der vorigen
            // neutralen Auswahlfüllung. Derselbe Token wie
            // TerminalPane.tsx' Fokus-Hairline (nicht `--pc-focusBorder`
            // direkt — das ist der strikte Fokusring-Ton; `--pc-pane-
            // activeBorder` ist der dafür vorgesehene Chrome-Zwilling,
            // hier korrekt mit `--pc-paneHeader-activeForeground`
            // gepaart, derselben Paarung wie im Pane-Header).
            // Inaktiv: jetzt mit sichtbarer, dauerhafter 1px-Box in
            // gedämpftem Grau statt `border-transparent` — Nutzer-Fund:
            // ohne Kontur las sich ein inaktiver Tab gar nicht mehr als
            // Tab, nur noch als schwebender Text. Erst bei Hover hellt
            // Rand UND Füllung auf.
            className={`flex h-full min-w-6 items-center justify-center rounded-t-(--pc-paneControl-radius) border border-b-2 px-3 text-(length:--pc-chrome-fontSizeSmall) transition-colors ${
              active
                ? "border-(--pc-pane-activeBorder) bg-(--pc-pane-activeBorder)/14 font-semibold text-(--pc-paneHeader-activeForeground)"
                : "border-(--pc-paneHeader-border) font-medium text-(--pc-paneHeader-foreground) hover:border-(--pc-pane-border) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground)"
            } ${CHROME_FOCUS_RING}`}
          >
            {/* Terminalschrift + tabular-nums statt der Chrome-Schrift:
                die Nummer ist HUD-Readout wie die Slot-Nummern der leeren
                Slots (ProjectPicker.tsx) und bleibt bei jedem Wert gleich
                breit. */}
            <span className="font-(family-name:--pc-terminal-fontFamily) tabular-nums">
              {number}
            </span>
          </button>
        )}
      </span>
    </ContextMenu.Trigger>
  );

  return (
    <ContextMenu.Root>
      {renaming ? trigger : <ChromeTooltip label={tooltipLabel}>{trigger}</ChromeTooltip>}
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={`min-w-40 ${CHROME_MENU_CONTENT_CLASS}`}
          // Ersetzt Radix' Standardverhalten (Fokus zurück auf den Trigger)
          // durch die oben beschriebene Übergabe ans Umbenennen-Feld, sofern
          // "Umbenennen" der Menüpunkt war, der das Schließen ausgelöst hat.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (pendingRenameRef.current) {
              pendingRenameRef.current = false;
              onStartRename();
            }
          }}
        >
          <ContextMenu.Item
            onSelect={() => {
              pendingRenameRef.current = true;
            }}
            className={CHROME_MENU_ITEM_CLASS}
          >
            {t("paneTabs.renameTerminalTab", { number })}
          </ContextMenu.Item>
          {closable && (
            <ContextMenu.Item onSelect={onClose} className={CHROME_MENU_ITEM_CLASS}>
              {t("paneTabs.closeTerminalTab", { number })}
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// Ersetzt die Nummer durch ein `absolute` positioniertes Eingabefeld
// unterhalb des Chips (Widget-Material wie `ConfirmDialog.tsx` — dieselben
// `--pc-widget-*`-Töne) — nimmt bewusst NICHT am Flex-Layout der Tab-Gruppe
// teil (Begründung: Kopfkommentar dieser Datei). Enter committet, Escape UND
// Blur verwerfen (kein `RenameField`-artiges Commit-on-Blur: ein Klick weg
// vom Feld ist hier eher ein "ich hab's mir anders überlegt" als ein
// "fertig", anders als bei ExplorerPanel.tsx' Dateiumbenennung). Leeres oder
// unverändertes Feld committet als "kein Name" (`label: null`) — so lässt
// sich ein vergebener Name über dasselbe Feld auch wieder löschen.
function TerminalTabRenameField({
  number,
  initialValue,
  onCommit,
  onDiscard,
}: {
  number: number;
  initialValue: string;
  onCommit: (label: string | null) => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const commit = () => {
    const trimmed = value.trim();
    onCommit(trimmed === "" ? null : trimmed);
  };

  return (
    <div className="absolute left-0 top-full z-20 mt-1 w-36 rounded-md border border-(--pc-widget-border) bg-(--pc-widget-background) p-1 shadow-lg">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={t("paneTabs.renameTerminalTabFieldLabel", { number })}
        placeholder={t("paneTabs.terminalTab", { number })}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onDiscard();
          }
        }}
        onBlur={onDiscard}
        className={`w-full rounded bg-transparent px-1.5 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground) outline-none ${CHROME_FOCUS_RING}`}
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
      // Dieselbe Aktiv-Signalisierung wie TerminalTabChip (volle 1px-Box,
      // verdoppelte Unterkante, Akzent-Lasur, gepaartes Foreground-Token) —
      // ein Bauteil, ein Idiom, s. Kopfkommentar dieser Datei. Kein
      // ❯-Präfix (2026-08-13 mitentfernt, s. Kopfkommentar "Nachtrag …noch
      // später") — dasselbe Idiom auf beiden Tab-Arten heißt auch: beide
      // verlieren dasselbe Signal, nicht nur eine. Nur oben gerundet, aus
      // demselben Grund wie dort (siehe Kommentar an TerminalTabChip).
      className={`flex h-6 max-w-32 min-w-0 shrink items-center gap-1 rounded-t-(--pc-paneControl-radius) border border-b-2 px-1.5 text-(length:--pc-chrome-fontSizeSmall) transition-colors ${
        active
          ? "border-(--pc-pane-activeBorder) bg-(--pc-pane-activeBorder)/14 font-semibold text-(--pc-paneHeader-activeForeground)"
          : "border-(--pc-paneHeader-border) font-medium text-(--pc-paneHeader-foreground) hover:border-(--pc-pane-border) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground)"
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
      strokeWidth="1.25"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 2v8M2 6h8" />
    </svg>
  );
}
