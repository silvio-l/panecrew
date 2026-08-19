import { useCallback, useEffect, useRef, useState } from "react";
import { defaultAdapterIdFromSetting } from "../terminal/adapters";
import { useSettings } from "../settings/useSettings";
import {
  INITIAL_GRID_STATE,
  assignProjectToSlot,
  closePane as closePaneInState,
  closeTerminalTab as closeTerminalTabInState,
  enterFocusMode as enterFocusModeInState,
  exitFocusMode as exitFocusModeInState,
  focusModeSelectSlot as focusModeSelectSlotInState,
  focusPane as focusPaneInState,
  moveTerminalTab as moveTerminalTabInState,
  moveTerminalTabToEmptySlot as moveTerminalTabToEmptySlotInState,
  movePaneToEmptySlot as movePaneToEmptySlotInState,
  openTerminalTab as openTerminalTabInState,
  renameTerminalTab as renameTerminalTabInState,
  setSplitRatios as setSplitRatiosInState,
  swapPanes as swapPanesInState,
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
  /** `adapterId` (Ticket 35): omitted (`undefined`) resolves the
   * `terminal.defaultAdapter` setting for the pane's first tab — pass an
   * explicit value (a specific adapter id, or `null` for the built-in
   * shell) to override it, the restore path (`App.tsx`s `restoreSlot`) uses
   * this for a persisted tab's saved choice. */
  assignProject: (
    slotIndex: number,
    projectPath: string,
    adapterId?: string | null,
  ) => { paneId: string; tabId: string };
  closePane: (paneId: string) => void;
  /** Tauscht die Slot-Positionen zweier belegter Panes (Ticket 20). Bewusst
   * über `paneId`s statt über Slot-Indizes, obwohl der Reducer indexbasiert
   * arbeitet: der Aufrufer ist ein laufender Zieh-Vorgang, dessen Indizes zum
   * Zeitpunkt des Loslassens veraltet sein könnten (ein Template-Wechsel
   * währenddessen kompaktiert sie). Aufgelöst wird deshalb hier drin, gegen
   * den DANN aktuellen State; unbekannte `paneId`s ergeben -1 und damit den
   * No-Op des Reducers. */
  swapPanes: (sourcePaneId: string, targetPaneId: string) => void;
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
   * (Kopfkommentar). Gibt sie synchron zurück, aus demselben Grund.
   * `adapterId` (Ticket 35): dieselbe omitted-vs-explizit-Semantik wie
   * `assignProject` oben. */
  openTerminalTab: (paneId: string, adapterId?: string | null) => string;
  closeTerminalTab: (paneId: string, tabId: string) => void;
  /** Verschiebt einen Terminal-Tab an eine Position (`insertIndex`,
   * Einfüge-Slot vor dem Herauslösen gezählt; ohne Angabe: ans Ende) einer
   * Pane desselben Projekts — Ziel darf auch die Quelle selbst sein
   * (Umsortieren). Die PTY läuft dabei weiter. Zieht der letzte Tab weg,
   * leert sich der Quell-Slot (s. `gridState.ts`). No-Op über Projektgrenzen
   * hinweg. */
  moveTerminalTab: (
    sourcePaneId: string,
    tabId: string,
    targetPaneId: string,
    insertIndex?: number,
  ) => void;
  /** Verschiebt einen Terminal-Tab auf einen LEEREN Slot: dort entsteht eine
   * neue Pane im Projekt der Quelle, mit diesem Tab als einzigem — die
   * frische `paneId` wird hier erzeugt (dieselbe Erzeugungs-Verantwortung
   * wie `assignProject`). No-Op, wenn der Slot inzwischen belegt ist. */
  moveTerminalTabToEmptySlot: (
    sourcePaneId: string,
    tabId: string,
    targetSlotIndex: number,
  ) => void;
  /** Zieht eine GANZE Pane in einen leeren Slot — identisches Pane-Objekt,
   * unveränderte `paneId` (React-Key der Zelle: keine neue Id, sonst
   * remountet der gekeyte Teilbaum und die PTYs sterben, s. `gridState.ts`).
   * No-Op, wenn der Slot inzwischen belegt ist. */
  movePaneToEmptySlot: (paneId: string, targetSlotIndex: number) => void;
  /** Setzt/löscht den Anzeigenamen eines Terminal-Tabs (Kontextmenü
   * "Umbenennen", `PaneTabs.tsx`) — `label: null` löscht ihn wieder. */
  renameTerminalTab: (paneId: string, tabId: string, label: string | null) => void;
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
  /** Schreibt die Schnittkanten-Verhältnisse des aktuellen Templates (Ticket
   * 21) — Pointer-Drag/Pfeiltasten (`components/GridSplitters.tsx`) und der
   * Sitzungs-Restore (`App.tsx`) rufen dieselbe Funktion. */
  setSplitRatios: (ratios: readonly number[]) => void;
}

