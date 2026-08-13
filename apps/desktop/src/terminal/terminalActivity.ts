import { useCallback, useSyncExternalStore } from "react";
import type { Terminal } from "@xterm/xterm";

// Aktivitätssignal für Terminal-Tabs: "empfängt diese PTY gerade laufend neue
// Ausgabe" — Grundlage für ein künftiges Needs-Attention-Signal (Muster-
// Erkennung auf neuen Zeilen), das entscheiden muss, WANN es überhaupt neue
// Zeilen prüft, statt bei jedem Redraw. Bleibt bewusst reine
// Durchsatz-/Zeilenzahl-Buchhaltung, keine inhaltliche Interpretation der
// Ausgabe — die Projekt-Leitlinie ("Session-Status-Erkennung... explizit
// außerhalb v0.1-Scope") gilt für heuristisches Parsen VOM Ausgabe-INHALT,
// nicht für diese reine Zeilen-Zähl-Metrik.
//
// Zeilen statt Zeichen: Ink-basierte CLI-Agenten malen Prompt/Spinner/
// Statuszeile per Escape-Sequenzen laufend NEU,
// auch im Leerlauf — ein reiner Zeichen-Diff an terminal.write() bliebe an
// einem untätigen Prompt dauerhaft "aktiv". `buffer.active.baseY + cursorY`
// wächst dagegen nur, wenn wirklich neuer Zeileninhalt committet wird
// (Token-Streaming), nicht bei einem In-Place-Redraw. Im Alternate-Buffer
// (vim, htop, jedes Fullscreen-TUI) wächst `baseY` grundsätzlich nie —
// `committedLineCount` liefert dort bewusst `null` statt einer falschen 0,
// damit ein Aufrufer das von "keine neuen Zeilen" unterscheiden kann.
//
// Modul-globales Register statt lokalem usePtyTerminal-Rückgabewert:
// PaneGrid.tsx hält jeden Terminal-Tab einer Pane dauerhaft gemountet (auch
// unsichtbare) und rendert PaneTabs dabei mehrfach — jede Kopie braucht das
// Signal für ALLE Tabs der Pane, nicht nur den eigenen tabId. Gleiches Muster
// wie useDetectedTool.ts, dort per Poll, hier push-getrieben, weil
// usePtyTerminal.ts ohnehin exakt weiß, wann neue Zeilen ankommen.
//
// Zwei echte Settings-Felder (`terminal.activityIdleMs`/
// `terminal.activityLineThreshold`, config_core.rs) statt fixer Konstanten —
// live befüllt von applyActivitySettings.ts, dem einzigen Modul, das diese
// beiden Setter je aufruft. Bewusst getrennt von dieser Datei: die
// Tauri-Invoke/Listen-Aufrufe dort würden terminalActivity.test.ts (ruft
// reportLineAdvance direkt auf, ohne echtes Backend) beim bloßen Import
// scheitern lassen, gäbe es sie hier.
// 15000 statt vormals 1500 (Fund 2026-08-13, Nutzer-Bugreport): der Punkt
// unten ist persistent, kein selbstheilendes Signal mehr — ein zu kurzes
// Fenster markiert schon vereinzeltes Gelegenheits-Log-Rauschen sofort
// "ungelesen", ohne dass der Nutzer das je bewusst wahrnehmen könnte, bevor
// es unwiderruflich (bis zum Ansehen) hängen bleibt. Muss synchron mit dem
// Rust-Default in config_core.rs bleiben.
const DEFAULT_IDLE_MS = 15000;
const DEFAULT_LINE_THRESHOLD = 1;
let idleMs = DEFAULT_IDLE_MS;
let lineThreshold = DEFAULT_LINE_THRESHOLD;

