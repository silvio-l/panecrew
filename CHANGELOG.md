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