/**
 * Dünner React-Wrapper um `gridState.ts`, im Stil von `useFileEditor.ts`:
 * hält den reinen State per `useState`, die einzige Aufgabe hier ist die
 * `paneId`-Erzeugung (bewusst außerhalb des reinen Moduls, siehe dessen
 * Kopfkommentar).
 */
export function useGrid(): Grid {
  const [state, setState] = useState<GridState>(INITIAL_GRID_STATE);

  // Ticket 35: der `terminal.defaultAdapter`-Wert lebt in einem Ref statt
  // einer `useCallback`-Abhängigkeit, aus genau dem Grund, den der
  // Kopfkommentar unten für `assignProject`/`closePane` nennt — die
  // Callbacks sollen referenzstabil bleiben, nicht bei jeder
  // Einstellungsänderung neu entstehen. Der Effekt liest trotzdem immer den
  // aktuellen Wert beim nächsten Aufruf, nicht den vom Mount-Zeitpunkt.
  const { values: settingsValues } = useSettings();
  const defaultAdapterIdRef = useRef<string | null>(null);
  useEffect(() => {
    defaultAdapterIdRef.current = defaultAdapterIdFromSetting(
      settingsValues["terminal.defaultAdapter"],
    );
  }, [settingsValues]);

  // Referenzstabil (leere Dep-Arrays, beide schließen nur über `setState`s
  // Updater-Form): sonst müsste jeder `useEffect`, der `assignProject`/
  // `closePane` aufruft (der CLI-Start in App.tsx), sie in sein Dep-Array
  // aufnehmen und bei jedem Grid-Update erneut feuern.
  const assignProject = useCallback(
    (slotIndex: number, projectPath: string, adapterId?: string | null) => {
      const paneId = crypto.randomUUID();
      const tabId = crypto.randomUUID();
      const resolvedAdapterId =
        adapterId === undefined ? defaultAdapterIdRef.current : adapterId;
      setState((current) =>
        assignProjectToSlot(current, slotIndex, projectPath, paneId, tabId, resolvedAdapterId),
      );
      return { paneId, tabId };
    },
    [],
  );

  const closePane = useCallback((paneId: string) => {
    setState((current) => closePaneInState(current, paneId));
  }, []);

  const swapPanes = useCallback((sourcePaneId: string, targetPaneId: string) => {
    setState((current) =>
      swapPanesInState(
        current,
        current.slots.findIndex((slot) => slot?.paneId === sourcePaneId),
        current.slots.findIndex((slot) => slot?.paneId === targetPaneId),
      ),
    );
  }, []);

  const switchTemplate = useCallback((target: TemplateId) => {
    setState((current) => switchTemplateInState(current, target));
  }, []);

  const focusPane = useCallback((paneId: string) => {
    setState((current) => focusPaneInState(current, paneId));
  }, []);

  const openTerminalTab = useCallback((paneId: string, adapterId?: string | null) => {
    const tabId = crypto.randomUUID();
    const resolvedAdapterId = adapterId === undefined ? defaultAdapterIdRef.current : adapterId;
    setState((current) => openTerminalTabInState(current, paneId, tabId, resolvedAdapterId));
    return tabId;
  }, []);

  const closeTerminalTab = useCallback((paneId: string, tabId: string) => {
    setState((current) => closeTerminalTabInState(current, paneId, tabId));
  }, []);

  const moveTerminalTab = useCallback(
    (
      sourcePaneId: string,
      tabId: string,
      targetPaneId: string,
      insertIndex?: number,
    ) => {
      setState((current) =>
        moveTerminalTabInState(
          current,
          sourcePaneId,
          tabId,
          targetPaneId,
          insertIndex,
        ),
      );
    },
    [],
  );

  const moveTerminalTabToEmptySlot = useCallback(
    (sourcePaneId: string, tabId: string, targetSlotIndex: number) => {
      const newPaneId = crypto.randomUUID();
      setState((current) =>
        moveTerminalTabToEmptySlotInState(
          current,
          sourcePaneId,
          tabId,
          targetSlotIndex,
          newPaneId,
        ),
      );
    },
    [],
  );

  const movePaneToEmptySlot = useCallback(
    (paneId: string, targetSlotIndex: number) => {
      setState((current) =>
        movePaneToEmptySlotInState(current, paneId, targetSlotIndex),
      );
    },
    [],
  );

  const renameTerminalTab = useCallback(
    (paneId: string, tabId: string, label: string | null) => {
      setState((current) => renameTerminalTabInState(current, paneId, tabId, label));
    },
    [],
  );

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

  const setSplitRatios = useCallback((ratios: readonly number[]) => {
    setState((current) => setSplitRatiosInState(current, ratios));
  }, []);

  return {
    state,
    assignProject,
    closePane,
    swapPanes,
    switchTemplate,
    focusPane,
    openTerminalTab,
    closeTerminalTab,
    moveTerminalTab,
    moveTerminalTabToEmptySlot,
    movePaneToEmptySlot,
    renameTerminalTab,
    switchToTerminalTab,
    switchToFileTab,
    enterFocusMode,
    exitFocusMode,
    focusModeSelectSlot,
    setSplitRatios,
  };
}
