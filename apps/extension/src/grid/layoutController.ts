// Translates PaneCrew's ported `GridState` (gridState.ts) into VS Code's own
// editor-group layout shape, consumed via
// `vscode.commands.executeCommand('vscode.setEditorLayout', layout)`, plus a
// side-effecting controller that also creates/moves the terminal per pane.
//
// Split deliberately in two halves, same shape as the desktop app's own
// pure-state/impure-effect split (gridState.ts vs. useGrid.ts):
//   - `editorGroupLayoutForTemplate` / `computeApplyPlan` are pure, no
//     `vscode` import, and are exactly what's unit-tested here.
//   - `GridLayoutController` is the thin impure shell that actually calls
//     `vscode.window.createTerminal`/`executeCommand` — exercised only by the
//     integration smoke test (a real VS Code host), not vitest.
import type { GridState, Pane, TemplateId } from "./gridState";

/** Mirrors `vscode.GroupOrientation` (0 = horizontal, 1 = vertical) without
 * importing the `vscode` module, so this file stays usable from plain
 * Node/vitest. */
type GroupOrientation = 0 | 1;

/** Mirrors the recursive shape VS Code expects for
 * `vscode.setEditorLayout`'s `groups` entries: a leaf has no `groups`, a
 * split has nested `groups` and an optional `orientation` is implied by the
 * parent. */
interface EditorGroupLayoutGroup {
  size?: number;
  groups?: EditorGroupLayoutGroup[];
}

export interface EditorGroupLayout {
  orientation: GroupOrientation;
  groups: EditorGroupLayoutGroup[];
}

const HORIZONTAL: GroupOrientation = 0;
const VERTICAL: GroupOrientation = 1;

/**
 * The editor-group tree for a given template. Leaf order (depth-first,
 * `groups` array order) intentionally matches `GridState.slots`' own index
 * order (0, 1, 2, …) for every template below — so no separate slot→leaf
 * remap table is needed; `computeApplyPlan` just walks slots in order and
 * assigns view columns 1, 2, 3, … as it encounters them.
 *
 * `two-over-one` reads as "two panes on top, one full-width pane below";
 * `one-over-two` the mirror. Both differ from `quad`'s even 2×2 split only
 * in that the bottom (resp. top) row is a single unsplit group instead of
 * two.
 */
export function editorGroupLayoutForTemplate(template: TemplateId): EditorGroupLayout {
  switch (template) {
    case "single":
      return { orientation: HORIZONTAL, groups: [{}] };
    case "split":
      return { orientation: HORIZONTAL, groups: [{}, {}] };
    case "row-3":
      return { orientation: HORIZONTAL, groups: [{}, {}, {}] };
    case "row-4":
      return { orientation: HORIZONTAL, groups: [{}, {}, {}, {}] };
    case "quad":
      return {
        orientation: VERTICAL,
        groups: [{ groups: [{}, {}] }, { groups: [{}, {}] }],
      };
    case "two-over-one":
      return {
        orientation: VERTICAL,
        groups: [{ groups: [{}, {}] }, {}],
      };
    case "one-over-two":
      return {
        orientation: VERTICAL,
        groups: [{}, { groups: [{}, {}] }],
      };
    default: {
      // Exhaustiveness guard, mirrors gridState.ts's own `slotCount`/
      // `trackShape` pattern for an unknown TemplateId.
      const exhaustive: never = template;
      throw new Error(`Unknown template: ${exhaustive as string}`);
    }
  }
}

/** One pane's assignment to a 1-based VS Code `ViewColumn` position — plain
 * data, no `vscode.ViewColumn` import needed since it's a structural number
 * (`ViewColumn.One` is `1`, `ViewColumn.Two` is `2`, …). */
interface PaneViewColumnAssignment {
  slotIndex: number;
  pane: Pane;
  viewColumn: number;
}

export interface GridApplyPlan {
  layout: EditorGroupLayout;
  /** One entry per OCCUPIED slot, in ascending slot-index (== leaf) order.
   * Empty slots produce an empty, terminal-less editor group — they still
   * exist in `layout` (so the topology is right), just nothing is opened in
   * them until a project is assigned. */
  assignments: PaneViewColumnAssignment[];
}

