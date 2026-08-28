# Changelog

All notable changes to the PaneCrew extension are documented here.

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
