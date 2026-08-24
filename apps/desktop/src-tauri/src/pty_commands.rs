//! Thin Tauri-command wrappers over `pty_manager` — see
//! `.scratch/panecrew-v0.1/issues/02-ipc-contract.md` for the frozen IPC
//! contract these commands implement (Ticket 18 addendum: `pane_id` renamed
//! to `tab_id` throughout, see the addendum entry there for why). No
//! lifecycle logic lives here; all of it is in `pty_manager`.

use crate::config_registry::ConfigRegistry;
use crate::pty_manager::{self, PtyHandle};
use crate::settings_commands::{app_data_dir, ConfigRegistryState};
use crate::settings_store::{self, Overrides};
use crate::shell_integration;
use crate::tool_detect::ToolDetector;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Manager, Runtime, State, Window};

#[derive(Default)]
pub struct PtyState(Mutex<HashMap<String, PtyHandle>>);

impl PtyState {
    /// `(tab_id, pid)` for every currently tracked PTY's own shell process —
    /// `resource_guard`'s per-tab tree walk starts from each of these roots,
    /// unlike `child_pids` above (a flat list with no tab identity, only
    /// useful for `resource_monitor`'s single app-wide aggregate).
    pub(crate) fn tab_root_pids(&self) -> Vec<(String, u32)> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(tab_id, handle)| handle.pid().map(|pid| (tab_id.clone(), pid)))
            .collect()
    }
}

/// Where PaneCrew's shell wrappers were written at startup — `None` if
/// materialization hasn't finished yet or failed, in which case panes spawn
/// unwrapped rather than not at all. Managed with `None` synchronously
/// during `.setup()` (so `pty_spawn` never sees "state accessed before
/// `manage()`" on a fast cold start) and filled in by a background thread
/// once `shell_integration::materialize` actually finishes (ticket 04, perf
/// audit — that write must not block the event loop from starting).
pub struct ShellIntegrationDir(pub Mutex<Option<PathBuf>>);

/// Which `tab_id`s belong to which native window (Ticket 27, landmine 5):
/// `PtyState` itself has no notion of windows, only tabs, so a window's
/// `CloseRequested` handler has no other way to find "which PTYs are mine"
/// short of the frontend perfectly reporting every spawn/kill before the OS
/// tears the window down — not guaranteed on a force-quit or a native
/// red-button close. Populated from `pty_spawn`'s own Tauri-injected
/// `Window` argument, so the frontend's IPC payload (the frozen contract
/// this module documents at the top) never has to carry a window label at
/// all.
#[derive(Default)]
pub struct WindowPtyRegistry(Mutex<HashMap<String, HashSet<String>>>);

impl WindowPtyRegistry {
    fn register(&self, window_label: &str, tab_id: &str) {
        self.0
            .lock()
            .unwrap()
            .entry(window_label.to_string())
            .or_default()
            .insert(tab_id.to_string());
    }

    /// A tab can move or vanish without the caller knowing which window it
    /// was under (e.g. `pty_kill` only receives a `tab_id`) — removed from
    /// every window's set rather than requiring the label up front.
    /// `pub(crate)`: `resource_guard`'s tier-4 escalation calls this
    /// directly, same reasoning as `kill` right below.
    pub(crate) fn unregister(&self, tab_id: &str) {
        let mut map = self.0.lock().unwrap();
        for tab_ids in map.values_mut() {
            tab_ids.remove(tab_id);
        }
        map.retain(|_, tab_ids| !tab_ids.is_empty());
    }

