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
  tabs: [
    { kind: "terminal", tabId: "tab-1", shortcutPosition: 1, label: null },
    { kind: "terminal", tabId: "tab-2", shortcutPosition: 2, label: null },
  ],
  activeTabId: "tab-1",
  paneFocused: true,
  project: {
    name: "panecrew",
    path: "/Users/dev/projects/panecrew",
    gitRepo: null,
  },
  onSelectTab: vi.fn(),
  onOpenTerminalTab: vi.fn(),
  onCloseTerminalTab: vi.fn(),
  onCloseOtherTerminalTabs: vi.fn(),
  onCloseTerminalTabsToRight: vi.fn(),
  onRenameTerminalTab: vi.fn(),
  onCloseFileTab: vi.fn(),
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

/** Öffnet Radix' `DropdownMenu` (Adapter-Picker, Ticket 35) — jsdom feuert
 * kein reales Pointer-Gerät, ein bloßer `fireEvent.click` allein lässt
 * Radix' Trigger deshalb geschlossen (kein `data-state="open"`); erst der
 * vorgeschaltete `pointerdown` bringt denselben Zustand wie ein echter
 * Maus-Klick. */
const openAdapterDropdown = () => {
  const trigger = screen.getByRole("button", { name: "Terminal-Tab mit Tool öffnen" });
  fireEvent.pointerDown(trigger, { pointerId: 1, button: 0, isPrimary: true });
  fireEvent.click(trigger);
};