// Ungelesen-Zustand (Umbau 2026-08-13, Nutzer-Neuspezifikation): `active`
// oben ist bewusst TRANSIENT (fällt nach `idleMs` Stille von selbst zurück)
// — genau das ist für ein "bis du den Tab öffnest, bleibt es markiert"-Signal
// die falsche Grundlage, ein Agent-Lauf mit Sprechpausen über `idleMs` hinaus
// würde das Badge sonst zwischendurch fälschlich verlieren. `unread` ist
// deshalb ein ZWEITER, unabhängig gepflegter Zustand pro Tab: gesetzt bei
// jedem frischen Aktivitäts-Burst auf einem Tab, der gerade NICHT der eine
// angesehene Tab ist (s. `viewedTabId` unten), gelöscht ausschließlich durch
// `markTabViewed` — nie durch Zeitablauf.
//
// GENAU EIN global angesehener Tab (`viewedTabId`) statt eines Pane-lokalen
// Zustands: Nutzer-Zitat zur Neuspezifikation, "es gibt ja immer nur ein
// aktives Tab, das hat nichts mit dem Grid oder dem Pane zu tun" — wörtlich
// nur wahr, wenn "angesehen" GRID-WEIT eindeutig ist (sonst gäbe es bis zu
// vier gleichzeitig "ausgewählte" Tabs, einen pro Pane). Der Aufrufer
// (PaneTabs.tsx' `TerminalTabChip`) meldet genau den einen Tab, der sowohl
// innerhalb seiner Pane ausgewählt ALS AUCH dessen Pane grid-fokussiert ist —
// dieselbe Kombination, die dort schon den Hintergrund-Pane-Fund behoben hat
// (Kopfkommentar dort, Korrektur "Hintergrund-Pane-Fund"). Modul-global statt
// Pane-lokal gehalten, weil genau EIN Tab app-weit gemeint ist, nicht einer
// pro Pane.
let viewedTabId: string | null = null;

export function setActivityIdleMs(value: number): void {
  if (Number.isFinite(value) && value > 0) idleMs = value;
}

export function setActivityLineThreshold(value: number): void {
  if (Number.isFinite(value) && value >= 1) lineThreshold = value;
}

interface ActivityEntry {
  active: boolean;
  /** Noch nicht als "aktiv" gewertete Zeilen, gesammelt innerhalb des
   * laufenden Idle-Fensters — verfällt auf 0, wenn `idleMs` ohne weiteren
   * Nachschub verstreicht, bevor `lineThreshold` erreicht ist (s.
   * `reportLineAdvance`). Ein einzelner Schwellwert PRO Flush wäre kein
   * brauchbarer Regler: ein Flush ist ein Animationsframe, ein streamender
   * Agent committet darin fast immer nur 1-2 Zeilen, jede Schwelle über 1
   * schaltete das Signal faktisch ab. Diese Fenster-Summe macht
   * `lineThreshold` dagegen über den gesamten sinnvollen Bereich nutzbar. */
  pendingLines: number;
  windowTimer: number;
  listeners: Set<() => void>;
  /** Persistenter Ungelesen-Zustand, s. Kommentar an `viewedTabId` oben. */
  unread: boolean;
  /** Ungelesen-Akkumulator — bewusst UNABHÄNGIG von `pendingLines`/`active`
   * oben, s. Kopfkommentar an `reportLineAdvance` (Fund 2026-08-13: "danach
   * passierte nichts"). Verfällt auf 0 nach `idleMs` ohne Nachschub, aus
   * demselben Grund wie `pendingLines`. */
  unreadPendingLines: number;
  /** Der allererste Zeilen-Burst eines frischen Eintrags ist der
   * Shell-Start-Prompt, kein verpasstes Ereignis — wird einmalig konsumiert,
   * ohne `unread` zu setzen, dann nie wieder geprüft. Ersetzt ein früheres
   * zeitbasiertes Start-Ruhefenster (`createdAt`/1s ab Entstehung des
   * Eintrags), das bei einem langsam startenden Shell — mehrere Panes
   * spawnen beim Sitzungs-Restore gleichzeitig ihre PTY — schon abgelaufen
   * sein konnte, BEVOR der erste echte Output überhaupt ankam, und den Boot-
   * Prompt dadurch fälschlich als ungelesen markierte. */
  firstBurstConsumed: boolean;
}