/** Pure translation from `GridState` to what `GridLayoutController` needs to
 * actually apply — no `vscode` import, this is the part vitest exercises
 * directly. */
export function computeApplyPlan(state: GridState): GridApplyPlan {
  const layout = editorGroupLayoutForTemplate(state.template);
  const assignments: PaneViewColumnAssignment[] = [];
  state.slots.forEach((pane, slotIndex) => {
    if (pane === null) return;
    assignments.push({ slotIndex, pane, viewColumn: slotIndex + 1 });
  });
  return { layout, assignments };
}

/** Sanity check used only by tests: the number of leaf groups a layout
 * produces, so a test can assert it matches `trackShape`/`slotCount`
 * expectations without hand-counting each template's nested shape. */
export function countLeafGroups(layout: EditorGroupLayout): number {
  const countGroup = (group: EditorGroupLayoutGroup): number =>
    group.groups ? group.groups.reduce((sum, g) => sum + countGroup(g), 0) : 1;
  return layout.groups.reduce((sum, g) => sum + countGroup(g), 0);
}

// ---------------------------------------------------------------------------
// Impure shell — actually applies a plan against a real VS Code window. Kept
// deliberately thin: everything decision-worthy lives in the pure functions
// above.
// ---------------------------------------------------------------------------

/** Structural subset of the `vscode` module this controller needs — lets the
 * pure logic above stay untouched while the impure shell below still gets
 * type-checked against the real `vscode` types at the call site
 * (`extension.ts` passes the real module in). */
export interface VscodeLike {
  commands: {
    executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
  };
  window: {
    createTerminal(options: {
      name: string;
      cwd: string;
      location: { viewColumn: number };
    }): ControllerTerminal;
    terminals: readonly ControllerTerminal[];
  };
}

interface ControllerTerminal {
  name: string;
  /** Present on every real `vscode.Terminal` as `TerminalOptions |
   * ExtensionTerminalOptions`. Confirmed via live instrumentation
   * (2026-08-28) to come back EMPTY for a terminal VS Code revives from a
   * persisted session across a full Extension Development Host restart —
   * unlike a same-process "just reload the webview" reload, revival
   * apparently doesn't replay the original launch config's `cwd` into
   * `creationOptions` at all, only `terminalCwd`'s `shellIntegration.cwd`
   * fallback below actually carries it. Kept as the first-choice source
   * anyway since it's synchronously available for a terminal PaneCrew just
   * created in the very same session (no shell-integration handshake delay
   * needed yet). Typed `unknown` (read via `terminalCwd`) because the real
   * union's `ExtensionTerminalOptions` branch shares no properties with a
   * `{ cwd }` shape, which TS's weak-type check rejects outright — and
   * because `TerminalOptions.cwd` itself is `string | Uri`, not worth
   * importing `vscode.Uri` into this vscode-import-free file for. */
  creationOptions?: unknown;
  /** Shell-integration-reported live cwd (`vscode.TerminalShellIntegration`)
   * — `undefined` until the shell finishes its integration handshake, which
   * for a terminal that's been alive since before this extension activated
   * (the exact revived-terminal case above) has normally already happened
   * by the time `ensureTerminal` runs. */
  shellIntegration?: { cwd?: { fsPath: string } };
  show(preserveFocus?: boolean): void;
  dispose?(): void;
}

/** Reads a terminal's cwd as a plain string — `creationOptions.cwd` first
 * (see its type comment for why that's empty for a revived terminal), then
 * `shellIntegration.cwd`. `undefined` if neither is available yet. */
function terminalCwd(terminal: ControllerTerminal): string | undefined {
  const options = terminal.creationOptions;
  if (typeof options === "object" && options !== null && "cwd" in options) {
    const cwd = (options as { cwd?: unknown }).cwd;
    if (typeof cwd === "string") return cwd;
    if (typeof cwd === "object" && cwd !== null && "fsPath" in cwd && typeof cwd.fsPath === "string") {
      return cwd.fsPath;
    }
  }
  return terminal.shellIntegration?.cwd?.fsPath;
}

