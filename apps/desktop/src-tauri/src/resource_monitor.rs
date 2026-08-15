//! Hintergrund-Sampler für die Ressourcenanzeige der Titelleiste: PaneCrews
//! eigener Prozess plus jeder lebende PTY-Kindprozess (die von der App selbst
//! gestarteten Shells), auf niedrigem, festem Takt refresht — günstig genug,
//! um über die gesamte Prozesslaufzeit mitzulaufen.

use std::collections::VecDeque;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager};

use crate::pty_commands::PtyState;
use crate::resource_guard::{self, ResourceGuardState};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(5);

// 3 Samples * 5s = 15s gleitendes Fenster für die CPU-Zahl: eine einzelne
// kurze Lastspitze (ein Compile-Burst, `git status`) soll nicht sofort in
// den Warnzustand kippen. RAM braucht diese Glättung nicht — er baut sich
// über Zeit auf statt kurz zu zappeln.
const CPU_SMOOTHING_WINDOW: usize = 3;

// RAM = (eigene RSS + Summe aller PTY-Kind-RSS) / Gesamt-RAM. Ein einzelner
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResourceUsage {
    mem_percent: f32,
    cpu_percent: f32,
    mem_status: Status,
    cpu_status: Status,
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

fn collect_pids(app: &AppHandle) -> Vec<Pid> {
    let mut pids: Vec<Pid> = Vec::new();
    if let Ok(own) = sysinfo::get_current_pid() {
        pids.push(own);
    }
    let state = app.state::<PtyState>();
    pids.extend(state.child_pids().into_iter().map(Pid::from_u32));
    pids
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
            let pids = collect_pids(&app);
            // `All` instead of only the own+children pids collected above:
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

            let mut mem_bytes: u64 = 0;
            let mut cpu_sum: f32 = 0.0;
            for pid in &pids {
                if let Some(process) = system.process(*pid) {
                    mem_bytes += process.memory();
                    cpu_sum += process.cpu_usage();
                }
            }

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
                tabs: tab_samples
                    .into_iter()
                    .map(|sample| TabUsage {
                        tab_id: sample.tab_id,
                        mem_percent: sample.mem_percent,
                        cpu_percent: sample.cpu_percent,
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
}
