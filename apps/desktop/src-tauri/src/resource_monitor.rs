//! Hintergrund-Sampler für die Ressourcenanzeige der Titelleiste: PaneCrews
//! eigener Prozess plus, für jede lebende PTY, deren gesamter rekursiver
//! Prozessbaum (Shell + alle Nachfahren — ein Agent-CLI, ein Dev-Server, ...,
//! s. `resource_guard::tick_all`), auf niedrigem, festem Takt refresht —
//! günstig genug, um über die gesamte Prozesslaufzeit mitzulaufen.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager};

use crate::pty_commands::{PtyState, WindowPtyRegistry};
use crate::resource_guard::{self, ResourceGuardState};
use crate::windows;

const SAMPLE_INTERVAL: Duration = Duration::from_secs(5);

// How often a sample gets written to the persistent log even when nothing
// changed — the live UI event above is the only place samples went before
// (2026-08-26 incident: PaneCrew ran the machine's real memory into the
// ground, the OS's own low-memory dialog reported ~85GB, and afterwards
// there was no trail anywhere — not in the UI, which nobody was watching at
// the time, and not on disk, since this sampler never wrote a single line).
// A periodic heartbeat plus an immediate line on every threshold crossing
// (below) means a postmortem always has *something* in `panecrew.log`.
const LOG_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60);

// 3 Samples * 5s = 15s gleitendes Fenster für die CPU-Zahl: eine einzelne
// kurze Lastspitze (ein Compile-Burst, `git status`) soll nicht sofort in
// den Warnzustand kippen. RAM braucht diese Glättung nicht — er baut sich
// über Zeit auf statt kurz zu zappeln.
const CPU_SMOOTHING_WINDOW: usize = 3;

// RAM = eigene RSS + Summe aller PTY-Prozessbaum-RSS, absolut in Bytes
// bewertet statt als Anteil am Gesamt-RAM der Maschine: ein Prozentsatz vom
// System-Gesamt-RAM wäre auf einer 8-GB-Maschine viel zu empfindlich und auf
// einer 64-GB-Maschine viel zu träge, obwohl PaneCrews eigener Verbrauch
// (Terminals + darin laufende Agent-CLIs) auf beiden identisch aussieht.
// Baseline: ein einzelnes Terminal mit einer laufenden Agent-CLI zieht grob
// 1 GB — mehrere solcher Panes parallel sind normaler Betrieb, kein
// Warnsignal. Erst deutlich darüber ist es ein Signal für ein echtes Leck
// oder eine ungewöhnlich exzessive Situation.
const MEM_WARN_BYTES: u64 = 6 * 1024 * 1024 * 1024;
const MEM_CRITICAL_BYTES: u64 = 12 * 1024 * 1024 * 1024;

// CPU = Summe der Prozess-CPU-Auslastung (sysinfo-Konvention: 0-100 pro
// Kern), normalisiert auf die Gesamtkapazität der Maschine, über das
// Fenster oben geglättet.
const CPU_WARN_PERCENT: f32 = 25.0;
const CPU_CRITICAL_PERCENT: f32 = 60.0;

pub const EVENT_NAME: &str = "resource-usage";

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    Normal,
    Warn,
    Critical,
}

impl Status {
    fn label(self) -> &'static str {
        match self {
            Status::Normal => "normal",
            Status::Warn => "warn",
            Status::Critical => "critical",
        }
    }

    /// Ordinal rank for "did this get worse", used only for choosing the log
    /// level of a transition — `Status` itself intentionally has no `Ord`
    /// (nothing outside logging needs to compare severity).
    fn rank(self) -> u8 {
        match self {
            Status::Normal => 0,
            Status::Warn => 1,
            Status::Critical => 2,
        }
    }
}

/// Eine flache Liste statt bereits pro Pane gruppiert: welche Tabs zu welcher
/// Pane gehören, weiß nur der Grid-Store im Frontend (`gridState.ts`) —
/// dieser Rust-Sampler kennt nur `tabId`s, keine `paneId`s (dieselbe
/// Trennung wie überall sonst zwischen PTY-Prozessverwaltung und
/// UI-Layout). `TitleBar.tsx`s Hover-Popover gruppiert selbst anhand des
/// bestehenden Grid-Zustands.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TabUsage {
    tab_id: String,
    mem_percent: f32,
    cpu_percent: f32,
    mem_bytes: u64,
    /// `None` only in the brief race between a tab spawning and
    /// `WindowPtyRegistry::register` running for it (see `pty_spawn`) — the
    /// frontend drops such a tab from window grouping the same way it
    /// already drops a tab with no sample yet.
    window_label: Option<String>,
}

