import { render, screen } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import { describe, expect, it, vi } from "vitest";
import { FileEditor } from "./FileEditor";
import type { PaneTabsProps } from "./PaneTabs";
import type { FileEditorState } from "../explorer/fileEditorState";

// Ticket 39 (Syntax-Highlighting + Zeilennummerierung): eigene, isolierte
// Komponententests statt nur über App.test.tsx' Integrationspfad — dieselbe
// Fixture-Form wie TerminalPane.test.tsx' `paneTabs` (dort schon für
// `PaneTabsProps` etabliert), diese Fläche hatte bisher keine eigene
// Testdatei.
const paneTabs: PaneTabsProps = {
  terminalTabs: [{ tabId: "tab-1", number: 1, label: null }],
  activeTerminalTabId: "tab-1",
  paneFocused: true,
  showingFile: true,
  fileName: "example.ts",
  fileDirty: false,
  onSelectTerminalTab: vi.fn(),
  onOpenTerminalTab: vi.fn(),
  onCloseTerminalTab: vi.fn(),
  onCloseOtherTerminalTabs: vi.fn(),
  onCloseTerminalTabsToRight: vi.fn(),
  onRenameTerminalTab: vi.fn(),
  onSelectFile: vi.fn(),
  tabDrag: {
    start: vi.fn(),
    consumeClick: () => false,
    draggingTabId: null,
    draggable: true,
  },
};

function readyState(path: string, content: string): FileEditorState {
  return {
    status: "ready",
    path,
    content,
    crlf: false,
    stamp: { modified_ms: 0, len: content.length },
    dirty: false,
  };
}

function renderEditor(state: FileEditorState) {
  return render(
    <Tooltip.Provider>
      <FileEditor
        state={state}
        focused
        maximized={false}
        projectName="projekt"
        tabs={paneTabs}
        onEdit={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onHeaderPointerDown={vi.fn()}
        onToggleFocusMode={vi.fn()}
        focusModeHud={null}
        jumpToLine={null}
        onJumpApplied={vi.fn()}
      />
    </Tooltip.Provider>,
  );
}

describe("FileEditor — Zeilennummern (Ticket 39)", () => {
  it("zeigt Zeilennummern auch für eine unbekannte/nicht hervorgehobene Extension", () => {
    renderEditor(readyState("notes.xyz", "erste Zeile\nzweite Zeile\ndritte Zeile"));

    // `div.pr-2` statt einer nackten Textsuche — der Tab-Chip in
    // `paneTabs` (Zahl „1") sitzt in derselben Kopfzeile und ist sonst
    // nicht von der Gutter-Zeilennummer unterscheidbar.
    expect(screen.getByText("1", { selector: "div.pr-2" })).toBeInTheDocument();
    expect(screen.getByText("2", { selector: "div.pr-2" })).toBeInTheDocument();
    expect(screen.getByText("3", { selector: "div.pr-2" })).toBeInTheDocument();
  });

  it("zeigt Zeilennummern für eine erkannte Extension", () => {
    renderEditor(readyState("src/app.ts", "const a = 1;\nconst b = 2;"));

    expect(screen.getByText("1", { selector: "div.pr-2" })).toBeInTheDocument();
    expect(screen.getByText("2", { selector: "div.pr-2" })).toBeInTheDocument();
  });
});

describe("FileEditor — Syntax-Highlighting (Ticket 39)", () => {
  it("hebt ein Keyword in einer TypeScript-Datei farbig hervor", () => {
    renderEditor(readyState("src/app.ts", "const value = 1;"));

    const keyword = screen.getByText("const", { selector: "span" });
    expect(keyword.tagName).toBe("SPAN");
    expect(keyword.className).toContain("gitDecoration-modifiedResourceForeground");
  });

  it("hebt einen Kommentar in einer Rust-Datei farbig hervor", () => {
    renderEditor(readyState("src/main.rs", "// ein Kommentar"));

    const comment = screen.getByText("// ein Kommentar", { selector: "span" });
    expect(comment.tagName).toBe("SPAN");
    expect(comment.className).toContain("descriptionForeground");
  });

  it("zeigt reinen Text ohne Farbklassen für eine unbekannte Extension", () => {
    renderEditor(readyState("notes.xyz", "einfacher Text"));

    const plain = screen.getByText("einfacher Text", { selector: "span" });
    expect(plain.className).toContain("--pc-foreground");
  });
});
