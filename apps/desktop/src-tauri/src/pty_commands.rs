//! Thin Tauri-command wrappers over `pty_manager` — see
//! `.scratch/panecrew-v0.1/issues/02-ipc-contract.md` for the frozen IPC
//! contract these commands implement (Ticket 18 addendum: `pane_id` renamed
//! to `tab_id` throughout, see the addendum entry there for why). No
//! lifecycle logic lives here; all of it is in `pty_manager`.

use crate::pty_manager::{self, PtyHandle};
use crate::shell_integration;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

#[derive(Default)]
pub struct PtyState(Mutex<HashMap<String, PtyHandle>>);

/// Where PaneCrew's shell wrappers were written at startup — `None` if that
/// failed, in which case panes spawn unwrapped rather than not at all.
pub struct ShellIntegrationDir(pub Option<PathBuf>);

#[tauri::command]
pub fn pty_spawn(
    state: State<PtyState>,
    integration_dir: State<ShellIntegrationDir>,
    tab_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    on_output: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let shell = pty_manager::default_shell();
    let integration = integration_dir
        .0
        .as_deref()
        .map(|root| shell_integration::for_shell(&shell, root))
        .unwrap_or_default();

    spawn_and_register(
        &state,
        tab_id,
        pty_manager::SpawnOptions {
            cmd: shell,
            args: integration.args,
            cwd: cwd.into(),
            env: integration.env,
            cols,
            rows,
        },
        move |bytes| {
            let _ = on_output.send(InvokeResponseBody::Raw(bytes.to_vec()));
        },
    )
    .map_err(|e| e.to_string())
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
    if let Some(previous) = state.0.lock().unwrap().insert(tab_id, handle) {
        previous.kill()?;
    }
    Ok(())
}

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
pub fn pty_kill(state: State<PtyState>, tab_id: String) -> Result<(), String> {
    let handle = state
        .0
        .lock()
        .unwrap()
        .remove(&tab_id)
        .ok_or_else(|| format!("unknown tab_id: {tab_id}"))?;
    handle.kill().map_err(|e| e.to_string())
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
            cwd: std::env::temp_dir(),
            env: vec![],
            cols: 80,
            rows: 24,
        }
    }

    fn is_process_alive(pid: u32) -> bool {
        // `kill -0` sends no signal, only checks whether the pid could be
        // signaled — the same existence probe a process manager would use.
        // Its own "No such process" message goes to stderr once the child
        // has died, which is expected during polling, not a real failure.
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
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
}