export class GridLayoutController {
  /** paneId -> live terminal, so re-applying a layout (e.g. after adding a
   * folder) doesn't spawn a second terminal for a pane that already has
   * one. */
  private readonly terminalsByPaneId = new Map<string, ControllerTerminal>();
  /** Reverse lookup by terminal object identity — kept as a fallback signal
   * for the exact terminal PaneCrew itself created, but NOT the primary way
   * `focusFollow.ts` resolves "which pane has focus": the user (or a CLI
   * agent running inside a pane) routinely opens *another*
   * terminal inside the same editor group, and that terminal is never in
   * this map, yet focus-follow still needs to resolve it to the right pane.
   * `paneByViewColumn` below is what actually covers that case. */
  private readonly paneByTerminal = new Map<ControllerTerminal, Pane>();
  /** pane by its editor group (VS Code `ViewColumn` position) — resolves
   * focus for ANY terminal or tab in that group, not just the one
   * `ensureTerminal` created, since VS Code exposes which group is focused
   * (`tabGroups.activeTabGroup.viewColumn`) independent of tab identity. */
  private readonly paneByViewColumn = new Map<number, Pane>();

  /** Panes whose terminal was adopted (revived from a persisted VS Code
   * session, e.g. after "Developer: Reload Window") during the most recent
   * `apply()` call, rather than freshly created by this controller.
   * Attention tracking does NOT recover on its own for these in the common
   * case (verified 2026-08-28, correcting an earlier, over-optimistic
   * assumption): the pane's foreground command (e.g. a CLI agent's own
   * process) is still the one, already-running shell command from before
   * the reload, and `onDidStartTerminalShellExecution` only fires for a NEW
   * command start -- more input into that still-running process never fires
   * it again, and VS Code's stable API has no way to attach to an
   * already-started command's live output. This is logged (see
   * `extension.ts`'s `logAdoptedPanes`) rather than acted on automatically,
   * since ending the command to restart tracking is destructive and should
   * stay an explicit choice. Kept around so `panecrew.restartPaneTerminal`
   * has a record of which panes were adopted, for when the user notices a
   * specific pane's attention notifications stay stuck and asks to restart
   * it. */
  private readonly lastAdoptedPaneIds = new Set<string>();

  constructor(private readonly vscode: VscodeLike) {}

  async apply(state: GridState): Promise<void> {
    const plan = computeApplyPlan(state);
    await this.vscode.commands.executeCommand("vscode.setEditorLayout", plan.layout);
    this.lastAdoptedPaneIds.clear();
    for (const { pane, viewColumn } of plan.assignments) {
      this.paneByViewColumn.set(viewColumn, pane);
      this.ensureTerminal(pane, viewColumn);
    }
  }

  /** Panes adopted (not freshly created) by the most recent `apply()` call —
   * see `lastAdoptedPaneIds` for why this matters for attention tracking. */
  adoptedPaneIds(): readonly string[] {
    return [...this.lastAdoptedPaneIds];
  }

  private ensureTerminal(pane: Pane, viewColumn: number): void {
    const existing = this.terminalsByPaneId.get(pane.paneId);
    if (existing) {
      existing.show(true);
      this.paneByTerminal.set(existing, pane);
      return;
    }
    // Adopt a live terminal for this pane instead of always creating a new
    // one (2026-08-27 fix, revised 2026-08-28): after a "Developer: Reload
    // Window", or whenever the extension host restarts without its saved
    // session having survived (unreliable for an unsaved multi-root
    // workspace's `workspaceState`), this controller's in-memory maps start
    // empty while VS Code itself may have kept the *terminal* alive across
    // the reload — without adoption, every such restart spawned a second,
    // duplicate terminal for the same pane instead of reusing the original.
    //
    // Match by `cwd` first, not by name: a terminal VS Code revives from a
    // persisted session comes back with a generic shell-derived name (e.g.
    // "zsh") — the `name` this controller originally passed to
    // `createTerminal` does NOT survive revival — while `creationOptions.cwd`
    // does. Matching on name alone (the original 2026-08-27 fix) therefore
    // never found the revived terminal and created a second one for every
    // still-open pane on every reload (bug reported 2026-08-28). Name match
    // stays as a fallback for terminals that aren't revived-from-persistence
    // (e.g. created earlier in the very same session), where `cwd` may not
    // be reported.
    const expectedName = paneTerminalName(pane);
    const expectedCwd = normalizeCwd(pane.projectPath);
    const adopted = this.vscode.window.terminals.find((terminal) => {
      if (this.paneByTerminal.has(terminal)) return false;
      const cwd = terminalCwd(terminal);
      if (cwd !== undefined) return normalizeCwd(cwd) === expectedCwd;
      return terminal.name === expectedName;
    });
    if (adopted) this.lastAdoptedPaneIds.add(pane.paneId);
    const terminal = adopted ?? this.vscode.window.createTerminal({
      name: expectedName,
      cwd: pane.projectPath,
      location: { viewColumn },
    });
    this.terminalsByPaneId.set(pane.paneId, terminal);
    this.paneByTerminal.set(terminal, pane);
    terminal.show(true);
  }

