import { useCallback, useState } from "react";

/**
 * Stabile Container für die Terminal-Tabs (Ticket 32) — die Mechanik, die
 * einen Tab die Pane wechseln lässt, ohne dass seine PTY stirbt.
 *
 * DAS PROBLEM ist React-Rekonziliation, nicht Zustand: ein `<TerminalPane
 * key={tabId}>`, das von den Kindern einer Zelle zu denen einer anderen
 * wandert, wird unmountet und neu gemountet — Key-Stabilität gilt nur
 * innerhalb DESSELBEN Elternteils. `usePtyTerminal`s Cleanup killt beim
 * Unmount die PTY, ein „Verschieben" wäre also nicht von „schließen und neu
 * öffnen" zu unterscheiden.
 *
 * DIE LÖSUNG: jeder Tab bekommt hier ein einmalig erzeugtes, NICHT von React
 * verwaltetes `<div>`. `PaneGrid.tsx` rendert seine `TerminalPane` per
 * `createPortal` hinein — als flache Liste direkt unter `PaneGrid`, deren
 * React-Elternteil sich nie ändert. Bewegt wird ausschließlich der
 * DOM-Elternteil des Containers (`appendChild` VERSCHIEBT einen bereits
 * eingehängten Knoten, es kopiert ihn nicht), von der Host-Fläche der einen
 * Pane in die der anderen. xterm.js' Canvas/WebGL übersteht das (es ist kein
 * iframe, dessen Inhalt beim Umhängen neu lädt).
 *
 * Bewusst NICHT über `createPortal`s `container`-Argument gelöst: ein Wechsel
 * dieses Arguments ist für React ebenfalls Unmount+Remount — exakt der
 * Fehler, um den es hier geht.
 *
 * ZWEITE HÄLFTE derselben Mechanik, außerhalb dieser Datei: die Portal-Liste
 * in `PaneGrid.tsx` darf ihre Reihenfolge nicht von der Pane-Zugehörigkeit
 * ableiten (`terminalTabSurfaceOrder`, dortiger Kommentar). Ein stabiler
 * React-Elternteil allein genügt nicht — ein Positionswechsel in der
 * Geschwisterliste reicht React schon, um das Kind mit `Placement` zu
 * markieren, und unter StrictMode läuft dafür ein zusätzlicher
 * Effekt-Zyklus, der `usePtyTerminal`s Cleanup (und damit `pty_kill`) auslöst.
 *
 * REIHENFOLGE ist Teil des Vertrags: `syncOwnership` gehört in einen
 * LAYOUT-Effekt. Elternteil-Effekte feuern zwar nach Kind-Effekten, aber alle
 * Layout-Effekte feuern vor allen passiven — nur so hängt der Container schon
 * im Dokument, wenn `usePtyTerminal`s passiver Mount-Effekt `terminal.open()`
 * und `fitAddon.fit()` aufruft. In einem noch nicht eingehängten Container
 * misst der FitAddon 0×0, und der Tab startete mit einer unbrauchbaren
 * Terminalgröße.
 */

/** Wem gehört welcher Tab GERADE — die einzige Eingabe, aus der sich das
 * Umhängen ergibt. */
export interface TabOwnership {
  tabId: string;
  paneId: string;
}

export interface TerminalTabHosts {
  /** Ref-Callback für die eine Host-Fläche einer Pane (`PaneCell` rendert
   * genau ein solches `<div>` und legt selbst nie etwas hinein — React darf
   * die Kinder dieses Knotens nicht verwalten, sie kommen von hier). Pro
   * `paneId` derselbe Callback, sonst meldete React ihn bei jedem Render ab
   * und wieder an. */
  hostRef: (paneId: string) => (element: HTMLDivElement | null) => void;
  /** Der stabile Container dieses Tabs, beim ersten Aufruf erzeugt. */
  containerFor: (tabId: string) => HTMLDivElement;
  /** Hängt jeden Container in die Host-Fläche seiner aktuellen Pane und
   * entfernt die Container verschwundener Tabs. Idempotent: was schon am
   * richtigen Platz hängt, wird nicht angefasst (ein überflüssiges
   * `appendChild` wäre ein echtes Entfernen+Einfügen und würde den DOM-Fokus
   * und xterms Messung unnötig stören). */
  syncOwnership: (ownership: readonly TabOwnership[]) => void;
}

export function useTerminalTabHosts(): TerminalTabHosts {
  // `useState`-Initializer statt `useRef`: auf diese Karten wird während des
  // RENDERNS zugegriffen (`containerFor` beim Aufbau der Portale), und genau
  // das wertet die React-Compiler-Regel `react-hooks/refs` an einem `useRef`
  // als verbotenen Ref-Zugriff. Die Karten selbst entstehen einmalig und
  // werden nie ersetzt — es gibt keinen Zustand, dessen Änderung ein Rendern
  // auslösen müsste, nur eine Identität, die über Renders hinweg hält.
  const [hosts] = useState(() => new Map<string, HTMLDivElement>());
  const [containers] = useState(() => new Map<string, HTMLDivElement>());
  const [hostRefs] = useState(
    () => new Map<string, (element: HTMLDivElement | null) => void>(),
  );

  const hostRef = useCallback(
    (paneId: string) => {
      const cached = hostRefs.get(paneId);
      if (cached) return cached;
      const callback = (element: HTMLDivElement | null) => {
        if (element) {
          hosts.set(paneId, element);
          return;
        }
        // Pane geschlossen/Slot geleert: die Host-Fläche ist weg. Die
        // Container ihrer Tabs verschwinden mit ihr aus dem Dokument (sie
        // hingen darin) — `syncOwnership` räumt die Karte gleich mit auf,
        // weil die Tabs dann auch aus der Ownership-Liste fallen.
        hosts.delete(paneId);
        hostRefs.delete(paneId);
      };
      hostRefs.set(paneId, callback);
      return callback;
    },
    [hosts, hostRefs],
  );

  const containerFor = useCallback(
    (tabId: string) => {
      const existing = containers.get(tabId);
      if (existing) return existing;
      const container = document.createElement("div");
      // Die Host-Fläche ist `absolute inset-0`; der Container selbst bleibt
      // ohne eigene Geometrie, seine Terminalfläche legt sich innen wieder
      // per `absolute inset-0` darüber (React-verwaltet, `PaneGrid.tsx`).
      containers.set(tabId, container);
      return container;
    },
    [containers],
  );

  const syncOwnership = useCallback(
    (ownership: readonly TabOwnership[]) => {
      const live = new Set<string>();
      for (const { tabId, paneId } of ownership) {
        live.add(tabId);
        const container = containers.get(tabId);
        const host = hosts.get(paneId);
        if (!container || !host) continue;
        if (container.parentElement === host) continue;
        host.appendChild(container);
      }
      for (const [tabId, container] of containers) {
        if (live.has(tabId)) continue;
        container.remove();
        containers.delete(tabId);
      }
    },
    [containers, hosts],
  );

  return { hostRef, containerFor, syncOwnership };
}