    /// Snapshot instead of a reference: the caller kills PTYs one by one
    /// while holding no lock on this map, so a later `pty_kill`/`pty_spawn`
    /// racing on another thread can't deadlock against it.
    pub fn tab_ids_for_window(&self, window_label: &str) -> Vec<String> {
        self.0
            .lock()
            .unwrap()
            .get(window_label)
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn forget_window(&self, window_label: &str) {
        self.0.lock().unwrap().remove(window_label);
    }

    /// Cross-window-drag ticket 01: re-associates `tab_id` from
    /// `old_window_label` to `new_window_label` for an in-flight move.
    /// Registers under the new label FIRST, only then removes the old
    /// association — reversed, there would be an instant where `tab_id`
    /// belongs to no window's set at all. `kill_all_for_window` below is
    /// taught to treat a tab still listed under a second window as "in
    /// transit, not abandoned", so the brief overlap this ordering produces
    /// (registered under both, for the moment between these two steps) is
    /// exactly the safe direction to err toward.
    pub fn move_tab(&self, tab_id: &str, old_window_label: &str, new_window_label: &str) {
        self.register(new_window_label, tab_id);
        let mut map = self.0.lock().unwrap();
        if let Some(tab_ids) = map.get_mut(old_window_label) {
            tab_ids.remove(tab_id);
        }
        map.retain(|_, tab_ids| !tab_ids.is_empty());
    }

    /// Whether `tab_id` is currently registered under some window OTHER than
    /// `excluding_window_label` — used by `kill_all_for_window` to recognize
    /// a tab mid cross-window-move (ticket 01) as still reachable elsewhere,
    /// rather than abandoned.
    fn registered_under_another_window(&self, tab_id: &str, excluding_window_label: &str) -> bool {
        self.0
            .lock()
            .unwrap()
            .iter()
            .any(|(window_label, tab_ids)| {
                window_label != excluding_window_label && tab_ids.contains(tab_id)
            })
    }

    /// Reverse of the map this struct otherwise keeps (window -> tabs):
    /// `tab_id` -> owning window's label, for `resource_monitor`'s per-tick
    /// samples, which start from a flat tab list and need to attach each
    /// one back to its window.
    pub(crate) fn window_for_tab_snapshot(&self) -> HashMap<String, String> {
        let map = self.0.lock().unwrap();
        let mut reverse = HashMap::new();
        for (window_label, tab_ids) in map.iter() {
            for tab_id in tab_ids {
                reverse.insert(tab_id.clone(), window_label.clone());
            }
        }
        reverse
    }
}

/// The shell a NEW `pty_spawn` call should use: the current `terminal.shell`
/// override if one is set, otherwise the registered default. Factored out of
/// `pty_spawn` so it's unit-testable without a running Tauri app — same
/// reasoning as `kill_all_for_window` below. Deliberately takes borrowed,
/// freshly-loaded `overrides` rather than reading `settings.json` itself:
/// every already-running `PtyHandle` only ever holds the plain `String` this
/// function returned at ITS OWN spawn time (see `pty_manager::SpawnOptions`),
/// never a reference back into the registry — so nothing here can reach into
/// a session that already exists, by construction, not by a runtime check.
fn resolve_shell(registry: &ConfigRegistry, overrides: &Overrides) -> String {
    registry
        .resolve(overrides)
        .get("terminal.shell")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .unwrap_or_else(pty_manager::default_shell)
}

// `async`: resolving `terminal.shell` reads `settings.json` off disk
// (`settings_store::load_overrides`) — same reasoning as every other
// file-touching command in this codebase (`settings_commands.rs`,
// `session_store::session_load`), it must not block the thread that
// dispatches IPC.
#[tauri::command(async)]
pub async fn pty_spawn<R: Runtime>(
    window: Window<R>,
    state: State<'_, PtyState>,
    registry: State<'_, WindowPtyRegistry>,
    integration_dir: State<'_, ShellIntegrationDir>,
    config_registry: State<'_, ConfigRegistryState>,
    tab_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    on_output: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    // `terminal.shell` (ticket 06): resolved fresh at every spawn, never
    // cached — a change made in the Settings window must reach the very next
    // new session without requiring an app restart, while any PTY already
    // running keeps whatever shell it was actually spawned with (this
    // function never touches an existing `PtyHandle`; `resolve_shell`'s own
    // tests document that isolation directly).
    let shell = {
        let dir = app_data_dir(window.app_handle())?;
        let overrides = settings_store::load_overrides(&dir);
        let registry = config_registry.0.lock().expect("config registry poisoned");
        resolve_shell(&registry, &overrides)
    };
    let integration = integration_dir
        .0
        .lock()
        .expect("shell integration dir poisoned")
        .as_deref()
        .map(|root| shell_integration::for_shell(&shell, root))
        .unwrap_or_default();

    spawn_and_register(
        &state,
        tab_id.clone(),
        pty_manager::SpawnOptions {
            cmd: shell,
            args: integration.args,
            cwd: cwd.clone().into(),
            env: integration.env,
            cols,
            rows,
        },
        move |bytes| {
            let _ = on_output.send(InvokeResponseBody::Raw(bytes.to_vec()));
        },
    )
    .map_err(|e| e.to_string())?;

    // The window can be destroyed while the disk read above (`app_data_dir`
    // + `load_overrides`) was in flight — this command is `async`, so a
    // `CloseRequested` racing that read sees an empty `WindowPtyRegistry`
    // (this spawn hasn't registered yet), skips the active-session
    // confirmation gate, and tears the window down with nothing to kill.
    // Registering into that already-dead window's slot below would leave the
    // handle above permanently unreachable (`kill_all_for_window` only ever
    // runs once per window, already ran) — a real orphaned process, not just
    // a UI freeze (2026-08-16 perf/leak audit finding). Narrows the race
    // rather than closing it outright (a check-then-register gap remains,
    // same best-effort posture as `kill_all_for_window`'s own "already-dead
    // tab_id is a no-op" handling), which is proportionate to how small that
    // remaining window is.
    if window.app_handle().get_webview_window(window.label()).is_none() {
        if let Err(error) = kill(&state, &tab_id) {
            log::warn!("failed to kill pty {tab_id} spawned for an already-closed window: {error}");
        }
        log::info!("pty spawn for tab {tab_id} discarded: window {} closed during spawn", window.label());
        return Ok(());
    }

    registry.register(window.label(), &tab_id);
    log::info!("pty spawned: tab {tab_id} cwd {cwd}");
    Ok(())
}

/// Extracted from `pty_spawn` so it's callable without a Tauri runtime, same
/// as `pty_manager` itself.
///
/// A repeated `tab_id` (e.g. a frontend retry) must not silently orphan the
/// PTY already registered under it — `HashMap::insert`'s displaced value is
/// killed, not just dropped, since dropping a `PtyHandle` doesn't kill its
/// child (mirrors `std::process::Child`'s own drop behavior). Since Ticket 18
/// this key is a tab, not a pane — several `tab_id`s belonging to the same
/// pane are independent entries and never displace each other.
///
/// Killing the displaced handle is best-effort (logged, not propagated): the
/// NEW handle is already inserted into `state` by the time that kill runs, so
/// a failure there used to `?`-propagate out of this function and skip
/// `pty_spawn`'s subsequent `registry.register` call — leaving the new PTY
/// live in `PtyState` but absent from `WindowPtyRegistry`, permanently
/// unreachable by `kill_all_for_window` on window close (2026-08-16 perf/leak
/// audit finding).
fn spawn_and_register<F>(
    state: &PtyState,
    tab_id: String,
    opts: pty_manager::SpawnOptions,
    on_output: F,
) -> anyhow::Result<()>
where
    F: Fn(&[u8]) + Send + 'static,
{
    let handle = pty_manager::spawn(opts, on_output)?;
    let previous = {
        let tab_id_for_log = tab_id.clone();
        let previous = state.0.lock().unwrap().insert(tab_id, handle);
        previous.map(|handle| (tab_id_for_log, handle))
    };
    if let Some((tab_id, previous)) = previous {
        if let Err(error) = previous.kill() {
            log::warn!("failed to kill pty displaced by a reused tab_id {tab_id}: {error}");
        }
    }
    Ok(())
}

// Deliberately NOT `(async)` (2026-08-16 perf/leak audit): `pty_write` fires
// once per keystroke (`usePtyTerminal.ts`'s `terminal.onData`) and those
// calls are a byte stream, not idempotent/order-independent — marking this
// `(async)` would let Tauri dispatch concurrent invocations onto different
// threads with no ordering guarantee, corrupting typed input order. Staying
// synchronous keeps every call's enqueue into `PtyHandle`'s writer channel in
// exact IPC-arrival order; `PtyHandle::write` itself is what got fixed
// instead (see its own comment in `pty_manager.rs`) — the actual OS write
// that could previously block this thread indefinitely now happens on a
// dedicated per-pty thread, off this one.
#[tauri::command]
pub fn pty_write(state: State<PtyState>, tab_id: String, data: Vec<u8>) -> Result<(), String> {
    with_handle(&state, &tab_id, |handle| handle.write(&data))
}

#[tauri::command]
pub fn pty_resize(
    state: State<PtyState>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    with_handle(&state, &tab_id, |handle| handle.resize(cols, rows))
}

#[tauri::command]
pub fn pty_kill(
    state: State<PtyState>,
    registry: State<WindowPtyRegistry>,
    tab_id: String,
) -> Result<(), String> {
    registry.unregister(&tab_id);
    kill(&state, &tab_id)
}

/// The `pty_kill` command's actual work, factored out so window-close
/// cleanup (Ticket 27) can kill a window's PTYs directly against the shared
/// state without going through another Tauri IPC round-trip. `pub(crate)`
/// (not private) since `resource_guard`'s tier-4 escalation calls this same
/// path directly, the same reasoning as `kill_all_for_window` below.
pub(crate) fn kill(state: &PtyState, tab_id: &str) -> Result<(), String> {
    let handle = state
        .0
        .lock()
        .unwrap()
        .remove(tab_id)
        .ok_or_else(|| format!("unknown tab_id: {tab_id}"))?;
    log::info!("pty killed: tab {tab_id}");
    handle.kill().map_err(|e| e.to_string())
}

/// Called from a window's `CloseRequested`/`Destroyed` handler (Ticket 27,
/// landmine 5): kills every PTY the registry still associates with this
/// window label. Best-effort — an already-dead/unknown `tab_id` (e.g. the
/// frontend beat the native close with its own `pty_kill`) is not an error
/// here, just a no-op for that one entry.
pub fn kill_all_for_window(state: &PtyState, registry: &WindowPtyRegistry, window_label: &str) {
    for tab_id in registry.tab_ids_for_window(window_label) {
        // Cross-window-drag ticket 01: a tab still registered under another
        // window at this instant is mid-move ("unterwegs"), not abandoned —
        // only forget this window's own association, don't kill the PTY a
        // sibling window is about to take ownership of.
        if registry.registered_under_another_window(&tab_id, window_label) {
            continue;
        }
        let _ = kill(state, &tab_id);
    }
    registry.forget_window(window_label);
}

/// Tool-icon detection (wayfinder-map Task 11): returns the binary name of
/// `tab_id`'s most active OS process-tree descendant, for the frontend to
/// map onto an icon. `None` — not an error — both when the tab has no
/// handle (already closed, a poll racing a close) and when the detector
/// itself can't find the root pid anymore; the frontend treats both the
/// same way, by simply not showing an icon.
///
/// `async` (perf audit ticket 06): a scan walks the ENTIRE OS process table
/// (`ToolDetector::detect`, via `sysinfo`), which — unlike `pty_write`,
/// `pty_resize`, `pty_kill` right above, all cheap in-memory map lookups —
/// is genuinely slow enough to matter. Every open terminal tab polls this
/// command independently (`useDetectedToolId`, ~2s cadence), so without
/// `async` a scan in flight would sit on the same IPC dispatch thread that
/// also has to dispatch e.g. `pty_write` for a completely unrelated pane,
/// adding real keystroke latency there. Same "must not block the IPC
/// dispatch thread" reasoning as `pty_spawn` above and `session_load`
/// (`session_store.rs`) — `(async)` alone (no `async fn`, matching
/// `session_load`'s and `explorer_read_dir`'s convention) is enough since
/// Tauri already dispatches an `(async)` command via its own async runtime
/// instead of the main thread; there's no `.await` point inside this body.
#[tauri::command(async)]
pub fn pty_detect_tool(
    state: State<PtyState>,
    detector: State<ToolDetector>,
    tab_id: String,
) -> Option<String> {
    let pid = state.0.lock().unwrap().get(&tab_id).and_then(PtyHandle::pid)?;
    detector.detect(pid)
}

fn with_handle(
    state: &State<PtyState>,
    tab_id: &str,
    f: impl FnOnce(&PtyHandle) -> anyhow::Result<()>,
) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    let handle = map
        .get(tab_id)
        .ok_or_else(|| format!("unknown tab_id: {tab_id}"))?;
    f(handle).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn wait_for<F: Fn() -> bool>(predicate: F, timeout: Duration) -> bool {
        let start = Instant::now();
        while start.elapsed() < timeout {
            if predicate() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        predicate()
    }

    fn sh_opts(script: &str) -> pty_manager::SpawnOptions {
        pty_manager::SpawnOptions {
            cmd: "sh".into(),
            args: vec!["-c".into(), script.into()],
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- arbitrary real cwd for a test-only PTY spawn, not a security operation.
            cwd: std::env::temp_dir(),
            env: vec![],
            cols: 80,
            rows: 24,
        }
    }

    fn is_process_alive(pid: u32) -> bool {
        // `kill -0` (the previous approach here) sends no signal, only
        // checks whether the pid could be signaled — but it's a Unix-only
        // binary, absent on Windows, where the shell-out itself fails
        // (never mind what it reports), so every check here came back
        // false regardless of whether the child was actually running.
        // `sysinfo` (already a dependency, same crate `tool_detect` uses)
        // gives the same existence check on every platform this app ships.
        let mut system = sysinfo::System::new();
        system.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::Some(&[sysinfo::Pid::from_u32(pid)]),
            true,
            sysinfo::ProcessRefreshKind::nothing(),
        );
        system.process(sysinfo::Pid::from_u32(pid)).is_some()
    }