  /** Drops the tracked terminal for a pane that no longer exists in the
   * grid (closed by the user) — does not itself dispose the terminal;
   * VS Code already reflects that in `vscode.window.terminals` once the
   * user or the pty closes it. */
  forgetPane(paneId: string): void {
    const terminal = this.terminalsByPaneId.get(paneId);
    if (terminal) this.paneByTerminal.delete(terminal);
    this.terminalsByPaneId.delete(paneId);
    for (const [viewColumn, pane] of this.paneByViewColumn) {
      if (pane.paneId === paneId) this.paneByViewColumn.delete(viewColumn);
    }
  }

  /** Actively closes the live terminal for a pane the user explicitly
   * removed from the grid (e.g. "Remove Project…"), then forgets it —
   * unlike `forgetPane`, which only drops the tracked reference because
   * VS Code already closed the terminal on its own. */
  disposeTerminalForPane(paneId: string): void {
    this.terminalsByPaneId.get(paneId)?.dispose?.();
    this.forgetPane(paneId);
  }

  /** Explicitly closes and recreates the terminal for one pane — used for
   * the user-facing "restart terminal" action offered for adopted/revived
   * panes (see `lastAdoptedPaneIds`) whose attention tracking doesn't work.
   * Unlike `ensureTerminal`'s normal path this always creates a fresh
   * terminal rather than adopting one, since the whole point is to replace
   * the one whose shell-integration tracking is broken. Destructive by
   * design — only ever called from an explicit user action, never
   * automatically, since it kills whatever is running in that pane. */
  restartTerminalForPane(pane: Pane, viewColumn: number): void {
    this.disposeTerminalForPane(pane.paneId);
    const terminal = this.vscode.window.createTerminal({
      name: paneTerminalName(pane),
      cwd: pane.projectPath,
      location: { viewColumn },
    });
    this.terminalsByPaneId.set(pane.paneId, terminal);
    this.paneByTerminal.set(terminal, pane);
    this.paneByViewColumn.set(viewColumn, pane);
    terminal.show(true);
  }

  /** The pane that owns `terminal`, or `null` if it's not one PaneCrew
   * created (e.g. a terminal the user opened by hand outside the grid). */
  paneForTerminal(terminal: ControllerTerminal): Pane | null {
    return this.paneByTerminal.get(terminal) ?? null;
  }

  /** The pane assigned to a given editor group position, or `null` if that
   * `ViewColumn` isn't currently occupied by a pane (e.g. an empty slot, or
   * a group the user split open by hand outside the grid template). */
  paneForViewColumn(viewColumn: number): Pane | null {
    return this.paneByViewColumn.get(viewColumn) ?? null;
  }
}

function paneTerminalName(pane: Pane): string {
  const base = pane.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? pane.projectPath;
  return `PaneCrew: ${base}`;
}

/** Strips a trailing path separator so `"/repo/a"` and `"/repo/a/"` compare
 * equal — the only normalization actually needed here, since a revived
 * terminal's `creationOptions.cwd` round-trips the exact string this
 * controller originally passed to `createTerminal`. */
function normalizeCwd(cwd: string): string {
  return cwd.replace(/[\\/]+$/, "");
}
