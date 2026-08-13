import { useEffect } from "react";
import { timelineEvents, type Storyboard } from "./storyboard";

export interface StoryboardPlayerHandlers {
  /** Belegt `slot` mit einem simulierten Projekt — dieselbe Form wie
   * `Grid.assignProject` (`grid/useGrid.ts`), synchron, weil Fokus- und
   * Tipp-Events sofort danach über die entstandene `paneId`/`tabId`
   * auflösen müssen. */
  assignPane: (slot: number, projectName: string) => {
    paneId: string;
    tabId: string;
  };
  focusPane: (paneId: string) => void;
  typeInto: (tabId: string, text: string) => void;
}

/**
 * Spielt ein Storyboard automatisiert ab: weist beim Mount jede
 * `storyboard.panes`-Pane synchron zu (keine Zeitachse dafür, s.
 * `storyboard.ts`), plant danach jedes Fokus-/Tipp-Event der Timeline über
 * `setTimeout` relativ zum Mount-Zeitpunkt und räumt beim Unmount jeden noch
 * ausstehenden Timer ab. Rührt bewusst nie die Titelleiste an — die
 * Storyboard-Schema-Typen kennen weder Suchfeld noch Zahnrad, es gibt hier
 * also keinen Code-Pfad, der sie erreichen könnte.
 *
 * `storyboard`/`handlers` werden nur beim ersten Mount gelesen (leeres
 * Dep-Array) — ein Demo-Harness spielt genau ein statisches Storyboard mit
 * referenzstabilen Handlern ab, kein Storyboard-Wechsel zur Laufzeit.
 */
export function useStoryboardPlayer(
  storyboard: Storyboard,
  handlers: StoryboardPlayerHandlers,
): void {
  useEffect(() => {
    const paneOf = new Map<number, { paneId: string; tabId: string }>();
    for (const pane of storyboard.panes) {
      paneOf.set(pane.slot, handlers.assignPane(pane.slot, pane.projectName));
    }

    const timers = timelineEvents(storyboard).map((event) =>
      window.setTimeout(() => {
        const pane = paneOf.get(event.slot);
        if (!pane) return;
        if (event.kind === "focus") handlers.focusPane(pane.paneId);
        else handlers.typeInto(pane.tabId, event.text);
      }, event.atMs),
    );

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- storyboard/handlers gelten für die Lebensdauer des Harness als konstant (Kopfkommentar); ein Storyboard-Wechsel zur Laufzeit ist kein unterstützter Fall.
  }, []);
}