const entries = new Map<string, ActivityEntry>();

function getOrCreateEntry(tabId: string): ActivityEntry {
  let entry = entries.get(tabId);
  if (!entry) {
    entry = {
      active: false,
      pendingLines: 0,
      windowTimer: 0,
      listeners: new Set(),
      unread: false,
      unreadPendingLines: 0,
      firstBurstConsumed: false,
    };
    entries.set(tabId, entry);
  }
  return entry;
}

function notify(entry: ActivityEntry): void {
  for (const listener of entry.listeners) listener();
}

/** Committete Zeilenposition (Scrollback + Cursor-Zeile) im normalen Puffer,
 * `null` im Alternate-Puffer (dort ist "aktiv/inaktiv" nicht sinnvoll
 * definierbar, s. Kopfkommentar). Vom Aufrufer VOR und NACH einem
 * `terminal.write()` gemessen — die Differenz ist die Zahl der neu
 * committeten Zeilen. */
export function committedLineCount(terminal: Terminal): number | null {
  const buffer = terminal.buffer.active;
  return buffer.type === "normal" ? buffer.baseY + buffer.cursorY : null;
}

/** Von usePtyTerminal.ts aufgerufen, sobald ein Flush tatsächlich neue Zeilen
 * committet hat (`linesAdvanced > 0`, s. `committedLineCount`) — reine
 * Durchsatz-Buchhaltung, kein Rückschluss auf den geschriebenen Inhalt. */
export function reportLineAdvance(
  tabId: string,
  linesAdvanced: number,
): void {
  if (linesAdvanced <= 0) return;
  const entry = getOrCreateEntry(tabId);

  // Ungelesen-Erkennung läuft VOR und UNABHÄNGIG vom active/idle-Zweig
  // unten — der hat für einen bereits aktiven Tab einen frühen `return`.
  // Ohne diese Trennung bliebe ein durchgehend streamender Hintergrund-Tab
  // (dessen `active`-Fenster nie abreißt) für immer im "schon aktiv"-Zweig
  // gefangen, und `unread` würde nach einem `markTabViewed` nie wieder
  // gesetzt, egal wie viel neuer Output noch ankommt (Nutzer-Fund
  // 2026-08-13: "danach passierte nichts").
  if (tabId !== viewedTabId && !entry.unread) {
    entry.unreadPendingLines += linesAdvanced;
    if (entry.unreadPendingLines >= lineThreshold) {
      entry.unreadPendingLines = 0;
      if (entry.firstBurstConsumed) {
        entry.unread = true;
        notify(entry);
      } else {
        // S. Kommentar an `firstBurstConsumed`: der allererste Burst ist der
        // Shell-Start-Prompt, kein verpasstes Ereignis.
        entry.firstBurstConsumed = true;
      }
    }
  }

  window.clearTimeout(entry.windowTimer);

  if (entry.active) {
    // Schon aktiv: weiterer Nachschub verlängert nur das Idle-Fenster, ohne
    // die Schwelle erneut zu prüfen — ein einmal erkannter Burst bleibt
    // "aktiv", solange er nicht abreißt.
    entry.windowTimer = window.setTimeout(() => {
      entry.active = false;
      entry.pendingLines = 0;
      entry.unreadPendingLines = 0;
      notify(entry);
    }, idleMs);
    return;
  }

  entry.pendingLines += linesAdvanced;
  if (entry.pendingLines >= lineThreshold) {
    entry.active = true;
    entry.pendingLines = 0;
    entry.windowTimer = window.setTimeout(() => {
      entry.active = false;
      entry.unreadPendingLines = 0;
      notify(entry);
    }, idleMs);
    notify(entry);
  } else {
    // Schwelle noch nicht erreicht: die Zähler verfallen, wenn innerhalb des
    // Zeitfensters kein weiterer Nachschub kommt — sonst würde ein einzelner
    // Streuling von vor Minuten einen viel späteren, unabhängigen Burst zu
    // Unrecht mit auffüllen.
    entry.windowTimer = window.setTimeout(() => {
      entry.pendingLines = 0;
      entry.unreadPendingLines = 0;
    }, idleMs);
  }
}

