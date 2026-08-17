//! Filesystem watch behind the explorer's automatic refresh
//! (`.scratch/explorer-live-refresh`). `ProjectWatcher` is a plain,
//! Tauri-free struct — testable against a real temp directory without a
//! running app, same style as `explorer_fs.rs`'s own tests — wrapped by a
//! thin per-window Tauri command layer below it.
//!
//! One `ProjectWatcher` per window, keyed by the window's own label, mirrors
//! `pty_commands::WindowPtyRegistry`'s per-window keying. Ticket 27
//! (Multi-Window) gives every window its own `ExplorerPanel`/focused
//! project, so a single global watch would have a focus change in window B
//! silently stop window A's watch.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use tauri::{Emitter, Manager, Window};

use crate::explorer_fs::is_ignored_entry;

/// Coalesces bursts (`git checkout`, `npm install`) into one signal per
/// window of this length rather than one refresh per file event.
const DEBOUNCE: Duration = Duration::from_millis(300);

pub const CHANGED_EVENT: &str = "explorer:changed";

/// Watches one project root and calls `on_change` — already
/// debounced/coalesced and denylist-filtered — whenever something relevant
/// changes inside it. Dropping the watcher stops it (the underlying
/// `Debouncer` stops its background thread on `Drop`).
pub struct ProjectWatcher {
    root: PathBuf,
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

impl ProjectWatcher {
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Fails gracefully (no panic, no watch left half-running) when `root`
    /// doesn't exist — matches `explorer_read_dir`'s existing missing-root
    /// handling rather than crashing or watching nothing forever.
    ///
    /// Canonicalizes `root` first: on macOS the system temp dir (and,
    /// sometimes, real project paths — e.g. anything under an iCloud-synced
    /// volume) resolves through a symlink (`/var` -> `/private/var`), while
    /// FSEvents always reports the resolved physical path. Comparing a
    /// non-canonical `root` against those event paths in `is_relevant` would
    /// silently fail `strip_prefix` and treat every event as "outside root",
    /// i.e. always relevant — quietly defeating the denylist filter.
    pub fn start<F>(root: PathBuf, on_change: F) -> Result<Self, String>
    where
        F: Fn() + Send + 'static,
    {
        let root = std::fs::canonicalize(&root).map_err(|_| {
            format!("Projektverzeichnis nicht gefunden: {}", root.display())
        })?;
        if !root.is_dir() {
            return Err(format!(
                "Projektverzeichnis nicht gefunden: {}",
                root.display()
            ));
        }

        let watch_root = root.clone();
        let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };
            let relevant = events
                .iter()
                .any(|event| event.event.paths.iter().any(|path| is_relevant(&watch_root, path)));
            if relevant {
                on_change();
            }
        })
        .map_err(|error| format!("Watcher konnte nicht gestartet werden: {error}"))?;

        debouncer
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|error| format!("Verzeichnis konnte nicht beobachtet werden: {error}"))?;

        Ok(Self {
            root,
            _debouncer: debouncer,
        })
    }
}

/// Same filter `explorer_fs.rs::read_dir_entries` applies while listing — any
/// denylisted path component anywhere between `root` and `changed` means the
/// event is noise (e.g. `node_modules` churn), not something the tree
/// display cares about. A path notify reports outside `root` (shouldn't
/// happen — the watch is scoped to `root`) is treated as relevant rather
/// than silently swallowed.
fn is_relevant(root: &Path, changed: &Path) -> bool {
    let Ok(relative) = changed.strip_prefix(root) else {
        return true;
    };
    !relative
        .components()
        .any(|component| is_ignored_entry(&component.as_os_str().to_string_lossy()))
}

#[derive(Default)]
pub struct ExplorerWatchState(Mutex<HashMap<String, ProjectWatcher>>);

