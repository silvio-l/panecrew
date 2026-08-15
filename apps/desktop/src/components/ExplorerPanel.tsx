import { useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ContextMenu } from "radix-ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Trans, useTranslation } from "react-i18next";
import {
  CHROME_FOCUS_RING,
  CHROME_MENU_CONTENT_CLASS,
  CHROME_MENU_ITEM_CLASS,
  CHROME_MENU_SEPARATOR_CLASS,
  ChromeTooltip,
} from "./ChromeTooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileIcon, FolderIcon } from "./explorerIcons";
import { HudReadout } from "./HudReadout";
import { isPathOrDescendant, remapRenamedPath } from "../explorer/filePath";
import { searchProjectTree } from "../explorer/searchTree";
import { vscodeIsInstalled } from "../explorer/vscodeDetection";
import { isMacPlatform } from "../shortcuts/platform";
import { useSettings } from "../settings/useSettings";
import type { GitChangeStatus, GitDecorations } from "../types/gitStatus";
import type { ContentMatch, Project, TreeNode } from "../types/project";

// Dieselbe Dauer wie TerminalPane.tsx' Kopier-Bestätigung (Ticket 24 nennt
// deren Kontextmenü ausdrücklich als Vorbild) — ein zweiter, abweichender
// Wert für dieselbe Geste hätte keine erkennbare Begründung.
const COPY_FLASH_MS = 1200;

// Verzögerung zwischen dem letzten Tastendruck in der Explorer-Suche und dem
// tatsächlichen Backend-Walk (`explorer_search_names`) — eine Anfrage pro
// Anschlag wäre auf einem großen Baum unnötige Last für Zwischenzustände.
const SEARCH_DEBOUNCE_MS = 200;

