import { useCallback, useSyncExternalStore } from "react";

// Frontend-seite der Pro-Tab-Ressourcen-Eskalationskette
// (`resource_guard.rs`) — ein modul-globales Register plus
// `useSyncExternalStore`-Hooks, exakt dasselbe Muster wie
// `terminalActivity.ts` (dortiger Kopfkommentar zur Begründung: mehrere
// gleichzeitig gemountete Konsumenten desselben `tabId` — hier PaneTabs.tsx'
// Warn-Chip UND TerminalPane.tsx' Pause-/Terminated-Banner — brauchen
// dasselbe Signal, ohne dass eine der beiden Stellen die Tauri-Events selbst
// abonniert).
//
// Bewusst getrennt von `usePtyTerminal.ts`: dieses Modul liest/schreibt
// nichts an dessen internem Zustand und importiert es nicht — die vier neuen
// Tauri-Events werden zentral in `App.tsx` (einmal pro Fenster-Lebensdauer,
// mit Unlisten-Cleanup, dasselbe Muster wie dortiges `explorer:changed`)
// entgegengenommen und über die `apply*`-Funktionen unten in dieses Register
// geschrieben.

type ResourceGuardStatus = "normal" | "warn" | "paused" | "terminated";

interface GuardSnapshot {
  status: ResourceGuardStatus;
  percent: number;
  /** Nur bei `status === "terminated"` gesetzt — der stabile Grund-Schlüssel
   * vom Backend (`resource_guard.rs`s `REASON_*`-Konstanten), die Übersetzung
   * übernimmt die UI. */
  reason: string | null;
  /** Erhöht sich bei jedem transienten "ein einzelner Prozess wurde gezielt
   * beendet, der Tab lebt weiter"-Ereignis — key-Neumount-Auslöser für eine
   * Toast-Anzeige, dasselbe Prinzip wie PaneTabs.tsx' `flashKey`. */
  singleKillNonce: number;
}

interface GuardEntry {
  snapshot: GuardSnapshot;
  /** Nur während `status === "paused"` relevant — die tabId reicht für
   * "Fortsetzen" (der Tauri-Command braucht keinen pid vom Frontend), dieser
   * pid ist reine Diagnose/Vollständigkeit, keine UI liest ihn direkt. */
  pausedPid: number | null;
  listeners: Set<() => void>;
}

const IDLE_SNAPSHOT: GuardSnapshot = {
  status: "normal",
  percent: 0,
  reason: null,
  singleKillNonce: 0,
};

const entries = new Map<string, GuardEntry>();

function getOrCreate(tabId: string): GuardEntry {
  let entry = entries.get(tabId);
  if (!entry) {
    entry = { snapshot: IDLE_SNAPSHOT, pausedPid: null, listeners: new Set() };
    entries.set(tabId, entry);
  }
  return entry;
}

function commit(tabId: string, snapshot: GuardSnapshot, pausedPid: number | null): void {
  const entry = getOrCreate(tabId);
  entry.snapshot = snapshot;
  entry.pausedPid = pausedPid;
  for (const listener of entry.listeners) listener();
}

/** `pty:tab-resource-status` — normal/warn, kein Prozesseingriff. */
export function applyStatusEvent(payload: {
  tabId: string;
  status: "normal" | "warn";
  percent: number;
}): void {
  const entry = getOrCreate(payload.tabId);
  commit(
    payload.tabId,
    {
      status: payload.status,
      percent: payload.percent,
      reason: null,
      singleKillNonce: entry.snapshot.singleKillNonce,
    },
    null,
  );
}

/** `pty:tab-paused` — der Tab-Prozessbaum bleibt am Leben, eingefroren. */
export function applyPausedEvent(payload: { tabId: string; percent: number; pid: number }): void {
  const entry = getOrCreate(payload.tabId);
  commit(
    payload.tabId,
    {
      status: "paused",
      percent: payload.percent,
      reason: null,
      singleKillNonce: entry.snapshot.singleKillNonce,
    },
    payload.pid,
  );
}

/** `pty:tab-single-kill` — nur EIN Prozess innerhalb des Tabs wurde gezielt
 * beendet, der Tab selbst läuft normal weiter (Rust emittiert dieses Event
 * NICHT gleichzeitig mit einem Statuswechsel — der nächste reguläre Tick
 * liefert normal/warn separat nach, sobald sich die neue Lage zeigt). Der
 * Nonce-Zähler ist über ALLE `apply*`-Funktionen hinweg monoton (keine setzt
 * ihn zurück) — sonst würde ein Status-/Pause-/Terminated-Event zwischen zwei
 * Single-Kills den Zähler auf den Stand zurückwerfen, den
 * `TabResourceBanner.tsx`s `mountedNonce`-Ref schon gesehen hat, und der
 * zweite Kill bliebe unsichtbar. */
export function applySingleKillEvent(payload: { tabId: string; percent: number }): void {
  const entry = getOrCreate(payload.tabId);
  commit(
    payload.tabId,
    {
      ...entry.snapshot,
      percent: payload.percent,
      singleKillNonce: entry.snapshot.singleKillNonce + 1,
    },
    entry.pausedPid,
  );
}

/** `pty:tab-terminated` — letzte Eskalationsstufe, der ganze Tab-Prozessbaum
 * wurde beendet. */
export function applyTerminatedEvent(payload: {
  tabId: string;
  percent: number;
  reason: string;
}): void {
  const entry = getOrCreate(payload.tabId);
  commit(
    payload.tabId,
    {
      status: "terminated",
      percent: payload.percent,
      reason: payload.reason,
      singleKillNonce: entry.snapshot.singleKillNonce,
    },
    null,
  );
}

/** Vom Aufrufer von "Neu starten" (`TabResourceBanner.tsx`) genutzt, um den
 * alten `terminated`-Zustand zu löschen, bevor ein frischer Terminal-Tab
 * unter derselben `tabId` NICHT wiederverwendet wird (der Neustart öffnet
 * bewusst einen neuen Tab, s. dortiger Kommentar) — räumt trotzdem den alten
 * Eintrag weg, damit er nicht als toter Zustand im Register hängen bleibt. */
export function disposeResourceGuardEntry(tabId: string): void {
  entries.delete(tabId);
}

function subscribe(tabId: string, listener: () => void): () => void {
  const entry = getOrCreate(tabId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

function getSnapshot(tabId: string): GuardSnapshot {
  return entries.get(tabId)?.snapshot ?? IDLE_SNAPSHOT;
}

export function useTabResourceGuard(tabId: string): GuardSnapshot {
  const subscribeForTab = useCallback(
    (listener: () => void) => subscribe(tabId, listener),
    [tabId],
  );
  const snapshot = useCallback(() => getSnapshot(tabId), [tabId]);
  return useSyncExternalStore(subscribeForTab, snapshot);
}

/** Nur für Tests: räumt das gesamte Register zurück, dasselbe Bedürfnis wie
 * `terminalActivity.ts`s `resetTerminalActivityForTests`. */
export function resetResourceGuardForTests(): void {
  entries.clear();
}
