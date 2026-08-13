import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaneTabs, type PaneTabsProps } from "./PaneTabs";
import { disposeTerminalActivity, reportLineAdvance } from "../terminal/terminalActivity";
import { PtyBackendContext, type PtyBackend } from "../terminal/ptyBackend";

// Regressionstests zum Umbau vom 2026-08-13 (s. Kopfkommentar in
// PaneTabs.tsx, "Schließen per Kontextmenü"): das Schließkreuz ist ersatzlos
// entfernt, Schließen UND Umbenennen laufen jetzt ausschließlich über das
// Radix-Kontextmenü des Chips. Dasselbe `fireEvent.contextMenu`-Muster wie
// TerminalPane.test.tsx' Kopier-Menü-Test.
const baseProps = (
  overrides: Partial<PaneTabsProps> = {},
): PaneTabsProps => ({
  terminalTabs: [
    { tabId: "tab-1", number: 1, label: null },
    { tabId: "tab-2", number: 2, label: null },
  ],
  activeTerminalTabId: "tab-1",
  paneFocused: true,
  showingFile: false,
  fileName: null,
  fileDirty: false,
  onSelectTerminalTab: vi.fn(),
  onOpenTerminalTab: vi.fn(),
  onCloseTerminalTab: vi.fn(),
  onRenameTerminalTab: vi.fn(),
  onSelectFile: vi.fn(),
  ...overrides,
});

const renderTabs = (props: PaneTabsProps) =>
  render(
    <Tooltip.Provider>
      <PaneTabs {...props} />
    </Tooltip.Provider>,
  );

/** Wie `renderTabs`, aber mit einem gestellten `PtyBackend` — für die
 * Tool-Icon-Tests unten, die `detectTool` einen festen Binärnamen pro
 * `tabId` beantworten lassen, statt des echten Tauri-IPC-Aufrufs. */
const renderTabsWithBackend = (props: PaneTabsProps, backend: PtyBackend) =>
  render(
    <Tooltip.Provider>
      <PtyBackendContext.Provider value={backend}>
        <PaneTabs {...props} />
      </PtyBackendContext.Provider>
    </Tooltip.Provider>,
  );

const fakePtyBackend = (detectTool: PtyBackend["detectTool"]): PtyBackend => ({
  spawn: vi.fn().mockResolvedValue(undefined),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  detectTool,
});

/** Der `ContextMenu.Trigger` ist der `<span>`, der Zahl-Knopf/Umbenennen-Feld
 * umschließt — derselbe unmittelbare Elternknoten in beiden Zuständen
 * (`PaneTabs.tsx`). */
const chipTrigger = (name: string) => {
  const el = screen.getByRole("button", { name }).closest("span");
  if (!el) throw new Error(`Kontextmenü-Trigger für "${name}" nicht gefunden`);
  return el;
};

