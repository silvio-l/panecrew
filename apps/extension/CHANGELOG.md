# Changelog

All notable changes to the PaneCrew extension are documented here.

## 0.1.0 — Unreleased

Initial production release of the PaneCrew VS Code extension. This replaces
the earlier Tauri desktop app (`apps/desktop`) as PaneCrew's primary product.

### Added

- **Terminal grid**: N×M grids of live terminal panes mapped onto VS Code's
  own editor-group layout (`vscode.setEditorLayout`), each pane anchored to a
  workspace folder in a multi-root workspace.
- **Focus-following explorer**: a real `TreeDataProvider`-based explorer (not
  a webview) in its own PaneCrew activity-bar container, with one subtree per
  workspace folder. Automatically reveals whichever project owns the
  currently focused terminal or editor tab.
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
