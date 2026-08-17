import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneTabs, type PaneTabsProps } from "./PaneTabs";
import {
  reportOutput,
  resetTerminalActivityForTests,
  setActivityIdleMs,
} from "../terminal/terminalActivity";
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

  it("schließt den Tab nur über das Kontextmenü, ohne ihn auszuwählen", async () => {
    const props = baseProps();
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 2"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Terminal 2 schließen" }));

    // Wie beim Umbenennen (s. Test unten) läuft `onClose` erst über Radix'
    // `onCloseAutoFocus`, also erst einen Tick nach dem Klick — direkt aus
    // `onSelect` hätte es mit dem noch aktiven ContextMenu-FocusScope-Trap
    // kollidiert (PaneTabs.tsx' `pendingActionRef`-Kommentar; genau das war
    // der real gemeldete Bug: "Schließen" tat sichtbar nichts).
    await waitFor(() => expect(props.onCloseTerminalTab).toHaveBeenCalledWith("tab-2"));
    expect(props.onSelectTerminalTab).not.toHaveBeenCalled();
  });

  it("schließt alle Tabs rechts vom angeklickten über das Kontextmenü", async () => {
    const props = baseProps({
      terminalTabs: [
        { tabId: "tab-1", number: 1, label: null },
        { tabId: "tab-2", number: 2, label: null },
        { tabId: "tab-3", number: 3, label: null },
      ],
    });
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 1"));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "2 Tabs rechts davon schließen" }),
    );

    await waitFor(() =>
      expect(props.onCloseTerminalTabsToRight).toHaveBeenCalledWith("tab-1"),
    );
  });

  it("schließt alle anderen Tabs über das Kontextmenü", async () => {
    const props = baseProps({
      terminalTabs: [
        { tabId: "tab-1", number: 1, label: null },
        { tabId: "tab-2", number: 2, label: null },
        { tabId: "tab-3", number: 3, label: null },
      ],
    });
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 2"));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "2 andere Tabs schließen" }),
    );

    await waitFor(() =>
      expect(props.onCloseOtherTerminalTabs).toHaveBeenCalledWith("tab-2"),
    );
  });

  it("bietet für den letzten Tab keinen 'Tabs rechts schließen'-Menüpunkt", () => {
    const props = baseProps({
      terminalTabs: [
        { tabId: "tab-1", number: 1, label: null },
        { tabId: "tab-2", number: 2, label: null },
      ],
    });
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 2"));

    expect(
      screen.queryByRole("menuitem", { name: /Tabs? rechts davon schließen/ }),
    ).not.toBeInTheDocument();
  });

  it("bietet für den letzten verbleibenden Tab keinen Schließen-Menüpunkt", () => {
    renderTabs(baseProps({ terminalTabs: [{ tabId: "tab-1", number: 1, label: null }] }));

    fireEvent.contextMenu(chipTrigger("Terminal 1"));

    expect(screen.queryByRole("menuitem", { name: "Terminal 1 schließen" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /andere Tabs? schließen/ }),
    ).not.toBeInTheDocument();
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
        baseProps({ incomingTab: { index: 2, number: 3 } }),
      );

      const slot = container.querySelector("[data-incoming-tab]");
      expect(slot).not.toBeNull();
      expect(slot).toHaveTextContent("3");
      // Rein visuell, kein Bedienelement: dem Zeiger gehört der Zug.
      expect(slot).toHaveAttribute("aria-hidden", "true");

      rerender(
        <Tooltip.Provider>
          <PaneTabs {...baseProps({ incomingTab: null })} />
        </Tooltip.Provider>,
      );
      expect(container.querySelector("[data-incoming-tab]")).toBeNull();
    });

    it("stellt den Platzhalter an den Einfüge-Slot ZWISCHEN die Chips, nicht ans Ende (Präzisions-Runde)", () => {
      // index 1 = zwischen Terminal 1 und Terminal 2 — der Nutzer-Befund
      // hinter der Runde: "ich möchte … das Drag-Tab zwischen zwei andere
      // Tabs platzieren können".
      const { container } = renderTabs(
        baseProps({ incomingTab: { index: 1, number: 2 } }),
      );

      const slot = container.querySelector("[data-incoming-tab]");
      expect(slot).not.toBeNull();
      expect(slot).toHaveTextContent("2");
      // DOM-Reihenfolge in der Leiste: Chip 1 davor, Chip 2 dahinter.
      expect(
        slot?.previousElementSibling?.querySelector(
          '[data-terminal-tab-chip="tab-1"]',
        ),
      ).not.toBeNull();
      expect(
        slot?.nextElementSibling?.querySelector(
          '[data-terminal-tab-chip="tab-2"]',
        ),
      ).not.toBeNull();
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

  describe("Needs-Attention: wartet-auf-dich-Punkt", () => {
    // 2026-08-17 rewrite (user bug report: activity detection "doesn't work
    // meaningfully" — see terminalActivity.ts header comment for the full
    // root-cause finding and semantic rewrite). The marker now means "this
    // tab did real work, then went quiet" — the inverse of the previous
    // "unread" signal: it appears once idle instead of on new output, and
    // disappears the instant new output arrives instead of only on viewing.
    //
    // The very first burst of a fresh tab entry still counts as the shell's
    // own startup prompt and gets consumed without arming the marker
    // (terminalActivity.ts' `bootBurstConsumed`) — every test here reports
    // that "free pass" burst before the one actually under test.
    //
    // idleMs is lowered to keep these tests fast (the real default is
    // 15000ms, config_core.rs) — reset in afterEach so it can't leak into
    // later tests in this file. `resetTerminalActivityForTests` (rather than
    // individual `disposeTerminalActivity` calls) additionally clears
    // `viewedTabId` (terminalActivity.ts), which isn't tied to any single
    // tab entry and would otherwise leak from earlier tests in this file —
    // every prior test here renders with the `baseProps` default
    // (`activeTerminalTabId: "tab-1", paneFocused: true`), which sets
    // `viewedTabId = "tab-1"` unnoticed.
    const TEST_IDLE_MS = 1000;
    beforeEach(() => {
      resetTerminalActivityForTests();
      setActivityIdleMs(TEST_IDLE_MS);
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
      resetTerminalActivityForTests();
      setActivityIdleMs(15000);
    });

    it("shows the dot for a background tab of an unfocused pane once it goes idle after real work", () => {
      renderTabs(baseProps({ activeTerminalTabId: "tab-2", paneFocused: false }));

      act(() => {
        reportOutput("tab-2", 1); // free pass (boot prompt)
        reportOutput("tab-2", 1);
      });
      expect(
        screen.queryByRole("button", { name: "Terminal 2: Wartet auf dich" }),
      ).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });
      expect(
        screen.getByRole("button", { name: "Terminal 2: Wartet auf dich" }),
      ).toBeInTheDocument();
    });

    it("never shows the dot for the tab the user is currently viewing, even once idle", () => {
      renderTabs(baseProps({ activeTerminalTabId: "tab-2", paneFocused: true }));

      act(() => {
        reportOutput("tab-2", 1);
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });

      expect(
        screen.queryByRole("button", { name: "Terminal 2: Wartet auf dich" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Terminal 2" })).toBeInTheDocument();
    });

    it("clears the dot the instant new output arrives, without needing to open the tab", () => {
      renderTabs(baseProps({ activeTerminalTabId: "tab-1", paneFocused: true }));

      act(() => {
        reportOutput("tab-2", 1);
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });
      expect(
        screen.getByRole("button", { name: "Terminal 2: Wartet auf dich" }),
      ).toBeInTheDocument();

      act(() => {
        reportOutput("tab-2", 1); // e.g. the agent starts working again
      });
      expect(
        screen.queryByRole("button", { name: "Terminal 2: Wartet auf dich" }),
      ).not.toBeInTheDocument();
    });

    it("clears the dot as soon as the tab is actually opened", () => {
      const props = baseProps({ activeTerminalTabId: "tab-1", paneFocused: true });
      const { rerender } = renderTabs(props);

      act(() => {
        reportOutput("tab-2", 1);
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });
      expect(
        screen.getByRole("button", { name: "Terminal 2: Wartet auf dich" }),
      ).toBeInTheDocument();

      rerender(
        <Tooltip.Provider>
          <PaneTabs {...props} activeTerminalTabId="tab-2" />
        </Tooltip.Provider>,
      );

      expect(
        screen.queryByRole("button", { name: "Terminal 2: Wartet auf dich" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Terminal 2" })).toBeInTheDocument();
    });

    it("flags the tab again immediately once the user looks away, if it's still idle and nothing changed", () => {
      // Not a bug: `isTabAwaitingAttention` is derived live from current
      // state (terminalActivity.ts), not a sticky dismissal flag — a tab
      // that finished while being watched, and still hasn't produced
      // anything new, genuinely IS "done and not being looked at" the
      // moment the user moves on.
      const props = baseProps({ activeTerminalTabId: "tab-2", paneFocused: true });
      const { rerender } = renderTabs(props);

      act(() => {
        reportOutput("tab-2", 1);
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS); // finishes while being watched
      });
      expect(
        screen.queryByRole("button", { name: "Terminal 2: Wartet auf dich" }),
      ).not.toBeInTheDocument();

      rerender(
        <Tooltip.Provider>
          <PaneTabs {...props} activeTerminalTabId="tab-1" />
        </Tooltip.Provider>,
      );

      expect(
        screen.getByRole("button", { name: "Terminal 2: Wartet auf dich" }),
      ).toBeInTheDocument();
    });

    it("re-arms after being opened, once new background activity goes idle again", () => {
      const props = baseProps({ activeTerminalTabId: "tab-1", paneFocused: true });
      const { rerender } = renderTabs(props);

      act(() => {
        reportOutput("tab-2", 1); // free pass
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });
      expect(
        screen.getByRole("button", { name: "Terminal 2: Wartet auf dich" }),
      ).toBeInTheDocument();

      // Open tab 2 (focused pane) — clears the dot.
      rerender(
        <Tooltip.Provider>
          <PaneTabs {...props} activeTerminalTabId="tab-2" />
        </Tooltip.Provider>,
      );
      expect(screen.getByRole("button", { name: "Terminal 2" })).toBeInTheDocument();

      // Back to tab 1, tab-2 gets new background activity, then goes idle again.
      rerender(
        <Tooltip.Provider>
          <PaneTabs {...props} activeTerminalTabId="tab-1" />
        </Tooltip.Provider>,
      );
      act(() => {
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });

      expect(
        screen.getByRole("button", { name: "Terminal 2: Wartet auf dich" }),
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
