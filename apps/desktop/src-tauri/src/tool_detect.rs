//! Cross-platform CLI-tool detection for terminal tab icons (wayfinder-map
//! Task 11/12, project-instructions scope note): walks the real OS process
//! tree from a spawned PTY's own shell pid downward and returns a canonical
//! tool id (see `TOOL_MARKERS` below) or `None` when nothing recognizable is
//! running. Deterministic OS process state, not terminal-output parsing —
//! the reason this does NOT fall under the project instructions'
//! session-status-detection exclusion, unlike `Needs-Attention` (ticket 13),
//! which does and is documented there as an explicit scope extension.
//!
//! `portable-pty`'s own `process_group_leader()` is `#[cfg(unix)]`-only (no
//! Windows implementation exists in the crate), so this uses `sysinfo`
//! instead for one code path on every platform.
//!
//! Matching happens against BOTH the process name and its full command-line
//! arguments, not the name alone: most Node.js-based CLI agents ship as a
//! `#!/usr/bin/env node` shebang script — the kernel execs `node` directly
//! for those, so the OS-level process is genuinely named "node", never
//! anything tool-specific. Only the script's own path, visible in argv,
//! still carries that name. Matching on the name alone briefly "worked"
//! only for the instant right after spawn (before the shebang exec replaced
//! the image), then silently reverted to nothing — the exact bug this
//! comment exists to prevent regressing.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{Pid, Process, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};

/// (Suchstichwort, kanonische Tool-ID) — das Stichwort wird als
/// Teilstring-Suche (case-insensitive) gegen Prozessname UND volle
/// Befehlszeile geprüft, s. Kopfkommentar zum Grund.
const TOOL_MARKERS: &[(&str, &str)] = &[
    ("claude", "claude"), // brandlint-ok: funktionaler Match-String gegen den realen Prozessnamen/argv, keine Werbenennung
    ("gemini", "gemini"), // brandlint-ok: funktionaler Match-String gegen den realen Prozessnamen/argv, keine Werbenennung
    ("copilot", "copilot"), // brandlint-ok: funktionaler Match-String gegen den realen Prozessnamen/argv, keine Werbenennung
    ("codex", "codex"), // brandlint-ok: funktionaler Match-String gegen den realen Prozessnamen/argv, keine Werbenennung
    ("opencode", "opencode"),
];

const SHELL_BINARIES: &[&str] = &[
    "bash",
    "zsh",
    "fish",
    "sh",
    "dash",
    "ksh",
    "tcsh",
    "csh",
    "pwsh",
    "powershell",
    "cmd",
];

/// Ticket 03 (perf audit): every open terminal tab polls `detect()`
/// independently (`useDetectedToolId`, ~2s cadence per tab, see
/// `useDetectedTool.ts`) — without coalescing, N open tabs whose poll
/// intervals land close together each trigger their own full system-wide
/// `sysinfo` process refresh, which is the actually expensive part of a
/// scan (walking every OS process), not the per-call tree walk over the
/// already-fetched snapshot. A refresh inside this window is reused by
/// every caller instead of re-triggered; only the first caller after the
/// TTL expires pays for a fresh one. Short enough that no caller ever acts
/// on data staler than a fraction of a single tab's own poll interval.
const REFRESH_TTL: Duration = Duration::from_millis(500);

/// The shared, cached `sysinfo` state plus when it was last actually
/// refreshed (`None` before the first call ever runs).
#[derive(Default)]
struct Snapshot {
    system: System,
    refreshed_at: Option<Instant>,
}

/// Wraps a `Snapshot` behind a `Mutex` so it can live in Tauri's managed
/// state across repeated polls — CPU usage is meaningless from a single
/// refresh (sysinfo's own documented limitation: it's a delta since the
/// PREVIOUS refresh), so a fresh `System` per call would report 0% for
/// everyone. The same lock that guards the `System` also coalesces
/// concurrent/near-simultaneous `detect()` calls onto one underlying
/// refresh (see `REFRESH_TTL` above): a caller that finds the cache still
/// fresh skips `refresh_processes_specifics` entirely and reads straight
/// from what an earlier caller already fetched.
pub struct ToolDetector {
    snapshot: Mutex<Snapshot>,
    /// Test-only instrumentation: counts actual underlying refreshes so the
    /// coalescing test below can assert on it directly instead of inferring
    /// it from timing. Absent from release builds.
    #[cfg(test)]
    refresh_count: AtomicUsize,
}

impl Default for ToolDetector {
    fn default() -> Self {
        Self {
            snapshot: Mutex::new(Snapshot::default()),
            #[cfg(test)]
            refresh_count: AtomicUsize::new(0),
        }
    }
}

