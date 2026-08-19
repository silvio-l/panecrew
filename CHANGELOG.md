# Changelog

Every entry here is a **prerequisite for the release CI**, not just docs: a
tag push (`app-v*` for Stable, the rolling `nightly-latest` for Nightly)
locally triggers `tools/changelog-gate/check.py`, which checks the topmost
entry against the real `git diff` since the last channel tag — if the
coverage list is missing an affected module, or the diff hash no longer
matches the actual diff (because new code landed since), the release push
fails. Not an autogenerator: the prose has to be written by hand, with real
content. Mechanism and rationale: `docs/decisions.md` →
"Auto-Update via GitHub Releases", point 5.

This file deliberately contains **only the human-written part** — short,
user-facing, no file paths. The metadata the gate needs mechanically
(coverage list per version, diff hash, last released commit per channel)
lives exclusively in `tools/changelog-gate/release-state.json` (`tools/` is
entirely gitignored — that state never reaches GitHub, see
`docs/decisions.md`).

**Bilingual since 2026-08-14**: this file (`CHANGELOG.md`) is the English
edition, `CHANGELOG.de.md` the German one — identical in content, and the
gate checks both against the same, language-independent state entry
(coverage/diff hash track the code diff, not the wording). A new entry must
be added to both files, with the same version heading.

## Format

    ## [X.Y.Z] - YYYY-MM-DD
    ### Added / Changed / Fixed
    - Short, human-readable bullet point per change.

- Newest version goes on top (reverse chronological); the gate only reads
  the file's **first** `## [...]` version heading and looks up the matching
  coverage/hash record for it in `release-state.json`.

**App-only prose (2026-08-16)**: this changelog ships inside the desktop app
(the updater points users at the GitHub release, which links here) and is
read as "what changed in the app I'm about to install" — it is not a
project-wide changelog. `apps/website` commits (marketing site copy, SEO,
guides, layout) never get a bullet here, even though the gate still requires
`website` in the release's `coverage` list whenever the diff touches it (the
gate checks module coverage mechanically, not prose — the module still has
to be accounted for, it's just never described in the human-facing text).

## [0.1.0-nightly.14] - 2026-08-19
### Added
- Typing `://` at the start of a terminal line (or after a space) now opens
  a searchable command popup: built-in commands like scaffolding a
  project's snippet folder, plus your own reusable text snippets from
  project and user snippet files, inserted in place of what you typed.
- Each terminal tab can now launch with a specific CLI tool adapter
  instead of always using your default shell, chosen from a dropdown next
  to the "new tab" button.
- Opening an image (PNG, JPEG, GIF, SVG, WebP) or video (MP4, WebM) file
  in a file tab now shows a preview instead of raw text or binary
  garbage.
- The file-tab code editor now has syntax highlighting and line numbers
  for TypeScript/JavaScript, Rust, JSON, CSS, and Markdown.
- The explorer header and the pane status rail now show the current
  project's git branch, dirty-file count, ahead/behind status, and
  worktree info.

### Changed
- The "finished, waiting for you" tab marker is now a card that visibly
  lifts out of the tab row, instead of an easy-to-miss highlight.

### Fixed
- Terminal tabs no longer get silently clipped off the right edge of a
  pane once too many are open — the tab row now scrolls horizontally
  (mouse wheel included), and the active or newly opened tab scrolls
  into view automatically.
- Selecting text by dragging the mouse now copies to the clipboard
  correctly even when the drag ends outside the pane's bounds.
- Hovering a recent-project row in the project picker no longer opens a
  tooltip that blocked the mouse path to the rows below it.

## [0.1.0-nightly.13] - 2026-08-17
### Changed
- Terminal tabs now stay marked "active" through a tool's whole
  thinking/working phase instead of flickering to idle during pauses with
  no new output; the tab highlight now means "finished, waiting for you"
  instead of "unread", and clears the moment you look back at that tab.
- Closing a terminal pane or tab now reliably stops every process it
  started, not just its shell — a background dev server or CLI agent you
  were running can no longer keep running invisibly after its pane closes.
- The About window reopens instantly instead of rebuilding itself every
  time.
- Reduced background CPU/battery use from terminal tool-detection,
  especially with many tabs open.
- App startup and restoring windows from your last session are both
  faster, especially with several windows open.