/// One entry per open content window (excludes "about"/"settings"/splash,
/// same filter as the native "Window" menu it's built from) — lets the
/// frontend label each window's tab group with something a user recognizes
/// instead of the bare Tauri window label.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowInfo {
    label: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResourceUsage {
    mem_percent: f32,
    cpu_percent: f32,
    mem_status: Status,
    cpu_status: Status,
    /// Rohe App-weite RSS-Summe (eigener Prozess + alle PTY-Prozessbäume) in Bytes
    /// — dieselbe Zahl, aus der `mem_percent` oben abgeleitet ist. Roh
    /// mitgeschickt statt dem Frontend das Zurückrechnen aus dem
    /// Prozentwert zu überlassen (bräuchte dort zusätzlich das
    /// System-Gesamt-RAM und würde Rundungsdrift einführen).
    mem_bytes_total: u64,
    tabs: Vec<TabUsage>,
    windows: Vec<WindowInfo>,
}

fn format_gib(bytes: u64) -> String {
    format!("{:.2}GiB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}

/// Logged whenever `mem_status`/`cpu_status` cross a threshold in either
/// direction, and — regardless of any crossing — every `LOG_HEARTBEAT_INTERVAL`
/// as a baseline. `sys_used_mem`/`sys_used_swap` (the whole machine, not just
/// PaneCrew's tracked total) are the point: PaneCrew's own gauge only sums its
/// own pid plus each PTY's recursive process tree (`resource_guard::tick_all`)
/// — it cannot see memory in the separate WebKit XPC processes (WebContent,
/// GPU, Networking) the OS spawns for the app's own webview, since those are
/// children of launchd, not of PaneCrew or any PTY shell (verified via `ps
/// -eo pid,ppid,comm` against a running instance). A leak there would leave
/// `mem_bytes_total` looking perfectly normal while the machine chokes — the
/// system-wide numbers are what would catch that case in the log even though
/// the app's own total can't.
/// Pure decision: what to write and at what level. Split out from
/// `log_resource_sample` below so it's testable without touching the `log`
/// crate's process-global logger state.
fn resource_log_line(
    usage: &ResourceUsage,
    sys_used_mem: u64,
    sys_total_mem: u64,
    sys_used_swap: u64,
    sys_total_swap: u64,
    transition_from: Option<(Status, Status)>,
) -> (log::Level, String) {
    let mut top_tabs: Vec<&TabUsage> = usage.tabs.iter().collect();
    top_tabs.sort_by_key(|t| std::cmp::Reverse(t.mem_bytes));
    let top_tabs_summary = top_tabs
        .iter()
        .take(5)
        .map(|t| format!("{}={}", t.tab_id, format_gib(t.mem_bytes)))
        .collect::<Vec<_>>()
        .join(", ");

    let suffix = match transition_from {
        Some((prev_mem, prev_cpu)) => format!(" (was mem={} cpu={})", prev_mem.label(), prev_cpu.label()),
        None => " (heartbeat)".to_string(),
    };
    let message = format!(
        "resource_monitor: mem={} cpu={:.1}% ({}) tracked_total={} | system: used={} total={} swap_used={} swap_total={} | top tabs: [{top_tabs_summary}]{suffix}",
        usage.mem_status.label(),
        usage.cpu_percent,
        usage.cpu_status.label(),
        format_gib(usage.mem_bytes_total),
        format_gib(sys_used_mem),
        format_gib(sys_total_mem),
        format_gib(sys_used_swap),
        format_gib(sys_total_swap),
    );

    // Getting worse is the case a postmortem needs most — always WARN so it
    // survives a default log-level filter, never buried at INFO.
    let worsened = matches!(
        transition_from,
        Some((prev_mem, prev_cpu))
            if usage.mem_status.rank() > prev_mem.rank() || usage.cpu_status.rank() > prev_cpu.rank()
    );
    let level = if worsened { log::Level::Warn } else { log::Level::Info };
    (level, message)
}

/// See `resource_log_line` for the message/level decision this writes out —
/// kept as a thin wrapper so that function stays unit-testable.
fn log_resource_sample(
    usage: &ResourceUsage,
    sys_used_mem: u64,
    sys_total_mem: u64,
    sys_used_swap: u64,
    sys_total_swap: u64,
    transition_from: Option<(Status, Status)>,
) {
    let (level, message) = resource_log_line(usage, sys_used_mem, sys_total_mem, sys_used_swap, sys_total_swap, transition_from);
    log::log!(level, "{message}");
}

fn classify<T: PartialOrd>(value: T, warn: T, critical: T) -> Status {
    if value > critical {
        Status::Critical
    } else if value > warn {
        Status::Warn
    } else {
        Status::Normal
    }
}

/// App-weite RSS/CPU-Summe: PaneCrews eigener Prozess plus jede Tab-Baumsumme,
/// die `resource_guard::tick_all` bereits rekursiv gebildet hat (Shell + jeder
/// Nachfahre, den sie startet — ein Agent-CLI, ein Dev-Server, ...). Vorher
/// summierte diese Schleife stattdessen je Tab nur die nackte Shell-Pid über
/// `PtyState::child_pids()` — alles, was eine Shell selbst startet, fiel aus
/// der Titelleisten-Gesamtsumme heraus, während die Tab-Aufschlüsselung
/// direkt darunter (gespeist aus demselben rekursiven Tree-Walk) es weiter
/// vollständig zählte: die Kopfzeile konnte einen Bruchteil dessen zeigen, was
/// ein einzelner darunter aufgelisteter Tab schon für sich allein auswies.
/// Kein `System`-Zugriff, vollständig ohne `AppHandle`/`System` testbar.
fn aggregate_app_totals(own_mem: u64, own_cpu_raw: f32, tab_samples: &[resource_guard::TabResourceSample]) -> (u64, f32) {
    let mem_bytes = tab_samples.iter().map(|s| s.mem_bytes).fold(own_mem, |acc, m| acc + m);
    let cpu_raw = tab_samples.iter().map(|s| s.cpu_raw).fold(own_cpu_raw, |acc, c| acc + c);
    (mem_bytes, cpu_raw)
}

/// Startet den Sampler-Thread; läuft für die gesamte Prozesslebensdauer —
/// kein eigenes Shutdown-Signal, dieselbe Lebensdauer wie die übrigen
/// App-weiten Hintergrund-Threads aus `setup()`, fällt beim Prozessende von
/// selbst weg.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut system = System::new();
        let cpu_cores = std::thread::available_parallelism()
            .map(|n| n.get() as f32)
            .unwrap_or(1.0);
        let mut cpu_history: VecDeque<f32> = VecDeque::with_capacity(CPU_SMOOTHING_WINDOW);
        let mut last_status: (Status, Status) = (Status::Normal, Status::Normal);
        // `None` so the very first tick logs an immediate baseline heartbeat
        // instead of waiting a full interval after startup. Deliberately not
        // `Instant::now() - LOG_HEARTBEAT_INTERVAL`: `Instant` is
        // monotonic-since-boot on macOS, and subtracting from it panics if
        // the app starts within the interval of boot (`Sub<Duration> for
        // Instant` is a `checked_sub().expect(...)`), which would silently
        // kill this whole sampler thread on an early-login-item launch.
        let mut last_heartbeat: Option<Instant> = None;

        loop {
            let tick_start = Instant::now();
            // `All` instead of only PaneCrew's own pid and its PTY shells:
            // `resource_guard`'s per-tab tree walk needs every process'
            // parent pointer to find descendants it doesn't already know the
            // pid of (a build tool, a leaked daemon, ...) — a targeted
            // refresh of only already-known pids can never surface those.
            // Same 5-second tick, same thread, no added system load beyond
            // what a full `ps`-equivalent scan already costs at that cadence.
            system.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_memory().with_cpu(),
            );
            system.refresh_memory();

            let tab_roots = app.state::<PtyState>().tab_root_pids();
            let tab_samples = resource_guard::tick_all(
                &app,
                &app.state::<ResourceGuardState>(),
                &system,
                &tab_roots,
                system.total_memory(),
                cpu_cores,
            );

            let (own_mem, own_cpu_raw) = sysinfo::get_current_pid()
                .ok()
                .and_then(|pid| system.process(pid))
                .map(|process| (process.memory(), process.cpu_usage()))
                .unwrap_or((0, 0.0));
            let (mem_bytes, cpu_sum) = aggregate_app_totals(own_mem, own_cpu_raw, &tab_samples);

            let total_memory = system.total_memory();
            let mem_percent = if total_memory == 0 {
                0.0
            } else {
                (mem_bytes as f32 / total_memory as f32) * 100.0
            };

            let cpu_percent_raw = cpu_sum / cpu_cores;
            if cpu_history.len() == CPU_SMOOTHING_WINDOW {
                cpu_history.pop_front();
            }
            cpu_history.push_back(cpu_percent_raw);
            let cpu_percent = cpu_history.iter().sum::<f32>() / cpu_history.len() as f32;

            let window_for_tab = app.state::<WindowPtyRegistry>().window_for_tab_snapshot();
            let window_infos: Vec<WindowInfo> = windows::window_labels_and_titles(&app)
                .into_iter()
                .map(|(label, title)| WindowInfo { label, title })
                .collect();

            let usage = ResourceUsage {
                mem_percent,
                cpu_percent,
                mem_status: classify(mem_bytes, MEM_WARN_BYTES, MEM_CRITICAL_BYTES),
                cpu_status: classify(cpu_percent, CPU_WARN_PERCENT, CPU_CRITICAL_PERCENT),
                mem_bytes_total: mem_bytes,
                tabs: tab_samples
                    .into_iter()
                    .map(|sample| TabUsage {
                        window_label: window_for_tab.get(&sample.tab_id).cloned(),
                        tab_id: sample.tab_id,
                        mem_percent: sample.mem_percent,
                        cpu_percent: sample.cpu_percent,
                        mem_bytes: sample.mem_bytes,
                    })
                    .collect(),
                windows: window_infos,
            };
            let _ = app.emit(EVENT_NAME, &usage);

            let status_now = (usage.mem_status, usage.cpu_status);
            if status_now.0 != last_status.0 || status_now.1 != last_status.1 {
                log_resource_sample(&usage, system.used_memory(), total_memory, system.used_swap(), system.total_swap(), Some(last_status));
                last_status = status_now;
                last_heartbeat = Some(tick_start);
            } else if last_heartbeat.is_none_or(|t| tick_start.duration_since(t) >= LOG_HEARTBEAT_INTERVAL) {
                log_resource_sample(&usage, system.used_memory(), total_memory, system.used_swap(), system.total_swap(), None);
                last_heartbeat = Some(tick_start);
            }

            // User-reported beachball-on-pane-switch (2026-08-16): no
            // reproduction was pinned down yet (this thread's own
            // `ProcessesToUpdate::All` scan measured ~3ms on a 440-process
            // dev machine, not a plausible cause on its own), but this tick
            // does touch several shared locks (`PtyState`, `WindowPtyRegistry`,
            // `ResourceGuardState`) that PTY commands also take — an
            // occasional slow tick, if one ever occurs, is a real suspect.
            // Threshold-gated so a normal ~3-10ms tick never spams the log,
            // which the user can already inspect without a live console
            // handoff (`PANECREW_LOG=debug`, see logging.rs docstring).
            let tick_elapsed = tick_start.elapsed();
            if tick_elapsed > Duration::from_millis(100) {
                log::warn!(
                    "resource_monitor: tick took {:?} (budget: 100ms)",
                    tick_elapsed
                );
            }

            std::thread::sleep(SAMPLE_INTERVAL);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_respects_warn_and_critical_boundaries() {
        assert!(matches!(classify(0.0, 8.0, 20.0), Status::Normal));
        assert!(matches!(classify(8.0, 8.0, 20.0), Status::Normal));
        assert!(matches!(classify(8.1, 8.0, 20.0), Status::Warn));
        assert!(matches!(classify(20.0, 8.0, 20.0), Status::Warn));
        assert!(matches!(classify(20.1, 8.0, 20.0), Status::Critical));
    }

    #[test]
    fn classify_works_over_byte_thresholds_too() {
        assert!(matches!(classify(MEM_WARN_BYTES, MEM_WARN_BYTES, MEM_CRITICAL_BYTES), Status::Normal));
        assert!(matches!(classify(MEM_WARN_BYTES + 1, MEM_WARN_BYTES, MEM_CRITICAL_BYTES), Status::Warn));
        assert!(matches!(classify(MEM_CRITICAL_BYTES + 1, MEM_WARN_BYTES, MEM_CRITICAL_BYTES), Status::Critical));
    }

    #[test]
    fn aggregate_app_totals_sums_own_process_and_every_tab_tree() {
        let samples = vec![
            resource_guard::TabResourceSample {
                tab_id: "a".to_string(),
                mem_percent: 1.0,
                cpu_percent: 1.0,
                mem_bytes: 200,
                cpu_raw: 10.0,
            },
            resource_guard::TabResourceSample {
                tab_id: "b".to_string(),
                mem_percent: 2.0,
                cpu_percent: 2.0,
                mem_bytes: 300,
                cpu_raw: 20.0,
            },
        ];
        let (mem_bytes, cpu_raw) = aggregate_app_totals(100, 5.0, &samples);
        assert_eq!(mem_bytes, 600, "own process (100) + tab a (200) + tab b (300)");
        assert_eq!(cpu_raw, 35.0, "own process (5) + tab a (10) + tab b (20)");
    }

    fn sample_usage(mem_status: Status, cpu_status: Status) -> ResourceUsage {
        ResourceUsage {
            mem_percent: 10.0,
            cpu_percent: 12.5,
            mem_status,
            cpu_status,
            mem_bytes_total: 2 * 1024 * 1024 * 1024,
            tabs: vec![
                TabUsage {
                    tab_id: "small".to_string(),
                    mem_percent: 1.0,
                    cpu_percent: 1.0,
                    mem_bytes: 1024 * 1024 * 1024,
                    window_label: None,
                },
                TabUsage {
                    tab_id: "big".to_string(),
                    mem_percent: 5.0,
                    cpu_percent: 5.0,
                    mem_bytes: 4 * 1024 * 1024 * 1024,
                    window_label: None,
                },
            ],
            windows: vec![],
        }
    }

    /// The exact case behind the 2026-08-26 incident this logging exists for:
    /// a status crossing into Critical must log at WARN, not INFO, so it
    /// survives whatever level filter is active by default in production.
    #[test]
    fn worsening_transition_logs_at_warn() {
        let usage = sample_usage(Status::Critical, Status::Normal);
        let (level, message) = resource_log_line(&usage, 1, 2, 0, 0, Some((Status::Warn, Status::Normal)));
        assert_eq!(level, log::Level::Warn);
        assert!(message.contains("was mem=warn"), "message: {message}");
    }

    #[test]
    fn improving_transition_logs_at_info_not_warn() {
        let usage = sample_usage(Status::Normal, Status::Normal);
        let (level, _message) = resource_log_line(&usage, 1, 2, 0, 0, Some((Status::Critical, Status::Normal)));
        assert_eq!(level, log::Level::Info);
    }

    #[test]
    fn heartbeat_with_no_transition_logs_at_info_and_is_labelled() {
        let usage = sample_usage(Status::Normal, Status::Normal);
        let (level, message) = resource_log_line(&usage, 1, 2, 0, 0, None);
        assert_eq!(level, log::Level::Info);
        assert!(message.contains("(heartbeat)"), "message: {message}");
    }

    /// The whole point of also logging system-wide RAM/swap alongside
    /// PaneCrew's own tracked total: a leak in a process the app can't see
    /// (the WebKit XPC helpers, see `resource_log_line`'s docstring) would
    /// leave `tracked_total` looking fine while these numbers do not — so
    /// they must actually be in the line, not silently dropped.
    #[test]
    fn message_carries_system_wide_memory_and_swap_not_just_the_tracked_total() {
        let usage = sample_usage(Status::Critical, Status::Normal);
        let (_level, message) = resource_log_line(&usage, 70 * 1024 * 1024 * 1024, 96 * 1024 * 1024 * 1024, 40 * 1024 * 1024 * 1024, 48 * 1024 * 1024 * 1024, None);
        assert!(message.contains("used=70.00GiB"), "message: {message}");
        assert!(message.contains("total=96.00GiB"), "message: {message}");
        assert!(message.contains("swap_used=40.00GiB"), "message: {message}");
        assert!(message.contains("swap_total=48.00GiB"), "message: {message}");
    }

    #[test]
    fn message_ranks_top_tabs_by_memory_descending() {
        let usage = sample_usage(Status::Normal, Status::Normal);
        let (_level, message) = resource_log_line(&usage, 0, 0, 0, 0, None);
        let big_pos = message.find("big=").expect("big tab should be in the message");
        let small_pos = message.find("small=").expect("small tab should be in the message");
        assert!(big_pos < small_pos, "the 4GiB tab should be listed before the 1GiB one: {message}");
    }

    /// Reproduces the reported bug against a REAL two-level process tree (a
    /// shell that forks a child and waits on it) — same proof style as
    /// `resource_guard.rs`'s own `primitives_against_a_real_process` module.
    /// Before this fix, the header total was built from each tab's bare shell
    /// pid alone (`PtyState::child_pids()`, i.e. exactly `root_only` below),
    /// so it silently dropped whatever that shell spawned (an agent CLI, a
    /// dev server, ...) even though the tab breakdown directly below it — fed
    /// by the same recursive `walk_tree` exercised here — kept counting it
    /// fully. Platform-neutral: only spawning the real shell+child tree
    /// differs per OS (see the two `#[cfg]`-gated callers below), everything
    /// from sampling onward is identical sysinfo/`resource_guard` logic on
    /// every platform.
    #[cfg(any(unix, windows))]
    fn assert_app_total_beats_the_old_shell_only_figure(root_pid: sysinfo::Pid) {
        use crate::resource_guard;
        use std::collections::HashMap;
        use sysinfo::Pid;

        // Give the shell a moment to actually spawn its child before sampling.
        std::thread::sleep(std::time::Duration::from_millis(300));

        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_memory().with_cpu(),
        );
        system.refresh_memory();

        let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
        for (pid, process) in system.processes() {
            if let Some(parent) = process.parent() {
                children.entry(parent).or_default().push(*pid);
            }
        }

        let (recursive_total, _cpu, members) = resource_guard::walk_tree(&system, &children, root_pid);
        assert!(members.len() >= 2, "the shell should have spawned at least one live descendant");

        let root_only = system.process(root_pid).map(|p| p.memory()).unwrap_or(0);
        assert!(
            recursive_total > root_only,
            "the tab's recursive tree sum ({recursive_total}) must exceed the bare shell's own \
             RSS ({root_only}) once it has spawned a child — this is exactly the number the \
             header total was silently missing before `aggregate_app_totals` started folding in \
             the recursive `TabResourceSample.mem_bytes` instead of only each tab's bare shell pid"
        );

        let (own_mem, own_cpu_raw) = sysinfo::get_current_pid()
            .ok()
            .and_then(|pid| system.process(pid))
            .map(|p| (p.memory(), p.cpu_usage()))
            .unwrap_or((0, 0.0));
        let old_naive_total = own_mem + root_only;
        let sample = resource_guard::TabResourceSample {
            tab_id: "tab-1".to_string(),
            mem_percent: 0.0,
            cpu_percent: 0.0,
            mem_bytes: recursive_total,
            cpu_raw: 0.0,
        };
        let (fixed_total, _) = aggregate_app_totals(own_mem, own_cpu_raw, std::slice::from_ref(&sample));
        assert!(
            fixed_total > old_naive_total,
            "the fixed header total ({fixed_total}) must exceed what the old, pre-fix logic \
             would have reported ({old_naive_total}) for a tab whose shell has spawned a child"
        );
    }

    #[cfg(unix)]
    #[test]
    fn app_total_includes_what_a_tab_shell_spawns_not_just_the_shell_itself() {
        let mut shell = std::process::Command::new("sh")
            .args(["-c", "sleep 30 & wait"])
            .spawn()
            .expect("spawning a real shell + child process tree should succeed");

        assert_app_total_beats_the_old_shell_only_figure(sysinfo::Pid::from_u32(shell.id()));

        let _ = shell.kill();
        let _ = shell.wait();
    }

    /// Windows twin of the Unix test above: `cmd.exe /c "ping ... >NUL"` gives
    /// the same real two-level tree (`cmd.exe` waits on a spawned `ping.exe`
    /// child) without the classic `timeout.exe` trap — it refuses to run at
    /// all ("Input redirection is not supported") when spawned without an
    /// inherited console, which `std::process::Command` doesn't give it here.
    #[cfg(windows)]
    #[test]
    fn app_total_includes_what_a_tab_shell_spawns_not_just_the_shell_itself() {
        let mut shell = std::process::Command::new("cmd")
            .args(["/c", "ping -n 31 127.0.0.1 >NUL"])
            .spawn()
            .expect("spawning a real shell + child process tree should succeed");

        assert_app_total_beats_the_old_shell_only_figure(sysinfo::Pid::from_u32(shell.id()));

        let _ = shell.kill();
        let _ = shell.wait();
    }
}
