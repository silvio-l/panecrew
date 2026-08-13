import { fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import { describe, expect, it, vi } from "vitest";
import { PaneTabs, type PaneTabsProps } from "./PaneTabs";

// Regressionstest zur Nutzerbeschwerde vom 2026-08-13 (s. Kopfkommentar in
// PaneTabs.tsx): der Chip war ursprünglich EIN `absolute inset-0`-Knopf, den
// Hover komplett zum Schließkreuz machte — ein Klick auf die Zahl schloss den
// Tab, statt ihn auszuwählen. Dieser Test rendert echtes DOM (kein
// Shallow-Mock) und prüft genau die Klick-Ziele, die den Unterschied machen:
// Zahl/Punkt wählt aus, das separate Kreuz schließt — nie beides zugleich.
const baseProps = (
  overrides: Partial<PaneTabsProps> = {},
): PaneTabsProps => ({
  terminalTabs: [
    { tabId: "tab-1", number: 1 },
    { tabId: "tab-2", number: 2 },
  ],
  activeTerminalTabId: "tab-1",
  showingFile: false,
  fileName: null,
  fileDirty: false,
  onSelectTerminalTab: vi.fn(),
  onOpenTerminalTab: vi.fn(),
  onCloseTerminalTab: vi.fn(),
  onSelectFile: vi.fn(),
  ...overrides,
});

const renderTabs = (props: PaneTabsProps) =>
  render(
    <Tooltip.Provider>
      <PaneTabs {...props} />
    </Tooltip.Provider>,
  );

describe("PaneTabs", () => {
  it("wählt den Tab per Klick auf die Zahl aus, ohne ihn zu schließen", () => {
    const props = baseProps();
    renderTabs(props);

    fireEvent.click(screen.getByRole("button", { name: "Terminal 2" }));

    expect(props.onSelectTerminalTab).toHaveBeenCalledWith("tab-2");
    expect(props.onCloseTerminalTab).not.toHaveBeenCalled();
  });

  it("schließt den Tab nur über das eigene Schließkreuz, ohne ihn auszuwählen", () => {
    const props = baseProps();
    renderTabs(props);

    fireEvent.click(
      screen.getByRole("button", { name: "Terminal 2 schließen" }),
    );

    expect(props.onCloseTerminalTab).toHaveBeenCalledWith("tab-2");
    expect(props.onSelectTerminalTab).not.toHaveBeenCalled();
  });

  it("reserviert dem Schließkreuz denselben Randbereich, ob schließbar oder nicht", () => {
    // Bug vom 2026-08-13 (Advisor-Review): `pr-4` galt nur, solange
    // `closable` true war — der letzte verbleibende Tab (nicht schließbar)
    // wurde dadurch schmaler als jeder andere, derselbe Breitensprung, den
    // dieser Umbau eigentlich beheben sollte. Ein Rendern mit nur einem Tab
    // muss dieselbe Randklasse tragen wie eines mit mehreren.
    renderTabs(baseProps({ terminalTabs: [{ tabId: "tab-1", number: 1 }] }));

    const button = screen.getByRole("button", { name: "Terminal 1" });
    expect(button.className).toContain("pr-4");
    expect(button.className).not.toContain("pr-1.5");
  });
});