describe("PaneTabs", () => {
  it("wählt den Tab per Klick auf die Zahl aus, ohne ihn zu schließen", () => {
    const props = baseProps();
    renderTabs(props);

    fireEvent.click(screen.getByRole("button", { name: "Terminal 2" }));

    expect(props.onSelectTerminalTab).toHaveBeenCalledWith("tab-2");
    expect(props.onCloseTerminalTab).not.toHaveBeenCalled();
  });

  it("schließt den Tab nur über das Kontextmenü, ohne ihn auszuwählen", () => {
    const props = baseProps();
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 2"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Terminal 2 schließen" }));

    expect(props.onCloseTerminalTab).toHaveBeenCalledWith("tab-2");
    expect(props.onSelectTerminalTab).not.toHaveBeenCalled();
  });

  it("bietet für den letzten verbleibenden Tab keinen Schließen-Menüpunkt", () => {
    renderTabs(baseProps({ terminalTabs: [{ tabId: "tab-1", number: 1, label: null }] }));

    fireEvent.contextMenu(chipTrigger("Terminal 1"));

    expect(screen.queryByRole("menuitem", { name: "Terminal 1 schließen" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Terminal 1 umbenennen" })).toBeInTheDocument();
  });

  it("benennt einen Tab über das Kontextmenü um", async () => {
    const props = baseProps();
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 2"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Terminal 2 umbenennen" }));

    // Das Feld hängt erst einen Tick nach dem Klick ein (PaneTabs.tsx'
    // `onStartRename`-Kommentar: Radix' eigener Schließvorgang muss dem
    // Umbenennen-Feld erst den Fokus-Trap freigeben) — `findByRole` statt
    // `getByRole` wartet darauf.
    const field = await screen.findByRole("textbox", { name: "Name für Terminal 2" });
    fireEvent.change(field, { target: { value: "build" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(props.onRenameTerminalTab).toHaveBeenCalledWith("tab-2", "build");
  });

  it("verwirft die Umbenennung bei Escape, ohne zu committen", async () => {
    const props = baseProps();
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 2"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Terminal 2 umbenennen" }));
    const field = await screen.findByRole("textbox", { name: "Name für Terminal 2" });
    fireEvent.change(field, { target: { value: "build" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(props.onRenameTerminalTab).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Terminal 2" })).toBeInTheDocument();
  });

  describe("Needs-Attention-Badge", () => {
    // Regressionstest zum Hintergrund-Pane-Fund (Kopfkommentar von
    // PaneTabs.tsx, Korrektur "Hintergrund-Pane-Fund"): der ausgewählte Tab
    // einer unfokussierten Pane muss das Badge zeigen können — nur der Tab,
    // den der Nutzer GERADE ansieht (ausgewählt UND Pane hat den Grid-Fokus),
    // darf es unterdrücken.
    afterEach(() => {
      disposeTerminalActivity("tab-1");
      disposeTerminalActivity("tab-2");
    });

    it("zeigt das Badge für den ausgewählten Tab einer unfokussierten Pane", () => {
      reportLineAdvance("tab-2", 1);
      renderTabs(baseProps({ activeTerminalTabId: "tab-2", paneFocused: false }));

      expect(
        screen.getByRole("button", { name: "Terminal 2: Aktiv im Hintergrund" }),
      ).toBeInTheDocument();
    });

    it("unterdrückt das Badge nur für den Tab, den der Nutzer in der fokussierten Pane gerade ansieht", () => {
      reportLineAdvance("tab-2", 1);
      renderTabs(baseProps({ activeTerminalTabId: "tab-2", paneFocused: true }));

      expect(
        screen.queryByRole("button", { name: "Terminal 2: Aktiv im Hintergrund" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Terminal 2" })).toBeInTheDocument();
    });
  });

  describe("Tool-Icon-Erkennung", () => {
    it("hängt den erkannten Tool-Namen an Tooltip und aria-label an", async () => {
      const detectTool = vi
        .fn<PtyBackend["detectTool"]>()
        .mockImplementation((tabId) => Promise.resolve(tabId === "tab-1" ? "claude" : null)); // brandlint-ok: kanonische Tool-ID als Test-Fixture für toolIcons.tsx' Mapping
      renderTabsWithBackend(baseProps(), fakePtyBackend(detectTool));

      expect(await screen.findByRole("button", { name: "Terminal 1: Claude Code" })).toBeInTheDocument(); // brandlint-ok: erwarteter i18n-Anzeigename desselben Mappings
      expect(screen.getByRole("button", { name: "Terminal 2" })).toBeInTheDocument();
    });

    it("zeigt kein Icon und keinen Namenszusatz für einen unbekannten Prozess", async () => {
      const detectTool = vi.fn<PtyBackend["detectTool"]>().mockResolvedValue("some-unknown-tool");
      renderTabsWithBackend(baseProps(), fakePtyBackend(detectTool));

      await waitFor(() => expect(detectTool).toHaveBeenCalled());
      expect(screen.getByRole("button", { name: "Terminal 1" })).toBeInTheDocument();
    });
  });
});