/// Starts watching `path` for the calling window, replacing any watch that
/// window already had. Same pane refocused, or two panes on the same
/// project trading focus (allowed per ticket 04) — both land here with an
/// unchanged root, so that case is a no-op rather than tearing the watcher
/// down and rebuilding it.
///
/// `async`: same bug class as `git_status.rs::explorer_git_status` (its
/// comment has the verified-against-tauri-2.11.5 threading claim this relies
/// on). `ProjectWatcher::start` reseeds `notify-debouncer-full`'s file-id
/// cache via an unbounded, symlink-following `WalkDir` over the whole
/// project root (`file_id_map.rs::FileIdMap::add_path`) — measured 6.75s in
/// a release build against this repo's own 218k-file tree (2026-08-16,
/// user-reported beachball on pane switching). App.tsx's focused-path effect
/// tears the watch down and rebuilds it on every pane focus switch between
/// two different projects, so a non-async command here froze the whole
/// window for the full walk on every such switch.
#[tauri::command(async)]
pub fn explorer_watch_start(
    window: Window,
    state: tauri::State<ExplorerWatchState>,
    path: String,
) -> Result<(), String> {
    let requested = PathBuf::from(&path);
    // Best-effort: an unresolvable path falls through unchanged and lets
    // `ProjectWatcher::start` below produce the real, user-facing error.
    let root = std::fs::canonicalize(&requested).unwrap_or(requested);
    let label = window.label().to_string();

    // Lock released before the (multi-second) walk below, not held across
    // it: `explorer_watch_stop`/`stop_for_window` still take this same lock
    // inline on the IPC dispatch thread/main thread respectively, and would
    // otherwise queue behind the walk for its full duration — trading the
    // original freeze for an equally long one on the very next invoke.
    let already_watching = {
        let guard = state.0.lock().unwrap();
        guard.get(&label).is_some_and(|watcher| watcher.root() == root)
    };
    if already_watching {
        return Ok(());
    }

    let emit_window = window.clone();
    let watcher = ProjectWatcher::start(root, move || {
        let _ = emit_window.emit_to(emit_window.label(), CHANGED_EVENT, ());
    })?;
    // Benign check-then-act race with a concurrent start for the same
    // window (e.g. two rapid focus switches): both walk, both finish, last
    // `insert` here wins and the loser's `ProjectWatcher` is simply dropped
    // (stops its debouncer thread) — cheaper than serializing switches
    // behind the lock again.
    state.0.lock().unwrap().insert(label, watcher);
    Ok(())
}

/// Stops the calling window's watch, if any. Safe to call when nothing is
/// being watched (e.g. an empty grid) — a no-op, not an error.
#[tauri::command]
pub fn explorer_watch_stop(window: Window, state: tauri::State<ExplorerWatchState>) {
    state.0.lock().unwrap().remove(window.label());
}