    #[test]
    fn spawning_over_an_existing_tab_id_kills_the_previous_child() {
        let state = PtyState::default();

        spawn_and_register(&state, "tab-1".into(), sh_opts("sleep 30"), |_| {})
            .expect("first spawn should succeed");
        let first_pid = state
            .0
            .lock()
            .unwrap()
            .get("tab-1")
            .and_then(PtyHandle::pid)
            .expect("first child should have a pid");
        assert!(
            is_process_alive(first_pid),
            "sanity check: first child should be running before the overwrite"
        );

        spawn_and_register(&state, "tab-1".into(), sh_opts("true"), |_| {})
            .expect("second spawn should succeed");

        let first_child_died = wait_for(|| !is_process_alive(first_pid), Duration::from_secs(5));
        assert!(
            first_child_died,
            "expected the displaced first child to be killed, not just dropped"
        );
        assert_eq!(
            state.0.lock().unwrap().len(),
            1,
            "expected exactly one handle left registered under the reused tab_id"
        );
    }

    /// The whole point of Ticket 18: two terminal tabs of the SAME pane are
    /// two independent `tab_id`s in this map, not one `pane_id` fighting over
    /// a single slot. Neither spawn may displace the other.
    #[test]
    fn two_tabs_of_the_same_pane_run_concurrently_without_killing_each_other() {
        let state = PtyState::default();

        spawn_and_register(&state, "pane-1:tab-1".into(), sh_opts("sleep 30"), |_| {})
            .expect("first tab's spawn should succeed");
        spawn_and_register(&state, "pane-1:tab-2".into(), sh_opts("sleep 30"), |_| {})
            .expect("second tab's spawn should succeed");

        let (first_pid, second_pid) = {
            let map = state.0.lock().unwrap();
            (
                map.get("pane-1:tab-1")
                    .and_then(PtyHandle::pid)
                    .expect("first tab should have a pid"),
                map.get("pane-1:tab-2")
                    .and_then(PtyHandle::pid)
                    .expect("second tab should have a pid"),
            )
        };

        assert!(
            is_process_alive(first_pid),
            "first tab's child should still be running"
        );
        assert!(
            is_process_alive(second_pid),
            "second tab's child should still be running"
        );
        assert_eq!(
            state.0.lock().unwrap().len(),
            2,
            "expected both tabs registered under their own tab_id"
        );
    }

