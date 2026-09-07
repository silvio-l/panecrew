import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Pane } from "../grid/gridState";
import { registerFocusFollow } from "./focusFollow";

// `focusFollow.ts` imports the real `vscode` module, which only resolves
// inside a real VS Code extension host (see `vitest.config.mts`'s comment on
// why `src/test/**` is excluded from the vitest run). This is a virtual mock
// of just the surface `focusFollow.ts` and this test actually touch, so the
// module's real resolution logic (not a reimplementation of it) runs under
// plain Vitest.
// `vi.mock` factories are hoisted above every other statement in the file,
// so the mutable fixture state and fake classes they close over must be
// created via `vi.hoisted` rather than as plain top-level declarations.
const fixture = vi.hoisted(() => {
  class FakeUri {
    fsPath: string;
    constructor(fsPath: string) {
      this.fsPath = fsPath;
    }
    static file(fsPath: string): FakeUri {
      return new FakeUri(fsPath);
    }
  }
  // A marker class — `focusFollow.ts` only ever does `instanceof
  // TabInputTerminal` against it, never reads a property, but a field is
  // kept so this isn't an "empty class" for
  // `@typescript-eslint/no-extraneous-class`.
  class FakeTabInputTerminal {
    readonly marker = "terminal" as const;
  }

  interface FakeTerminal {
    name: string;
    creationOptions: { cwd?: string | FakeUri };
    shellIntegration?: { cwd?: FakeUri };
  }

  const state: {
    activeTerminal: FakeTerminal | undefined;
    activeTabInput: unknown;
    activeGroupViewColumn: number;
    workspaceFolders: { name: string; uri: FakeUri }[];
    capturedRevealForActiveTab: (() => void) | undefined;
  } = {
    activeTerminal: undefined,
    activeTabInput: undefined,
    activeGroupViewColumn: 1,
    workspaceFolders: [],
    capturedRevealForActiveTab: undefined,
  };

  return { FakeUri, FakeTabInputTerminal, state };
});

const { FakeUri, FakeTabInputTerminal, state } = fixture;

function noopDisposable(): { dispose: () => undefined } {
  return { dispose: () => undefined };
}

vi.mock("vscode", () => ({
  TabInputTerminal: fixture.FakeTabInputTerminal,
  // Unused by these tests (no file/notebook/custom-tab scenario), but
  // `focusFollow.ts` does `instanceof` checks against all three at module
  // load, so each needs a real constructor function to mock against.
  TabInputText: function FakeTabInputText(this: object) {
    /* marker type only */
  },
  TabInputNotebook: function FakeTabInputNotebook(this: object) {
    /* marker type only */
  },
  TabInputCustom: function FakeTabInputCustom(this: object) {
    /* marker type only */
  },
  Uri: fixture.FakeUri,
  window: {
    get activeTerminal() {
      return fixture.state.activeTerminal;
    },
    tabGroups: {
      get activeTabGroup() {
        return { viewColumn: fixture.state.activeGroupViewColumn, activeTab: { input: fixture.state.activeTabInput, label: undefined } };
      },
      onDidChangeTabGroups: noopDisposable,
      onDidChangeTabs: noopDisposable,
    },
    // `registerFocusFollow` wires the same `revealForActiveTab` callback to
    // all three events — capturing it here is enough to drive it manually.
    onDidChangeActiveTerminal: (cb: () => void) => {
      fixture.state.capturedRevealForActiveTab = cb;
      return noopDisposable();
    },
  },
  workspace: {
    get workspaceFolders() {
      return fixture.state.workspaceFolders;
    },
    getWorkspaceFolder: (uri: InstanceType<typeof fixture.FakeUri>) =>
      fixture.state.workspaceFolders.find((f) => uri.fsPath === f.uri.fsPath || uri.fsPath.startsWith(f.uri.fsPath + "/")),
  },
}));

describe("registerFocusFollow", () => {
  let shownFolders: string[];
  const votepitFolder = { name: "votepit", uri: FakeUri.file("/repos/votepit") };
  const loamFolder = { name: "loam", uri: FakeUri.file("/repos/loam") };
  const votepitPane: Pane = { paneId: "pane-1", projectPath: "/repos/votepit" } as Pane;

  beforeEach(() => {
    shownFolders = [];
    state.activeTerminal = undefined;
    state.activeTabInput = undefined;
    state.activeGroupViewColumn = 1;
    state.workspaceFolders = [votepitFolder, loamFolder];
    state.capturedRevealForActiveTab = undefined;

    registerFocusFollow(
      { setActiveFolder: (folder: { name: string }) => shownFolders.push(folder.name) },
      // Simulates `extension.ts`'s `onDidChangeActiveTerminal` adoption
      // handler: every terminal opened inside the Votepit pane's editor
      // group gets force-adopted into that pane, and that association is
      // never revisited afterwards.
      { paneForTerminal: () => votepitPane, paneForViewColumn: () => null },
    );
  });

  test("a terminal adopted into a pane, but whose shell has since cd'd into a different open project, follows the live cwd — not the stale pane association", () => {
    state.activeTabInput = new FakeTabInputTerminal();
    state.activeTerminal = {
      name: "zsh",
      creationOptions: {},
      // The user opened a second terminal tab in the Votepit pane's group,
      // then `cd`'d it into Loam's directory.
      shellIntegration: { cwd: FakeUri.file("/repos/loam") },
    };

    expect(state.capturedRevealForActiveTab).toBeTypeOf("function");
    state.capturedRevealForActiveTab?.();

    expect(shownFolders).toEqual(["loam"]);
  });

  test("falls back to the pane association when the terminal's cwd isn't resolvable yet", () => {
    state.activeTabInput = new FakeTabInputTerminal();
    state.activeTerminal = {
      name: "PaneCrew: votepit",
      creationOptions: {},
      // Shell integration hasn't finished its handshake yet.
      shellIntegration: undefined,
    };

    state.capturedRevealForActiveTab?.();

    expect(shownFolders).toEqual(["votepit"]);
  });
});
