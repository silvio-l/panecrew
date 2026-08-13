import { useCallback, useState } from "react";
import {
  INITIAL_GRID_STATE,
  assignProjectToSlot,
  closePane as closePaneInState,
  closeTerminalTab as closeTerminalTabInState,
  enterFocusMode as enterFocusModeInState,
  exitFocusMode as exitFocusModeInState,
  focusModeSelectSlot as focusModeSelectSlotInState,
  focusPane as focusPaneInState,
  openTerminalTab as openTerminalTabInState,
  switchTemplate as switchTemplateInState,
  switchToFileTab as switchToFileTabInState,
  switchToTerminalTab as switchToTerminalTabInState,
  type GridState,
  type TemplateId,
} from "./gridState";

export interface Grid {
  state: GridState;
  /** Weist `projectPath` dem Slot zu und erzeugt dafür eine frische `paneId`
   * samt dem `tabId` ihres ersten Terminal-Tabs — die einzige Stelle, die das
   * tut (siehe `gridState.ts`s Invariante: eine `paneId` ist unveränderlich
   * für eine (Slot, Projekt)-Zuordnung, eine Neuzuweisung erzeugt immer eine
   * neue). Gibt beide synchron zurück (sie entstehen hier, nicht erst im
   * nächsten Render) — die Sitzungs-Wiederherstellung (Ticket 06, seit
   * Ticket 18 auch für weitere Terminal-Tabs) braucht sie sofort. */
  assignProject: (
    slotIndex: number,
    projectPath: string,
  ) => { paneId: string; tabId: string };
  closePane: (paneId: string) => void;
  /** Der Zustandsübergang hinter "Klick in eine Pane setzt den Fokus" —
   * ruft `usePtyTerminal`s eigenen `focus()` (DOM-Fokus für xterm.js) nicht
   * ab, das bleibt Sache des Aufrufers; hier wird nur `focusedPaneId`
   * geschrieben, wovon Fokus-Ring und Explorer-Pfad abhängen. */
  focusPane: (paneId: string) => void;
  /** No-Op (identische `state`-Referenz), wenn `templateSwitchBlockReason`
   * für `target` nicht `null` ist — die Steuerung entscheidet daran selbst,
   * ob sie den Aufruf überhaupt zulässt, hier wird nur noch ausgeführt. */
  switchTemplate: (target: TemplateId) => void;
  /** Öffnet einen weiteren Terminal-Tab in der Pane und erzeugt dafür eine
   * frische `tabId` — dieselbe Erzeugungs-Verantwortung wie `assignProject`
   * (Kopfkommentar). Gibt sie synchron zurück, aus demselben Grund. */
  openTerminalTab: (paneId: string) => string;
  closeTerminalTab: (paneId: string, tabId: string) => void;
  switchToTerminalTab: (paneId: string, tabId: string) => void;
  switchToFileTab: (paneId: string) => void;
  /** Versetzt eine Pane in den Fokus-Modus (Ticket 19) — sie nimmt das
   * gesamte Grid ein, die übrigen Panes laufen unsichtbar im Hintergrund
   * weiter. */
  enterFocusMode: (paneId: string) => void;
  /** Verlässt den Fokus-Modus, No-Op wenn er nicht aktiv ist. */
  exitFocusMode: () => void;
  /** Wechselt im Fokus-Modus direkt zur Pane in `slotIndex` des aktuellen
   * Templates — der Zustandsübergang hinter den Zahlen-Hotkeys 1–4. */
  focusModeSelectSlot: (slotIndex: number) => void;
}

/**
 * Dünner React-Wrapper um `gridState.ts`, im Stil von `useFileEditor.ts`:
 * hält den reinen State per `useState`, die einzige Aufgabe hier ist die
 * `paneId`-Erzeugung (bewusst außerhalb des reinen Moduls, siehe dessen
 * Kopfkommentar).
 */
export function useGrid(): Grid {
  const [state, setState] = useState<GridState>(INITIAL_GRID_STATE);

  // Referenzstabil (leere Dep-Arrays, beide schließen nur über `setState`s
  // Updater-Form): sonst müsste jeder `useEffect`, der `assignProject`/
  // `closePane` aufruft (der CLI-Start in App.tsx), sie in sein Dep-Array
  // aufnehmen und bei jedem Grid-Update erneut feuern.
  const assignProject = useCallback((slotIndex: number, projectPath: string) => {
    const paneId = crypto.randomUUID();
    const tabId = crypto.randomUUID();
    setState((current) =>
      assignProjectToSlot(current, slotIndex, projectPath, paneId, tabId),
    );
    return { paneId, tabId };
  }, []);

  const closePane = useCallback((paneId: string) => {
    setState((current) => closePaneInState(current, paneId));
  }, []);

  const switchTemplate = useCallback((target: TemplateId) => {
    setState((current) => switchTemplateInState(current, target));
  }, []);

  const focusPane = useCallback((paneId: string) => {
    setState((current) => focusPaneInState(current, paneId));
  }, []);

  const openTerminalTab = useCallback((paneId: string) => {
    const tabId = crypto.randomUUID();
    setState((current) => openTerminalTabInState(current, paneId, tabId));
    return tabId;
  }, []);

  const closeTerminalTab = useCallback((paneId: string, tabId: string) => {
    setState((current) => closeTerminalTabInState(current, paneId, tabId));
  }, []);

  const switchToTerminalTab = useCallback((paneId: string, tabId: string) => {
    setState((current) => switchToTerminalTabInState(current, paneId, tabId));
  }, []);

  const switchToFileTab = useCallback((paneId: string) => {
    setState((current) => switchToFileTabInState(current, paneId));
  }, []);

  const enterFocusMode = useCallback((paneId: string) => {
    setState((current) => enterFocusModeInState(current, paneId));
  }, []);

  const exitFocusMode = useCallback(() => {
    setState((current) => exitFocusModeInState(current));
  }, []);

  const focusModeSelectSlot = useCallback((slotIndex: number) => {
    setState((current) => focusModeSelectSlotInState(current, slotIndex));
  }, []);

  return {
    state,
    assignProject,
    closePane,
    switchTemplate,
    focusPane,
    openTerminalTab,
    closeTerminalTab,
    switchToTerminalTab,
    switchToFileTab,
    enterFocusMode,
    exitFocusMode,
    focusModeSelectSlot,
  };
}