    /// Ticket 27, landmine 5: `kill_all_for_window` is the piece a native
    /// `CloseRequested` handler leans on when it has no frontend cooperation
    /// to rely on — it must find and kill exactly the PTYs registered under
    /// that window's label, and leave a sibling window's PTYs untouched.
    #[test]
    fn kill_all_for_window_kills_only_that_windows_tabs() {
        let state = PtyState::default();
        let registry = WindowPtyRegistry::default();

        spawn_and_register(&state, "win-a:tab-1".into(), sh_opts("sleep 30"), |_| {})
            .expect("spawn a1");
        spawn_and_register(&state, "win-a:tab-2".into(), sh_opts("sleep 30"), |_| {})
            .expect("spawn a2");
        spawn_and_register(&state, "win-b:tab-1".into(), sh_opts("sleep 30"), |_| {})
            .expect("spawn b1");
        registry.register("win-a", "win-a:tab-1");
        registry.register("win-a", "win-a:tab-2");
        registry.register("win-b", "win-b:tab-1");

        let surviving_pid = state
            .0
            .lock()
            .unwrap()
            .get("win-b:tab-1")
            .and_then(PtyHandle::pid)
            .expect("win-b's child should have a pid");

        kill_all_for_window(&state, &registry, "win-a");

        assert_eq!(
            state.0.lock().unwrap().len(),
            1,
            "expected only win-b's tab left registered"
        );
        assert!(
            state.0.lock().unwrap().contains_key("win-b:tab-1"),
            "win-b's tab must survive win-a's cleanup"
        );
        assert!(
            is_process_alive(surviving_pid),
            "win-b's child must still be running after win-a's cleanup"
        );
        assert!(
            registry.tab_ids_for_window("win-a").is_empty(),
            "win-a's registry entry should be forgotten after cleanup"
        );
    }