### Fixed
- The splash screen — and the main window behind it — could appear
  off-center, or on the wrong monitor entirely, on multi-monitor setups.
  Both now always center correctly on whichever monitor the app is
  starting on.
- A window's layout (open projects, split panes, which pane was focused)
  could occasionally fail to be saved if you closed the window very soon
  after making a change.

## [0.1.0-nightly.12] - 2026-08-17
### Added
- A guided first-run setup wizard: pick your language and theme (applied
  immediately, live, as you click), grant macOS's Full Disk Access
  permission if needed, then jump straight into your first project.
  Replaces the previous single hint and now works correctly no matter how
  full the grid already is.
- Empty project slots show a "recent projects" panel on hover, docked right
  into the slot itself, plus an entry to browse for a project that isn't on
  the list yet.

### Fixed
- Right-clicking a terminal tab and choosing "Rename" or "Close" could
  silently do nothing.
- "Restart onboarding" in Settings left the Settings window open on top of
  the wizard it triggers; it now closes itself.
- Restarting onboarding on a grid that already has a project open no longer
  offers to silently replace it.
- Some notifications (the close-confirmation dialog, menu actions like
  "Open Folder") could incorrectly fire in every open window instead of
  just the one they were meant for.
- A secondary window's title-bar resource-usage popover now correctly
  groups its terminal tabs by pane instead of showing a flat, unlabeled
  list.

## [0.1.0-nightly.11] - 2026-08-16
### Added
- First-run onboarding: a short on-grid hint appears the first time you have
  two panes open side by side, and clears itself once you've tried it.
  Settings has a new "Help" category (macOS) with a button to replay the
  hint and direct links into System Settings' Full Disk Access, Files &
  Folders, and Privacy & Security panes for the permissions PaneCrew needs.

### Changed
- New installs now default to the dark theme instead of following the
  system setting.

### Fixed
- Switching focus between panes could still occasionally make the app
  briefly unresponsive (beachball on macOS) even after the previous fix: a
  file-watcher restart was doing a full, unbounded filesystem scan on the
  main thread. It now runs in the background.
- Closing and reopening terminal tabs in quick succession could very rarely
  leave an orphaned shell process running after its window closed, and a
  large paste into a terminal could momentarily freeze the whole window
  while it was being sent to the shell.
- A stale internal flag could very rarely leave an empty ghost window open
  after quitting and immediately reopening the app.
- Every open window kept checking every terminal tab for which CLI tool is
  running even while minimized or hidden; this check now pauses while a
  window isn't visible.
- Dragging the explorer panel's resize handle could feel sluggish with many
  open panes, since every mouse movement re-rendered the whole grid; now
  only the final width triggers a re-render.
- PaneCrew rewrote its whole saved-session file on every single pane click,
  even when nothing about it had actually changed, and two open windows
  saving around the same moment could very rarely overwrite each other's
  changes. Both fixed.
- On a fresh install, the app could briefly appear at 100% zoom before
  settling at its intended default.

## [0.1.0-nightly.10] - 2026-08-16
### Changed
- The window resource usage popover in the title bar now lists every open
  window, not just the one you're currently looking at.

### Fixed
- Switching focus between panes could occasionally make the app briefly
  unresponsive (beachball on macOS): a background check was rebuilding the
  whole native menu bar far more often than needed. It now only rebuilds
  when something actually changed.
- The "Recent Projects" menu could lag behind or show stale entries after
  opening or closing projects; fixed by the same change as above.
- Opening a project from the "Recent Projects" menu or Cmd+O could silently
  replace whatever was running in the currently focused pane. It now only
  opens into an empty pane; if every pane is already in use, PaneCrew asks
  whether to open the project in a new window instead.

## [0.1.0-nightly.9] - 2026-08-16
### Fixed
- The title bar's memory warning could trigger far too easily on machines
  with less total RAM (and too late on machines with more): the threshold
  was a percentage of total system RAM instead of an absolute amount. Now a
  fixed 6GB (warning) / 12GB (critical), independent of the machine's total
  RAM.

## [0.1.0-nightly.8] - 2026-08-16
### Fixed
- Fixed a startup crash introduced in nightly.7: the app could fail to
  launch at all (crashing before its first window appeared) because the
  application menu was being built too early in Tauri's own startup
  sequence.