// Dauerhaft sichtbares, kompaktes Explorer-Panel (Struktur aus Komposition 3):
// nur der Dateibaum, kein Icon-Rail, kein Overlay. Die STRUKTUR (Chevron-
// Spalte, Einrückungsstaffelung, Hervorhebung des aktiven Eintrags) folgt dem
// Referenz-Editor; die OPTIK spricht seit der TUI-Runde 2026-08-13
// (Nutzer-Direktive „TUI-Chic-Nordstern") das Terminal-Register der App:
// Baumzeilen, Kopfname und Eingabefelder in der Terminal-Monospace,
// ▸/▾-Zeichen statt rotierender SVG-Winkel, ├/└-Ast-Konnektoren als
// gezeichnete Hairlines, ❯ auf der ausgewählten Datei und ein Zähl-Readout
// als HUD-Fußzeile. Die Datei-Glyphen sind seit 2026-08-05 das echte
// Seti-Set — Herkunft, Lizenz und Farbzuordnung stehen in
// `explorerIcons.tsx`. Der Akzent-Punkt im Kopf ist das Explorer-Echo der
// fokussierten Pane.
// Breite/Einklapp-Zustand des PANELS besitzt App (überlebt so den key-Remount
// pro Projektwechsel); der Resize-Handle sitzt ebenfalls dort. Was der Baum in
// sich einklappt — einzelne Ordner und die Wurzel — gehört dagegen hierher:
// beides ist an den konkreten Baum gebunden und soll den Projektwechsel gerade
// NICHT überleben.
//
// DER BAUM IST VIRTUALISIERT (seit 2026-08-12). Vorher rendert `TreeRow` sich
// rekursiv über den ganzen Baum, also bis zu MAX_ENTRIES = 5000 echte
// DOM-Zeilen — und weil das Panel pro Projekt gekeyt ist (s. App.tsx), fiel
// genau dieser Aufbau bei JEDEM Pane-Wechsel neu an. Das ist die
// Kernbewegung dieser App, und sie war dadurch spürbar zäh.
//
// Der Weg heraus ist der, den der Referenz-Editor für seine eigenen Listen-/Baum-Widgets
// geht (`vs/base/browser/ui/list`): feste Zeilenhöhe, den aufgeklappten Baum
// zu EINER flachen Liste ausrollen und daraus nur das mounten, was im
// Sichtfenster steht (plus ein kleiner Puffer). Zwei Konsequenzen tragen
// diesen Umbau:
//   1. `TreeRow` rekursiert nicht mehr — `flattenTree` unten macht aus dem
//      Baum die sichtbare Zeilenfolge, `TreeRow` ist nur noch Darstellung.
//   2. Die Zeilen liegen absolut positioniert übereinander in einem
//      Platzhalter der vollen Höhe, damit die Bildlaufleiste die WAHRE Länge
//      des Baums zeigt und nicht nur die des gemounteten Ausschnitts.
// Was dabei nicht mehr von allein funktioniert, ist das Weiterwandern per
// Tastatur über nicht gemountete Zeilen hinweg — dafür stehen die
// Pfeiltasten weiter unten (`moveRowFocus`).
export function ExplorerPanel({
  project,
  width,
  selectedFile,
  dirtyFile,
  initialExpanded,
  onExpandedChange,
  onSelectFile,
  onCollapse,
  onRefresh,
  onLoadChildren,
  onStartPathDrag,
  draggingPath,
  onConsumeDragClick,
  onEntryRenamed,
  onEntryDeleted,
}: {
  project: Project;
  width: number;
  selectedFile: string;
  /** Die im Editor geöffnete Datei, solange sie ungespeicherte Änderungen
   * trägt — projekt-relativ, also in derselben Pfad-Konvention wie
   * `selectedFile`. `null`, wenn nichts offen oder alles geschrieben ist. */
  dirtyFile: string | null;
  /** Aus `session.json` wiederhergestellte AUFgeklappte Ordner für GENAU
   * dieses Projekt (App hält die Zuordnung projektpfad-geschlüsselt) —
   * `undefined` oder leer heißt schlicht: nichts weicht vom
   * Alles-eingeklappt-Default ab. Gespeichert wird die Abweichung und nicht
   * der Zustand selbst, weil „alles eingeklappt" als Default die eingeklappte
   * Menge zu jedem Ordner des Projekts aufgebläht hatte (session_store.rs
   * trägt die Messung). Nur als Initialwert gelesen (s. `useState` unten):
   * App reicht bei einem Projektwechsel ohnehin einen neuen `key` durch, ein
   * späteres Ändern dieser Prop soll den Baum NICHT von außen zurücksetzen. */
  initialExpanded?: readonly string[];
  /** Feuert bei jeder Änderung des Klapp-Zustands, mit den AUFgeklappten
   * Ordnern — App spiegelt das in `expandedFolders` und damit in den nächsten
   * `session.json`-Schreibvorgang. */
  onExpandedChange: (expanded: readonly string[]) => void;
  /** `line` (Ticket 26, Inhaltssuche): gesetzt, wenn der Klick von einer
   * Treffer-Zeile kam — springt der Editor zur passenden Stelle, statt nur
   * die Datei zu öffnen. */
  onSelectFile: (path: string, line?: number) => void;
  onCollapse: () => void;
  /** Liest den Dateibaum dieses Projekts neu von der Platte. Der Lesepfad
   * (`explorer_read_dir` für die Wurzel, dann jeder zuvor beladene Ordner
   * erneut) liegt bei App/`useProjects.ts`, nicht hier — der Explorer weiß
   * nur, dass es ihn gibt. */
  onRefresh: () => void;
  /** Lädt die Kinder EINES noch unbeladenen Ordners nach (Lazy-Expand,
   * `explorer_read_dir`) — der eigentliche Lese-Aufruf liegt in
   * `useProjects.ts`s `loadChildren`, hier nur durchgereicht, aus demselben
   * Grund wie bei `onRefresh`. Wirft bei einem Lesefehler (Ordner z. B.
   * gerade gelöscht) — der Aufrufer entscheidet, wie er darauf reagiert. */
  onLoadChildren: (relPath: string) => Promise<void>;
  /** Beginnt das Ziehen einer Zeile in eine Pane (Ticket 25). Bekommt den
   * ABSOLUTEN Pfad — die Umrechnung passiert hier, wo `project.path` bekannt
   * ist, genau wie bei `dirtyFile`: der Baum selbst spricht durchgehend
   * projekt-relativ, und ein zusätzlicher `projectPath` durch TreeList und
   * TreeRow hindurch wäre eine zweite Konvention in derselben Datei. */
  onStartPathDrag: (
    event: ReactPointerEvent<HTMLElement>,
    absolutePath: string,
    rowPath: string,
  ) => void;
  /** Die gerade gezogene Zeile (projekt-relativ), sonst `null`. */
  draggingPath: string | null;
  /** Ob der jetzt eintreffende Klick noch zum eben beendeten Ziehen gehört —
   * dann öffnet er keine Datei und klappt keinen Ordner. */
  onConsumeDragClick: () => boolean;
  /** Meldet eine tatsächlich vollzogene Umbenennung nach oben (beide Pfade
   * projekt-relativ) — App gleicht damit `selectedFile` und den offenen
   * Editor-Puffer ab (Ticket 24: eine Umbenennung darf weder die Auswahl
   * noch einen ungespeicherten Stand unter der alten Adresse zurücklassen). */
  onEntryRenamed: (oldRelPath: string, newRelPath: string) => void;
  /** Meldet eine tatsächlich vollzogene Löschung nach oben (projekt-relativ) —
   * derselbe Abgleich wie bei `onEntryRenamed`, nur schließend statt
   * umziehend. */
  onEntryDeleted: (relPath: string) => void;
}) {
  const { t } = useTranslation();
  // Ticket 05 (Live-Reload): derselbe `useSettings`, den auch der Settings-
  // Editor nutzt — sein `values`-Stand hängt am `settings:changed`-Event, ein
  // Umschalten dieser Einstellung wirkt also sofort, ohne dass der Explorer
  // neu gemountet werden muss. Fehlt der Wert (noch nicht geladen), gilt der
  // registrierte Default (`true`) — nie ungefragt löschen, solange unklar ist.
  const { values: settingsValues } = useSettings();
  const confirmBeforeDelete = settingsValues["explorer.confirmBeforeDelete"] !== false;
  // AUFgeklappte Ordner sind seit dem Umbau auf Lazy-Loading (2026-08-13) die
  // Quelle der Wahrheit, nicht mehr ein „eingeklappt"-Set gegen die Menge
  // ALLER Ordnerpfade gerechnet: Lazy-Loading kennt „alle Ordner des
  // Projekts" gar nicht mehr (das war genau das Problem am alten,
  // eager-rekursiven `explorer_read_tree` — ein früh-alphabetischer Ordner
  // mit sehr vielen Einträgen konnte per gemeinsamem Budget alle
  // nachfolgenden Geschwister aus dem Baum verdrängen, siehe whispaste,
  // 2026-08-13). Startzustand ist deshalb direkt die aus der Sitzung
  // wiederhergestellte Menge — ein gemerkter Pfad, den es nicht mehr gibt,
  // fällt beim `flattenTree`-Ausrollen unten von selbst weg, er trifft dort
  // schlicht auf keinen Knoten.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(initialExpanded ?? []),
  );
  // Meldet jede Änderung nach oben, siehe Prop-Doku von `onExpandedChange`.
  useEffect(() => {
    onExpandedChange([...expanded]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);
  // Lädt die aus der Sitzung wiederhergestellten Ordner tatsächlich nach —
  // `expanded` allein macht eine Zeile nur SICHTBAR, ihre Kinder müssen dafür
  // erst aus `explorer_read_dir` kommen (s. `TreeNode.children`-Doku). Nach
  // Vorbild des Referenz-Editors' `resolveTo`: streng von der Wurzel zu den
  // Blättern hin aufgelöst (`sort` nach Tiefe), weil `withChildrenAt`
  // (`types/project.ts`) einen Zielpfad nur findet, wenn jeder Elternordner
  // auf dem Weg dorthin bereits geladen ist — ein paralleler Fire-and-Forget
  // über alle Pfade würde jeden Treffer verlieren, dessen Eltern noch nicht
  // an der Reihe waren.
  //
  // Nur beim Einhängen: `initialExpanded` ist laut seiner eigenen Doku nur
  // ein Startwert, kein Prop, das den Baum später von außen zurücksetzen
  // soll (derselbe Grund, aus dem `collapsed`/`expanded` selbst keinen
  // `useEffect` auf `initialExpanded` hat).
  useEffect(() => {
    if (!initialExpanded || initialExpanded.length === 0) return;
    let cancelled = false;
    // TypeScript narrows a captured `let` to its last-checked literal value
    // across an `await` — it doesn't know the cleanup closure below can flip
    // it in between. Reading it back through a function call sidesteps that,
    // same pattern as App.tsx's session-restore effect.
    const isCancelled = () => cancelled;
    const chain = [...initialExpanded].sort(
      (a, b) => a.split("/").length - b.split("/").length,
    );
    void (async () => {
      for (const path of chain) {
        if (isCancelled()) return;
        try {
          await onLoadChildren(path);
        } catch (error) {
          console.error(
            "PaneCrew: gespeicherter Ordner konnte nicht nachgeladen werden",
            error,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Zweiter, bewusst eigener Einklapp-Zustand statt eines Eintrags in
  // `collapsed`: Der Projektknoten hat gar keine Zeile im Baum — der beginnt
  // schon bei seinen Kindern — und damit auch keinen Pfad, unter dem ihn das
  // Set führen könnte.
  const [rootCollapsed, setRootCollapsed] = useState(false);
  // Die offene Anlege-Zeile — `null`, solange keine offen ist. Ein einzelner
  // Zustand statt zweier Flags ist hier die ganze Umsetzung der Regel „nie
  // zwei Zeilen gleichzeitig": ein zweiter Klick überschreibt schlicht den
  // ersten Wert, und weil der `key` der Zeile die Art ist, wird sie dabei neu
  // aufgesetzt (Name und Fehler zurück auf leer). Nichts davon war committet,
  // also gibt es auch nichts zurückzufragen.
  const [draftKind, setDraftKind] = useState<DraftKind | null>(null);
  // Der Text der Explorer-Suche — `null` heißt: das Feld ist gar nicht offen.
  // Ein einzelner Zustand statt „offen"-Flag plus Text, weil Schließen und
  // Verwerfen hier dasselbe sind: Escape wie zweiter Klick auf den Knopf
  // lassen keinen Text zurück, der beim nächsten Öffnen wieder auftauchen
  // dürfte. Panel-lokal wie `expanded`/`rootCollapsed` und aus demselben
  // Grund — die Suche gehört zu DIESEM Baum und soll den key-Remount beim
  // Projektwechsel nicht überleben.
  //
  // Seit dem Umbau auf Lazy-Loading (2026-08-13) ein eigener Backend-Walk
  // (`explorer_search_names`, s. `searchTree.ts`) statt der früheren rein
  // clientseitigen Filterung über den bereits geladenen Baum
  // (`types/treeFilter.ts`, entfallen): ein noch nie aufgeklappter Ordner
  // hätte sonst nie durchsucht werden können. Die globale Suche in der
  // Titelzeile ist eine andere Sache und bleibt davon unberührt.
  const [search, setSearch] = useState<string | null>(null);

  // Ohne lesbaren Baum gibt es nichts zu suchen: dann gilt die Suche als
  // geschlossen, egal was der Zustand sagt (derselbe Fall deaktiviert unten
  // den Knopf). Der getippte Text bleibt dabei erhalten statt weggeworfen zu
  // werden — schlägt ein späteres Aktualisieren an, kommt die Suche zurück,
  // wie sie war.
  const searchQuery = project.treeError === null ? search : null;
  const trimmedSearchQuery = searchQuery?.trim() ?? "";

  // Ergebnis des zuletzt ABGESCHLOSSENEN Suchlaufs, zusammen mit der Anfrage,
  // die es beantwortet — nur wenn beide übereinstimmen, ist es aktuell (s.
  // `filteredTree` unten). Bleibt beim Weitertippen bewusst stehen (kein
  // Zurücksetzen auf `null`), damit ein neuer Tastendruck nicht kurz den
  // ganzen Baum aufblitzen lässt, bevor die nächste Antwort da ist.
  const [searchResult, setSearchResult] = useState<{
    query: string;
    nodes: TreeNode[];
    truncated: boolean;
  } | null>(null);

  useEffect(() => {
    if (trimmedSearchQuery === "") return;
    let cancelled = false;
    // Entkoppelt vom Tippen: eine Anfrage pro Tastenanschlag wäre auf einem
    // großen Baum unnötige Backend-Last für Zwischenzustände, die ohnehin
    // sofort durch die nächste Anfrage ersetzt werden.
    const timer = window.setTimeout(() => {
      void searchProjectTree(project.path, trimmedSearchQuery)
        .then(({ nodes, truncated }) => {
          // Verwirft eine spät eintreffende Antwort auf eine Anfrage, die
          // nicht mehr die aktuelle ist — sonst könnte eine frühere, langsame
          // Anfrage eine neuere, schnellere überschreiben.
          if (cancelled) return;
          setSearchResult({ query: trimmedSearchQuery, nodes, truncated });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          console.error("PaneCrew: Suche fehlgeschlagen", error);
          setSearchResult({ query: trimmedSearchQuery, nodes: [], truncated: false });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project.path, trimmedSearchQuery]);

  // `null` heißt hier zweierlei — Feld zu ODER Feld leer — und beides
  // bedeutet dasselbe: der Baum wird unverändert gezeigt, mit dem normalen
  // Ein-/Ausklapp-Verhalten. Während eine neuere Anfrage noch unterwegs ist,
  // bleibt das vorherige Ergebnis stehen (s. `searchResult`-Doku oben) statt
  // kurz auf „keine Treffer" umzuspringen.
  const filteredTree = useMemo(
    () => (trimmedSearchQuery === "" ? null : (searchResult?.nodes ?? [])),
    [trimmedSearchQuery, searchResult],
  );
  const searchPending =
    trimmedSearchQuery !== "" && searchResult?.query !== trimmedSearchQuery;
  const shownTree = filteredTree ?? project.tree;

  const toggleSearch = () => {
    if (search === null) {
      setSearch("");
      // Wie `openDraft`: bei eingeklappter Wurzel gibt es keinen Baumbereich,
      // in dem Treffer erscheinen könnten — der Knopf sähe wirkungslos aus.
      // Suchen ist die stärkere Absicht, sie klappt den Baum wieder auf.
      // Bewusst nur beim Öffnen: klappt der Nutzer die Wurzel bei offener
      // Suche selbst zu, ist das seine Entscheidung, und das Schließen der
      // Suche darf sie nicht rückgängig machen.
      setRootCollapsed(false);
      return;
    }
    setSearch(null);
  };

  const openDraft = (kind: DraftKind) => {
    setDraftKind(kind);
    // Bei eingeklappter Wurzel gibt es keinen Baumbereich, in dem die Zeile
    // erscheinen könnte — der Knopf sähe wirkungslos aus. Anlegen ist die
    // stärkere Absicht, sie klappt den Baum wieder auf.
    setRootCollapsed(false);
  };

  const toggleFolder = (row: FlatRow) => {
    // Während gefiltert wird, ist jeder gezeigte Ordner aufgeklappt — ein
    // Klick könnte das Set also nur unsichtbar verändern und beim Schließen
    // der Suche als überraschend anders geklappter Baum zurückkommen. Deshalb
    // hier folgenlos: der handgeklappte Zustand überlebt die Suche unberührt.
    if (filteredTree !== null) return;
    const { path, node } = row;
    const opening = !expanded.has(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (opening) next.add(path);
      else next.delete(path);
      return next;
    });
    // Nur beim ÖFFNEN eines noch unbeladenen Ordners nachladen — ein Klick,
    // der wieder zuklappt, oder einer auf einen bereits beladenen Ordner
    // (Kinder stehen im Cache, s. `useProjects.ts`) braucht keinen
    // Backend-Aufruf.
    if (opening && node.children === undefined) {
      void onLoadChildren(path).catch((error: unknown) => {
        console.error("PaneCrew: Ordner konnte nicht geladen werden", error);
        // Klappt wieder zu, statt dauerhaft in der Lade-Zeile hängen zu
        // bleiben — ein erneuter Klick versucht es einfach noch einmal.
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      });
    }
  };

  // Ersetzt das Set statt es zu ergänzen: nach „alles einklappen" gibt es
  // keinen offenen Ordner mehr, den ein Altbestand noch offenhalten dürfte.
  //
  // Wirkt anders als ein Chevron-Klick (s. `toggleFolder`) AUCH bei offener
  // Suche, dann eben erst sichtbar, wenn sie wieder zu ist: das hier ist ein
  // ausdrücklicher Befehl auf den ganzen Baum, den der Nutzer selbst erteilt
  // hat. Ein Chevron-Klick wäre dagegen nur die unsichtbare Nebenwirkung
  // eines Klicks, der in dem Moment aussieht, als täte er nichts.
  //
  // Verwirft bereits geladene Kinder NICHT: „einklappen" ist rein die
  // Sichtbarkeit der Zeilen, kein Cache-Invalidieren — ein erneutes Aufklappen
  // desselben Ordners zeigt ihn ohne neuen Backend-Aufruf sofort wieder.
  const collapseAll = () => {
    setExpanded(new Set());
  };

  // Die sichtbare Zeilenfolge des Baums — genau das, was der rekursive Aufbau
  // vorher implizit erzeugt hat, hier nur als Liste ausgeschrieben, damit sich
  // ein Sichtfenster darauf ausrechnen lässt.
  const rows = useMemo(
    () => flattenTree(shownTree, expanded, filteredTree !== null),
    [shownTree, expanded, filteredTree],
  );
  // Bezugsgröße des Fußzeilen-Readouts: jeder Knoten, den der Explorer
  // BISHER kennt (Wurzel plus jeder Ordner, der schon einmal per
  // `explorer_read_dir` beladen wurde), unabhängig von Klapp- und
  // Suchzustand. Seit dem Umbau auf Lazy-Loading (2026-08-13) ist das NICHT
  // mehr die wahre Projektgröße — die kennt der Explorer erst, wenn alles
  // aufgeklappt war — sondern der ehrliche Stand dessen, was tatsächlich
  // gelesen wurde. Das ist eine bewusste Abkehr vom früheren Vertrag „12/384
  // heißt: 384 Einträge existieren im Projekt" hin zu „384 Einträge sind dem
  // Explorer gerade bekannt" — dieselbe Auskunft, die z. B. der Referenz-Editor für seine
  // eigene Baumansicht gibt.
  const totalEntries = useMemo(() => countNodes(project.tree), [project.tree]);

  // Ob VS Code überhaupt installiert ist, ändert sich nicht innerhalb einer brandlint-ok: funktionale Erkennung des real installierten Editors
  // Session — einmal ermittelt (gecacht in `vscodeDetection.ts`), reicht ein
  // Panel-weiter State statt einer erneuten Rust-Anfrage pro Rechtsklick.
  const [vscodeInstalled, setVscodeInstalled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void vscodeIsInstalled().then((installed) => {
      if (!cancelled) setVscodeInstalled(installed);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Der Baumpfad der Zeile, die GERADE umbenannt wird — `null` heißt: keine.
  // Ein einzelner Zustand statt eines Flags pro Zeile, aus demselben Grund
  // wie `draftKind`: höchstens eine Zeile kann gleichzeitig umbenannt werden,
  // ein zweiter Rechtsklick-„Umbenennen" ersetzt schlicht den ersten.
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  // Der Baumpfad der Zeile, deren Kontextmenü gerade offen ist — die einzige
  // Hervorhebung, die ein rechtsgeklickter ORDNER bekommen kann (`selected`
  // verlangt `!isFolder`, s. `TreeRow`).
  const [contextTargetPath, setContextTargetPath] = useState<string | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<{
    path: string;
    isFolder: boolean;
    name: string;
  } | null>(null);
  // Bestätigung nach Copy Path/Copy Relative Path — dieselbe „900ms-Flash"-
  // Mechanik wie TerminalPane.tsx' Kopier-Bestätigung, nur im Fußzeilen-
  // Readout statt als eigener schwebender Chip: der Explorer hat mit
  // `TreeStatusReadout` bereits eine Fläche, die genau diese Rolle spielt
  // (kurzlebige, textuelle Rückmeldung am unteren Panelrand), ein zweiter
  // Toast-Mechanismus wäre hier verfrüht (das ist Ticket 28).
  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  const copyFlashTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyFlashTimer.current !== null) window.clearTimeout(copyFlashTimer.current);
    },
    [],
  );
  const flashCopied = (message: string) => {
    setCopyFlash(message);
    if (copyFlashTimer.current !== null) window.clearTimeout(copyFlashTimer.current);
    copyFlashTimer.current = window.setTimeout(() => setCopyFlash(null), COPY_FLASH_MS);
  };

  // Verschiebt jeden Aufklapp-Zustand-Eintrag, der GENAU `oldPath` war oder
  // darunter lag, auf die entsprechende Adresse unter `newPath` — sonst
  // erschiene ein umbenannter, vorher aufgeklappter Ordner nach dem
  // Aktualisieren plötzlich eingeklappt (er stünde unter seinem neuen Namen
  // nicht mehr im `expanded`-Set).
  const remapExpandedOnRename = (oldPath: string, newPath: string) => {
    setExpanded((prev) => {
      const next = new Set<string>();
      for (const entry of prev) next.add(remapRenamedPath(entry, oldPath, newPath));
      return next;
    });
  };

  const commitRename = async (
    relPath: string,
    newRelPath: string,
  ): Promise<string | null> => {
    try {
      await invoke("explorer_rename", {
        from: `${project.path}/${relPath}`,
        to: `${project.path}/${newRelPath}`,
      });
    } catch (cause) {
      return typeof cause === "string" ? cause : String(cause);
    }
    remapExpandedOnRename(relPath, newRelPath);
    setRenamingPath(null);
    onRefresh();
    onEntryRenamed(relPath, newRelPath);
    return null;
  };

  const performDelete = (path: string) => {
    void invoke("explorer_delete", { path: `${project.path}/${path}` })
      .then(() => {
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const entry of prev) {
            if (isPathOrDescendant(entry, path)) next.delete(entry);
          }
          return next;
        });
        onRefresh();
        onEntryDeleted(path);
      })
      .catch((error: unknown) => {
        // Dasselbe stille Fallback wie `FileEditor.tsx`s `openPath`-Fehler:
        // kein eigener Fehlerdialog für einen seltenen Fall (Berechtigung,
        // Datei gerade anderswo gesperrt) — die Rückfrage ist schon
        // geschlossen, ein zweiter modaler Unterbruch wäre hier zu viel.
        console.error("PaneCrew: Eintrag konnte nicht gelöscht werden", error);
      });
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    const { path } = pendingDelete;
    setPendingDelete(null);
    performDelete(path);
  };

  const menuActions: RowMenuHandlers = {
    onReveal: (row) => {
      void revealItemInDir(`${project.path}/${row.path}`).catch((error: unknown) => {
        console.error("PaneCrew: Eintrag konnte nicht angezeigt werden", error);
      });
    },
    onOpenInVSCode: (row) => {
      void invoke("vscode_open", { path: `${project.path}/${row.path}` }).catch(
        (error: unknown) => {
          console.error("PaneCrew: VS Code konnte nicht geöffnet werden", error); // brandlint-ok: reale Fehlermeldung der Editor-Öffnen-Funktion
        },
      );
    },
    onStartRename: (row) => setRenamingPath(row.path),
    onRequestDelete: (row) => {
      if (confirmBeforeDelete) {
        setPendingDelete({ path: row.path, isFolder: row.isFolder, name: row.node.name });
      } else {
        performDelete(row.path);
      }
    },
    onCopyPath: (row) => {
      void navigator.clipboard
        .writeText(`${project.path}/${row.path}`)
        .then(() => flashCopied(t("explorer.contextMenu.pathCopied")))
        .catch(() => {
          /* Zwischenablage ohne Berechtigung — kein Feedback ist hier
             ehrlicher als ein Erfolgs-Flash, der nicht stattgefunden hat. */
        });
    },
    onCopyRelativePath: (row) => {
      void navigator.clipboard
        .writeText(row.path)
        .then(() => flashCopied(t("explorer.contextMenu.relativePathCopied")))
        .catch(() => {
          // Dasselbe stille Fallback wie bei `onCopyPath` oben.
        });
    },
  };

  return (
    <aside
      style={{ width }}
      className="group/explorer flex shrink-0 flex-col border-r border-(--pc-explorer-border) bg-(--pc-explorer-background)"
    >
      {/* Werkzeugleiste ÜBER dem Projektnamen statt daneben (Ticket 26,
          2026-08-15): bei der Standardbreite (224px) blieben sechs Knöpfe
          neben dem Namen in einer Zeile diesem kaum noch Platz — jetzt hat
          die Leiste die volle Panel-Breite für sich, alle sechs Aktionen
          passen direkt nebeneinander, kein Overflow-Menü mehr nötig.
          h-8 = 32px: (32 - 24px Knopfgröße) / 2 = 4px Rand oben/unten, exakt
          `pt-1` — die Zahl, an der sich `CollapsedExplorerStrip.pt-1` unten
          orientiert, damit der Zeiger beim Ein-/Ausklappen nicht springt.

          `justify-between` statt eines rechtsbündigen Blocks: die drei
          Gruppen — Anlegen, Baum, Panel — spannen sich über die volle Breite
          auf, mit `ToolbarDivider` an genau den beiden Gruppengrenzen. Das
          ist dieselbe Trenngrammatik wie `Divider` in `TitleBar.tsx` ("die
          einzige Trenngrammatik des Instrumenten-Clusters, an jeder
          Wertegrenze"), hier auf den Explorer-Oberflächenton übertragen statt
          auf den Glas-Ton der Titelleiste. Eine gleichmäßig verteilte
          Werkzeugleiste mit sichtbaren Gruppengrenzen liest sich als
          Instrumenten-Cluster, ein rechtsbündiger Pulk aus sechs Knöpfen
          dagegen nur als Anhängsel. */}
      <div className="flex h-8 shrink-0 items-center justify-between px-1.5">
        {/* Reihenfolge wie im Referenz-Editor, in drei Stufen von innen nach
            außen: zuerst die Aktionen, die etwas IM Baum anlegen, dann die
            auf dem ganzen Baum (Filtern, Aktualisieren, Einklappen), zuletzt
            die auf dem Panel selbst (Ausblenden). Die Suche steht in der
            mittleren Gruppe, nicht bei den Anlege-Knöpfen: sie legt nichts
            an, sie verändert die Sicht auf den gesamten Baum. Anders als vor
            der Zeilentrennung sind alle sechs jetzt dauerhaft sichtbar statt
            Hover-Reveal — eine eigene Zeile, die erst bei Zeigerkontakt
            Inhalt zeigt, wäre sonst bloßer Leerraum. */}
        <div className="flex items-center gap-0.5">
          <HeaderAction label={t("explorer.newFile")} onClick={() => openDraft("file")}>
            <NewFileIcon />
          </HeaderAction>
          <HeaderAction
            label={t("explorer.newFolder")}
            onClick={() => openDraft("directory")}
          >
            <NewFolderIcon />
          </HeaderAction>
        </div>
        <ToolbarDivider />
        <div className="flex items-center gap-0.5">
          <HeaderAction
            label={t("explorer.filterFiles")}
            onClick={toggleSearch}
            // Ohne lesbaren Baum gibt es nichts zu filtern. Deaktiviert statt
            // stumm wirkungslos: der Grund steht zwei Zeilen tiefer schon als
            // Fehlermeldung im Baumbereich, der ausgegraute Knopf verweist
            // darauf, statt ein Feld anzubieten, das auf nichts arbeitet.
            // Aktualisieren daneben bleibt aktiv — das ist der Weg heraus.
            // Bewusst in Kauf genommen: ein deaktivierter Knopf bekommt keine
            // Zeigerereignisse, sein Tooltip erscheint in diesem Zustand also
            // nicht. Die Fehlermeldung darunter sagt ohnehin mehr als er.
            disabled={project.treeError !== null}
            pressed={searchQuery !== null}
          >
            <SearchIcon />
          </HeaderAction>
          <HeaderAction label={t("explorer.refreshTree")} onClick={onRefresh}>
            <RefreshIcon />
          </HeaderAction>
          <HeaderAction label={t("explorer.collapseAll")} onClick={collapseAll}>
            <CollapseAllIcon />
          </HeaderAction>
        </div>
        <ToolbarDivider />
        <HeaderAction label={t("explorer.hideExplorer")} onClick={onCollapse}>
          <SidebarIcon />
        </HeaderAction>
      </div>
      {/* h-10, nicht h-9: der Projektname steht hier direkt neben demselben
          Projektnamen im Pane-Header, und der sitzt 2px tiefer (das Grid
          darunter hat p-2, der Pane-Header ist h-6 — Mitte also bei 8+12=20).
          Mit h-9 lagen die beiden identischen Wörter sichtbar versetzt
          nebeneinander; 40/2 = 20 bringt sie auf dieselbe optische Achse.
          Diese Rechnung gilt unverändert für die NAMENSZEILE selbst — sie ist
          seit der Zeilentrennung oben (Ticket 26) nur nicht mehr die einzige
          Kopfzeile, sondern die zweite von zweien. */}
      {/* pl-0.5 + pl-2 am Knopf = 10px bis zum Chevron, exakt das
          paddingLeft, mit dem die Baumzeilen der Tiefe 0 beginnen: die
          Wurzel-Chevrons und die der obersten Ordner stehen damit in einer
          Spalte, der Projektname eine Einrückungsstufe links vor seinen
          Kindern — dieselbe Staffelung wie im Explorer des Referenz-Editors. */}
      {/* h-[41px] = die bisherigen 40px Innenhöhe plus die 1px-Hairline unten
          (border-box!): die Trennlinie kam mit der TUI-Runde 2026-08-13 dazu —
          sie rahmt den Baum wie die Pane-Header ihre Terminals — und hätte
          bei h-10 die optische Mitte der Zeile auf 19,5px gedrückt, aus der
          Flucht mit dem Projektnamen im Pane-Header (Mitte 20, s. o.). Sie
          bleibt die einzige Trennlinie des gesamten (jetzt zweizeiligen)
          Kopfbereichs — zwischen Werkzeugleiste und Namenszeile steht bewusst
          keine zweite: beide bilden optisch einen Block. */}
      <div className="flex h-[41px] shrink-0 items-center gap-1 border-b border-(--pc-explorer-border) pl-0.5 pr-1.5">
        {/* Die Kopfzeile ist zugleich der Wurzelknoten: ein Klick klappt den
            gesamten Baum weg. Der zugängliche Name des Knopfes ist der
            Projektname selbst, `aria-expanded` trägt den Zustand: das
            Standardmuster für einen Aufklapp-Abschnitt. */}
        <button
          type="button"
          aria-expanded={!rootCollapsed}
          onClick={() => setRootCollapsed((prev) => !prev)}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pl-2 pr-1 text-left transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
        >
          <Chevron open={!rootCollapsed} />
          {/* Das Akzent-Echo der fokussierten Pane. Liest deren eigenes Token
              (nicht den generischen focusBorder-Fallback), damit Echo und
              Anlass denselben Ton haben. Der frühere 6px-Schein ist mit dem
              Glow der Pane entfallen — die Sprache ist jetzt Kante, nicht
              Leuchten. */}
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-(--pc-pane-activeBorder)"
          />
          {/* Terminalschrift auch hier: der Kopf ist die Wurzelzeile des
              Baums darunter und spricht seit der TUI-Runde dessen Register. */}
          <span className="min-w-0 flex-1 truncate font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) font-semibold text-(--pc-explorerHeader-foreground)">
            {project.name}
          </span>
        </button>
      </div>
      {!rootCollapsed && (
        <>
          {/* Über dem Baumbereich statt darin: das Feld ist eine Aussage über
              den ganzen Baum, und es soll beim Scrollen durch die Trefferliste
              stehen bleiben, statt oben hinauszurutschen. */}
          {searchQuery !== null && (
            <TreeFilterRow
              value={searchQuery}
              onChange={setSearch}
              onClose={() => setSearch(null)}
            />
          )}
          {/* Immer ganz oben, unabhängig davon, ob darunter ein Baum, der
              Leer-Platzhalter oder der Lesefehler steht: die Zeile gehört zur
              Wurzel, und die Wurzel beginnt hier. `key` ist die Art — der
              Wechsel von Datei auf Ordner setzt Eingabe und Fehler zurück,
              statt den Text der einen Absicht in die andere zu übernehmen.

              Sie steht ÜBER dem Baumbereich statt darin — dieselbe Aufteilung
              wie beim Suchfeld darüber, hier aber aus einem zweiten Grund:
              der Bereich darunter ist der Scroll-Container des virtualisierten
              Baums, und der muss bei sich nur die Liste haben. Sonst läge die
              Liste um die Höhe dieser Zeile versetzt — eine Höhe, die mit
              ihrer Fehlermeldung auch noch wechselt. Sichtbar ändert das
              nichts: die Zeile erscheint an derselben Stelle in derselben
              Zeilengeometrie, sie rutscht beim Scrollen nur nicht mehr weg. */}
          {draftKind !== null && (
            <NewEntryRow
              key={draftKind}
              kind={draftKind}
              projectPath={project.path}
              onDiscard={() => setDraftKind(null)}
              onCreated={(name) => {
                setDraftKind(null);
                onRefresh();
                // Nur Dateien: `onSelectFile` ist laut seinem Vertrag der
                // Auswahlpfad des späteren Editors und erwartet eine Datei.
                // Der Pfad ist relativ zur Wurzel — genau die Konvention, in
                // der `flattenTree` seine Pfade baut (Tiefe 0: der bloße Name).
                if (draftKind === "file") onSelectFile(name);
              }}
            />
          )}
          {/* Der leere Baum wird VOR dem leeren Filterergebnis geprüft: ein
              Projekt ohne Baum liefert auch auf jede Suche nichts, und
              „Keine Treffer" wäre dort die falsche Auskunft.

              Die Auskünfte und die Liste füllen denselben Rest des Panels,
              bringen ihren scrollenden Bereich aber getrennt mit: der der
              Liste ist zugleich ihr Sichtfenster und darf deshalb außer ihr
              nichts enthalten. */}
          {project.treeError !== null ? (
            <TreeNoticeArea>
              <TreeErrorNotice message={project.treeError} />
            </TreeNoticeArea>
          ) : project.tree.length === 0 ? (
            <TreeNoticeArea>
              <p className="px-3 py-1 text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)">
                {t("explorer.noTreeLoaded")}
              </p>
            </TreeNoticeArea>
          ) : shownTree.length === 0 && !searchPending ? (
            // Vom Leer-Platzhalter darüber bewusst unterscheidbar: eine Suche
            // ohne Treffer darf nie wie ein leeres Projekt aussehen —
            // dieselbe Sorgfalt wie bei `TreeErrorNotice`, hier aber mit einem
            // Satz genug, weil nichts kaputt ist. `searchPending` hält diesen
            // Zweig zurück, solange die Antwort auf die AKTUELLE Anfrage noch
            // unterwegs ist — sonst blitzte „Keine Treffer" bei jedem
            // Tastendruck kurz auf, bevor die eigentliche Antwort ankommt.
            <TreeNoticeArea>
              <p className="px-3 py-1 text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)">
                {t("explorer.noSearchResults", { query: trimmedSearchQuery })}
              </p>
            </TreeNoticeArea>
          ) : (
            <TreeList
              rows={rows}
              selected={selectedFile}
              dirtyFile={dirtyFile}
              gitDecorations={project.gitDecorations}
              onToggleFolder={toggleFolder}
              onSelectFile={onSelectFile}
              onStartPathDrag={(event, rowPath) => {
                onStartPathDrag(event, `${project.path}/${rowPath}`, rowPath);
              }}
              draggingPath={draggingPath}
              onConsumeDragClick={onConsumeDragClick}
              menu={menuActions}
              vscodeInstalled={vscodeInstalled}
              renamingPath={renamingPath}
              onCommitRename={commitRename}
              onDiscardRename={() => setRenamingPath(null)}
              contextTargetPath={contextTargetPath}
              onContextMenuOpenChange={(path, open) =>
                setContextTargetPath(open ? path : null)
              }
            />
          )}
          {/* Backend-Suche kappt bewusst nur die TREFFERLISTE
              (`MAX_SEARCH_MATCHES`, `explorer_fs.rs`), nie unbeteiligte
              Geschwister wie der alte `MAX_ENTRIES`-Bug — trotzdem offen
              kommuniziert statt still, sonst sähe eine lange Trefferliste wie
              eine vollständige aus. Nur bei der AKTUELLEN, abgeschlossenen
              Suche (nicht `searchPending`), sonst stünde die Meldung noch für
              die vorherige Anfrage. */}
          {filteredTree !== null && !searchPending && searchResult?.truncated === true && (
            <p className="shrink-0 border-t border-(--pc-explorer-border) px-3 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground)">
              {t("explorer.searchTruncated")}
            </p>
          )}
          {/* Nur unter einem echten Baum: unter Fehler- und Leerzuständen
              gäbe es nichts zu zählen, und ein Readout „0/0" sähe wie ein
              weiterer Fehler aus. */}
          {project.treeError === null && project.tree.length > 0 && (
            <TreeStatusReadout
              visible={rows.length}
              total={totalEntries}
              flash={copyFlash}
            />
          )}
        </>
      )}
      {/* Rückfrage vor dem Löschen — dieselbe `ConfirmDialog`, die `App.tsx`
          für ungespeicherte Änderungen einsetzt. Datei/Ordner-Unterscheidung
          nur im Beschreibungstext: ein gelöschter Ordner nimmt seinen ganzen
          Inhalt mit, das muss die Rückfrage sagen, bevor der Klick auf
          „Löschen" das entschieden hat. */}
      {pendingDelete !== null && (
        <ConfirmDialog
          title={t("explorer.deleteDialog.title", { name: pendingDelete.name })}
          description={
            // Derselbe `<bold>`-Interpolationsplatzhalter wie in
            // UnsavedChangesDialog.tsx: der Name trägt die volle Hervorhebung,
            // unabhängig davon, wo ihn die jeweilige Übersetzung im Satz setzt.
            <Trans
              i18nKey={
                pendingDelete.isFolder
                  ? "explorer.deleteDialog.descriptionFolder"
                  : "explorer.deleteDialog.descriptionFile"
              }
              values={{ name: pendingDelete.name }}
              components={{
                bold: <span className="font-medium text-(--pc-foreground)" />,
              }}
            />
          }
          confirmLabel={t("explorer.deleteDialog.confirm")}
          cancelLabel={t("explorer.deleteDialog.cancel")}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </aside>
  );
}

// HUD-Fußzeile des Baums (TUI-Direktive 2026-08-13): sichtbare gegen
// vorhandene Einträge. Das Register selbst — Terminalschrift, 10px, Sperrung,
// gedimmte Farbe, Ziffern sichtbar und der ganze Satz nur für Screenreader —
// steht seit 2026-08-13 in `HudReadout`; diese Fußzeile war der erste Ort, an
// dem es galt, und ist deshalb der erste, der es aus dem Bauteil bezieht.
// Hier bleibt nur die Fassung: Höhe, Trennlinie, Einzug. Die Zahl reagiert
// auf Klappen, Suchen UND Aktualisieren — ein lebendes Instrument, kein
// Zierrat.
function TreeStatusReadout({
  visible,
  total,
  flash,
}: {
  visible: number;
  total: number;
  /** Kurzlebige Bestätigung nach Copy Path/Copy Relative Path — verdrängt das
   * Zähl-Readout für `COPY_FLASH_MS`. Bewusst NICHT über `HudReadout`: dessen
   * eigene Regel ist „sichtbar sind nur Ziffern, nie Prosa", und dieser Text
   * ist Prosa — er gehört deshalb in die Systemschrift des Chrome, wie jede
   * andere Meldung im Panel auch. Der Wechsel selbst ist ein harter Schnitt
   * (kein Fade), wie es die Direktive gegen weiche Zustandsübergänge verlangt. */
  flash: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-5 shrink-0 items-center border-t border-(--pc-explorer-border) px-3">
      {flash !== null ? (
        <span
          role="status"
          className="truncate text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)"
        >
          {flash}
        </span>
      ) : (
        <HudReadout
          value={`${String(visible)}/${String(total)}`}
          srText={t("explorer.visibleCount", { visible, total })}
        />
      )}
    </div>
  );
}

// Zählt jeden Knoten des Baums (Dateien wie Ordner), unabhängig vom
// Klappzustand — die Bezugsgröße des Fußzeilen-Readouts.
function countNodes(nodes: readonly TreeNode[]): number {
  return nodes.reduce(
    (sum, node) =>
      sum + 1 + (node.children === undefined ? 0 : countNodes(node.children)),
    0,
  );
}

// Der Platz im Panel, den sonst die Liste einnimmt — für die drei Fälle, in
// denen es keine gibt (Lesefehler, leeres Projekt, Suche ohne Treffer).
// Scrollt, weil ein Rechtefehler aus Rust mit langen Pfaden auch mal höher
// baut als das Panel.
function TreeNoticeArea({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto pb-2">{children}</div>;
}

// Die virtualisierte Baumliste: sie besitzt das Sichtfenster (ihren eigenen
// Scroll-Container), rechnet daraus den gemounteten Ausschnitt aus und trägt
// deshalb auch die Pfeiltasten-Navigation, die über dessen Grenze hinausführt.
//
// Eigene Komponente und nicht Teil von `ExplorerPanel`: der React Compiler
// kann um `useVirtualizer` herum nichts memoisieren (die API gibt Funktionen
// zurück) und lässt deshalb die ganze Komponente aus, in der sie steht. Steht
// sie hier, ist das genau diese Liste — die ohnehin bei jedem Scrollschritt
// neu rendert — statt zusätzlich der Kopfzeile mit ihren sechs Knöpfen.
function TreeList({
  rows,
  selected,
  dirtyFile,
  gitDecorations,
  onToggleFolder,
  onSelectFile,
  onStartPathDrag,
  draggingPath,
  onConsumeDragClick,
  menu,
  vscodeInstalled,
  renamingPath,
  onCommitRename,
  onDiscardRename,
  contextTargetPath,
  onContextMenuOpenChange,
}: {
  rows: readonly FlatRow[];
  selected: string;
  dirtyFile: string | null;
  gitDecorations: GitDecorations;
  /** Bekommt die GANZE Zeile, nicht nur ihren Pfad: `toggleFolder` in
   * `ExplorerPanel` braucht `row.node.children`, um zu entscheiden, ob ein
   * Aufklappen einen Lazy-Load auslösen muss. */
  onToggleFolder: (row: FlatRow) => void;
  /** `line` (Ticket 26, Inhaltssuche): gesetzt, wenn der Klick von einer
   * Treffer-Zeile kam — springt der Editor zur passenden Stelle, statt nur
   * die Datei zu öffnen. */
  onSelectFile: (path: string, line?: number) => void;
  /** Wie in `ExplorerPanel`, nur schon auf den Baumpfad der Zeile verkürzt —
   * die Umrechnung auf den absoluten Pfad liegt eine Ebene höher. */
  onStartPathDrag: (
    event: ReactPointerEvent<HTMLElement>,
    rowPath: string,
  ) => void;
  draggingPath: string | null;
  onConsumeDragClick: () => boolean;
  menu: RowMenuHandlers;
  vscodeInstalled: boolean;
  /** Der Baumpfad der GENAU einen Zeile, die gerade umbenannt wird, sonst
   * `null` — siehe `ExplorerPanel`. */
  renamingPath: string | null;
  onCommitRename: (relPath: string, newRelPath: string) => Promise<string | null>;
  onDiscardRename: () => void;
  /** Der Baumpfad der Zeile, deren Kontextmenü gerade offen ist, sonst
   * `null` — siehe `ExplorerPanel`. */
  contextTargetPath: string | null;
  onContextMenuOpenChange: (path: string, open: boolean) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Der React Compiler überspringt diese Komponente — um eine API herum, die
  // Funktionen zurückgibt, kann er nicht memoisieren, ohne stehengebliebene
  // Oberfläche zu riskieren. Das ist hinnehmbar und zugleich der Grund, warum
  // die Liste überhaupt eine eigene Komponente ist (s. o.): sie
  // rendert beim Scrollen ohnehin neu, und was daran hängt, sind die zwei bis
  // drei Dutzend gemounteten Zeilen — nicht mehr der ganze Baum.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: ROW_OVERSCAN,
    // Der Baum wird bei jedem Filter- und Klappschritt neu ausgerollt; ohne
    // einen vom Index unabhängigen Schlüssel behielte der Virtualizer Messwerte
    // für „Zeile 7", die dann eine ganz andere Datei meint.
    getItemKey: (index) => rows[index]?.path ?? index,
  });
  const items = virtualizer.getVirtualItems();

  // Die Zeile, die den Fokus bekommen soll, sobald sie gemountet ist — s.
  // `moveRowFocus`. `null` heißt: kein offener Wunsch.
  const [pendingFocusRow, setPendingFocusRow] = useState<number | null>(null);

  // Pfeiltasten in der Baumliste. Sie sind erst mit der Virtualisierung nötig
  // geworden: vorher stand jede Zeile als eigener Tabstopp im Dokument, ein
  // langer Baum war also (mühsam, aber lückenlos) durchtabbar. Gemountet ist
  // jetzt nur noch das Sichtfenster, und damit endete der Tab-Weg schlicht an
  // dessen Rand. Auf/Ab holt die Nachbarzeile zuerst ins Sichtfenster und setzt
  // den Fokus dann dorthin — die Tastatur erreicht damit wieder jede Zeile,
  // unabhängig davon, was gerade im DOM steht.
  //
  // Bewusst NUR Auf/Ab und bewusst OHNE Roving-Tabindex: alles Weitere (ein
  // einzelner Tabstopp für die ganze Liste, Links/Rechts zum Auf- und
  // Zuklappen, role="tree") wäre der Umbau des Bedienmodells und nicht mehr
  // das Ausgleichen dessen, was die Virtualisierung weggenommen hat.
  const moveRowFocus = (
    index: number,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    const target = index + step;
    // An den Enden bleibt der Fokus stehen, statt aus der Liste zu fallen.
    if (target < 0 || target >= rows.length) return;
    // Ohne das scrollte der Container zusätzlich von sich aus — die Zeile wäre
    // fokussiert und der Blick trotzdem woanders.
    event.preventDefault();
    virtualizer.scrollToIndex(target);
    setPendingFocusRow(target);
  };

  // Fokussiert wird erst, wenn die Zielzeile wirklich im DOM steht, und das ist
  // beim Sprung über die Fenstergrenze ein Render später der Fall: der
  // Virtualizer erfährt seine neue Position über das Scroll-Ereignis. Deshalb
  // hängt der Effekt außer am Wunsch selbst am gemounteten Ausschnitt — ändert
  // der sich, versucht er es erneut, und der Wunsch wird erst gelöscht, wenn er
  // erfüllt ist.
  useEffect(() => {
    if (pendingFocusRow === null) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${String(pendingFocusRow)}"]`,
    );
    if (!row) return;
    row.focus();
    setPendingFocusRow(null);
  }, [pendingFocusRow, items]);

  return (
    // Der Scroll-Container IST das Sichtfenster, an dem der Virtualizer misst —
    // deshalb liegt der ref genau auf dem Element, das `overflow-y-auto` trägt.
    // `data-virtual-viewport` ist die Marke, an der src/test/setup.ts ihm eine
    // Höhe unterschiebt: jsdom rechnet kein Layout, und ein 0px hohes
    // Sichtfenster enthält keine einzige sichtbare Zeile.
    <div
      ref={scrollRef}
      data-virtual-viewport
      className="min-h-0 flex-1 overflow-y-auto pb-2"
    >
      {/* Der Platzhalter trägt die Höhe ALLER Zeilen, nicht nur der
          gemounteten: daran hängt die Bildlaufleiste, und die soll die wahre
          Länge des Baums zeigen. Die Zeilen liegen absolut darin — deshalb
          `relative`. */}
      <div
        style={{ height: virtualizer.getTotalSize() }}
        className="relative w-full"
      >
        {items.map((item) => {
          const row = rows[item.index];
          if (row === undefined) return null;
          return (
            <TreeRow
              key={row.path}
              row={row}
              index={item.index}
              offset={item.start}
              selected={selected}
              dirtyFile={dirtyFile}
              gitDecorations={gitDecorations}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              onStartPathDrag={onStartPathDrag}
              dragging={draggingPath === row.path}
              onConsumeDragClick={onConsumeDragClick}
              onKeyDown={moveRowFocus}
              menu={menu}
              vscodeInstalled={vscodeInstalled}
              isRenaming={renamingPath === row.path}
              onCommitRename={onCommitRename}
              onDiscardRename={onDiscardRename}
              isContextTarget={contextTargetPath === row.path}
              onContextMenuOpenChange={onContextMenuOpenChange}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Was die offene Anlege-Zeile gerade anlegt. Die beiden Werte sind zugleich
 * die Unterscheidung der beiden Tauri-Commands dahinter. */
type DraftKind = "file" | "directory";

const CREATE_COMMAND: Record<DraftKind, string> = {
  file: "explorer_create_file",
  directory: "explorer_create_directory",
};

const DRAFT_PLACEHOLDER_KEY: Record<DraftKind, "newFileNamePlaceholder" | "newFolderNamePlaceholder"> = {
  file: "newFileNamePlaceholder",
  directory: "newFolderNamePlaceholder",
};

// Die Anlege-Zeile: eine Baumzeile, in der statt des Namens ein Textfeld
// steht. Bewusst genau in der Geometrie von `TreeRow` gebaut (Zeilenhöhe,
// paddingLeft 10, die 10px-Lücke, wo sonst das Chevron sitzt, dasselbe
// gap-1.5) — sie soll wie eine Zeile des Baums aussehen, die es gleich geben
// wird, nicht wie ein Dialog, der sich davorschiebt.
//
// Nur Wurzelebene, ohne Einrückung: der Explorer kennt keinen „fokussierten
// Ordner"-Zustand, nur `selectedFile` (eine einzelne Datei fürs Editor-Ticket).
// Diesen für den Anlege-Ort zweckzuentfremden wäre eine Annahme, die nicht
// trägt. Die Kopfzeile ist eine Aktion auf dem ganzen Panel — die Wurzel ist
// dazu die ehrliche Antwort.
//
// BLUR VERWIRFT, ER COMMITTET NICHT. Ein Fokuswechsel ist keine Bestätigung:
// wer ins Terminal klickt, hat den halb getippten Namen nicht bestätigen
// wollen, und ein stillschweigend angelegtes `Unbenannt`-Artefakt im Repo
// wäre teurer als ein verlorener Tippversuch, der in zwei Sekunden wiederholt
// ist. Anlegen passiert ausschließlich auf Enter.
function NewEntryRow({
  kind,
  projectPath,
  onDiscard,
  onCreated,
}: {
  kind: DraftKind;
  projectPath: string;
  onDiscard: () => void;
  /** Bekommt den bereinigten Namen, nicht den Rohtext des Feldes — der Aufrufer
   * soll denselben Namen sehen, unter dem die Datei auf der Platte liegt. */
  onCreated: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Fokus per Ref statt `autoFocus`: Letzteres ist als Attribut pauschal
  // verpönt (jsx-a11y), weil es Fokus ungefragt an ein Element reißt, das der
  // Nutzer nicht angefordert hat. Hier hat er ihn angefordert — er hat den
  // Knopf geklickt, dessen einziger Zweck diese Eingabe ist.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Verhindert, dass zweimaliges Enter zwei Anlege-Aufrufe absetzt: der zweite
  // liefe in die Namenskollision des ersten und zeigte einen Fehler für einen
  // Vorgang, der gerade erfolgreich war. Ein Ref und kein State, weil daran
  // nichts hängt, was gerendert wird.
  const pending = useRef(false);

  const commit = async () => {
    const trimmed = name.trim();
    // Leer heißt: der Nutzer hat noch nichts gesagt. Enter tut dann nichts —
    // weder anlegen noch meckern.
    if (trimmed === "") return;
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setError(t("explorer.nameContainsPathError"));
      return;
    }
    if (pending.current) return;
    pending.current = true;
    try {
      await invoke(CREATE_COMMAND[kind], { path: `${projectPath}/${trimmed}` });
    } catch (cause) {
      // Der Rohtext aus Rust, ohne Umformulierung: er benennt den Fall
      // (existiert bereits / Elternordner fehlt) genauer, als eine eigene
      // Ersatzformulierung es könnte. Die Zeile bleibt offen — korrigieren
      // ist hier fast immer die richtige nächste Handlung, nicht neu anfangen.
      setError(typeof cause === "string" ? cause : String(cause));
      pending.current = false;
      return;
    }
    // Bewusst NACH dem try, nicht darin: was der Aufrufer beim Aufräumen tut
    // (Neulesen des Baums, Auswahl setzen), darf nicht als Fehlschlag DES
    // ANLEGENS erscheinen — die Datei liegt an dieser Stelle bereits auf der
    // Platte.
    onCreated(trimmed);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onDiscard();
    }
  };

  return (
    // `shrink-0` seit die Zeile über dem Baumbereich und nicht mehr in ihm
    // steht: als Geschwister des Bereichs, der den ganzen Rest füllt, würde
    // sie sonst zusammengedrückt, sobald das Panel niedrig wird.
    <div className="shrink-0">
      <div
        style={{ paddingLeft: 10 }}
        className="flex h-(--pc-list-rowHeight) w-full items-center gap-1.5 pr-2 text-(length:--pc-chrome-fontSize)"
      >
        {/* Die Lücke, in der bei Ordnerzeilen das Chevron steht — sie hält das
            Icon in derselben Spalte wie in den echten Zeilen darunter. */}
        <span className="w-2.5 shrink-0" />
        {kind === "file" ? <FileIcon /> : <FolderIcon open={false} />}
        <input
          ref={inputRef}
          type="text"
          value={name}
          aria-label={t(`explorer.${DRAFT_PLACEHOLDER_KEY[kind]}`)}
          placeholder={t(`explorer.${DRAFT_PLACEHOLDER_KEY[kind]}`)}
          onChange={(event) => {
            setName(event.target.value);
            // Der Fehler gehört zum abgeschickten Namen, nicht zum Feld: wer
            // tippt, hat ihn bereits beantwortet.
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={onDiscard}
          className={`min-w-0 flex-1 rounded-sm border bg-(--pc-widget-background) px-1 py-px font-(family-name:--pc-terminal-fontFamily) text-(--pc-explorer-foreground) outline-none placeholder:text-(--pc-descriptionForeground) ${
            error === null
              ? "border-(--pc-widget-border) focus:border-(--pc-focusBorder)"
              : "border-(--pc-icon-red)"
          }`}
        />
      </div>
      {error !== null && (
        // Der Fehlerton liegt auf dem RAHMEN, nicht auf dieser Schrift —
        // dieselbe Aufteilung, mit der `TreeErrorNotice` weiter oben das Rot
        // dem Icon gibt und den Text im vollen Vordergrund lässt:
        // --pc-icon-red verfehlt als Fließtext die 4,5:1 (3,6:1 dark), als
        // Grafikobjekt liegt derselbe Wert mit 3,57:1 dark / 5,49:1 light über
        // den 3:1. Bewusst nur ein Satz und kein Block wie dort: das hier ist
        // eine Korrekturhilfe an einer offenen Eingabe, kein Zustandsbericht
        // über ein fehlgeschlagenes Laden.
        <p
          role="alert"
          // 46px = 10 (Zeileneinzug) + 10 (Chevron-Lücke) + 6 + 14 (Icon) + 6:
          // exakt die linke Kante des Feldes darüber, damit der Satz unter der
          // Eingabe hängt statt unter dem Icon.
          style={{ paddingLeft: 46 }}
          className="pb-1 pr-2 text-(length:--pc-chrome-fontSizeSmall) leading-relaxed text-(--pc-explorer-foreground)"
        >
          {error}
        </p>
      )}
    </div>
  );
}

// Das Eingabefeld der Explorer-Suche. Eigene Komponente allein wegen des
// Fokus: so läuft der Effekt genau einmal, wenn die Zeile entsteht. Der
// Suchtext selbst liegt bewusst NICHT hier, sondern im Panel — dort
// entscheidet er, welcher Baum überhaupt gerendert wird.
//
// BLUR SCHLIESST NICHT — anders als bei `NewEntryRow` weiter oben, und zwar
// notwendigerweise: der nächste Klick nach dem Tippen ist fast immer der auf
// einen gefundenen Treffer, und der nimmt dem Feld den Fokus. Würde Blur die
// Suche verwerfen, wäre der gefilterte Baum genau in dem Moment weg, in dem
// man ihn benutzt. Beendet wird deshalb nur auf ausdrückliche Ansage: Escape
// oder ein zweiter Klick auf den Knopf in der Kopfzeile. (Bei der Anlege-Zeile
// ist es umgekehrt richtig — dort verhindert das Verwerfen ein ungefragt
// angelegtes Artefakt auf der Platte, hier gäbe es nichts zu schützen.)
function TreeFilterRow({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  // Fokus per Ref statt `autoFocus` — dieselbe Begründung wie bei
  // `NewEntryRow`: der Nutzer hat den Fokus angefordert, indem er den Knopf
  // geklickt hat, dessen einziger Zweck diese Eingabe ist.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      // Geometrie der Anlege-Zeile: 10px Einzug, dieselbe 1,5er-Lücke, Glyphe
      // in der Icon-Spalte — die linke Kante des Feldes trifft damit die der
      // Dateinamen darunter. Bewusst OHNE die 10px-Chevron-Lücke: das hier ist
      // keine Baumzeile, sondern eine Aussage über den ganzen Baum.
      style={{ paddingLeft: 10 }}
      className="flex shrink-0 items-center gap-1.5 py-1 pr-2"
    >
      <span
        aria-hidden="true"
        className="flex shrink-0 text-(--pc-descriptionForeground)"
      >
        <SearchIcon />
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        aria-label={t("explorer.filterFilesAria")}
        placeholder={t("explorer.filterFiles")}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onClose();
        }}
        className="min-w-0 flex-1 rounded-sm border border-(--pc-widget-border) bg-(--pc-widget-background) px-1 py-px font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) text-(--pc-explorer-foreground) outline-none placeholder:text-(--pc-descriptionForeground) focus:border-(--pc-focusBorder)"
      />
    </div>
  );
}

// Lupe in der Strichsprache der übrigen Bediensymbole dieser Datei (16er-Box,
// 1.26, currentColor, runde Enden), nicht aus dem Seti-Set: das ist ein
// Dateityp-Satz für den Baum, kein Bediensymbol-Satz. Der Griff setzt exakt am
// Kreisrand an — 7 + 4.75/√2 ≈ 10.36 — statt ihn zu überlappen: zwei
// Konturen an derselben Stelle verschmieren bei 14px zu einem Fleck, derselbe
// Grund, aus dem das Plus der „Neu…"-Glyphen ausgespart und nicht überlagert
// ist.
function SearchIcon() {
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
    >
      <circle cx="7" cy="7" r="4.75" />
      <path d="m10.4 10.4 3.1 3.1" />
    </svg>
  );
}

// Blatt mit umgeschlagener Ecke, unten rechts von einem Plus ausgespart — in
// der Strichsprache der übrigen Kopfzeilen-Glyphen (16er-Box, 1.26, currentColor,
// runde Enden), nicht aus dem Seti-Set: das ist ein Dateityp-Satz für den Baum,
// kein Bediensymbol-Satz. Die Aussparung statt einer Überlagerung ist der
// Grund, warum das bei 14px noch lesbar bleibt: zwei gekreuzte Konturen an
// derselben Stelle verschmieren dort zu einem Fleck. Das Plus sitzt in beiden
// Glyphen auf exakt denselben Koordinaten, damit die Reihe „Neu…" als eine
// Familie liest und nur das Grundzeichen wechselt.
//
// Die Ecke ist mit 3,75 Einheiten Schenkellänge bewusst größer als der erste
// Entwurf (2,75): gerastert gegengehalten fiel das Dreieck dort bei 1,26
// Strichstärke zu einem Splitter zusammen. 3,75 lässt bei 14px rund 1,4px
// freie Fläche darin stehen — dieselbe Größenordnung wie die Lücke im Bogen
// des RefreshIcon nebenan.
function NewFileIcon() {
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
    >
      <path d="M7.5 1.75H4.15A1.4 1.4 0 0 0 2.75 3.15v8.7a1.4 1.4 0 0 0 1.4 1.4H7.4" />
      <path d="M7.5 1.75 11.25 5.5V7.5" />
      <path d="M7.4 1.9v2.75a.9.9 0 0 0 .9.9h2.75" />
      <path d="M12 10v4" />
      <path d="M10 12h4" />
    </svg>
  );
}

// Ordner mit Reiter, unten rechts genauso ausgespart wie das Blatt — gleiche
// Grundlinie (13.25), gleicher Abriss (x 7.4), identisches Plus.
function NewFolderIcon() {
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
    >
      <path d="M11.25 7.5V6.15A1.4 1.4 0 0 0 9.85 4.75H6.6L5.25 3.15H3.15A1.4 1.4 0 0 0 1.75 4.55v7.3a1.4 1.4 0 0 0 1.4 1.4H7.4" />
      <path d="M12 10v4" />
      <path d="M10 12h4" />
    </svg>
  );
}

// Zeilenhöhe in Pixeln. Sie ist die Voraussetzung dafür, dass sich das
// Sichtfenster ohne Messung ausrechnen lässt, und muss deshalb mit
// --pc-list-rowHeight (theme.css: 1.375rem = 22px) übereinstimmen — die Zeilen
// selbst tragen weiter das Token, nicht diese Zahl. Wird das Token je
// verstellt, gehört diese Konstante mitverstellt; ein Auseinanderlaufen
// verschiebt die Zeilen gegen ihre berechneten Positionen.
//
// Fest und nicht gemessen ist hier richtig: der App-Zoom läuft über Tauris
// nativen Webview-Zoom (s. `useAppZoom`), der CSS-Pixel unangetastet lässt.
const ROW_HEIGHT = 22;

// Zeilen über dem Sichtfenster hinaus, oben wie unten. Bei 22px Zeilenhöhe
// sind das gut zwei Zentimeter Vorrat in jede Richtung — genug, dass schnelles
// Scrollen keine leere Fläche zeigt, und immer noch nichts gegen 5000 Zeilen.
const ROW_OVERSCAN = 10;

/** Eine ausgerollte Baumzeile: der Knoten plus alles, was sich beim
 * Ausrollen ohnehin schon ergeben hat und die Zeile sonst neu herleiten
 * müsste. */
interface FlatRow {
  node: TreeNode;
  /** Projekt-relativer Pfad in der Konvention des ganzen Explorers (Tiefe 0:
   * der bloße Name, darunter `${eltern}/${name}`) — dieselben Schlüssel, unter
   * denen `expanded`, `gitDecorations` und `selectedFile` geführt werden.
   * Ausnahme: die synthetische Lade-Zeile (`isLoadingPlaceholder`) trägt
   * keinen echten Baumpfad, nur einen für React/den Virtualizer eindeutigen
   * Schlüssel — sie steht für keinen tatsächlichen Eintrag. */
  path: string;
  depth: number;
  isFolder: boolean;
  isOpen: boolean;
  /** Ast-Geometrie für die Ebenen 0 … depth-2 (die eigene Ebene depth-1 trägt
   * `isLast`): `true`, wenn der Vorfahr dieser Ebene noch Geschwister UNTER
   * sich hat — nur dann läuft dort eine durchgehende Vertikale weiter. Beim
   * letzten Kind endet der Ast, und alles darunter bliebe eine Linie ins
   * Leere. Beim Ausrollen mitberechnet statt pro Zeile hergeleitet: die Zeile
   * selbst kennt ihre Geschwister nicht mehr. */
  ancestorGuides: readonly boolean[];
  /** Letztes Kind seiner Ebene → der eigene Konnektor ist ein └ (Vertikale
   * endet auf halber Zeilenhöhe) statt eines ├. */
  isLast: boolean;
  /** Steht für einen Ordner, der offen ist, dessen Kinder aber noch nicht aus
   * `explorer_read_dir` zurück sind (`node.children === undefined`) — die
   * einzige Zeile, die `TreeRow` nicht als echten Eintrag rendert. */
  isLoadingPlaceholder?: boolean;
  /** Nur bei einer Inhaltstreffer-Zeile gesetzt (Ticket 26,
   * `searchTree.ts`s `matches` an einem Datei-Knoten) — eine Zeile pro
   * Zeilentreffer, als Kind der Datei-Zeile eingerollt. `path` trägt hier
   * einen synthetischen, pro Treffer eindeutigen Schlüssel (dieselbe
   * Konvention wie bei der Lade-Zeile oben), `filePath` den echten
   * Baumpfad der Datei, zu der der Treffer gehört. */
  match?: ContentMatch;
  filePath?: string;
}

/** Rollt den Baum zu der Zeilenfolge aus, die gerade sichtbar ist: ein
 * eingeklappter Ordner steht drin, seine Kinder nicht. Genau die Reihenfolge,
 * die der frühere rekursive Aufbau im DOM erzeugt hat — sie ist jetzt nur
 * abzählbar, damit sich ein Sichtfenster darauf beziehen kann.
 *
 * `forceOpen` ist der Suchfall: während gefiltert wird, muss JEDER gezeigte
 * Ordner offen sein, sonst bliebe unsichtbar, was die Suche gerade gefunden
 * hat. Es überstimmt `expanded`, ohne es anzufassen — der handgeklappte
 * Zustand kommt beim Schließen der Suche unverändert zurück. */
function flattenTree(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
  forceOpen: boolean,
): FlatRow[] {
  const rows: FlatRow[] = [];

  const walk = (
    level: readonly TreeNode[],
    parentPath: string,
    depth: number,
    ancestorGuides: readonly boolean[],
  ) => {
    level.forEach((node, index) => {
      const path = parentPath === "" ? node.name : `${parentPath}/${node.name}`;
      const isFolder = node.isDirectory;
      const isOpen = isFolder && (forceOpen || expanded.has(path));
      const isLast = index === level.length - 1;
      rows.push({ node, path, depth, isFolder, isOpen, ancestorGuides, isLast });
      if (!isOpen) {
        // Inhaltstreffer einer Datei rollen als eigene Kindzeilen ein — auch
        // wenn `isOpen` bei einer Datei nie zutrifft (`isFolder` ist hier
        // `false`), genau wie die Lade-Zeile unten braucht das dieselbe
        // Astlagen-Vererbung, sonst hinge die Vertikale in der Luft.
        if (node.matches !== undefined && node.matches.length > 0) {
          const childAncestorGuides = [...ancestorGuides, !isLast];
          const matches = node.matches;
          matches.forEach((match, matchIndex) => {
            rows.push({
              node,
              path: `${path}//match/${String(matchIndex)}`,
              filePath: path,
              depth: depth + 1,
              isFolder: false,
              isOpen: false,
              ancestorGuides: childAncestorGuides,
              isLast: matchIndex === matches.length - 1,
              match,
            });
          });
        }
        return;
      }
      // Die Kinder erben die Astlage aller Ebenen darüber plus die dieser
      // Zeile: läuft hier unten noch ein Geschwister nach, führt die
      // Vertikale durch den ganzen Teilbaum — sonst endet sie mit dieser
      // Zeile. Dasselbe Array wird pro Ebene GETEILT (kein Kopieren pro
      // Zeile): erzeugt wird es genau einmal pro aufgeklapptem Ordner.
      const childAncestorGuides = [...ancestorGuides, !isLast];
      if (node.children === undefined) {
        // Offen, aber noch unbeladen (`explorer_read_dir` ist unterwegs, s.
        // `toggleFolder`) — eine einzelne synthetische Zeile statt echter
        // Kinder, die es noch gar nicht gibt.
        rows.push({
          node,
          // "//" statt eines echten Pfadsegments: eine leere Segmentfolge
          // kann kein tatsächlicher Baumpfad sein (kein Eintrag heißt ""),
          // der Schlüssel kollidiert also nie mit einer echten Zeile.
          path: `${path}//loading`,
          depth: depth + 1,
          isFolder: false,
          isOpen: false,
          ancestorGuides: childAncestorGuides,
          isLast: true,
          isLoadingPlaceholder: true,
        });
        return;
      }
      walk(node.children, path, depth + 1, childAncestorGuides);
    });
  };

  walk(nodes, "", 0, []);
  return rows;
}

// Die Werkzeugleisten-Knöpfe unterscheiden sich nur in Beschriftung, Glyph
// und Handler. Bis 2026-08-15 (vor Ticket 26) standen sie noch in der
// Namenszeile und trugen dort ein Hover-Reveal (unsichtbar bis der Zeiger im
// Panel stand) gegen die Enge neben dem Projektnamen. Mit der eigenen
// Werkzeugleisten-Zeile entfällt der Grund dafür: ein Reveal-Verhalten würde
// aus der ganzen Zeile bloßen Leerraum machen, solange der Zeiger woanders
// ist — die sechs Knöpfe sind jetzt dauerhaft sichtbar.
//
// Farbe wird hier in JS zu genau EINER Klasse verzweigt statt mehrere
// Kandidaten nebeneinander in die Klassenliste zu schreiben: zwei
// gleichrangige `text-(--…)`-Utilities entscheidet nicht die Reihenfolge im
// JSX, sondern die im erzeugten Stylesheet — das wäre ein Zufallsergebnis.
function HeaderAction({
  label,
  onClick,
  disabled = false,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  /** Sichtbar, aber ausgegraut und folgenlos — für Aktionen, die im aktuellen
   * Zustand des Panels nichts bewirken könnten. */
  disabled?: boolean;
  /** Nur für Knöpfe, die etwas AUFHALTEN statt einmal auszulösen: trägt den
   * Zustand als `aria-pressed` und zeigt ihn per dauerhaftem Hintergrundton,
   * solange er aktiv ist. */
  pressed?: boolean;
  children: ReactNode;
}) {
  const tone = disabled
    ? "text-(--pc-widget-border)"
    : pressed === true
      ? "bg-(--pc-list-hoverBackground) text-(--pc-foreground)"
      : "text-(--pc-descriptionForeground) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground)";

  return (
    <ChromeTooltip label={label} align="end">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={`flex size-6 shrink-0 items-center justify-center rounded-md transition-[color,background-color] ${tone} ${CHROME_FOCUS_RING}`}
      >
        {children}
      </button>
    </ChromeTooltip>
  );
}

// Trennt die drei Werkzeugleisten-Gruppen (Anlegen | Baum | Panel) an ihren
// Gruppengrenzen — dieselbe Trenngrammatik wie `Divider` in `TitleBar.tsx`,
// hier auf `--pc-explorer-border` statt auf den Glas-Ton der Titelleiste
// übertragen, weil dieser Trenner auf der Explorer-Oberfläche sitzt, nicht
// auf der Titelleiste. `aria-hidden`: reines Layout-Signal, kein Inhalt.
function ToolbarDivider() {
  return (
    <span
      aria-hidden="true"
      className="h-3 w-px shrink-0 self-center bg-(--pc-explorer-border)"
    />
  );
}

// Eingeklappter Zustand: schmale Leiste an derselben Stelle, deren Button den
// Explorer wieder einblendet — der Weg zurück bleibt damit immer sichtbar.
export function CollapsedExplorerStrip({ onExpand }: { onExpand: () => void }) {
  const { t } = useTranslation();
  return (
    // pt-1 spiegelt exakt die h-8-Werkzeugleiste des ausgeklappten Explorers
    // (32px - 24px Knopfgröße = 8px, hälftig 4px oben): der Knopf hier steht
    // an derselben Y-Position wie „Explorer ausblenden" ganz rechts in jener
    // Zeile, sonst springt der Zeiger beim Ein- und Ausklappen — und genau
    // dieser Knopf ist das Element, auf dem er dabei stehen bleibt.
    <div className="flex w-8 shrink-0 flex-col items-center border-r border-(--pc-explorer-border) bg-(--pc-explorer-background) pt-1">
      <ChromeTooltip label={t("explorer.showExplorer")} side="right">
        <button
          type="button"
          aria-label={t("explorer.showExplorer")}
          onClick={onExpand}
          className={`flex size-6 items-center justify-center rounded-md text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
        >
          <SidebarIcon />
        </button>
      </ChromeTooltip>
    </div>
  );
}

// Workbench-übliches "Sidebar umschalten"-Glyph: Fensterrahmen mit Seitenleiste.
function SidebarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.26"
      aria-hidden="true"
    >
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M6 2.75v10.5" />
    </svg>
  );
}

// Zwei Chevrons, die auf eine Mittellinie zulaufen — die verbreitete Lesart
// für „zusammenklappen"; die Gegenrichtung hieße aufklappen. Eigene Zeichnung
// in der Strichsprache dieser Datei (16er-Box, 1.26 Strichstärke), nicht aus
// dem Seti-Set: das ist ein Dateityp-Satz, kein Bediensymbol-Satz.
function CollapseAllIcon() {
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
    >
      <path d="M5 3.4 8 6.1l3-2.7" />
      <path d="M3 8h10" />
      <path d="M5 12.6 8 9.9l3 2.7" />
    </svg>
  );
}

// Kreispfeil, offen zwischen 12 und 2 Uhr, Spitze im Uhrzeigersinn in die
// Lücke zeigend — der Bogen ist ein echter 300°-Arc um (8,8) mit r 5, keine
// nachempfundene Kurve, damit er bei 14px nicht eiert.
function RefreshIcon() {
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
    >
      <path d="M11.8 4.8A5 5 0 1 1 7.1 3.1" />
      <path d="M4.5 2.1 7.1 3.1 5 4.9" />
    </svg>
  );
}

// Dritter Zustand des Baumbereichs, neben „Baum" und „leer": das Lesen selbst
// ist fehlgeschlagen. Bewusst NICHT wie der leere Platzhalter gesetzt — ein
// Rechteproblem darf nie wie ein leeres Projekt aussehen. Der Unterschied
// liegt in drei Dingen: rotes Warndreieck, Vorspann im vollen statt im
// gedämpften Vordergrund, und der Rohtext darunter. --pc-icon-red ist ein
// reiner Chrome-Icon-Ton (er färbt hier nebenan schon die Git-Dateiicons) und
// kollidiert deshalb nicht mit der ANSI-Palette echter Terminalausgabe.
//
// Das Rot trägt hier das Icon, nicht die Schrift: gemessen kommt #cc3e44 auf
// --pc-explorer-background (#191a1b) nur auf 3,6:1 und verfehlt damit die
// 4,5:1, die dieses Theme für Normalsatz führt (theme.css). Als Grafikobjekt
// liegt derselbe Wert über dessen 3:1-Grenze. Der Vorspann steht deshalb in
// --pc-explorer-foreground (9,5:1 dark / 15,6:1 light) — das hebt ihn zugleich
// vom bewusst leisen Leer-Platzhalter ab, der im gedämpften Ton bleibt.
//
// Padding/Grundschriftgröße sind die des Platzhalters, damit der Block in
// derselben Textspalte sitzt. Der Rohtext aus Rust steht eine Stufe kleiner
// darunter, in der gedämpften Beschreibungsfarbe: die Aussage führt, das
// technische Detail folgt — dasselbe Verhältnis wie im Rohtextblock des
// About-Fensters. `select-text`, weil ein Fehlertext zum Kopieren da ist,
// `break-words` gegen die langen Pfade darin bei schmalem Explorer.
// Rein anzeigend, ohne Aktion — Wiederholen/Schließen ist nicht Teil davon.
function TreeErrorNotice({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex items-start gap-1.5 px-3 py-1">
      <WarningIcon />
      <div className="min-w-0 flex-1">
        <p className="text-(length:--pc-chrome-fontSize) text-(--pc-explorer-foreground)">
          {t("explorer.treeReadError")}
        </p>
        <p className="mt-0.5 select-text break-words text-(length:--pc-chrome-fontSizeSmall) leading-relaxed text-(--pc-descriptionForeground)">
          {message}
        </p>
      </div>
    </div>
  );
}

// Warndreieck in derselben Strichsprache wie die Datei-/Ordner-Glyphen dieser
// Datei (14px, 16er-Viewbox, 1.2 Strichstärke) — es gab im Chrome noch kein
// Warn-/Fehlerglyph, deshalb hier eines nach genau diesen Maßen statt einer
// fremden Formsprache.
function WarningIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      // mt-px: die 14px-Glyphe gegen die 13px-Zeile daneben auf dieselbe
      // optische Grundlinie ziehen.
      className="mt-px shrink-0 text-(--pc-icon-red)"
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

/** Die Aktionen des Zeilen-Kontextmenüs (Ticket 24) — ein Objekt statt sieben
 * Einzel-Props, aus demselben Grund, aus dem `onStartPathDrag` schon vor
 * dieser Runde durchgereicht wurde: `TreeRow` kennt weder `project.path` noch
 * die Rust-Commands dahinter, jede Funktion hier ist in `ExplorerPanel` schon
 * fertig auf `row` gebunden. */
interface RowMenuHandlers {
  onReveal: (row: FlatRow) => void;
  onOpenInVSCode: (row: FlatRow) => void;
  onStartRename: (row: FlatRow) => void;
  onRequestDelete: (row: FlatRow) => void;
  onCopyPath: (row: FlatRow) => void;
  onCopyRelativePath: (row: FlatRow) => void;
}

interface TreeRowProps {
  row: FlatRow;
  /** Platz der Zeile in der ausgerollten Liste. Steht als `data-row-index` in
   * der Zeile, weil der Pfeiltasten-Fokus sie darüber wiederfindet, sobald sie
   * gemountet ist (s. `moveRowFocus`). */
  index: number;
  /** Abstand der Zeilenoberkante vom Listenanfang in Pixeln — die Zeilen
   * liegen absolut übereinander, nicht im Fluss. */
  offset: number;
  selected: string;
  /** Siehe `ExplorerPanel` — hier nur durchgereicht und pro Zeile verglichen. */
  dirtyFile: string | null;
  /** Fertig aggregierte Git-Deko pro Baumpfad — Ordner tragen hier schon den
   * bedeutendsten Status ihres Unterbaums (`gitDecorationsFromStatuses`), diese
   * Zeile schlägt also nur noch nach. Die Schlüssel sind exakt die Pfade, die
   * `flattenTree` baut (Tiefe 0: der bloße Name, darunter `${eltern}/${name}`),
   * deshalb ohne jede Umrechnung. */
  gitDecorations: GitDecorations;
  onToggleFolder: (row: FlatRow) => void;
  /** `line` (Ticket 26, Inhaltssuche): gesetzt, wenn der Klick von einer
   * Treffer-Zeile kam — springt der Editor zur passenden Stelle, statt nur
   * die Datei zu öffnen. */
  onSelectFile: (path: string, line?: number) => void;
  onStartPathDrag: (
    event: ReactPointerEvent<HTMLElement>,
    rowPath: string,
  ) => void;
  /** Ob GENAU diese Zeile gerade gezogen wird. */
  dragging: boolean;
  onConsumeDragClick: () => boolean;
  onKeyDown: (
    index: number,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => void;
  menu: RowMenuHandlers;
  /** Ob „In VS Code öffnen" überhaupt einen Eintrag bekommt — nur einmal pro brandlint-ok: funktionaler Menüeintrag-Name
   * Panel ermittelt (`vscodeDetection.ts`), hier nur durchgereicht. */
  vscodeInstalled: boolean;
  /** Ob GENAU diese Zeile gerade umbenannt wird — ersetzt dann den Namen
   * durch `RenameField` statt den Klick-/Tasten-Knopf zu rendern. */
  isRenaming: boolean;
  /** Baut die Umbenennung tatsächlich (Tauri-Aufruf liegt in `ExplorerPanel`,
   * die hier gebrauchten absoluten Pfade kennt nur sie). `null` bei Erfolg,
   * sonst der Rust-Fehlertext — dieselbe Vertragsform wie `NewEntryRow`s
   * `onCreated`, nur mit Rückmeldung statt Exception, weil `RenameField` den
   * Fehler selbst anzeigt und offen bleiben muss. */
  onCommitRename: (relPath: string, newRelPath: string) => Promise<string | null>;
  onDiscardRename: () => void;
  /** Ob GENAU diese Zeile gerade das Ziel eines offenen Kontextmenüs ist —
   * die einzige Hervorhebung, die ein rechtsgeklickter ORDNER bekommen kann
   * (`selected` verlangt `!isFolder`, s. u.). */
  isContextTarget: boolean;
  onContextMenuOpenChange: (path: string, open: boolean) => void;
}

// Reine Darstellung einer einzelnen ausgerollten Zeile — seit der
// Virtualisierung rekursiert hier nichts mehr, welche Zeilen es gibt,
// entscheidet `flattenTree`.
function TreeRow({
  row,
  index,
  offset,
  selected,
  dirtyFile,
  gitDecorations,
  onToggleFolder,
  onSelectFile,
  onStartPathDrag,
  dragging,
  onConsumeDragClick,
  onKeyDown,
  menu,
  vscodeInstalled,
  isRenaming,
  onCommitRename,
  onDiscardRename,
  isContextTarget,
  onContextMenuOpenChange,
}: TreeRowProps) {
  const { node, path, depth, isFolder, isOpen, ancestorGuides, isLast } = row;
  const { t } = useTranslation();
  const isSelected = !isFolder && selected === path;
  // Nur Dateien: geöffnet und geändert werden kann im Editor genau eine, und
  // Ordner tragen hier bewusst keine hochgereichte Sammel-Aussage wie bei der
  // Git-Deko — die Datei mit dem ungespeicherten Stand steht in der Fläche
  // daneben ohnehin offen, sie muss nicht auch noch gesucht werden.
  const isDirty = !isFolder && dirtyFile === path;
  const decoration = gitDecorations.get(path);
  // Die ausgewählte Zeile setzt die Deko-FARBE aus, behält aber das Zeichen.
  // Zwei Gründe: die Auswahl bringt mit
  // --pc-list-activeSelectionBackground/-Foreground bereits ein eigenes,
  // stärkeres Farbschema mit, und die Deko-Töne verlieren auf dieser Füllung
  // messbar — der Modified-Ton fällt vom Panelgrund auf die Auswahlfläche von
  // 5,80:1 auf 3,91:1 (dark) bzw. von 5,98:1 auf 4,29:1 (light), beide unter
  // die 4,5:1 dieses Themes für Normalsatz. Auch das eigene Tokenpaar von
  // 2026-08-05 ändert daran nichts: es hebt den Panelgrund-Fall über die
  // Grenze, den Auswahl-Fall nicht — die Aussetz-Lösung bleibt.
  // Es geht dabei nichts verloren: ausgewählt werden kann nur eine DATEI
  // (`isSelected` verlangt `!isFolder`), und deren Kürzel M/U trägt die
  // Unterscheidung schon ohne Farbe. Der farblose Punkt, der das nicht könnte,
  // steht nur auf Ordnerzeilen — und die erreichen diesen Zustand nie.
  const decorationColor = isSelected ? undefined : decoration;

  // Die Lade-Zeile eines noch unbeladenen, aber offenen Ordners — statisch,
  // kein rotierendes/pulsierendes Symbol (Direction Contract: kein
  // Kinetik-Text irgendwo im Chrome). Kein Knopf, kein Kontextmenü, kein
  // Ziehgriff: sie steht für keinen tatsächlichen Eintrag, es gibt nichts zu
  // bedienen, solange sie da ist — verschwindet von selbst, sobald
  // `explorer_read_dir` zurück ist und `flattenTree` an ihrer Stelle die
  // echten Kinder ausrollt.
  if (row.isLoadingPlaceholder) {
    return (
      <div
        style={{
          paddingLeft: 10 + depth * 12,
          transform: `translateY(${String(offset)}px)`,
        }}
        className="absolute left-0 top-0 flex h-(--pc-list-rowHeight) w-full items-center gap-1.5 pr-2 font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)"
      >
        <TreeRowGuides ancestorGuides={ancestorGuides} depth={depth} isLast={isLast} />
        <span aria-hidden="true" className="w-2.5 shrink-0" />
        <span className="truncate">{t("common.loading")}</span>
      </div>
    );
  }

  // Eine Inhaltstreffer-Zeile (Ticket 26) — Kind einer Datei-Zeile, kein
  // eigenständiger Baumeintrag: kein Chevron, kein Kontextmenü, kein
  // Ziehgriff, keine Auswahl-/Git-Deko-Logik (die gehört der Datei-Zeile
  // selbst). Ein Klick öffnet die Datei UND springt zur Fundstelle —
  // `row.filePath` trägt dafür den echten Baumpfad, `row.path` ist hier nur
  // der pro Treffer eindeutige React-/Virtualizer-Schlüssel.
  if (row.match) {
    const filePath = row.filePath ?? path;
    const { line, preview } = row.match;
    return (
      <button
        type="button"
        data-row-index={index}
        onClick={() => onSelectFile(filePath, line)}
        onKeyDown={(event) => onKeyDown(index, event)}
        style={{
          paddingLeft: 10 + depth * 12,
          transform: `translateY(${String(offset)}px)`,
        }}
        className="absolute left-0 top-0 flex h-(--pc-list-rowHeight) w-full items-center gap-1.5 pr-2 text-left font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-explorer-foreground) focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--pc-focusBorder)"
      >
        <TreeRowGuides ancestorGuides={ancestorGuides} depth={depth} isLast={isLast} />
        <span className="w-6 shrink-0 text-right text-[10px] leading-none tabular-nums">
          {line}
        </span>
        <span className="truncate">{preview}</span>
      </button>
    );
  }

  // Die umbenannte Zeile ist ein eigener, kleinerer Zweig statt eines
  // Zustands INNERHALB des Knopfs unten: ein `<input>` in einem `<button>`
  // ist ungültiges HTML (Button darf kein weiteres interaktives Element
  // enthalten) — dieselbe Entscheidung, aus der `NewEntryRow` schon ein
  // `<div>` statt eines Knopfs ist. Die Ast-Konnektoren bleiben trotzdem
  // stehen (`TreeRowGuides`, s. u.): eine Zeile, die mitten im Baum umbenannt
  // wird, soll nicht kurz aus ihrer Einrückung herausfallen.
  if (isRenaming) {
    return (
      <div
        style={{
          paddingLeft: 10 + depth * 12,
          transform: `translateY(${String(offset)}px)`,
        }}
        className="absolute left-0 top-0 flex h-(--pc-list-rowHeight) w-full items-center gap-1.5 pr-2 text-(length:--pc-chrome-fontSize)"
      >
        <TreeRowGuides ancestorGuides={ancestorGuides} depth={depth} isLast={isLast} />
        {isFolder ? (
          <Chevron open={isOpen} />
        ) : (
          <span aria-hidden="true" className="w-2.5 shrink-0" />
        )}
        {isFolder ? <FolderIcon open={isOpen} /> : <FileIcon kind={node.kind} />}
        <RenameField
          name={node.name}
          isFolder={isFolder}
          relPath={path}
          depth={depth}
          onDiscard={onDiscardRename}
          onCommit={onCommitRename}
        />
      </div>
    );
  }

  return (
    <ContextMenu.Root
      onOpenChange={(open) => onContextMenuOpenChange(path, open)}
    >
      <ContextMenu.Trigger asChild>
        <button
          type="button"
          data-row-index={index}
          onClick={() => {
            // Ein Klick, der nur das Ende eines Ziehens ist, tut hier nichts.
            // Ohne diese Klammer öffnete jeder erfolgreiche Drop die gezogene
            // Datei nebenbei auch noch im Editor — das Pointer-Capture führt den
            // Klick zur Zeile zurück, auch wenn über einer Pane losgelassen wurde
            // (`useExplorerPathDrag.ts`).
            if (onConsumeDragClick()) return;
            if (isFolder) onToggleFolder(row);
            else onSelectFile(path);
          }}
          onPointerDown={(event) => onStartPathDrag(event, path)}
          onKeyDown={(event) => onKeyDown(index, event)}
      // Absolut statt im Fluss: die Zeile sitzt auf ihrem ausgerechneten Platz
      // im Platzhalter voller Höhe. `translateY` und nicht `top`, weil es die
      // Zeile beim Scrollen ohne Layout-Durchgang verschiebt. Die
      // Einrückungs-Linien weiter unten hängen daran, dass DIESES Element
      // absolut positioniert ist — sie beziehen sich auf die Zeile selbst.
      style={{
        paddingLeft: 10 + depth * 12,
        transform: `translateY(${String(offset)}px)`,
      }}
      // Fokusring hier INNEN (negativer Offset) statt über CHROME_FOCUS_RING:
      // die Zeile geht randlos über die ganze Panelbreite, ein nach außen
      // versetzter Ring würde vom scrollenden Container beschnitten. Das ist
      // auch die eigene Lösung des Referenz-Editors für Listenzeilen.
      // Die gezogene Zeile senkt sich ab, statt zu verschwinden: sie ist der
      // Herkunftsort des Vorgangs und muss ihn überdauern — was gezogen wird,
      // steht schon auf der Zeigerplakette. Nur Deckkraft, keine
      // Farbe/Rahmenänderung, damit die Zeile ihre eigenen Zustände (Auswahl,
      // Git-Deko) sichtbar behält. Ohne `transition-*`: ein Zustandswechsel
      // schaltet hart (Direction Contract), Bewegung entsteht in diesem
      // Vorgang aus dem Zeiger, nicht aus Easing.
      className={`absolute left-0 top-0 flex h-(--pc-list-rowHeight) w-full items-center gap-1.5 pr-2 text-left font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSize) focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--pc-focusBorder) ${
        dragging ? "opacity-40" : ""
      } ${
        isSelected
          ? "bg-(--pc-list-activeSelectionBackground) text-(--pc-list-activeSelectionForeground)"
          : isContextTarget
            ? "bg-(--pc-list-hoverBackground) text-(--pc-explorer-foreground)"
            : "text-(--pc-explorer-foreground) hover:bg-(--pc-list-hoverBackground)"
      }`}
    >
      <TreeRowGuides ancestorGuides={ancestorGuides} depth={depth} isLast={isLast} />
      {isFolder ? (
        <Chevron open={isOpen} />
      ) : (
        // Die Chevron-Spalte der Dateizeile trägt den ❯-Marker der
        // ausgewählten Datei — dieselbe HUD-Grammatik wie im Kopf der
        // fokussierten Pane (TerminalPane.tsx): ❯ heißt „hier bist du".
        // Im Vordergrundton der Auswahl, nicht im Akzent — der Akzent
        // gehört dem Pane-Fokus, die Dateiauswahl ist ein leiserer Zustand.
        <span
          aria-hidden="true"
          className="w-2.5 shrink-0 text-center text-[11px] leading-none"
        >
          {isSelected ? "❯" : ""}
        </span>
      )}
      {isFolder ? <FolderIcon open={isOpen} /> : <FileIcon kind={node.kind} />}
      <span
        className={
          decorationColor === undefined
            ? "truncate"
            : `truncate ${GIT_TEXT_COLOR[decorationColor]}`
        }
      >
        {node.name}
      </span>
      {isDirty && <DirtyMark />}
      {decoration !== undefined && (
        <GitDecorationMark
          status={decoration}
          isFolder={isFolder}
          colored={decorationColor !== undefined}
        />
      )}
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        {/* Textmenü ohne Icons, exakt das Vorbild aus TerminalPane.tsx
            (Ticket 24 nennt es ausdrücklich) — nicht das Icon+Label-Muster
            der Kopfzeile daneben. „Löschen" bekommt keine eigene Rottönung:
            --pc-icon-red hält als Fließtext nicht die 4,5:1 (nur als
            Grafikobjekt 3:1, s. `ConfirmDialog.tsx`s `WarningIcon`-Kommentar),
            und ein Text-only-Menü hat kein Icon, an dem das Rot hängen
            könnte. */}
        <ContextMenu.Content className={`min-w-48 ${CHROME_MENU_CONTENT_CLASS}`}>
          <ContextMenu.Item
            onSelect={() => menu.onReveal(row)}
            className={CHROME_MENU_ITEM_CLASS}
          >
            {t(
              isMacPlatform()
                ? "explorer.contextMenu.revealInFinder"
                : "explorer.contextMenu.revealInExplorer",
            )}
          </ContextMenu.Item>
          {vscodeInstalled && (
            <ContextMenu.Item
              onSelect={() => menu.onOpenInVSCode(row)}
              className={CHROME_MENU_ITEM_CLASS}
            >
              {t("explorer.contextMenu.openInVSCode")}
            </ContextMenu.Item>
          )}
          <ContextMenu.Separator className={CHROME_MENU_SEPARATOR_CLASS} />
          <ContextMenu.Item
            onSelect={() => menu.onStartRename(row)}
            className={CHROME_MENU_ITEM_CLASS}
          >
            {t("explorer.contextMenu.rename")}
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={() => menu.onRequestDelete(row)}
            className={CHROME_MENU_ITEM_CLASS}
          >
            {t("explorer.contextMenu.delete")}
          </ContextMenu.Item>
          <ContextMenu.Separator className={CHROME_MENU_SEPARATOR_CLASS} />
          <ContextMenu.Item
            onSelect={() => menu.onCopyPath(row)}
            className={CHROME_MENU_ITEM_CLASS}
          >
            {t("explorer.contextMenu.copyPath")}
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={() => menu.onCopyRelativePath(row)}
            className={CHROME_MENU_ITEM_CLASS}
          >
            {t("explorer.contextMenu.copyRelativePath")}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// Dieselben drei Hairline-Bausteine wie zuvor inline in `TreeRow` — jetzt
// eigene Komponente, weil `RenameField`-Zweig (s. o.) sie unverändert
// mitbraucht: eine umbenannte Zeile soll nicht kurz aus ihrer Einrückung
// herausfallen. Ast-Konnektoren in ├/└-Geometrie (TUI-Direktive 2026-08-13) —
// als 1px-Hairlines GEZEICHNET statt als Box-Drawing-Glyphen gesetzt: Zeichen
// müssten die 22px-Zeilenbox exakt füllen, um lückenlos zu stapeln, Hairlines
// stapeln von selbst lückenlos und bleiben auf jeder Zoomstufe scharf. Drei
// Bausteine pro Zeile:
// 1. Durchlauf-Vertikalen der Vorfahren-Ebenen — nur wo der Ast dort
//    wirklich weiterläuft (`ancestorGuides`, sonst Linie ins Leere).
// 2. Die eigene Vertikale auf Ebene depth-1: voll (├) oder bis zur
//    Zeilenmitte (└, `isLast`) — 11.5px, damit sie die Horizontale
//    (10.5–11.5) gerade einschließt statt 0.5px vor ihr zu enden.
// 3. Der 6px-Stichel zur Zeile, mittig bei calc(50% - 0.5px): auf Retina ein
//    ganzer Gerätepixel, exakt auf der optischen Mitte der 22px-Zeile.
//
// x = 15 + Ebene * 12 trifft die Mitte des Chevrons des jeweiligen
// Elternordners (dessen paddingLeft 10 + 12 pro Ebene, Chevron 10 breit); der
// Stichel endet 1px vor der Inhaltskante (10 + Tiefe*12).
//
// Farbe ist --pc-widget-border, nicht --pc-explorer-border: theme.css hält
// fest, dass Letzterer im Light-Theme fast verschwindet, sobald unter ihm
// nicht die erwartete Nachbarfläche liegt. Genau dieser Fall ist hier — die
// Linie steht auf dem Panelgrund selbst.
function TreeRowGuides({
  ancestorGuides,
  depth,
  isLast,
}: {
  ancestorGuides: readonly boolean[];
  depth: number;
  isLast: boolean;
}) {
  return (
    <>
      {ancestorGuides.map((continues, level) =>
        continues ? (
          <span
            key={level}
            aria-hidden="true"
            style={{ left: 15 + level * 12 }}
            className="pointer-events-none absolute inset-y-0 w-px bg-(--pc-widget-border)"
          />
        ) : null,
      )}
      {depth > 0 && (
        <>
          <span
            aria-hidden="true"
            style={{ left: 15 + (depth - 1) * 12 }}
            className={`pointer-events-none absolute top-0 w-px bg-(--pc-widget-border) ${
              isLast ? "h-[11.5px]" : "bottom-0"
            }`}
          />
          <span
            aria-hidden="true"
            style={{ left: 15 + (depth - 1) * 12, width: 6, top: "calc(50% - 0.5px)" }}
            className="pointer-events-none absolute h-px bg-(--pc-widget-border)"
          />
        </>
      )}
    </>
  );
}

// Ersetzt den Namen einer bestehenden Zeile durch ein Eingabefeld — dieselben
// Regeln wie `NewEntryRow`s Feld weiter unten (BLUR VERWIRFT, ER COMMITTET
// NICHT; Enter committet, Escape verwirft, der Rust-Fehlertext bleibt
// unübersetzt stehen), nur ohne dessen Icon-Lücke davor: die steht hier schon
// in der Zeile selbst (`TreeRow`s isRenaming-Zweig).
//
// Vorselektiert ist bei Dateien NUR der Basisname, nicht die Endung (VS-Code- brandlint-ok: funktionaler Verweis auf reales Editor-Verhalten
// Konvention, vom Nutzer für dieses Ticket ausdrücklich gewünscht) — wer
// umbenennt, ändert fast immer den Namen, nicht den Dateityp, und ein
// versehentlicher erster Tastendruck soll die Endung nicht mitlöschen. Ordner
// und Punktdateien (".env") haben keine Endung in diesem Sinn, dort ist der
// GANZE Name vorselektiert.
function RenameField({
  name,
  isFolder,
  relPath,
  depth,
  onDiscard,
  onCommit,
}: {
  name: string;
  isFolder: boolean;
  /** Projekt-relativer Pfad des umzubenennenden Eintrags — dieselbe
   * Konvention wie überall im Baum. */
  relPath: string;
  /** Nur für die Positionierung der Fehlermeldung (s. u.) gebraucht. */
  depth: number;
  onDiscard: () => void;
  onCommit: (relPath: string, newRelPath: string) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Verhindert einen zweiten Commit-Versuch, während der erste noch auf die
  // Antwort des Backends wartet — dasselbe Muster wie `NewEntryRow`s `pending`.
  const pending = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const dot = name.lastIndexOf(".");
    const selectionEnd = isFolder || dot <= 0 ? name.length : dot;
    input.setSelectionRange(0, selectionEnd);
    // Nur beim Einhängen — danach darf der Nutzer frei innerhalb des Felds
    // markieren, ohne dass ein erneuter Lauf das rückgängig macht.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = async () => {
    const trimmed = value.trim();
    // Leer oder unverändert: nichts zu tun, kein Fehler — derselbe stille
    // Ausstieg wie ein Blur.
    if (trimmed === "" || trimmed === name) {
      onDiscard();
      return;
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setError(t("explorer.nameContainsPathError"));
      return;
    }
    if (pending.current) return;
    pending.current = true;
    const parent = relPath.includes("/")
      ? relPath.slice(0, relPath.lastIndexOf("/"))
      : "";
    const newRelPath = parent === "" ? trimmed : `${parent}/${trimmed}`;
    const failure = await onCommit(relPath, newRelPath);
    if (failure !== null) {
      setError(failure);
      pending.current = false;
      return;
    }
    // Bei Erfolg tut dieses Feld nichts weiter: `onCommit` hat den
    // Umbenennen-Zustand in `ExplorerPanel` bereits beendet (spiegelbildlich
    // zu `NewEntryRow`s `onCreated`, das ebenfalls erst NACH dem Erfolg läuft).
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onDiscard();
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        aria-label={t("explorer.contextMenu.renameFieldAria", { name })}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={onDiscard}
        className={`w-full min-w-0 rounded-sm border bg-(--pc-widget-background) px-1 py-px font-(family-name:--pc-terminal-fontFamily) text-(--pc-explorer-foreground) outline-none ${
          error === null
            ? "border-(--pc-widget-border) focus:border-(--pc-focusBorder)"
            : "border-(--pc-icon-red)"
        }`}
      />
      {error !== null && (
        // Schwebend statt im Fluss: diese Zeile steht absolut positioniert
        // zwischen den übrigen (virtualisierten) Baumzeilen — ein Fehlertext
        // IM Fluss würde die feste Zeilenhöhe sprengen und die Zeile darunter
        // überlagern. Dieselbe Materialsprache wie ein Kontextmenü (Rahmen,
        // Panelgrund, Schatten), eine Ebene darunter (z-20 < z-30).
        <p
          role="alert"
          style={{ left: -(10 + depth * 12) }}
          className="absolute top-full z-20 mt-0.5 max-w-72 rounded-sm border border-(--pc-icon-red) bg-(--pc-explorer-background) px-1.5 py-1 text-(length:--pc-chrome-fontSizeSmall) leading-relaxed text-(--pc-explorer-foreground) shadow-lg"
        >
          {error}
        </p>
      )}
    </div>
  );
}

// Git-Deko in derselben Aufteilung wie im Explorer des Referenz-Editors: die Farbe liegt
// auf dem Dateinamen, das Zeichen am rechten Zeilenrand.
//
// Seit 2026-08-05 hängt sie an einem EIGENEN Tokenpaar
// (--pc-gitDecoration-modifiedResourceForeground/-untrackedResourceForeground,
// Workbench-Kategorie 41, in `docs/agents/editor-theming-research.md` schon
// vorgemerkt) statt an den Seti-Icon-Tönen, an denen sie zuerst hing. Grund
// war der hier gemessene Vorbehalt: --pc-icon-orange/-green tragen als
// Dateiname nur im Dark-Theme (5,80:1 / 8,11:1 auf --pc-explorer-background),
// im Light-Theme fallen sie auf 3,48:1 bzw. 2,51:1 und damit unter die 4,5:1,
// die theme.css für Normalsatz führt. Als bloße Icon-Fläche (3:1) war das nie
// aufgefallen. Das eigene Tokenpaar löst genau das: dark dieselben Werte wie
// bisher, light die eigene dunklere Fassung des Referenz-Editors (5,98:1 / 6,00:1). Die
// Herleitung samt Zahlen steht bei den Tokens in theme.css, nicht hier —
// Farbwerte gehören dorthin.
const GIT_TEXT_COLOR: Record<GitChangeStatus, string> = {
  modified: "text-(--pc-gitDecoration-modifiedResourceForeground)",
  untracked: "text-(--pc-gitDecoration-untrackedResourceForeground)",
};

// Derselbe Tokenwechsel wie oben, und zwar zwingend gemeinsam: Punkt und
// Ordnername stehen in DERSELBEN Zeile: liefen sie auf zwei verschiedene
// Tokens, zeigte eine Ordnerzeile im Light-Theme einen orangen Punkt neben
// einem braunen Namen.
const GIT_DOT_COLOR: Record<GitChangeStatus, string> = {
  modified: "bg-(--pc-gitDecoration-modifiedResourceForeground)",
  untracked: "bg-(--pc-gitDecoration-untrackedResourceForeground)",
};

const GIT_LETTER: Record<GitChangeStatus, string> = {
  modified: "M",
  untracked: "U",
};

// Der Punkt statt eines Buchstabens auf Ordnern ist keine Vereinfachung,
// sondern eine Aussage: ein Ordner kann geänderte UND neue Dateien enthalten,
// ein einzelnes Kürzel würde die eine Hälfte davon unterschlagen. Die Farbe
// zeigt den bedeutendsten Fund, der Punkt sagt „irgendwo hier drunter".
const GIT_SR_LABEL_KEY: Record<
  GitChangeStatus,
  { file: string; folder: string }
> = {
  modified: {
    file: "explorer.gitStatus.modifiedFile",
    folder: "explorer.gitStatus.modifiedFolder",
  },
  untracked: {
    file: "explorer.gitStatus.untrackedFile",
    folder: "explorer.gitStatus.untrackedFolder",
  },
};

// Der Ungespeichert-Punkt der Baumzeile — dieselbe Marke wie in der Kopfzeile
// der Editorfläche (FileEditor.tsx), und dort steht auch die ausführliche
// Begründung. Kurz: `bg-current`, also im Ton der Zeile selbst, damit er nicht
// als dritter Git-Zustand neben „geändert" und „nicht versioniert" gelesen
// wird — und damit er auf der ausgewählten Zeile mit deren eigenem
// Vordergrund mitgeht, statt auf ihrer Füllung zu versacken.
//
// Er steht direkt hinter dem Namen und NICHT am rechten Zeilenrand: dort sitzt
// die Git-Deko, und beide Zeichen sind gleichzeitig möglich (eine geänderte,
// versionierte Datei mit ungespeichertem Puffer). Der Platz am rechten Rand
// gehört dem Repository-Zustand, der Platz am Namen dem Puffer.
function DirtyMark() {
  const { t } = useTranslation();
  return (
    <span className="flex shrink-0 items-center">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      <span className="sr-only">{t("common.unsavedSuffix")}</span>
    </span>
  );
}

// `ml-auto` statt einer festen Spalte im Zeilen-Layout: undekorierte Zeilen —
// der Normalfall — rendern hier gar nichts und behalten damit exakt ihre
// bisherige Geometrie. Die 12px-Breite ist nur innerhalb dieses Elements
// wirksam und stellt M, U und Punkt untereinander in eine Flucht.
// Der sichtbare Teil ist `aria-hidden`: „M" vorgelesen wäre nichts wert, und
// der Punkt trägt gar keinen Text. Stattdessen wandert das Wort in den
// zugänglichen Namen des Zeilen-Buttons („App.tsx geändert") — Farbe allein
// darf die Information nicht tragen.
function GitDecorationMark({
  status,
  isFolder,
  colored,
}: {
  status: GitChangeStatus;
  isFolder: boolean;
  colored: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span className="ml-auto flex w-3 shrink-0 items-center justify-center">
      {isFolder ? (
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${colored ? GIT_DOT_COLOR[status] : "bg-current"}`}
        />
      ) : (
        <span
          aria-hidden="true"
          className={`text-(length:--pc-chrome-fontSizeSmall) font-semibold leading-none${colored ? ` ${GIT_TEXT_COLOR[status]}` : ""}`}
        >
          {GIT_LETTER[status]}
        </span>
      )}
      {/* Das führende Komma ist Absicht, kein Tippfehler: der zugängliche Name
          des Zeilen-Buttons entsteht durch Aneinanderhängen der Textknoten,
          und der Namens-Algorithmus trimmt jeden davon einzeln — ein bloßes
          Leerzeichen davor überlebt das nicht, der Name läse sich als
          „App.tsxgeändert". Das Komma überlebt und ergibt zugleich die
          Sprechpause, die man an dieser Stelle hören will. */}
      <span className="sr-only">
        {`, ${t(isFolder ? GIT_SR_LABEL_KEY[status].folder : GIT_SR_LABEL_KEY[status].file)}`}
      </span>
    </span>
  );
}

// ▸/▾ als Zeichen statt des früheren rotierenden SVG-Winkels (TUI-Direktive
// 2026-08-13). Zwei Gewinne: die gefüllten Dreiecke sind die Klapp-Glyphen
// echter TUIs, und der Wechsel ist ein harter Zeichentausch bei 0ms — exakt
// die Motion-Regel „Zustandswechsel schalten hart", die die 100ms-Rotation
// des SVGs bis dahin als geduldete Ausnahme unterlief. Terminalschrift als
// HUD-Register, 10px in der 22px-Zeile — dieselbe Größe, die das SVG hatte.
function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="w-2.5 shrink-0 text-center font-(family-name:--pc-terminal-fontFamily) text-[10px] leading-none text-(--pc-descriptionForeground)"
    >
      {open ? "▾" : "▸"}
    </span>
  );
}
