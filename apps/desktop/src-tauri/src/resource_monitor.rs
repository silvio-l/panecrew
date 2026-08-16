//! Hintergrund-Sampler für die Ressourcenanzeige der Titelleiste: PaneCrews
//! eigener Prozess plus, für jede lebende PTY, deren gesamter rekursiver
//! Prozessbaum (Shell + alle Nachfahren — ein Agent-CLI, ein Dev-Server, ...,
//! s. `resource_guard::tick_all`), auf niedrigem, festem Takt refresht —
//! günstig genug, um über die gesamte Prozesslaufzeit mitzulaufen.

use std::collections::VecDeque;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager};

use crate::pty_commands::PtyState;
use crate::resource_guard::{self, ResourceGuardState};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(5);

// 3 Samples * 5s = 15s gleitendes Fenster für die CPU-Zahl: eine einzelne
// kurze Lastspitze (ein Compile-Burst, `git status`) soll nicht sofort in
// den Warnzustand kippen. RAM braucht diese Glättung nicht — er baut sich
// über Zeit auf statt kurz zu zappeln.
const CPU_SMOOTHING_WINDOW: usize = 3;

// RAM = (eigene RSS + Summe aller PTY-Prozessbaum-RSS) / Gesamt-RAM. Ein einzelner
// Prozess mit wenigen Panes bleibt üblicherweise deutlich unter 5 %; auch
// mehrere schwere Dev-Tools parallel in den Panes (Cargo, rust-analyzer,
// weitere Agents) treiben das transient auf 10-15 %, ohne dass etwas kaputt
// ist — das ist informativ (warn), nicht alarmierend. Erst deutlich darüber
// ist es ein Signal für ein echtes Leck oder eine ungewöhnlich exzessive
// Situation.
const MEM_WARN_PERCENT: f32 = 8.0;
const MEM_CRITICAL_PERCENT: f32 = 20.0;

// CPU = Summe der Prozess-CPU-Auslastung (sysinfo-Konvention: 0-100 pro
// Kern), normalisiert auf die Gesamtkapazität der Maschine, über das
// Fenster oben geglättet.
const CPU_WARN_PERCENT: f32 = 25.0;
const CPU_CRITICAL_PERCENT: f32 = 60.0;

pub const EVENT_NAME: &str = "resource-usage";

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    Normal,
    Warn,
    Critical,
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
}

fn classify(percent: f32, warn: f32, critical: f32) -> Status {
    if percent > critical {
        Status::Critical
    } else if percent > warn {
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

        loop {
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

            let usage = ResourceUsage {
                mem_percent,
                cpu_percent,
                mem_status: classify(mem_percent, MEM_WARN_PERCENT, MEM_CRITICAL_PERCENT),
                cpu_status: classify(cpu_percent, CPU_WARN_PERCENT, CPU_CRITICAL_PERCENT),
                mem_bytes_total: mem_bytes,
                tabs: tab_samples
                    .into_iter()
                    .map(|sample| TabUsage {
                        tab_id: sample.tab_id,
                        mem_percent: sample.mem_percent,
                        cpu_percent: sample.cpu_percent,
                        mem_bytes: sample.mem_bytes,
                    })
                    .collect(),
            };
            let _ = app.emit(EVENT_NAME, &usage);

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