## [0.1.0-nightly.7] - 2026-08-16
### Added
- Split Pane shortcut (Ctrl/Cmd+Shift+5): splits the currently focused pane
  by growing the grid to the next-larger layout and moving that pane's
  project into the newly revealed slot.
- Pane borders between adjacent slots can now be dragged (or resized with
  arrow keys) to adjust the size ratio between them, without changing the
  overall grid layout; double-click resets a border to its default.
- Command Palette (⌘⇧P), also reachable via the title bar's search field,
  for quickly switching layouts or jumping to Open Folder, Settings, or the
  shortcuts reference.
- File menu: "Open Folder" (⌘O), a "Recently Opened Projects" submenu, "New
  Window", and "Close All Windows".
- An in-app keyboard shortcuts reference, reachable from the menu.
- Empty grid slots now show a "recently opened projects" list app-wide
  instead of just an empty picker.
- Title bar back/forward arrows now navigate pane focus in both grid and
  focus mode.

### Changed
- New installs now default to English instead of following the system
  language automatically.
- Internal: replaced a throwaway single-bug debug capture with durable
  production logging (backend + frontend) to a rotating log file, making
  future bug reports easier to diagnose without a live console handoff.

### Fixed
- Title bar memory indicator: total RAM usage now also counts terminal
  child processes, not just the shells themselves.
- Ctrl+K for clearing the terminal no longer collides with the readline
  kill-line shortcut on Windows/Linux.
- Cmd+W now closes only the current terminal tab instead of the whole
  window.
- Closing a window (via the close button or Cmd+Q) now asks for
  confirmation if terminal sessions are still running.
- File explorer: the `.git` folder is no longer hidden — it was being
  filtered the same way as `node_modules`.
- File explorer tree now genuinely shows everything, including `.git` and
  `node_modules`/`target` directories together.
- File explorer: "Copy Path" in the context menu now actually copies to the
  clipboard.
- File explorer: refreshing no longer visibly collapses and re-expands
  already-open subfolders.
- Inline autocomplete ghost text no longer inserts at the wrong cursor
  position.
- Windows: fixed two real compile bugs surfaced by adding a Windows CI
  matrix job for the Rust test suite.

## [0.1.0-nightly.6] - 2026-08-15
### Added
- Right-clicking the Dock icon on macOS now shows a native menu with "New
  Window" plus a live list of all open windows, matching how other
  multi-window Mac apps behave.
- The file explorer's search now also searches file contents, not just
  file/folder names — matching lines show a preview and jump straight to
  that exact line (with the match highlighted) when clicked.

### Changed
- The file explorer's toolbar now sits on its own row above the project
  name instead of competing with it for space, and its icons are always
  visible instead of only appearing on hover.

## [0.1.0-nightly.5] - 2026-08-15
### Added
- Title bar now shows a live RAM/CPU indicator for PaneCrew and its terminal
  sessions, with a hover breakdown per pane/tab (percentages plus absolute
  MB/GB) and warning/critical color states.
- Runaway terminal sessions are now caught automatically: a tab using
  excessive memory is first flagged, then the single worst-offending process
  is paused (not killed) so it stays resumable; only repeated or unresolved
  overload escalates to terminating that one process, and only as a last
  resort the whole tab. A tab terminated this way shows a clear reason and a
  restart option instead of silently vanishing.
- Terminal output now recognizes URLs and absolute file paths as clickable
  links.
- Marketing website: new guide on running multiple terminal windows and CLI
  agent sessions side by side.

### Changed
- Default zoom level raised to 1.2x and default terminal font size to 14 for
  better out-of-the-box readability.
- New windows now position correctly across multiple monitors instead of
  occasionally landing in the wrong place.
- Title bar values (zoom, clock, resource indicator, icon buttons) are now
  consistently vertically centered and visually separated.
- Marketing website: visual redesign pass and a shared navigation/footer
  styling system across pages.
- Internal: a test that unintentionally moved files to the real system trash
  on every test run no longer runs by default — dev-only, no functional
  change for users.
- Internal: corrected stale release-workflow documentation and fixed the
  repository's default Actions token permissions, which had been silently
  blocking the automated Nightly release step — dev-only, no functional
  change for users.

