import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DropdownMenu } from "radix-ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";
import { FileIcon, FolderIcon } from "./explorerIcons";
import type { GitChangeStatus, GitDecorations } from "../types/gitStatus";
import type { Project, TreeNode } from "../types/project";
import { filterTree } from "../types/treeFilter";

// Dauerhaft sichtbares, kompaktes Explorer-Panel (Struktur aus Komposition 3):
// nur der Dateibaum, kein Icon-Rail, kein Overlay. Optik an VS Codes Explorer
// angelehnt: Ordner-Chevrons, Einrückungs-Führungslinien, gedämpfter
// Baum-Vordergrund mit hellerer Hervorhebung des aktiven Eintrags. Die
// Datei-Glyphen sind seit 2026-08-05 nicht mehr eine eingefärbte Strichdatei
// pro Typ, sondern das echte Seti-Set, aus dem auch VS Code seine baut —
// Herkunft, Lizenz und Farbzuordnung stehen in `explorerIcons.tsx`. Der
// Akzent-Punkt im Kopf ist das Explorer-Echo der fokussierten Pane.
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
// Der Weg heraus ist der, den VS Code für seine eigenen Listen-/Baum-Widgets
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
  onSelectFile: (path: string) => void;
  onCollapse: () => void;
  /** Liest den Dateibaum dieses Projekts neu von der Platte. Der Lesepfad
   * (`explorer_read_tree`) liegt bei App, nicht hier — der Explorer weiß nur,
   * dass es ihn gibt. */
  onRefresh: () => void;
}) {
  // Jeder Ordnerpfad des Baums — die Bezugsmenge, gegen die sich „eingeklappt"
  // und „aufgeklappt" ineinander umrechnen lassen. Ändert sich nur, wenn der
  // Baum neu von der Platte gelesen wurde.
  const allFolderPaths = useMemo(
    () => collectFolderPaths(project.tree, ""),
    [project.tree],
  );
  // Startzustand: alles eingeklappt, nur die Wurzelkinder sichtbar (2026-08-12
  // Nutzerentscheidung — vorher stand hier ein leeres Set, also ALLES
  // aufgeklappt, was bei größeren Projekten sofort einen Bildschirm voller
  // Zeilen ergab), abzüglich dessen, was die Sitzung als aufgeklappt gemerkt
  // hat. Ein gemerkter Pfad, den es nicht mehr gibt, fällt dabei von allein
  // weg — er kommt in der Differenz gar nicht erst vor.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    const expanded = new Set(initialExpanded ?? []);
    return new Set(
      collectFolderPaths(project.tree, "").filter((path) => !expanded.has(path)),
    );
  });
  // Meldet jede Änderung nach oben — als AUFgeklappte Ordner, siehe Prop-Doku.
  // Auch die erste direkt nach dem Mount: ein Projekt, dessen gemerkte Ordner
  // inzwischen verschwunden sind, soll die bereinigte Menge sofort in
  // `session.json` haben, nicht erst nach dem ersten manuellen Klick.
  useEffect(() => {
    onExpandedChange(allFolderPaths.filter((path) => !collapsed.has(path)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, allFolderPaths]);
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
  // dürfte. Panel-lokal wie `collapsed`/`rootCollapsed` und aus demselben
  // Grund — die Suche gehört zu DIESEM Baum und soll den key-Remount beim
  // Projektwechsel nicht überleben.
  //
  // Gefiltert wird ausschließlich clientseitig über den bereits geladenen
  // Baum (`filterTree`), kein neuer Backend-Aufruf; die globale Suche in der
  // Titelzeile ist eine andere Sache und bleibt davon unberührt.
  const [search, setSearch] = useState<string | null>(null);

  // Ohne lesbaren Baum gibt es nichts zu filtern: dann gilt die Suche als
  // geschlossen, egal was der Zustand sagt (derselbe Fall deaktiviert unten
  // den Knopf). Der getippte Text bleibt dabei erhalten statt weggeworfen zu
  // werden — schlägt ein späteres Aktualisieren an, kommt die Suche zurück,
  // wie sie war.
  const searchQuery = project.treeError === null ? search : null;
  // `null` heißt hier zweierlei — Feld zu ODER Feld leer (das entscheidet
  // `filterTree` selbst) — und beides bedeutet dasselbe: der Baum wird
  // unverändert gezeigt, mit dem normalen Ein-/Ausklapp-Verhalten.
  const filteredTree = useMemo(
    () => (searchQuery === null ? null : filterTree(project.tree, searchQuery)),
    [project.tree, searchQuery],
  );
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

  const toggleFolder = (path: string) => {
    // Während gefiltert wird, ist jeder gezeigte Ordner aufgeklappt — ein
    // Klick könnte das Set also nur unsichtbar verändern und beim Schließen
    // der Suche als überraschend anders geklappter Baum zurückkommen. Deshalb
    // hier folgenlos: der handgeklappte Zustand überlebt die Suche unberührt.
    if (filteredTree !== null) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Ersetzt das Set statt es zu ergänzen: nach „alles einklappen" gibt es
  // keinen offenen Ordner mehr, den ein Altbestand noch offenhalten dürfte.
  //
  // Wirkt anders als ein Chevron-Klick (s. `toggleFolder`) AUCH bei offener
  // Suche, dann eben erst sichtbar, wenn sie wieder zu ist: das hier ist ein
  // ausdrücklicher Befehl auf den ganzen Baum, den der Nutzer selbst erteilt
  // hat. Ein Chevron-Klick wäre dagegen nur die unsichtbare Nebenwirkung
  // eines Klicks, der in dem Moment aussieht, als täte er nichts.
  const collapseAll = () => {
    setCollapsed(new Set(allFolderPaths));
  };

  // Die sichtbare Zeilenfolge des Baums — genau das, was der rekursive Aufbau
  // vorher implizit erzeugt hat, hier nur als Liste ausgeschrieben, damit sich
  // ein Sichtfenster darauf ausrechnen lässt.
  const rows = useMemo(
    () => flattenTree(shownTree, collapsed, filteredTree !== null),
    [shownTree, collapsed, filteredTree],
  );

  return (
    <aside
      style={{ width }}
      className="group/explorer flex shrink-0 flex-col border-r border-(--pc-explorer-border) bg-(--pc-explorer-background)"
    >
      {/* h-10, nicht h-9: der Projektname steht hier direkt neben demselben
          Projektnamen im Pane-Header, und der sitzt 2px tiefer (das Grid
          darunter hat p-2, der Pane-Header ist h-6 — Mitte also bei 8+12=20).
          Mit h-9 lagen die beiden identischen Wörter sichtbar versetzt
          nebeneinander; 40/2 = 20 bringt sie auf dieselbe optische Achse. */}
      {/* pl-0.5 + pl-2 am Knopf = 10px bis zum Chevron, exakt das
          paddingLeft, mit dem die Baumzeilen der Tiefe 0 beginnen: die
          Wurzel-Chevrons und die der obersten Ordner stehen damit in einer
          Spalte, der Projektname eine Einrückungsstufe links vor seinen
          Kindern — dieselbe Staffelung wie in VS Codes Explorer. */}
      <div className="flex h-10 shrink-0 items-center gap-1 pl-0.5 pr-1.5">
        {/* Die Kopfzeile ist zugleich der Wurzelknoten: ein Klick klappt den
            gesamten Baum weg. Bewusst KEINE zusätzliche „Explorer"-Titelzeile
            darüber — der Direction Contract legt genau eine kompakte Kopfzeile
            fest, sie bekommt hier nur das Verhalten dazu. Der zugängliche Name
            des Knopfes ist der Projektname selbst, `aria-expanded` trägt den
            Zustand: das Standardmuster für einen Aufklapp-Abschnitt. */}
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
          <span className="min-w-0 flex-1 truncate text-(length:--pc-chrome-fontSize) font-semibold text-(--pc-explorerHeader-foreground)">
            {project.name}
          </span>
        </button>
        {/* Reihenfolge wie in VS Code, in drei Stufen von innen nach außen:
            zuerst die Aktionen, die etwas IM Baum anlegen, dann die auf dem
            ganzen Baum (Filtern, Aktualisieren, Einklappen), ganz rechts die
            auf dem Panel selbst (Ausblenden). Die Suche steht in der mittleren
            Gruppe, nicht bei den Anlege-Knöpfen: sie legt nichts an, sie
            verändert die Sicht auf den gesamten Baum. */}
        <HeaderAction label="Neue Datei" onClick={() => openDraft("file")}>
          <NewFileIcon />
        </HeaderAction>
        <HeaderAction
          label="Neuer Ordner"
          onClick={() => openDraft("directory")}
        >
          <NewFolderIcon />
        </HeaderAction>
        <HeaderAction
          label="Dateien filtern"
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
        <HeaderAction label="Dateibaum aktualisieren" onClick={onRefresh}>
          <RefreshIcon />
        </HeaderAction>
        {/* "Alle Ordner einklappen" und "Explorer ausblenden" waren bis
            2026-08-12 zwei eigene, dauerhaft reservierte Icon-Plätze in dieser
            Zeile — bei der Standardbreite (224px) blieben dem Projektnamen
            daneben nur rund 8px, er verschwand faktisch hinter den sechs
            Knöpfen. Beide sind die mit Abstand seltensten Aktionen hier
            (Panel-Ebene bzw. — seit der Standard-Einklapp-Änderung oben —
            meist schon erledigt) und wandern deshalb in ein gemeinsames Menü
            statt in zwei feste Plätze. Das gibt dem Namen einen Icon-Platz
            zurück, ohne eine der beiden Funktionen zu verlieren. */}
        <DropdownMenu.Root>
          <ChromeTooltip label="Weitere Aktionen" align="end">
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Weitere Aktionen"
                className={`flex size-6 shrink-0 items-center justify-center rounded-md text-(--pc-descriptionForeground) opacity-0 transition-[opacity,color,background-color] hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) focus-visible:opacity-100 group-hover/explorer:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-(--pc-list-hoverBackground) data-[state=open]:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
              >
                <MoreIcon />
              </button>
            </DropdownMenu.Trigger>
          </ChromeTooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-30 min-w-44 rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) p-1 text-(length:--pc-chrome-fontSize) text-(--pc-foreground) shadow-lg"
            >
              <DropdownMenu.Item
                onSelect={collapseAll}
                className="flex h-7 cursor-default select-none items-center gap-2 rounded px-2 outline-none data-[highlighted]:bg-(--pc-list-hoverBackground)"
              >
                <CollapseAllIcon />
                Alle Ordner einklappen
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={onCollapse}
                className="flex h-7 cursor-default select-none items-center gap-2 rounded px-2 outline-none data-[highlighted]:bg-(--pc-list-hoverBackground)"
              >
                <SidebarIcon />
                Explorer ausblenden
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
                Kein Dateibaum geladen.
              </p>
            </TreeNoticeArea>
          ) : shownTree.length === 0 ? (
            // Vom Leer-Platzhalter darüber bewusst unterscheidbar: eine Suche
            // ohne Treffer darf nie wie ein leeres Projekt aussehen —
            // dieselbe Sorgfalt wie bei `TreeErrorNotice`, hier aber mit einem
            // Satz genug, weil nichts kaputt ist. Zitiert wird der getrimmte
            // Text, also genau der, nach dem `filterTree` tatsächlich gesucht
            // hat.
            <TreeNoticeArea>
              <p className="px-3 py-1 text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)">
                {`Keine Treffer für „${searchQuery?.trim() ?? ""}“.`}
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
            />
          )}
        </>
      )}
    </aside>
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
}: {
  rows: readonly FlatRow[];
  selected: string;
  dirtyFile: string | null;
  gitDecorations: GitDecorations;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
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
              onKeyDown={moveRowFocus}
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

const DRAFT_PLACEHOLDER: Record<DraftKind, string> = {
  file: "Neuer Dateiname",
  directory: "Neuer Ordnername",
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
      setError("Name darf keinen Pfad enthalten.");
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
          aria-label={DRAFT_PLACEHOLDER[kind]}
          placeholder={DRAFT_PLACEHOLDER[kind]}
          onChange={(event) => {
            setName(event.target.value);
            // Der Fehler gehört zum abgeschickten Namen, nicht zum Feld: wer
            // tippt, hat ihn bereits beantwortet.
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={onDiscard}
          className={`min-w-0 flex-1 rounded-sm border bg-(--pc-widget-background) px-1 py-px text-(--pc-explorer-foreground) outline-none placeholder:text-(--pc-descriptionForeground) ${
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
        aria-label="Dateien im Projekt filtern"
        placeholder="Dateien filtern"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onClose();
        }}
        className="min-w-0 flex-1 rounded-sm border border-(--pc-widget-border) bg-(--pc-widget-background) px-1 py-px text-(length:--pc-chrome-fontSize) text-(--pc-explorer-foreground) outline-none placeholder:text-(--pc-descriptionForeground) focus:border-(--pc-focusBorder)"
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
   * denen `collapsed`, `gitDecorations` und `selectedFile` geführt werden. */
  path: string;
  depth: number;
  isFolder: boolean;
  isOpen: boolean;
}

/** Rollt den Baum zu der Zeilenfolge aus, die gerade sichtbar ist: ein
 * eingeklappter Ordner steht drin, seine Kinder nicht. Genau die Reihenfolge,
 * die der frühere rekursive Aufbau im DOM erzeugt hat — sie ist jetzt nur
 * abzählbar, damit sich ein Sichtfenster darauf beziehen kann.
 *
 * `forceOpen` ist der Suchfall: während gefiltert wird, muss JEDER gezeigte
 * Ordner offen sein, sonst bliebe unsichtbar, was die Suche gerade gefunden
 * hat. Es überstimmt `collapsed`, ohne es anzufassen — der handgeklappte
 * Zustand kommt beim Schließen der Suche unverändert zurück. */
function flattenTree(
  nodes: readonly TreeNode[],
  collapsed: ReadonlySet<string>,
  forceOpen: boolean,
): FlatRow[] {
  const rows: FlatRow[] = [];

  const walk = (
    level: readonly TreeNode[],
    parentPath: string,
    depth: number,
  ) => {
    for (const node of level) {
      const path = parentPath === "" ? node.name : `${parentPath}/${node.name}`;
      const isFolder = node.children !== undefined;
      const isOpen = isFolder && (forceOpen || !collapsed.has(path));
      rows.push({ node, path, depth, isFolder, isOpen });
      if (isOpen && node.children) walk(node.children, path, depth + 1);
    }
  };

  walk(nodes, "", 0);
  return rows;
}

// Sammelt JEDEN Ordnerpfad des Baums in genau der Pfad-Konvention, die
// `flattenTree` beim Ausrollen erzeugt (Tiefe 0: der bloße Name, darunter
// `${eltern}/${name}`) — sonst träfe „Alle Ordner einklappen" Pfade, die es
// im `collapsed`-Set gar nicht gibt.
//
// Bewusst ein eigener Gang über den UNGEFILTERTEN `project.tree` statt über
// die ausgerollten Zeilen: einzuklappen ist auch, was gerade gar nicht
// sichtbar ist.
function collectFolderPaths(
  nodes: readonly TreeNode[],
  parentPath: string,
): string[] {
  return nodes.flatMap((node) => {
    if (node.children === undefined) return [];
    const path = parentPath === "" ? node.name : `${parentPath}/${node.name}`;
    return [path, ...collectFolderPaths(node.children, path)];
  });
}

// Die Kopfzeilen-Knöpfe unterscheiden sich nur in Beschriftung, Glyph und
// Handler — ihr Hover-Reveal (unsichtbar bis der Zeiger im Panel steht, aber
// sofort sichtbar sobald der Fokus sie erreicht: sonst wäre die Tastatur hier
// blind) stand vorher einmal wörtlich da und wäre fünffach kopiert worden.
//
// Farbe und Deckkraft werden hier in JS zu genau EINER Klasse verzweigt statt
// mehrere Kandidaten nebeneinander in die Klassenliste zu schreiben: zwei
// gleichrangige Utilities (`opacity-0` neben `opacity-100`, zwei `text-(--…)`)
// entscheidet nicht die Reihenfolge im JSX, sondern die im erzeugten
// Stylesheet — das wäre ein Zufallsergebnis. Die Varianten-Regeln
// (`group-hover/…`, `focus-visible:`) dürfen daneben stehen bleiben, sie haben
// die höhere Spezifität.
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
   * Zustand als `aria-pressed` und hält den Knopf sichtbar, solange er aktiv
   * ist — ein offenes Suchfeld ohne den zugehörigen Knopf daneben (weil der
   * Zeiger das Panel verlassen hat) wäre ein Bedienelement ohne Ausschalter. */
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
        className={`flex size-6 shrink-0 items-center justify-center rounded-md transition-[opacity,color,background-color] focus-visible:opacity-100 group-hover/explorer:opacity-100 ${pressed === true ? "opacity-100" : "opacity-0"} ${tone} ${CHROME_FOCUS_RING}`}
      >
        {children}
      </button>
    </ChromeTooltip>
  );
}

// Eingeklappter Zustand: schmale Leiste an derselben Stelle, deren Button den
// Explorer wieder einblendet — der Weg zurück bleibt damit immer sichtbar.
export function CollapsedExplorerStrip({ onExpand }: { onExpand: () => void }) {
  return (
    // pt-2 spiegelt exakt die h-10-Kopfzeile des ausgeklappten Explorers
    // (40px - 24px Button = 8px oben): sonst springt der Knopf beim Ein- und
    // Ausklappen um 2px, und genau dieser Knopf ist das Element, auf dem der
    // Zeiger dabei stehen bleibt.
    <div className="flex w-8 shrink-0 flex-col items-center border-r border-(--pc-explorer-border) bg-(--pc-explorer-background) pt-2">
      <ChromeTooltip label="Explorer einblenden" side="right">
        <button
          type="button"
          aria-label="Explorer einblenden"
          onClick={onExpand}
          className={`flex size-6 items-center justify-center rounded-md text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
        >
          <SidebarIcon />
        </button>
      </ChromeTooltip>
    </div>
  );
}

// VS-Code-artiges "Sidebar umschalten"-Glyph: Fensterrahmen mit Seitenleiste.
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

// Drei gefüllte Punkte statt der sonst hier üblichen Strichzeichnung — ein
// Kebab-Menü besteht konventionell aus Flächen, nicht aus Linien, dieselbe
// Abweichung wie bei den Git-Punkten in `GitDecorationMark`.
function MoreIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="8" cy="3.4" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="12.6" r="1.3" />
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
  return (
    <div role="alert" className="flex items-start gap-1.5 px-3 py-1">
      <WarningIcon />
      <div className="min-w-0 flex-1">
        <p className="text-(length:--pc-chrome-fontSize) text-(--pc-explorer-foreground)">
          Dateibaum konnte nicht gelesen werden.
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
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
  onKeyDown: (
    index: number,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => void;
}

// Reine Darstellung einer einzelnen ausgerollten Zeile — seit der
// Virtualisierung rekursiert hier nichts mehr, welche Zeilen es gibt,
// entscheidet `flattenTree`.
function TreeRow({
  row: { node, path, depth, isFolder, isOpen },
  index,
  offset,
  selected,
  dirtyFile,
  gitDecorations,
  onToggleFolder,
  onSelectFile,
  onKeyDown,
}: TreeRowProps) {
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

  return (
    <button
      type="button"
      data-row-index={index}
      onClick={() => (isFolder ? onToggleFolder(path) : onSelectFile(path))}
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
      // auch VS Codes eigene Lösung für Listenzeilen.
      className={`absolute left-0 top-0 flex h-(--pc-list-rowHeight) w-full items-center gap-1.5 pr-2 text-left text-(length:--pc-chrome-fontSize) focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--pc-focusBorder) ${
        isSelected
          ? "bg-(--pc-list-activeSelectionBackground) text-(--pc-list-activeSelectionForeground)"
          : "text-(--pc-explorer-foreground) hover:bg-(--pc-list-hoverBackground)"
      }`}
    >
      {/* Einrückungs-Führungslinien: pro übersprungener Ebene eine Haarlinie
            über die volle Zeilenhöhe. Weil die Zeilen lückenlos aufeinander
            folgen, ergeben die Segmente eine durchgehende Linie über den ganzen
            ausgeklappten Teilbaum — dieselbe Bauweise wie in VS Code, und sie
            braucht keinen eigenen Zustand: dass eine Ebene noch offen ist,
            steht schon darin, dass diese Zeile überhaupt gerendert wird.

            x = 15 + Ebene * 12 trifft die Mitte des Chevrons des jeweiligen
            Elternordners (dessen paddingLeft 10 + 12 pro Ebene, Chevron 10
            breit) — die Linie hängt damit sichtbar an ihrem Ordner, nicht
            irgendwo im Einzug.

            Farbe ist --pc-widget-border, nicht --pc-explorer-border: theme.css
            hält fest, dass Letzterer im Light-Theme fast verschwindet, sobald
            unter ihm nicht die erwartete Nachbarfläche liegt. Genau dieser Fall
            ist hier — die Linie steht auf dem Panelgrund selbst. */}
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden="true"
          style={{ left: 15 + level * 12 }}
          className="pointer-events-none absolute inset-y-0 w-px bg-(--pc-widget-border)"
        />
      ))}
      {isFolder ? (
        <Chevron open={isOpen} />
      ) : (
        <span className="w-2.5 shrink-0" />
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
  );
}

// Git-Deko in derselben Aufteilung wie in VS Codes Explorer: die Farbe liegt
// auf dem Dateinamen, das Zeichen am rechten Zeilenrand.
//
// Seit 2026-08-05 hängt sie an einem EIGENEN Tokenpaar
// (--pc-gitDecoration-modifiedResourceForeground/-untrackedResourceForeground,
// VS Codes Kategorie 41, in `docs/agents/vscode-theming-research.md` schon
// vorgemerkt) statt an den Seti-Icon-Tönen, an denen sie zuerst hing. Grund
// war der hier gemessene Vorbehalt: --pc-icon-orange/-green tragen als
// Dateiname nur im Dark-Theme (5,80:1 / 8,11:1 auf --pc-explorer-background),
// im Light-Theme fallen sie auf 3,48:1 bzw. 2,51:1 und damit unter die 4,5:1,
// die theme.css für Normalsatz führt. Als bloße Icon-Fläche (3:1) war das nie
// aufgefallen. Das eigene Tokenpaar löst genau das: dark dieselben Werte wie
// bisher, light VS Codes eigene dunklere Fassung (5,98:1 / 6,00:1). Die
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
const GIT_SR_LABEL: Record<GitChangeStatus, { file: string; folder: string }> =
  {
    modified: { file: "geändert", folder: "enthält geänderte Dateien" },
    untracked: {
      file: "nicht versioniert",
      folder: "enthält nicht versionierte Dateien",
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
  return (
    <span className="flex shrink-0 items-center">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      <span className="sr-only">, ungespeichert</span>
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
        {`, ${isFolder ? GIT_SR_LABEL[status].folder : GIT_SR_LABEL[status].file}`}
      </span>
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={`shrink-0 text-(--pc-descriptionForeground) transition-transform duration-100 ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M3.5 1.8 6.7 5 3.5 8.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
