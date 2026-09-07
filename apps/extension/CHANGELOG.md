# Changelog

All notable changes to the PaneCrew extension are documented here.

## 0.1.13 — 2026-09-07

### Added

- Debug/trace log entries are now also mirrored to the console when running
  the extension itself in development mode (`F5`), showing up unfiltered in
  the Debug Console — no effect on real installs.

### Fixed

- A pane's Needs-Attention badge could self-clear within milliseconds of
  appearing while that pane was already the active tab, because any
  unrelated tab change elsewhere in the window re-triggered the explorer's
  focus-follow logic and always cleared attention even when the active
  folder hadn't actually changed. Now only clears on an actual folder
  transition.
- QuickPick menus (grid presets, grid templates, the PaneCrew theme picker,
  CLI-tool notification setup) no longer silently close if you switch focus
  away. `Restart Pane Terminal…` and `Delete Preset…` now show a message
  instead of an empty menu when there's nothing to pick from.

## 0.1.12 — 2026-09-07

### Fixed

- This changelog itself had silently gone stale for three releases in a
  row (0.1.9, 0.1.10, 0.1.11 were all missing here, despite being shipped)
  — backfilled, and the release tooling now technically enforces that this
  file's topmost entry matches the version being released before a
  release tag can be pushed.

## 0.1.11 — 2026-09-07

### Fixed

- A terminal tab opened inside a pane's group (e.g. via the terminal tab
  bar's native "+" button) that was then `cd`'d into a different open
  project's directory kept showing the pane's original project in the
  explorer instead of following that terminal's own live working
  directory. The explorer now always follows the focused terminal tab's
  actual cwd first.

## 0.1.10 — 2026-09-07

### Fixed

- A pane could show a false "attention notifications won't fire, restart
  terminal?" warning right after opening a folder that was never part of
  any PaneCrew session before, offering a destructive restart action for a
  terminal PaneCrew never actually tracked. The warning is now scoped to
  panes with genuine continuity from a persisted PaneCrew session.
- The grid no longer ignores `panecrew.grid.defaultColumns`/`defaultRows`
  whenever no previous session restores — it used to silently fall back to
  the built-in 2×2 template regardless of what was configured.

## 0.1.9 — 2026-09-07

### Added

- Structured logging: every module now logs through one leveled, sanitized
  logger instead of ad-hoc output-channel writes. Levels are configurable
  per session via "Developer: Set Log Level…" → "PaneCrew". Optional,
  opt-in error reporting to Sentry, off by default, for warning/error
  events only — never raw context or file contents.

### Fixed

- The "+" button for adding a terminal to a pane could report "focus a
  pane first" even with a pane actually focused, when the active
  terminal's view column no longer matched its originally tracked column
  (e.g. after a tab was dragged/reordered). It now resolves the target
  pane from the active terminal's own identity first, falling back to the
  view column only when no terminal is focused.

## 0.1.8 — 2026-08-31

### Added

- A new Needs-Attention queue in the sidebar lists every pane currently
  signaling attention, oldest first, with a live preview — click an entry
  (or use "Jump to Next Attention") to jump to and maximize that pane. An
  optional, off-by-default auto-advance setting jumps to the next queued
  pane once you clear the current one.
- A PaneCrew-managed "+" button — in the terminal tab bar and the explorer
  view title — adds a second, properly named and tracked terminal tab to
  the focused pane, instead of relying on VS Code's native "+" (which
  PaneCrew now also renames to match once it notices the new tab).
- Tree items show their full path on hover, and the snippet-insert picker
  previews each snippet's body before insertion.
- Status bar buttons (grid template, new window, sidebar toggle) now
  announce themselves properly to screen readers.

### Fixed

- Multi-step flows (snippet creation, grid presets, file rename/create) no
  longer silently drop entered text when focus briefly leaves the input
  box.
- Compact Look now also guarantees the editor tab bar and its action
  toolbar stay visible, so PaneCrew's own pane buttons can't end up hidden
  by a minimalist editor-tab setup.

## 0.1.7 — 2026-08-28

### Added

- Grid presets now support an optional per-pane startup command (e.g.
  `claude`), sent once into the terminal right after a preset creates it —
  never into a terminal the preset merely reconnects to.

## 0.1.6 — 2026-08-28

### Added

- Attention badges now also fire from Claude Code's Stop hook, and from new
  GitHub Copilot CLI and OpenCode notification adapters.
- A stronger Projects Overview icon and a VS Code toast for attention events.
- An actionable toast for adopted panes lacking automatic attention
  recovery, with a one-click restart.
- A per-tab restart icon and a terminal right-click "Restart" entry for
  multi-terminal panes.

### Fixed