/// Non-command sibling of `explorer_watch_stop`, called from `lib.rs`'s
/// `on_window_event` when `window_label` closes — mirrors
/// `pty_commands::kill_all_for_window`'s cleanup so a closed window's watcher
/// thread doesn't linger for the rest of the process's life alongside any
/// other window that stays open.
pub fn stop_for_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, window_label: &str) {
    if let Some(state) = app.try_state::<ExplorerWatchState>() {
        state.0.lock().unwrap().remove(window_label);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::Instant;

    /// A throwaway tree under the system temp dir, removed by `drop` — same
    /// shape as `explorer_fs.rs`'s own `Fixture`.
    struct Fixture(PathBuf);

    impl Fixture {
        fn new(name: &str) -> Self {
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
            let root = std::env::temp_dir().join(format!(
                "panecrew-explorer-watch-{}-{name}",
                std::process::id()
            ));
            std::fs::remove_dir_all(&root).ok();
            std::fs::create_dir_all(&root).expect("test fixture root should be creatable");
            Self(root)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    fn signal_counter() -> (Arc<AtomicUsize>, impl Fn() + Send + 'static) {
        let count = Arc::new(AtomicUsize::new(0));
        let count_for_closure = count.clone();
        (count, move || {
            count_for_closure.fetch_add(1, Ordering::SeqCst);
        })
    }

    fn wait_until_at_least(count: &AtomicUsize, at_least: usize, timeout: Duration) -> usize {
        let start = Instant::now();
        loop {
            let value = count.load(Ordering::SeqCst);
            if value >= at_least || start.elapsed() > timeout {
                return value;
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn creating_a_file_triggers_a_change_signal() {
        let fixture = Fixture::new("create");
        let (count, on_change) = signal_counter();
        let _watcher =
            ProjectWatcher::start(fixture.0.clone(), on_change).expect("watch should start");

        std::fs::write(fixture.0.join("new-file.txt"), "hi").unwrap();

        assert!(wait_until_at_least(&count, 1, Duration::from_secs(2)) >= 1);
    }

    #[test]
    fn deleting_a_file_triggers_a_change_signal() {
        let fixture = Fixture::new("delete");
        let existing = fixture.0.join("existing.txt");
        std::fs::write(&existing, "hi").unwrap();

        let (count, on_change) = signal_counter();
        let _watcher =
            ProjectWatcher::start(fixture.0.clone(), on_change).expect("watch should start");

        std::fs::remove_file(&existing).unwrap();

        assert!(wait_until_at_least(&count, 1, Duration::from_secs(2)) >= 1);
    }

    #[test]
    fn renaming_a_file_triggers_a_change_signal() {
        let fixture = Fixture::new("rename");
        let original = fixture.0.join("original.txt");
        std::fs::write(&original, "hi").unwrap();

        let (count, on_change) = signal_counter();
        let _watcher =
            ProjectWatcher::start(fixture.0.clone(), on_change).expect("watch should start");

        std::fs::rename(&original, fixture.0.join("renamed.txt")).unwrap();

        assert!(wait_until_at_least(&count, 1, Duration::from_secs(2)) >= 1);
    }

    #[test]
    fn a_change_inside_a_denylisted_directory_produces_no_signal() {
        let fixture = Fixture::new("denylisted");
        std::fs::create_dir_all(fixture.0.join("node_modules")).unwrap();

        let (count, on_change) = signal_counter();
        let _watcher =
            ProjectWatcher::start(fixture.0.clone(), on_change).expect("watch should start");

        std::fs::write(fixture.0.join("node_modules/package.js"), "x").unwrap();
        thread::sleep(DEBOUNCE * 3);

        assert_eq!(count.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn rapid_changes_coalesce_into_a_bounded_number_of_signals() {
        let fixture = Fixture::new("burst");
        let (count, on_change) = signal_counter();
        let _watcher =
            ProjectWatcher::start(fixture.0.clone(), on_change).expect("watch should start");

        for index in 0..50 {
            std::fs::write(fixture.0.join(format!("file-{index}.txt")), "x").unwrap();
        }
        thread::sleep(Duration::from_secs(1));

        let signals = count.load(Ordering::SeqCst);
        assert!(signals >= 1, "expected at least one signal, got none");
        assert!(
            signals < 50,
            "expected coalescing, got {signals} signals for 50 writes"
        );
    }

    #[test]
    fn stopping_the_watch_produces_no_further_signals() {
        let fixture = Fixture::new("stop");
        let (count, on_change) = signal_counter();
        let watcher =
            ProjectWatcher::start(fixture.0.clone(), on_change).expect("watch should start");

        drop(watcher);
        std::fs::write(fixture.0.join("after-stop.txt"), "x").unwrap();
        thread::sleep(DEBOUNCE * 3);

        assert_eq!(count.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn starting_a_watch_on_a_missing_root_fails_gracefully() {
        // Test-only, no file is ever written here; the path is deliberately built to NOT exist
        // (asserted below), so the predictable shared-tmp-dir race the rule guards against
        // (symlink swap before a write/open) does not apply — no write/open, just a missing-path
        // existence check.
        let missing = std::env::temp_dir().join(format!( // nosemgrep: rust.lang.security.temp-dir.temp-dir
            "panecrew-explorer-watch-{}-does-not-exist",
            std::process::id()
        ));
        std::fs::remove_dir_all(&missing).ok();

        let result = ProjectWatcher::start(missing, || {});

        assert!(result.is_err());
    }
}