#[cfg(test)]
impl ToolDetector {
    fn refresh_count(&self) -> usize {
        self.refresh_count.load(Ordering::SeqCst)
    }
}

impl ToolDetector {
    /// Returns a canonical tool id for `root_pid`'s process tree, or `None`
    /// when nothing recognizable is running there. `root_pid` gone entirely
    /// (the tab closed between the frontend's poll and this call reaching
    /// the process table) also reads as `None`.
    ///
    /// Priority: (1) the SHALLOWEST descendant whose name or argv matches a
    /// known tool wins outright — depth beats CPU here, since the actual
    /// CLI invocation is almost always the shell's direct child, with any
    /// deeper matches (e.g. a subprocess the tool itself spawned that
    /// happens to mention the same word) being noise. (2) If nothing
    /// matches but a child process exists at all, that's a real foreground
    /// job we just don't recognize — the spec calls for showing no icon
    /// then, not a guess. (3) Only a childless root (an idle shell) falls
    /// back to identifying the shell itself.
    pub fn detect(&self, root_pid: u32) -> Option<String> {
        let mut snapshot = self.snapshot.lock().unwrap();
        let stale = match snapshot.refreshed_at {
            Some(refreshed_at) => refreshed_at.elapsed() >= REFRESH_TTL,
            None => true,
        };
        if stale {
            // `cmd` defaults to `UpdateKind::Never` — without asking for it
            // explicitly, `Process::cmd()` stays empty forever regardless of
            // the real command line, silently defeating `match_tool`'s argv
            // search.
            snapshot.system.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
            );
            snapshot.refreshed_at = Some(Instant::now());
            #[cfg(test)]
            self.refresh_count.fetch_add(1, Ordering::SeqCst);
        }
        let system = &snapshot.system;

        let root = Pid::from_u32(root_pid);
        system.process(root)?;

        let mut children_by_parent: HashMap<Pid, Vec<Pid>> = HashMap::new();
        for (pid, process) in system.processes() {
            if let Some(parent) = process.parent() {
                children_by_parent.entry(parent).or_default().push(*pid);
            }
        }

        let mut best_match: Option<(&'static str, u32)> = None; // (tool_id, depth)
        let mut has_unmatched_descendant = false;
        let mut stack: Vec<(Pid, u32)> = vec![(root, 0)];
        while let Some((pid, depth)) = stack.pop() {
            if let Some(children) = children_by_parent.get(&pid) {
                for &child in children {
                    stack.push((child, depth + 1));
                }
            }
            if depth == 0 {
                continue; // root only ever matters as the childless-shell fallback below
            }
            let Some(process) = system.process(pid) else {
                continue;
            };
            match match_tool(process) {
                Some(tool_id) => {
                    let better = match best_match {
                        None => true,
                        Some((_, best_depth)) => depth < best_depth,
                    };
                    if better {
                        best_match = Some((tool_id, depth));
                    }
                }
                None => has_unmatched_descendant = true,
            }
        }

        if let Some((tool_id, _)) = best_match {
            return Some(tool_id.to_string());
        }
        if has_unmatched_descendant {
            return None;
        }

        let root_process = system.process(root)?;
        let root_name = root_process.name().to_string_lossy().to_lowercase();
        let root_name = root_name.strip_suffix(".exe").unwrap_or(&root_name);
        SHELL_BINARIES
            .contains(&root_name)
            .then(|| "shell".to_string())
    }
}