- The attention-signal buffer no longer grows unbounded when it never finds
  a terminator (e.g. stray bytes in raw/binary terminal output), fixing a
  memory-growth issue in long-running panes.
- Attention-notify hooks now reach the terminal on Windows.
- Adopted terminals track and expose a safe recovery path.
- CLI attention notify commands are resilient to a missing `/dev/tty`.
- PaneCrew no longer reopens closed panes or duplicates terminals on reload.

## 0.1.5 — 2026-08-28

### Added

- Pane attention notifications (OSC 9 / OSC 777 notify) and a maximize
  pane toggle.
- A "Remove Project from Workspace" command, active-tab theming, and
  proper terminal disposal.

### Fixed

- The sidebar toggle moved to the status bar, and the maximize icon now
  hides when a pane is already maximized.

## 0.1.4 — 2026-08-27

### Added

- A toggle button in the PaneCrew explorer's title bar to show/hide VS
  Code's primary side bar, the same behavior as
  `workbench.action.toggleSidebarVisibility` but reachable with a click
  instead of a keybinding or the command palette.

## 0.1.3 — 2026-08-27

### Fixed

- The PaneCrew explorer could get stuck showing a previously focused
  project's folder and never switch back — happened when focus moved to a
  terminal PaneCrew's own grid didn't create (e.g. a task terminal), which
  had no way to resolve which project it belonged to. It's now resolved via
  the terminal's own working directory.

## 0.1.2 — 2026-08-27

### Added

- `PaneCrew: Open Project Grid…` — a real command now, not just a documented
  one. Same underlying action as `Add Folder to Grid…`: opens a folder picker
  and gives it its own pane.
- The PaneCrew explorer shows a welcome view with an "Open Project Grid…"
  button when no folder is open yet, instead of staying blank.
- New `panecrew.grid.defaultProjectsFolder` setting: the folder the file
  picker opens in for "Open Project Grid…", "Add Folder to Grid…", and
  "Open Project in New Window…".
- `PaneCrew: Set Default Projects Folder…` command: sets that setting via a
  real folder picker instead of typing a path into Settings by hand. Also
  reachable from the explorer's `···` menu, and now a step in the
  "Get started with PaneCrew" walkthrough.

### Fixed

- `panecrew.grid.defaultColumns`/`defaultRows` are now actually applied when
  a new grid is created — previously the grid always started as Quad (2×2)
  regardless of these settings.

## 0.1.1 — 2026-08-27

### Changed

- Added a FAQ section to the README (platform support, licensing, supported
  CLI tools, where to file bugs/questions).
- Reworded "Known limitations" to describe the extension's own constraints
  directly, without assuming readers know the earlier desktop app.

## 0.1.0 — 2026-08-27

Initial production release of the PaneCrew VS Code extension. This replaces
the earlier Tauri desktop app (`apps/desktop`) as PaneCrew's primary product.

### Added

- **Terminal grid**: N×M grids of live terminal panes mapped onto VS Code's
  own editor-group layout (`vscode.setEditorLayout`), each pane anchored to a
  workspace folder in a multi-root workspace.
- **Focus-following explorer**: a real `TreeDataProvider`-based explorer (not
  a webview) in its own PaneCrew activity-bar container, showing exactly one
  project's tree at a time — switching automatically to whichever project
  owns the currently focused terminal or editor tab.
- **Git status decorations**: modified/added/untracked/deleted badges and
  colors on explorer tree items, backed by `git status --porcelain=v1` per
  workspace-folder root, cached and invalidated on save.
- **Search in folder**: a context-menu command delegating to VS Code's native
  "Find in Files" scoped to the selected folder.
- **Session persistence**: grid layout, per-pane workspace-folder assignment,
  and split ratios are restored automatically when a workspace with a saved
  PaneCrew session is reopened.
- **Two color themes**: PaneCrew Dark and PaneCrew Light, tuned for
  terminal-heavy, multi-project work.
- **Terminal link detection**: URLs and absolute file paths in terminal
  output become clickable links.
- **Snippets**: workspace-scoped (`.vscode/panecrew-snippets.json`) and
  global snippet storage, inserted into the active terminal via a
  command-palette quick pick.
- **Onboarding walkthrough**: a "Get started with PaneCrew" walkthrough
  covering opening a project grid, touring the explorer, applying the
  PaneCrew theme, and the compact look.
- **Compact Look**: hides secondary chrome (status bar, minimap) to make room
  for more panes — the activity bar always stays visible.
- **Grid presets**: save and reload named grid layouts across workspaces.
- **Settings**: `panecrew.*` configuration for grid defaults, compact-look
  behavior, git decorations, and snippet scope.