describe("PaneTabs", () => {
  it("uses tool identity instead of position numbering on terminal chips", () => {
    const { container } = renderTabs(baseProps());
    const chips = container.querySelectorAll("[data-pane-tab-chip]");

    expect(chips[0]).toHaveTextContent("Shell");
    expect(chips[0]).not.toHaveTextContent("1");
    expect(chips[0]).toHaveAccessibleName("Terminal 1: Shell");
    expect(chips[1]).toHaveTextContent("Shell");
    expect(chips[1]).not.toHaveTextContent("2");
    expect(chips[1]).toHaveAccessibleName("Terminal 2: Shell");
  });

  it("does not advertise a single file tab as draggable without a valid target", () => {
    const { container } = renderTabs(
      baseProps({
        tabs: [
          {
            kind: "file",
            tabId: "file-only",
            label: "README.md",
            path: "/repo/README.md",
            dirty: false,
          },
        ],
        activeTabId: "file-only",
      }),
    );

    expect(container.querySelector("[data-pane-tab-chip]")).not.toHaveClass(
      "cursor-grab",
    );
  });

  it("renders multiple File-Tabs in the same mixed order as Terminal-Tabs", () => {
    const props = baseProps({
      tabs: [
        { kind: "file", tabId: "file-a", label: "a.ts", path: "/repo/a.ts", dirty: false },
        { kind: "terminal", tabId: "tab-1", shortcutPosition: 1, label: null },
        { kind: "file", tabId: "file-b", label: "b.rs", path: "/repo/b.rs", dirty: true },
      ],
      activeTabId: "file-b",
    });
    const { container } = renderTabs(props);

    expect(
      [...container.querySelectorAll("[data-pane-tab-chip]")].map((chip) =>
        chip.getAttribute("data-pane-tab-chip"),
      ),
    ).toEqual(["file-a", "tab-1", "file-b"]);
    expect(screen.getByRole("button", { name: /b\.rs/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows and dismisses the non-blocking six-terminal performance warning", () => {
    const onDismiss = vi.fn();
    renderTabs(
      baseProps({
        tabs: Array.from({ length: 6 }, (_, index) => ({
          kind: "terminal" as const,
          tabId: `tab-${String(index + 1)}`,
          shortcutPosition: index + 1,
          label: null,
        })),
        terminalPerformanceWarning: { dismissed: false, onDismiss },
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Viele Terminal-Tabs können die Leistung beeinträchtigen",
    );
    fireEvent.click(screen.getByRole("button", { name: "Hinweis ausblenden" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("zeigt nach kurzem Hover eine tabbezogene Terminal-Übersicht", () => {
    vi.useFakeTimers();
    try {
      const props = baseProps({
        tabs: [
          { kind: "terminal", tabId: "tab-1", shortcutPosition: 1, label: null },
          { kind: "terminal", tabId: "tab-2", shortcutPosition: 2, label: "API-Agent", adapterId: "codex" }, // brandlint-ok: functional adapter ID
        ],
        project: {
          name: "panecrew",
          path: "/Users/dev/projects/panecrew",
          gitRepo: {
            branch: { name: "dev", detached: false, ahead: 3, behind: 1 },
            dirtyCount: 4,
            worktree: null,
          },
        },
      });
      renderTabs(props);

      fireEvent.pointerEnter(chipTrigger("Terminal 2: API-Agent"));
      act(() => {
        vi.advanceTimersByTime(400);
      });

      const overview = screen.getByRole("dialog", { name: "Übersicht für API-Agent" });
      expect(overview).toHaveTextContent("Terminal-Tab");
      expect(overview).toHaveTextContent("Codex CLI"); // brandlint-ok: canonical adapter display label
      expect(overview).toHaveTextContent("panecrew");
      expect(overview).toHaveTextContent("/Users/dev/projects/panecrew");
      expect(overview).toHaveTextContent("dev");
      expect(overview).toHaveTextContent("4 geänderte Dateien");
      expect(overview).toHaveTextContent("3 Commits vor dem Upstream");
      expect(overview).toHaveTextContent("1 Commit hinter dem Upstream");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses tool identity instead of position in an unnamed terminal overview", () => {
    vi.useFakeTimers();
    try {
      renderTabs(baseProps());

      fireEvent.pointerEnter(chipTrigger("Terminal 1: Shell"));
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(
        screen.getByRole("dialog", { name: "Übersicht für Shell" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("dialog", { name: "Übersicht für Terminal 1" }),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("zeigt im File-Tab den exakten Pfad und ungespeicherte Änderungen", () => {
    vi.useFakeTimers();
    try {
      renderTabs(
        baseProps({
          tabs: [
            { kind: "terminal", tabId: "tab-1", shortcutPosition: 1, label: null },
            {
              kind: "file",
              tabId: "file-1",
              label: "PaneTabs.tsx",
              path: "/Users/dev/projects/panecrew/apps/desktop/src/components/PaneTabs.tsx",
              dirty: true,
            },
          ],
          activeTabId: "file-1",
        }),
      );

      fireEvent.pointerEnter(
        screen.getByRole("button", { name: /PaneTabs\.tsx/ }),
      );
      act(() => {
        vi.advanceTimersByTime(400);
      });

      const overview = screen.getByRole("dialog", {
        name: "Übersicht für PaneTabs.tsx",
      });
      expect(overview).toHaveTextContent("File-Tab");
      expect(overview).toHaveTextContent("Ungespeicherte Änderungen");
      expect(overview).toHaveTextContent(
        "/Users/dev/projects/panecrew/apps/desktop/src/components/PaneTabs.tsx",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("öffnet während eines Tab-Zugs keine Übersicht über den Drop-Zielen", () => {
    vi.useFakeTimers();
    try {
      renderTabs(
        baseProps({
          tabDrag: {
            start: vi.fn(),
            consumeClick: () => false,
            draggingTabId: "tab-2",
            draggable: true,
          },
        }),
      );

      fireEvent.pointerEnter(chipTrigger("Terminal 2: Shell"));
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(screen.queryByRole("dialog", { name: "Übersicht für Shell" }))
        .not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("öffnet die Übersicht erst nach kurzem Verweilen und schließt sie nach dem Verlassen", () => {
    vi.useFakeTimers();
    try {
      renderTabs(baseProps());
      const trigger = chipTrigger("Terminal 2: Shell");

      fireEvent.pointerEnter(trigger);
      act(() => {
        vi.advanceTimersByTime(349);
      });
      expect(screen.queryByRole("dialog", { name: "Übersicht für Shell" }))
        .not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByRole("dialog", { name: "Übersicht für Shell" }))
        .toBeInTheDocument();

      fireEvent.pointerLeave(trigger);
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(screen.queryByRole("dialog", { name: "Übersicht für Shell" }))
        .not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("macht dieselbe Übersicht per Tastaturfokus erreichbar", () => {
    vi.useFakeTimers();
    try {
      renderTabs(baseProps());

      fireEvent.focus(screen.getByRole("button", { name: "Terminal 2: Shell" }));
      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(screen.getByRole("dialog", { name: "Übersicht für Shell" }))
        .toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("wählt den Tab per Klick auf die Zahl aus, ohne ihn zu schließen", () => {
    const props = baseProps();
    renderTabs(props);

    fireEvent.click(screen.getByRole("button", { name: "Terminal 2: Shell" }));

    expect(props.onSelectTab).toHaveBeenCalledWith("tab-2");
    expect(props.onCloseTerminalTab).not.toHaveBeenCalled();
  });

  describe("Adapter-Picker (Ticket 35)", () => {
    it("öffnet mit dem \"+\"-Knopf einen Terminal-Tab ohne explizite Adapter-Wahl", () => {
      const props = baseProps();
      renderTabs(props);

      fireEvent.click(screen.getByRole("button", { name: "Weiteren Terminal-Tab öffnen" }));

      // `undefined`, nicht `null`: der Aufrufer (`useGrid.ts`) löst den
      // `terminal.defaultAdapter`-Default nur bei ECHT fehlendem Argument
      // auf, ein explizites `null` bliebe (fälschlich) die eingebaute Shell.
      expect(props.onOpenTerminalTab).toHaveBeenCalledWith();
    });

    it("öffnet einen Terminal-Tab mit einem bestimmten Tool über das Dropdown daneben", () => {
      const props = baseProps();
      renderTabs(props);

      openAdapterDropdown();
      fireEvent.click(screen.getByRole("menuitem", { name: "Codex CLI" })); // brandlint-ok: canonical adapter display label, functional

      expect(props.onOpenTerminalTab).toHaveBeenCalledWith("codex"); // brandlint-ok: canonical adapter id, functional
    });

    it("öffnet über \"Shell\" im Dropdown explizit ohne Adapter statt den Default zu übernehmen", () => {
      const props = baseProps();
      renderTabs(props);

      openAdapterDropdown();
      fireEvent.click(screen.getByRole("menuitem", { name: "Shell" }));

      expect(props.onOpenTerminalTab).toHaveBeenCalledWith(null);
    });
  });

  it("schließt den Tab nur über das Kontextmenü, ohne ihn auszuwählen", async () => {
    const props = baseProps();
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 2: Shell"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Terminal-Tab schließen" }));

    // Wie beim Umbenennen (s. Test unten) läuft `onClose` erst über Radix'
    // `onCloseAutoFocus`, also erst einen Tick nach dem Klick — direkt aus
    // `onSelect` hätte es mit dem noch aktiven ContextMenu-FocusScope-Trap
    // kollidiert (PaneTabs.tsx' `pendingActionRef`-Kommentar; genau das war
    // der real gemeldete Bug: "Schließen" tat sichtbar nichts).
    await waitFor(() => expect(props.onCloseTerminalTab).toHaveBeenCalledWith("tab-2"));
    expect(props.onSelectTab).not.toHaveBeenCalled();
  });

  it("schließt alle Tabs rechts vom angeklickten über das Kontextmenü", async () => {
    const props = baseProps({
      tabs: [
        { kind: "terminal", tabId: "tab-1", shortcutPosition: 1, label: null },
        { kind: "terminal", tabId: "tab-2", shortcutPosition: 2, label: null },
        { kind: "terminal", tabId: "tab-3", shortcutPosition: 3, label: null },
      ],
    });
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 1: Shell"));
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: "2 Terminal-Tabs rechts davon schließen",
      }),
    );

    await waitFor(() =>
      expect(props.onCloseTerminalTabsToRight).toHaveBeenCalledWith("tab-1"),
    );
  });

  it("schließt alle anderen Tabs über das Kontextmenü", async () => {
    const props = baseProps({
      tabs: [
        { kind: "terminal", tabId: "tab-1", shortcutPosition: 1, label: null },
        { kind: "terminal", tabId: "tab-2", shortcutPosition: 2, label: null },
        { kind: "terminal", tabId: "tab-3", shortcutPosition: 3, label: null },
      ],
    });
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 2: Shell"));
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: "2 andere Terminal-Tabs schließen",
      }),
    );

    await waitFor(() =>
      expect(props.onCloseOtherTerminalTabs).toHaveBeenCalledWith("tab-2"),
    );
  });

  it("bietet für den letzten Tab keinen 'Tabs rechts schließen'-Menüpunkt", () => {
    const props = baseProps({
      tabs: [
        { kind: "terminal", tabId: "tab-1", shortcutPosition: 1, label: null },
        { kind: "terminal", tabId: "tab-2", shortcutPosition: 2, label: null },
      ],
    });
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 2: Shell"));

    expect(
      screen.queryByRole("menuitem", { name: /Tabs? rechts davon schließen/ }),
    ).not.toBeInTheDocument();
  });

  it("bietet für den letzten verbleibenden Tab keinen Schließen-Menüpunkt", () => {
    renderTabs(baseProps({ tabs: [{ kind: "terminal", tabId: "tab-1", shortcutPosition: 1, label: null }] }));

    fireEvent.contextMenu(chipTrigger("Terminal 1: Shell"));

    expect(screen.queryByRole("menuitem", { name: "Terminal-Tab schließen" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /andere Tabs? schließen/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Terminal-Tab umbenennen" })).toBeInTheDocument();
  });

  it("benennt einen Tab über das Kontextmenü um", async () => {
    const props = baseProps();
    renderTabs(props);

    fireEvent.contextMenu(chipTrigger("Terminal 2: Shell"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Terminal-Tab umbenennen" }));

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

    fireEvent.contextMenu(chipTrigger("Terminal 2: Shell"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Terminal-Tab umbenennen" }));
    const field = await screen.findByRole("textbox", { name: "Name für Terminal 2" });
    fireEvent.change(field, { target: { value: "build" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(props.onRenameTerminalTab).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Terminal 2: Shell" })).toBeInTheDocument();
  });

  describe("Tab-Zug: Einfüge-Platzhalter und Ankunfts-Quittung", () => {
    // Politur-Runde nach Nutzer-Befund ("er muss mir natürlich auch
    // anzeigen, wo ich ihn jetzt loslassen könnte und ihn dort einsortieren
    // kann"): schwebt ein Tab-Zug über der Pane, zeigt die Leiste einen
    // Placeholder marks the exact insertion slot without turning position
    // into tab identity; after the drop the arriving chip flashes once.
    it("shows an unnumbered placeholder while a drag hovers over the pane", () => {
      const { container, rerender } = renderTabs(
        baseProps({ incomingTab: { index: 2 } }),
      );

      const slot = container.querySelector("[data-incoming-tab]");
      expect(slot).not.toBeNull();
      expect(slot).toBeEmptyDOMElement();
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
        baseProps({ incomingTab: { index: 1 } }),
      );

      const slot = container.querySelector("[data-incoming-tab]");
      expect(slot).not.toBeNull();
      expect(slot).toBeEmptyDOMElement();
      // DOM-Reihenfolge in der Leiste: Chip 1 davor, Chip 2 dahinter.
      expect(
        slot?.previousElementSibling?.querySelector(
          '[data-pane-tab-chip="tab-1"]',
        ),
      ).not.toBeNull();
      expect(
        slot?.nextElementSibling?.querySelector(
          '[data-pane-tab-chip="tab-2"]',
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
          .getByRole("button", { name: "Terminal 2: Shell" })
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
    // (`activeTabId: "tab-1", paneFocused: true`), which sets
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
      renderTabs(baseProps({ activeTabId: "tab-2", paneFocused: false }));

      act(() => {
        reportOutput("tab-2", 1); // free pass (boot prompt)
        reportOutput("tab-2", 1);
      });
      expect(
        screen.queryByRole("button", { name: "Terminal 2: Shell · Wartet auf dich" }),
      ).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });
      expect(
        screen.getByRole("button", { name: "Terminal 2: Shell · Wartet auf dich" }),
      ).toBeInTheDocument();
    });

    it("never shows the dot for the tab the user is currently viewing, even once idle", () => {
      renderTabs(baseProps({ activeTabId: "tab-2", paneFocused: true }));

      act(() => {
        reportOutput("tab-2", 1);
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });

      expect(
        screen.queryByRole("button", { name: "Terminal 2: Shell · Wartet auf dich" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Terminal 2: Shell" })).toBeInTheDocument();
    });

    it("clears the dot the instant new output arrives, without needing to open the tab", () => {
      renderTabs(baseProps({ activeTabId: "tab-1", paneFocused: true }));

      act(() => {
        reportOutput("tab-2", 1);
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });
      expect(
        screen.getByRole("button", { name: "Terminal 2: Shell · Wartet auf dich" }),
      ).toBeInTheDocument();

      act(() => {
        reportOutput("tab-2", 1); // e.g. the agent starts working again
      });
      expect(
        screen.queryByRole("button", { name: "Terminal 2: Shell · Wartet auf dich" }),
      ).not.toBeInTheDocument();
    });

    it("clears the dot as soon as the tab is actually opened", () => {
      const props = baseProps({ activeTabId: "tab-1", paneFocused: true });
      const { rerender } = renderTabs(props);

      act(() => {
        reportOutput("tab-2", 1);
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });
      expect(
        screen.getByRole("button", { name: "Terminal 2: Shell · Wartet auf dich" }),
      ).toBeInTheDocument();

      rerender(
        <Tooltip.Provider>
          <PaneTabs {...props} activeTabId="tab-2" />
        </Tooltip.Provider>,
      );

      expect(
        screen.queryByRole("button", { name: "Terminal 2: Shell · Wartet auf dich" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Terminal 2: Shell" })).toBeInTheDocument();
    });

    it("flags the tab again immediately once the user looks away, if it's still idle and nothing changed", () => {
      // Not a bug: `isTabAwaitingAttention` is derived live from current
      // state (terminalActivity.ts), not a sticky dismissal flag — a tab
      // that finished while being watched, and still hasn't produced
      // anything new, genuinely IS "done and not being looked at" the
      // moment the user moves on.
      const props = baseProps({ activeTabId: "tab-2", paneFocused: true });
      const { rerender } = renderTabs(props);

      act(() => {
        reportOutput("tab-2", 1);
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS); // finishes while being watched
      });
      expect(
        screen.queryByRole("button", { name: "Terminal 2: Shell · Wartet auf dich" }),
      ).not.toBeInTheDocument();

      rerender(
        <Tooltip.Provider>
          <PaneTabs {...props} activeTabId="tab-1" />
        </Tooltip.Provider>,
      );

      expect(
        screen.getByRole("button", { name: "Terminal 2: Shell · Wartet auf dich" }),
      ).toBeInTheDocument();
    });

    it("re-arms after being opened, once new background activity goes idle again", () => {
      const props = baseProps({ activeTabId: "tab-1", paneFocused: true });
      const { rerender } = renderTabs(props);

      act(() => {
        reportOutput("tab-2", 1); // free pass
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });
      expect(
        screen.getByRole("button", { name: "Terminal 2: Shell · Wartet auf dich" }),
      ).toBeInTheDocument();

      // Open tab 2 (focused pane) — clears the dot.
      rerender(
        <Tooltip.Provider>
          <PaneTabs {...props} activeTabId="tab-2" />
        </Tooltip.Provider>,
      );
      expect(screen.getByRole("button", { name: "Terminal 2: Shell" })).toBeInTheDocument();

      // Back to tab 1, tab-2 gets new background activity, then goes idle again.
      rerender(
        <Tooltip.Provider>
          <PaneTabs {...props} activeTabId="tab-1" />
        </Tooltip.Provider>,
      );
      act(() => {
        reportOutput("tab-2", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });

      expect(
        screen.getByRole("button", { name: "Terminal 2: Shell · Wartet auf dich" }),
      ).toBeInTheDocument();
    });

    // Karteikarten-Umbau 2026-08-19 (Kopfkommentar PaneTabs.tsx): der Marker
    // ist nicht mehr nur der rote Punkt, sondern ein herausgezogener Chip —
    // Hülle mit `pc-tabcard--pulled` (Höhenwachstum + Kartenfläche) und
    // Erhebung am Knopf. Die Optik selbst kann jsdom nicht messen (kein CSS),
    // aber genau diese Verdrahtung ist das, was beim letzten Anlauf still
    // verloren ging — deshalb je eine Zusicherung auf den Haken, an dem der
    // App.css-Block hängt. Seit der Amber-Korrektur (2026-08-19, dritter
    // Durchgang) kommt die Kartentinte dazu: alles auf der Amber-Fläche steht
    // in `--pc-pane-background`, der Punkt also auch — sein früheres
    // `--pc-icon-red` wäre im Light-Theme auf Amber unsichtbar.
    it("zieht den wartenden Chip als Karte heraus (Hülle, Erhebung, Punkt)", () => {
      const { container } = renderTabs(
        baseProps({ activeTabId: "tab-2", paneFocused: false }),
      );
      const chip = container.querySelector('[data-pane-tab-chip="tab-1"]');
      const card = chip?.parentElement;
      expect(card).not.toBeNull();

      expect(card?.classList.contains("pc-tabcard")).toBe(true);
      expect(card?.classList.contains("pc-tabcard--pulled")).toBe(false);
      expect(chip?.className).not.toContain("--pc-lift-elevation");
      expect(chip?.querySelector("[data-attention-dot]")).toBeNull();

      act(() => {
        reportOutput("tab-1", 1); // free pass (boot prompt)
        reportOutput("tab-1", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });

      expect(card?.classList.contains("pc-tabcard--pulled")).toBe(true);
      expect(chip?.className).toContain("shadow-[var(--pc-lift-elevation)]");
      const dot = chip?.querySelector("[data-attention-dot]");
      expect(dot).not.toBeNull();
      // Kartentinte statt Attention-Rot, und die Karte ist RANDLOS: ihr Rand
      // liegt in derselben Amber-Fläche, die sie füllt.
      expect(dot?.className).toContain("bg-(--pc-pane-background)");
      expect(chip?.className).toContain("text-(--pc-pane-background)");
      expect(chip?.className).toContain("border-(--pc-pane-activeBorder)");

      // Zurück in den Ruhezustand: die Karte sinkt wieder ein, samt Erhebung.
      act(() => {
        reportOutput("tab-1", 1);
      });
      expect(card?.classList.contains("pc-tabcard--pulled")).toBe(false);
      expect(chip?.className).not.toContain("--pc-lift-elevation");
    });

    // Der Überlagerungsfall, den die Amber-Korrektur lösen musste: der
    // ausgewählte Tab einer NICHT fokussierten Pane kann gleichzeitig wartend
    // sein (`markTabViewed` läuft nur bei Auswahl UND Pane-Fokus). Beide
    // Zustände sprechen jetzt Amber — auseinander hält sie die Form: gefüllt
    // heißt "wartet", umrandet heißt "ausgewählt". Genau das prüft dieser Test,
    // denn er ist die einzige Stelle, an der ein stiller Rückfall auf einen
    // gemeinsamen Farbzweig überhaupt auffallen würde.
    it("hält Auswahl und Wartezustand auf demselben Chip auseinander", () => {
      const { container } = renderTabs(
        baseProps({ activeTabId: "tab-1", paneFocused: false }),
      );
      const chip = container.querySelector('[data-pane-tab-chip="tab-1"]');
      const card = chip?.parentElement;

      // Nur ausgewählt: umrandeter Chip mit Akzent-Wasch, keine Karte.
      expect(card?.classList.contains("pc-tabcard--pulled")).toBe(false);
      expect(chip?.className).toContain("bg-(--pc-pane-activeBorder)/14");

      act(() => {
        reportOutput("tab-1", 1); // free pass (boot prompt)
        reportOutput("tab-1", 1);
        vi.advanceTimersByTime(TEST_IDLE_MS);
      });

      // Ausgewählt UND wartend: die volle Karte (Auszug, Erhebung, Punkt) plus
      // die Auswahl-Randlinie in der Kartentinte. Der /14-Wasch des reinen
      // Auswahlzustands ist ERSETZT, nicht überlagert — sonst stünden zwei
      // Hintergrund-Utilities in derselben Klassenliste.
      expect(card?.classList.contains("pc-tabcard--pulled")).toBe(true);
      expect(chip?.className).toContain("border-(--pc-pane-background)");
      expect(chip?.className).toContain("font-semibold");
      expect(chip?.className).not.toContain("bg-(--pc-pane-activeBorder)/14");
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
        baseProps({
          paneFocused: true,
          activeTabId: "file-1",
          tabs: [
            { kind: "terminal", tabId: "tab-1", shortcutPosition: 1, label: null },
            {
              kind: "file",
              tabId: "file-1",
              label: "a.ts",
              path: "/repo/a.ts",
              dirty: false,
            },
          ],
        }),
      );

      const fileTab = screen.getByRole("button", { name: "a.ts" });
      expect(fileTab.querySelector("[data-trace-stub]")).not.toBeNull();
      // Der jetzt inaktive Terminal-Chip bekommt keinen.
      expect(container.querySelectorAll("[data-trace-stub]")).toHaveLength(1);
    });

    it("dämpft das Amber des aktiven Tabs in einer unfokussierten Pane auf /45", () => {
      renderTabs(baseProps({ paneFocused: false }));

      const active = screen.getByRole("button", { name: "Terminal 1: Shell" });
      expect(active.className).toContain("border-(--pc-pane-activeBorder)/45");
    });

    it("lässt den aktiven Tab der fokussierten Pane in voller Sättigung", () => {
      renderTabs(baseProps({ paneFocused: true }));

      const active = screen.getByRole("button", { name: "Terminal 1: Shell" });
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
      expect(screen.getByRole("button", { name: "Terminal 2: Shell" })).toBeInTheDocument();
    });

    it("zeigt kein Icon und keinen Namenszusatz für einen unbekannten Prozess", async () => {
      const detectTool = vi.fn<PtyBackend["detectTool"]>().mockResolvedValue("some-unknown-tool");
      renderTabsWithBackend(baseProps(), fakePtyBackend(detectTool));

      await waitFor(() => expect(detectTool).toHaveBeenCalled());
      expect(screen.getByRole("button", { name: "Terminal 1: Shell" })).toBeInTheDocument();
    });
  });
});