    #[test]
    fn unregister_removes_a_tab_from_whichever_window_it_belongs_to() {
        let registry = WindowPtyRegistry::default();
        registry.register("win-a", "tab-1");
        registry.register("win-a", "tab-2");

        registry.unregister("tab-1");

        assert_eq!(registry.tab_ids_for_window("win-a"), vec!["tab-2"]);
    }

    /// Cross-window-drag ticket 01: the move operation must register under
    /// the destination window before removing the source registration — this
    /// test proves that ordering by observing the state directly, without
    /// relying on real thread interleaving.
    #[test]
    fn move_tab_between_windows_registers_new_before_removing_old() {
        let registry = WindowPtyRegistry::default();
        registry.register("win-a", "tab-1");

        registry.move_tab("tab-1", "win-a", "win-b");

        assert_eq!(
            registry.tab_ids_for_window("win-b"),
            vec!["tab-1"],
            "tab should be registered under the destination window"
        );
        assert!(
            registry.tab_ids_for_window("win-a").is_empty(),
            "tab should no longer be registered under the source window"
        );
    }

    /// Cross-window-drag ticket 01 (spec.md "Backend-Registrierungsreihenfolge"):
    /// while a move is in flight, `tab_id` is briefly registered under BOTH
    /// windows. A source-window close racing that instant must not kill the
    /// PTY — it is "unterwegs" (in transit) to the destination window, not
    /// abandoned. `kill_all_for_window`'s behavior for a tab registered under
    /// only ONE window (the normal, non-move case) stays exactly as tested
    /// above in `kill_all_for_window_kills_only_that_windows_tabs`.
    #[test]
    fn window_close_racing_a_cross_window_move_does_not_kill_the_in_flight_pty() {
        let state = PtyState::default();
        let registry = WindowPtyRegistry::default();

        spawn_and_register(&state, "tab-1".into(), sh_opts("sleep 30"), |_| {})
            .expect("spawn tab-1");
        registry.register("win-a", "tab-1");

        let pid = state
            .0
            .lock()
            .unwrap()
            .get("tab-1")
            .and_then(PtyHandle::pid)
            .expect("tab-1 should have a pid");

        // The mid-move instant this ticket's ordering rule produces: already
        // registered under the destination, not yet removed from the source.
        registry.register("win-b", "tab-1");

        // The SOURCE window's close fires here, mid-move.
        kill_all_for_window(&state, &registry, "win-a");

        assert!(
            is_process_alive(pid),
            "in-flight PTY must survive a source-window close racing a move"
        );
        assert!(
            state.0.lock().unwrap().contains_key("tab-1"),
            "PtyState entry must remain for the in-flight tab"
        );
        assert_eq!(
            registry.tab_ids_for_window("win-b"),
            vec!["tab-1"],
            "destination registration must survive the source window's close"
        );
        assert!(
            registry.tab_ids_for_window("win-a").is_empty(),
            "source window's own bookkeeping is still forgotten on its close"
        );
    }

