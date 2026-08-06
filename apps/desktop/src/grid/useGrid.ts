import { useCallback, useState } from "react";
import {
  INITIAL_GRID_STATE,
  assignProjectToSlot,
  closePane as closePaneInState,
  type GridState,
} from "./gridState";

export interface Grid {
  state: GridState;
  /** Weist `projectPath` dem Slot zu und erzeugt dafür eine frische `paneId`
   * — die einzige Stelle, die das tut (siehe `gridState.ts`s Invariante: eine
   * `paneId` ist unveränderlich für eine (Slot, Projekt)-Zuordnung, eine
   * Neuzuweisung erzeugt immer eine neue). */
  assignProject: (slotIndex: number, projectPath: string) => void;
  closePane: (paneId: string) => void;
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
    setState((current) =>
      assignProjectToSlot(current, slotIndex, projectPath, crypto.randomUUID()),
    );
  }, []);

  const closePane = useCallback((paneId: string) => {
    setState((current) => closePaneInState(current, paneId));
  }, []);

  return { state, assignProject, closePane };
}
