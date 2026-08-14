import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneTabs, type PaneTabsProps } from "./PaneTabs";
import { reportLineAdvance, resetTerminalActivityForTests } from "../terminal/terminalActivity";
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
  tabDrag: {
    start: vi.fn(),
    consumeClick: () => false,
    draggingTabId: null,
    draggable: true,
  },
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

  describe("Tab-Zug: Einfüge-Platzhalter und Ankunfts-Quittung", () => {
    // Politur-Runde nach Nutzer-Befund ("er muss mir natürlich auch
    // anzeigen, wo ich ihn jetzt loslassen könnte und ihn dort einsortieren
    // kann"): schwebt ein Tab-Zug über der Pane, zeigt die Leiste einen
    // Platzhalter-Chip mit der Nummer, die der Tab hier bekäme; nach dem
    // Drop quittiert der angekommene Chip mit einem einmaligen Wasch.
    it("zeigt den Platzhalter-Chip mit der künftigen Nummer, solange ein Zug über der Pane schwebt", () => {
      const { container, rerender } = renderTabs(
        baseProps({ incomingTabNumber: 3 }),
      );

      const slot = container.querySelector("[data-incoming-tab]");
      expect(slot).not.toBeNull();
      expect(slot).toHaveTextContent("3");
      // Rein visuell, kein Bedienelement: dem Zeiger gehört der Zug.
      expect(slot).toHaveAttribute("aria-hidden", "true");

      rerender(
        <Tooltip.Provider>
          <PaneTabs {...baseProps({ incomingTabNumber: null })} />
        </Tooltip.Provider>,
      );
      expect(container.querySelector("[data-incoming-tab]")).toBeNull();
    });

    it("quittiert den angekommenen Tab mit dem Settle-Wasch, nur an genau diesem Chip", () => {
      const { container } = renderTabs(
        baseProps({ dropSettle: { tabId: "tab-2", nonce: 1 } }),
      );

      const washes = container.querySelectorAll("[data-drop-settle]");
      expect(washes).toHaveLength(1);
      expect(
        screen
          .getByRole("button", { name: "Terminal 2" })
          .querySelector("[data-drop-settle]"),
      ).not.toBeNull();
    });
  });

  describe("Needs-Attention: Ungelesen-Punkt", () => {
    // Umbau 2026-08-13 (Nutzer-Neuspezifikation, s. Kopfkommentar von
    // PaneTabs.tsx, Umbau-Absatz): persistent statt transient. Der
    // allererste Burst eines frischen Tab-Eintrags gilt als Shell-Start-
    // Prompt und wird konsumiert, ohne zu markieren (terminalActivity.ts'
    // `firstBurstConsumed`) — deshalb meldet jeder Test hier zuerst einen
    // "Freipass"-Burst, bevor der eigentlich zu prüfende Burst kommt.
    // `resetTerminalActivityForTests` statt einzelner
    // `disposeTerminalActivity`-Aufrufe: löscht zusätzlich `viewedTabId`
    // (terminalActivity.ts), das an keinem einzelnen Tab-Eintrag hängt und
    // sonst aus früheren Tests dieser Datei durchsickern würde — jeder
    // vorherige Test in dieser Datei rendert mit dem `baseProps`-Default
    // (`activeTerminalTabId: "tab-1", paneFocused: true`) und setzt darüber
    // unbemerkt `viewedTabId = "tab-1"`.
    beforeEach(() => {
      resetTerminalActivityForTests();
    });
    afterEach(() => {
      resetTerminalActivityForTests();
    });

    it("zeigt den Punkt für einen Hintergrund-Tab einer unfokussierten Pane, ab dem zweiten Burst", () => {
      renderTabs(baseProps({ activeTerminalTabId: "tab-2", paneFocused: false }));

      act(() => {
        reportLineAdvance("tab-2", 1); // Freipass (Start-Prompt)
        reportLineAdvance("tab-2", 1);
      });

      expect(
        screen.getByRole("button", { name: "Terminal 2: Ungelesene Aktivität" }),
      ).toBeInTheDocument();
    });

    it("unterdrückt den Punkt nur für den Tab, den der Nutzer in der fokussierten Pane gerade ansieht", () => {
      renderTabs(baseProps({ activeTerminalTabId: "tab-2", paneFocused: true }));

      act(() => {
        reportLineAdvance("tab-2", 1);
        reportLineAdvance("tab-2", 1);
      });

      expect(
        screen.queryByRole("button", { name: "Terminal 2: Ungelesene Aktivität" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Terminal 2" })).toBeInTheDocument();
    });

    it("löscht den Punkt erst, wenn der Tab tatsächlich geöffnet wird — nicht durch Zeitablauf", () => {
      vi.useFakeTimers();
      const props = baseProps({ activeTerminalTabId: "tab-1", paneFocused: true });
      const { rerender } = renderTabs(props);

      act(() => {
        reportLineAdvance("tab-2", 1);
        reportLineAdvance("tab-2", 1);
      });
      expect(
        screen.getByRole("button", { name: "Terminal 2: Ungelesene Aktivität" }),
      ).toBeInTheDocument();

      // Beliebig langes Verstreichen von Zeit — weit über jedes Idle-Fenster
      // hinaus — löscht den Punkt NICHT, nur tatsächliches Öffnen darf das
      // (Nutzer-Zitat: "so lange, bis man den Tab aufgemacht hat").
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(
        screen.getByRole("button", { name: "Terminal 2: Ungelesene Aktivität" }),
      ).toBeInTheDocument();
      vi.useRealTimers();

      rerender(
        <Tooltip.Provider>
          <PaneTabs {...props} activeTerminalTabId="tab-2" />
        </Tooltip.Provider>,
      );

      expect(
        screen.queryByRole("button", { name: "Terminal 2: Ungelesene Aktivität" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Terminal 2" })).toBeInTheDocument();
    });

    it("re-armiert den Punkt nach dem Ansehen erneut, sobald neue Hintergrund-Aktivität die Schwelle wieder erreicht", () => {
      // Regressionstest zum Fund 2026-08-13 ("Ich habe alle angeklickt...
      // aber danach passierte nichts") — genau das Szenario, das der Nutzer
      // beschrieben hat: Punkt sehen, Tab öffnen (löscht ihn), Tab
      // verlassen, neue Aktivität, Punkt muss zurückkommen.
      const props = baseProps({ activeTerminalTabId: "tab-1", paneFocused: true });
      const { rerender } = renderTabs(props);

      act(() => {
        reportLineAdvance("tab-2", 1); // Freipass
        reportLineAdvance("tab-2", 1); // markiert unread
      });
      expect(
        screen.getByRole("button", { name: "Terminal 2: Ungelesene Aktivität" }),
      ).toBeInTheDocument();

      // Tab 2 öffnen (fokussierte Pane) — löscht den Punkt.
      rerender(
        <Tooltip.Provider>
          <PaneTabs {...props} activeTerminalTabId="tab-2" />
        </Tooltip.Provider>,
      );
      expect(screen.getByRole("button", { name: "Terminal 2" })).toBeInTheDocument();

      // Zurück zu Tab 1, tab-2 bekommt neue Hintergrund-Aktivität.
      rerender(
        <Tooltip.Provider>
          <PaneTabs {...props} activeTerminalTabId="tab-1" />
        </Tooltip.Provider>,
      );
      act(() => {
        reportLineAdvance("tab-2", 1);
      });

      expect(
        screen.getByRole("button", { name: "Terminal 2: Ungelesene Aktivität" }),
      ).toBeInTheDocument();
    });
  });

  describe("Leiterbahn-Anbindung (Stub + Dämpfung)", () => {
    // Zwei Ergänzungen der Fokus-Leiterbahn-Runde (Kopfkommentar in
    // PaneTabs.tsx, Leiterbahn-Nachtrag): der Löt-Steg unter dem aktiven
    // Chip existiert nur bei Pane-Fokus, und ohne Pane-Fokus fällt das
    // Akzent-Amber des aktiven Tabs auf die 45%-Dämpfung des Pane-Headers.
    it("lötet den aktiven Tab nur in der fokussierten Pane auf die Leitung", () => {
      const { container, rerender } = renderTabs(baseProps({ paneFocused: true }));
      expect(container.querySelectorAll("[data-trace-stub]")).toHaveLength(1);

      rerender(
        <Tooltip.Provider>
          <PaneTabs {...baseProps({ paneFocused: false })} />
        </Tooltip.Provider>,
      );
      expect(container.querySelector("[data-trace-stub]")).toBeNull();
    });

    it("trägt der Datei-Tab denselben Steg, wenn er der aktive ist", () => {
      const { container } = renderTabs(
        baseProps({ paneFocused: true, showingFile: true, fileName: "a.ts" }),
      );

      const fileTab = screen.getByRole("button", { name: "a.ts" });
      expect(fileTab.querySelector("[data-trace-stub]")).not.toBeNull();
      // Der jetzt inaktive Terminal-Chip bekommt keinen.
      expect(container.querySelectorAll("[data-trace-stub]")).toHaveLength(1);
    });

    it("dämpft das Amber des aktiven Tabs in einer unfokussierten Pane auf /45", () => {
      renderTabs(baseProps({ paneFocused: false }));

      const active = screen.getByRole("button", { name: "Terminal 1" });
      expect(active.className).toContain("border-(--pc-pane-activeBorder)/45");
    });

    it("lässt den aktiven Tab der fokussierten Pane in voller Sättigung", () => {
      renderTabs(baseProps({ paneFocused: true }));

      const active = screen.getByRole("button", { name: "Terminal 1" });
      expect(active.className).toContain("border-(--pc-pane-activeBorder)");
      expect(active.className).not.toContain("border-(--pc-pane-activeBorder)/45");
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
