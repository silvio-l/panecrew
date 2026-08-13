//! Cross-platform CLI-tool detection for terminal tab icons (wayfinder-map
//! Task 11/12, project-instructions scope note): walks the real OS process
//! tree from a spawned PTY's own shell pid downward and returns the most
//! active descendant's binary name. Deterministic OS process state, not
//! terminal-output parsing — the reason this does NOT fall under the
//! project instructions' session-status-detection exclusion, unlike
//! `Needs-Attention` (ticket 13), which does and is documented there as an
//! explicit scope extension.
//!
//! `portable-pty`'s own `process_group_leader()` is `#[cfg(unix)]`-only (no
//! Windows implementation exists in the crate), so this uses `sysinfo`
//! instead for one code path on every platform. The returned binary name is
//! raw and unmapped — icon selection is a frontend concern.

use std::collections::HashMap;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// Wraps a `System` behind a `Mutex` so it can live in Tauri's managed state
/// across repeated polls — CPU usage is meaningless from a single refresh
/// (sysinfo's own documented limitation: it's a delta since the PREVIOUS
/// refresh), so a fresh `System` per call would report 0% for everyone.
#[derive(Default)]
pub struct ToolDetector(Mutex<System>);

impl ToolDetector {
    /// Returns the binary name of `root_pid`'s most active descendant, or of
    /// `root_pid` itself when it has no children (the common idle-shell
    /// case). `None` when `root_pid` is already gone — the tab can close
    /// between the frontend's poll and this call reaching the process table.
    ///
    /// "Most active" prefers the highest sampled CPU usage; ties — including
    /// the common case where nothing has used any CPU since the previous
    /// poll — fall back to the deepest descendant, since a foreground CLI
    /// tool is almost always the leaf of the shell's own process chain
    /// (shell → node wrapper → the actual tool, or similar).
    pub fn detect(&self, root_pid: u32) -> Option<String> {
        let mut system = self.0.lock().unwrap();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cpu(),
        );

        let root = Pid::from_u32(root_pid);
        system.process(root)?;

        let mut children_by_parent: HashMap<Pid, Vec<Pid>> = HashMap::new();
        for (pid, process) in system.processes() {
            if let Some(parent) = process.parent() {
                children_by_parent.entry(parent).or_default().push(*pid);
            }
        }

        let mut best: Option<(Pid, f32, u32)> = None;
        let mut stack: Vec<(Pid, u32)> = vec![(root, 0)];
        while let Some((pid, depth)) = stack.pop() {
            if let Some(children) = children_by_parent.get(&pid) {
                for &child in children {
                    stack.push((child, depth + 1));
                }
            }
            // The shell itself (depth 0) is only the fallback target below,
            // never a candidate that could "win" over an actual descendant.
            if depth == 0 {
                continue;
            }
            let Some(process) = system.process(pid) else {
                continue;
            };
            let cpu = process.cpu_usage();
            let is_better = match best {
                None => true,
                Some((_, best_cpu, best_depth)) => {
                    cpu > best_cpu || (cpu == best_cpu && depth > best_depth)
                }
            };
            if is_better {
                best = Some((pid, cpu, depth));
            }
        }

        let target = best.map_or(root, |(pid, _, _)| pid);
        system
            .process(target)
            .map(|process| process.name().to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    fn wait_for<F: Fn() -> bool>(predicate: F, timeout: Duration) -> bool {
        let start = Instant::now();
        while start.elapsed() < timeout {
            if predicate() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        predicate()
    }

    /// `sh -c "sleep 30 & wait"`: `sh` stays alive (waiting on the
    /// background job) instead of `exec`-replacing itself with `sleep`, so
    /// this reliably produces a real two-generation process tree —
    /// `sh` (the "shell" a PTY would report as its own pid) with `sleep` as
    /// an actual OS child, not just a single process wearing two names.
    fn spawn_shell_with_child() -> Child {
        Command::new("sh")
            .args(["-c", "sleep 30 & wait"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawning the fixture shell should succeed")
    }

    #[test]
    fn detects_the_deepest_child_when_nothing_has_measurable_cpu_usage() {
        let mut shell = spawn_shell_with_child();
        let detector = ToolDetector::default();

        // sysinfo's CPU delta needs two refreshes with real wall-clock time
        // between them before it reports anything other than 0% for a
        // process that's just sleeping — matching real production polling.
        detector.detect(shell.id());
        std::thread::sleep(Duration::from_millis(200));

        let detected = wait_for(
            || detector.detect(shell.id()).as_deref() == Some("sleep"),
            Duration::from_secs(5),
        );

        let _ = shell.kill();
        let _ = shell.wait();
        assert!(
            detected,
            "expected the sleeping grandchild 'sleep' to be detected as the deepest descendant"
        );
    }

    #[test]
    fn falls_back_to_the_root_process_when_it_has_no_children() {
        let mut shell = Command::new("sh")
            .args(["-c", "sleep 30"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawning the fixture shell should succeed");
        let detector = ToolDetector::default();

        // A plain `sh -c "sleep 30"` execs directly into `sleep` on most
        // shells (no fork), so the spawned pid itself already reports as
        // "sleep" — there is no child to fall back FROM, which is exactly
        // the "root has no children" case this test targets.
        let detected = wait_for(
            || detector.detect(shell.id()).is_some(),
            Duration::from_secs(5),
        );

        let _ = shell.kill();
        let _ = shell.wait();
        assert!(detected, "expected a name for the root process itself");
    }

    #[test]
    fn returns_none_for_an_already_dead_pid() {
        let mut shell = spawn_shell_with_child();
        let pid = shell.id();
        let _ = shell.kill();
        let _ = shell.wait();

        let detector = ToolDetector::default();
        assert!(wait_for(
            || detector.detect(pid).is_none(),
            Duration::from_secs(5)
        ));
    }
}