### Fixed
- The tab context menu's "Close tab" action could silently do nothing; it
  also gained a batch-close option.
- Copying with Cmd+C could add unwanted extra indentation to the copied
  text.

## [0.1.0-nightly.4] - 2026-08-15
### Added
- CI: closed, non-merged pull-request branches are now cleaned up
  automatically.
- The file explorer now refreshes automatically when files or folders
  change on disk outside the app.

### Changed
- The keyboard shortcut reference and its underlying descriptions are now
  in English.
- Internal repo-compliance tooling (brand-name linter, OSS-allowlist marker
  script, docs generator, release-driver installer) moved out of the public
  tracked tree — dev-only, no functional change for users.
- Marketing-site readability pass: improved typography and contrast, and
  corrected a couple of overstated feature claims.
- Marketing website: the page layout now scales proportionally instead of
  capping at a fixed width.
- Several performance improvements: tool detection, settings lookups,
  file-editor typing, and grid-layout transitions are now faster and no
  longer trigger unnecessary background re-renders.

### Fixed
- Terminal panes could render as corrupted, illegible fragments instead of
  readable text after several tabs had been open for a while — caused by
  the app exhausting the browser engine's limited pool of concurrent
  GPU-accelerated terminal renderers by keeping every tab's renderer alive
  in the background even while hidden; renderers are now only active for
  the currently visible tab.
- On macOS, a minimized or hidden PaneCrew window had no way to be found
  again short of using the system's App Exposé — the app now keeps a live
  "Window" menu listing every open window, with a click bringing it to the
  front.
- The app could end up with no visible window (only a Dock icon) if the
  Settings window happened to be open when the last content window was
  closed.
- Closing a terminal tab now reliably terminates every process it spawned;
  previously, child processes could keep running in the background after
  the tab closed.
- The terminal's "Copied" confirmation could appear even when the copy
  itself had failed, and copied text could pick up unwanted leading
  indentation.

## [0.1.0-nightly.3] - 2026-08-14
### Fixed
- Clicking "Install & Restart" could fail with "Could not be checked" even
  after an update was successfully found: the download link pointed at a
  GitHub API endpoint with a tight anonymous rate limit instead of the
  unlimited public download link. The error message in the About window and
  the update banner now also correctly distinguishes a failed check from a
  failed install, with a retry option.
- A file/folder path completion inserted via Tab, containing a backslash
  before a space, was no longer escaped correctly in the terminal input.

## [0.1.0-nightly.2] - 2026-08-14
### Added
- A complete settings window: pick a color theme, adjust zoom level and
  terminal font size live, choose a grid layout by pictogram.
- Additional windows: ⌘N/Ctrl+N opens another PaneCrew window, which
  remembers its position, size, and open projects independently across a
  restart.
- Terminal tabs now show real brand icons of the detected CLI tool, can be
  renamed/closed via context menu, and report background activity through
  an unread indicator.
- Panes and terminal tabs can be moved, swapped, and dragged into new, empty
  slots via drag and drop, with a pointer preview and a visible drop target.

### Changed
- Focus mode now reliably auto-rotates through panes/tabs, with a countdown
  shown in the pane header.
- The file explorer now loads folders lazily per directory instead of
  reading the entire project tree at once on open — noticeably faster on
  large projects.
- The nightly channel is now fully functional: automatic update checks are
  active, every nightly build gets its own, strictly increasing version
  number, and builds now target only Apple Silicon Macs (no more Rosetta
  notice on Apple-chip machines).
- Minor improvements to the marketing website (real tool logos, SEO
  fine-tuning, among others).

### Fixed
- A terminal tab dragged between panes used to lose its running session in
  the process — that no longer happens.

## [0.1.0] - 2026-08-13
First release. PaneCrew can now:

- Open up to four projects at once in a fixed grid, each with a real,
  independent terminal.
- Show a file explorer that automatically follows whichever terminal
  currently has focus.
- Remember sessions (open projects, layout) across an app restart.
- Launch directly with a project path (`panecrew <path>`), skipping the
  project picker.
- Display built-in and VS Code-imported color themes. <!-- brandlint-ok: names the theme mapper's real import source, not promotion -->
- Update itself automatically, via a Stable channel and a separately
  labeled Nightly channel.