fn match_tool(process: &Process) -> Option<&'static str> {
    let mut haystack = process.name().to_string_lossy().to_lowercase();
    for arg in process.cmd() {
        haystack.push(' ');
        haystack.push_str(&arg.to_string_lossy().to_lowercase());
    }
    TOOL_MARKERS
        .iter()
        .find(|(marker, _)| haystack.contains(marker))
        .map(|(_, id)| *id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command, Stdio};
    use std::sync::{Arc, Barrier};
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

    /// Reproduces the real bug this module's header comment documents:
    /// writes a throwaway shebang script whose PATH contains a known tool
    /// marker, then runs it as a background job of a shell. The kernel
    /// execs `/bin/sh` for that script (the shebang interpreter), so the
    /// resulting process is itself named "sh" — exactly like a real
    /// Node-based CLI agent, which the kernel execs as "node". Only the
    /// script's own path in argv still carries the recognizable name, which
    /// is what `match_tool` must find.
    #[test]
    #[cfg(unix)]
    fn matches_a_known_tool_by_argv_even_when_the_process_itself_is_named_after_the_interpreter() {
        use std::os::unix::fs::PermissionsExt;

        // Test-only fixture, not a security operation: no untrusted input in
        // the path, PID keeps it unique for the test's lifetime, and it's
        // removed at the end of this function.
        let script_path = std::env::temp_dir().join(format!( // nosemgrep: rust.lang.security.temp-dir.temp-dir
            "panecrew-tool-detect-claude-fixture-{}.sh", // brandlint-ok: Fixture-Dateiname muss ein echtes TOOL_MARKERS-Stichwort enthalten, sonst testet der Fall nichts
            std::process::id()
        ));
        std::fs::write(&script_path, "#!/bin/sh\nsleep 30\n").expect("writing the fixture script should succeed");
        let mut perms = std::fs::metadata(&script_path)
            .expect("fixture script metadata should be readable")
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).expect("fixture script should become executable");

        let mut shell = Command::new("sh")
            .arg("-c")
            .arg(format!("{} & wait", script_path.display()))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawning the fixture shell should succeed");
        let detector = ToolDetector::default();

        let detected = wait_for(
            || detector.detect(shell.id()).as_deref() == Some("claude"), // brandlint-ok: erwartete kanonische Tool-ID, funktionale Testaussage
            Duration::from_secs(5),
        );

        let _ = shell.kill();
        let _ = shell.wait();
        let _ = std::fs::remove_file(&script_path);
        assert!(
            detected,
            "expected the tool marker in the script's own path (argv) to be matched even though the running process itself reports as 'sh'"
        );
    }

    // Windows-only: Git for Windows' MSYS layer spawns an external command
    // through a short-lived intermediary process, gone from the process
    // table again within milliseconds — so `sleep.exe`'s OS-reported parent
    // pid points at an entry `sysinfo` can no longer find, severing the
    // link back to the `sh`/`bash` root this fixture relies on. That's an
    // external MSYS/Windows process-ancestry limitation, not a bug in
    // `detect()`'s own tree walk — there's no OS-level parent-child chain
    // left to walk by the time any observer (sysinfo, tasklist, Process
    // Explorer) looks. Unix `sh` keeps the real, live parent-child link the
    // whole time, so these tests stay meaningful there.
    #[cfg(unix)]
    #[test]
    fn returns_no_icon_for_an_active_but_unrecognized_descendant() {
        let mut shell = spawn_shell_with_child();
        let detector = ToolDetector::default();

        // The very first refresh after spawn can still return `None` simply
        // because sysinfo hasn't observed the child yet — only a SUSTAINED
        // `None` across later polls proves this isn't a guess, matching how
        // the frontend actually polls in production.
        detector.detect(shell.id());
        std::thread::sleep(Duration::from_millis(200));
        let stayed_none = wait_for(|| detector.detect(shell.id()).is_none(), Duration::from_secs(2))
            && detector.detect(shell.id()).is_none();

        let _ = shell.kill();
        let _ = shell.wait();
        assert!(
            stayed_none,
            "expected an unrecognized real descendant ('sleep') to still show no icon, not a guessed name"
        );
    }

    #[test]
    fn falls_back_to_shell_when_the_root_has_no_children() {
        // No `-c` script to exec into: a bare interactive `sh` reads from
        // stdin in a loop and spawns nothing on its own, staying a genuine
        // childless root for as long as its stdin stays open.
        let mut shell = Command::new("sh")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawning the fixture shell should succeed");
        let detector = ToolDetector::default();

        let detected = wait_for(
            || detector.detect(shell.id()).as_deref() == Some("shell"),
            Duration::from_secs(5),
        );

        let _ = shell.kill();
        let _ = shell.wait();
        assert!(detected, "expected a childless shell root to identify as 'shell'");
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

    /// Fixture-struct style (matches `explorer_watch.rs`/`session_store.rs`
    /// etc.): owns the throwaway shell child and guarantees it's killed even
    /// if an assertion below panics.
    struct Fixture {
        shell: Child,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                shell: spawn_shell_with_child(),
            }
        }

        fn pid(&self) -> u32 {
            self.shell.id()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = self.shell.kill();
            let _ = self.shell.wait();
        }
    }

    /// Ticket 03: N terminal tabs polling at (near-)the same moment must
    /// still cost one underlying `sysinfo` refresh, not N — that refresh,
    /// not the tree walk over its already-fetched result, is the expensive
    /// part `REFRESH_TTL` exists to coalesce. Uses a brand-new detector (no
    /// priming call) so the very first `detect()` in the batch is the one
    /// that has to refresh, and the outcome is a deterministic exact count
    /// rather than a range: every call is serialized through the same
    /// `Mutex<Snapshot>`, so whichever thread the OS scheduler lets acquire
    /// the lock first always finds `refreshed_at` still `None` (stale) and
    /// refreshes; by the time any other thread gets the lock afterward,
    /// `REFRESH_TTL` (500ms) has not remotely elapsed, so it reuses the
    /// cache. No thread can observe a state in between.
    // Windows-only: relies on `Fixture`'s "unmatched sleep child" tree
    // shape, which the severed MSYS parent-child link (see the comment on
    // `returns_no_icon_for_an_active_but_unrecognized_descendant`) makes
    // unobservable on Windows.
    #[cfg(unix)]
    #[test]
    fn concurrent_detect_calls_within_the_ttl_window_share_one_underlying_refresh() {
        const CONCURRENT_CALLS: usize = 8;

        let fixture = Fixture::new();
        let pid = fixture.pid();

        // Warm-up with a throwaway detector, NOT the one this test measures:
        // `sysinfo` only reports a child once the OS has actually made it
        // visible in the process table, which can lag slightly behind
        // `Command::spawn()` returning — without this, the burst below could
        // race a still-invisible "sleep" child and see the childless-shell
        // fallback (`Some("shell")`) instead of the intended unmatched
        // descendant (`None`), independent of this module's own cache.
        let warmup = ToolDetector::default();
        wait_for(|| warmup.detect(pid).is_none(), Duration::from_secs(5));

        let detector = Arc::new(ToolDetector::default());

        // A barrier lines every thread up at the same instant instead of
        // relying on OS scheduling to make their `detect()` calls land
        // close together.
        let barrier = Arc::new(Barrier::new(CONCURRENT_CALLS));
        let handles: Vec<_> = (0..CONCURRENT_CALLS)
            .map(|_| {
                let detector = Arc::clone(&detector);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    detector.detect(pid)
                })
            })
            .collect();

        let results: Vec<Option<String>> =
            handles.into_iter().map(|h| h.join().unwrap()).collect();

        assert_eq!(
            detector.refresh_count(),
            1,
            "expected the {CONCURRENT_CALLS} concurrent detect() calls inside the TTL window to collapse into exactly one underlying process refresh, not {CONCURRENT_CALLS}"
        );
        assert!(
            results.iter().all(Option::is_none),
            "every concurrent caller should see the same, consistent detection result ('sleep' is an unrecognized descendant, so `None`) from the shared snapshot"
        );
    }

    /// Ticket 03's other criterion: "each tab still receives a correct,
    /// current detection result" — a shared cache must not let one tab's
    /// answer leak onto another's. Two roots with genuinely DIFFERENT
    /// expected outcomes, detected back-to-back through the same detector
    /// (so both land inside one TTL window and share its one refresh),
    /// each still has to come back with its own correct result.
    // Windows-only: same severed MSYS parent-child link as the other two
    // tests above — the "unmatched sleep child" fixture shape it also
    // relies on is unobservable there.
    #[cfg(unix)]
    #[test]
    fn a_shared_refresh_still_returns_each_root_pids_own_correct_result() {
        let unmatched_fixture = Fixture::new(); // sh + unmatched "sleep" child -> None
        let unmatched_pid = unmatched_fixture.pid();
        let mut idle_shell = Command::new("sh")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawning the fixture shell should succeed");
        let idle_pid = idle_shell.id();

        // Warm up both roots with throwaway detectors first — same
        // process-table-visibility race as the test above, now for two
        // roots at once: the measured detector's single refresh must find
        // both already fully settled.
        let warmup_unmatched = ToolDetector::default();
        wait_for(
            || warmup_unmatched.detect(unmatched_pid).is_none(),
            Duration::from_secs(5),
        );
        let warmup_idle = ToolDetector::default();
        wait_for(
            || warmup_idle.detect(idle_pid).as_deref() == Some("shell"),
            Duration::from_secs(5),
        );

        let detector = ToolDetector::default();
        let unmatched_result = detector.detect(unmatched_pid);
        let idle_result = detector.detect(idle_pid);

        let _ = idle_shell.kill();
        let _ = idle_shell.wait();

        assert_eq!(
            detector.refresh_count(),
            1,
            "both calls landed inside the same TTL window and should share one refresh"
        );
        assert_eq!(
            unmatched_result, None,
            "the unmatched-descendant root's own result must not be replaced by the idle root's"
        );
        assert_eq!(
            idle_result.as_deref(),
            Some("shell"),
            "the idle-shell root's own result must not be replaced by the unmatched root's"
        );
    }
}