    /// Ticket 06: `resolve_shell` is what `pty_spawn` calls fresh on every
    /// invocation — these tests stand in for the acceptance criteria that
    /// need a running Tauri app to exercise as real IPC (there is no
    /// mock-app harness for `pty_spawn` itself in this codebase yet).
    mod resolve_shell_tests {
        use super::*;
        use crate::config_core::register_core_settings;
        use serde_json::json;

        fn registry_with_core_settings() -> ConfigRegistry {
            let mut registry = ConfigRegistry::new();
            register_core_settings(&mut registry).expect("core settings should register cleanly");
            registry
        }

        #[test]
        fn resolves_the_registered_default_when_no_override_is_set() {
            let registry = registry_with_core_settings();
            let overrides = Overrides::new();

            assert_eq!(resolve_shell(&registry, &overrides), pty_manager::default_shell());
        }

        #[test]
        fn resolves_the_override_when_one_is_set() {
            let registry = registry_with_core_settings();
            let mut overrides = Overrides::new();
            overrides.insert("terminal.shell".to_string(), json!("/bin/fish"));

            assert_eq!(resolve_shell(&registry, &overrides), "/bin/fish");
        }

        /// The isolation guarantee itself, not just the "picks up the new
        /// value" half: a shell string already captured for an existing
        /// session (`captured`, standing in for what `pty_spawn` stored into
        /// a `PtyHandle`'s `SpawnOptions` at ITS OWN call time) is a plain,
        /// owned `String` — changing the override afterwards can, by
        /// construction, never reach back into it. A second, independent
        /// `resolve_shell` call (standing in for the NEXT `pty_spawn`) picks
        /// the new value up, which is the actual "next session gets it"
        /// criterion.
        #[test]
        fn a_later_override_change_never_reaches_an_already_captured_shell_but_the_next_resolve_sees_it() {
            let registry = registry_with_core_settings();
            let mut overrides = Overrides::new();
            overrides.insert("terminal.shell".to_string(), json!("/bin/zsh"));

            let captured = resolve_shell(&registry, &overrides);
            assert_eq!(captured, "/bin/zsh");

            overrides.insert("terminal.shell".to_string(), json!("/bin/bash"));

            // The already-"running session"'s own value stands completely
            // untouched by the override change above.
            assert_eq!(captured, "/bin/zsh");
            // A fresh resolve (the next `pty_spawn`) sees the new value.
            assert_eq!(resolve_shell(&registry, &overrides), "/bin/bash");
        }

        /// An override whose value doesn't even type-check as a string
        /// (e.g. a hand-edited `settings.json` from ticket 07's raw mode
        /// bypassing normal validation) must never crash a spawn — falling
        /// back to the schema default is the same "corrupt input, safe
        /// default" posture as `json_store::read_json`.
        #[test]
        fn falls_back_to_the_default_when_the_override_has_the_wrong_type() {
            let registry = registry_with_core_settings();
            let mut overrides = Overrides::new();
            overrides.insert("terminal.shell".to_string(), json!(42));

            assert_eq!(resolve_shell(&registry, &overrides), pty_manager::default_shell());
        }
    }
}