/** Vom Cleanup derselben usePtyTerminal-Instanz aufgerufen, die den Tab
 * besitzt — ohne das behielte ein geschlossener Tab seinen Idle-Timer, und
 * ein wiederverwendetes tabId erbte dessen alten "aktiv"-Zustand. */
export function disposeTerminalActivity(tabId: string): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  window.clearTimeout(entry.windowTimer);
  entries.delete(tabId);
}

/** Nur für Tests: räumt sämtliche Einträge UND `viewedTabId` zurück — Letzteres
 * hängt an keinem einzelnen Tab-Eintrag und würde sonst unbemerkt aus einem
 * Test in den nächsten derselben Datei durchsickern (dasselbe Leck-Risiko,
 * gegen das `setActivityIdleMs`/`setActivityLineThreshold` ihr eigenes
 * Zurücksetzen in `afterEach` brauchen). */
export function resetTerminalActivityForTests(): void {
  for (const tabId of entries.keys()) disposeTerminalActivity(tabId);
  viewedTabId = null;
}

export function isTerminalActive(tabId: string): boolean {
  return entries.get(tabId)?.active ?? false;
}

/** Meldet, dass der Nutzer `tabId` gerade tatsächlich ansieht (PaneTabs.tsx'
 * `TerminalTabChip`, ausgewählt UND eigene Pane grid-fokussiert) — der
 * einzige Weg, `unread` zu löschen (kein Zeitablauf, s. Kommentar an
 * `viewedTabId` oben). Setzt `viewedTabId` auch dann, wenn für diesen Tab
 * noch gar kein Eintrag existiert (z. B. ein Tab ohne jede PTY-Ausgabe
 * bislang) — spätere `reportLineAdvance`-Aufrufe für ihn müssen ihn trotzdem
 * korrekt als "der angesehene" erkennen. */
export function markTabViewed(tabId: string): void {
  viewedTabId = tabId;
  const entry = entries.get(tabId);
  if (!entry) return;
  // Alles bis hierhin gilt als gesehen, auch ein noch unter der Schwelle
  // liegender Teil-Akkumulator — sonst würde ein späterer, eigentlich
  // unabhängiger Rest-Burst fälschlich mit bereits gesehenem Output
  // zusammengezählt.
  entry.unreadPendingLines = 0;
  if (entry.unread) {
    entry.unread = false;
    notify(entry);
  }
}

export function isTabUnread(tabId: string): boolean {
  return entries.get(tabId)?.unread ?? false;
}

function subscribe(tabId: string, listener: () => void): () => void {
  const entry = getOrCreateEntry(tabId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

/** Push-getriebener React-Hook — liefert `unread` (Kommentar an
 * `viewedTabId` oben) für `tabId`. `entry.active` selbst (s.
 * `isTerminalActive`) treibt inzwischen keine eigene UI mehr, bleibt aber
 * intern die Burst-Erkennung, auf der `unread` aufsetzt (s.
 * `reportLineAdvance`) — kein eigener Hook mehr dafür, seit PaneTabs.tsx'
 * Umbau (Kopfkommentar dort) das transiente Blink-Badge durch dieses
 * persistente Signal ersetzt hat. */
export function useTerminalUnread(tabId: string): boolean {
  const subscribeForTab = useCallback(
    (listener: () => void) => subscribe(tabId, listener),
    [tabId],
  );
  const getSnapshot = useCallback(() => isTabUnread(tabId), [tabId]);
  return useSyncExternalStore(subscribeForTab, getSnapshot);
}
