import { useCallback, useState } from "react";
import {
  INITIAL_GRID_STATE,
  assignProjectToSlot,
  closePane as closePaneInState,
  switchTemplate as switchTemplateInState,
  type GridState,
  type TemplateId,
} from "./gridState";

export interface Grid {
  state: GridState;
  /** Weist `projectPath` dem Slot zu und erzeugt dafür eine frische `paneId`
   * — die einzige Stelle, die das tut (siehe `gridState.ts`s Invariante: eine
   * `paneId` ist unveränderlich für eine (Slot, Projekt)-Zuordnung, eine
   * Neuzuweisung erzeugt immer eine neue). Gibt die erzeugte `paneId`
   * synchron zurück (die ID entsteht hier, nicht erst im nächsten Render) —
   * die Sitzungs-Wiederherstellung (Ticket 06) braucht sie sofort, um die
   * wiederhergestellte Dateiauswahl derselben Pane zuzuordnen. */
  assignProject: (slotIndex: number, projectPath: string) => string;
  closePane: (paneId: string) => void;
  /** No-Op (identische `state`-Referenz), wenn `templateSwitchBlockReason`
   * für `target` nicht `null` ist — die Steuerung entscheidet daran selbst,
   * ob sie den Aufruf überhaupt zulässt, hier wird nur noch ausgeführt. */
  switchTemplate: (target: TemplateId) => void;
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
    setState((current) => assignProjectToSlot(current, slotIndex, projectPath, paneId));
    return paneId;
  }, []);

  const closePane = useCallback((paneId: string) => {
    setState((current) => closePaneInState(current, paneId));
  }, []);

  const switchTemplate = useCallback((target: TemplateId) => {
    setState((current) => switchTemplateInState(current, target));
  }, []);

  return { state, assignProject, closePane, switchTemplate };
}
