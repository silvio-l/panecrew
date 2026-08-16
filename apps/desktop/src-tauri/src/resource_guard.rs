//! Pro-Tab-Ressourcen-Eskalationskette: erkennt, wenn EIN Tab (eine PTY samt
//! ihres kompletten Prozessbaums) übermäßig viel System-RAM verbraucht, und
//! reagiert abgestuft statt hart zu killen — warnen, pausieren, gezielt einen
//! einzelnen Prozess beenden, erst als letzte Stufe den ganzen Tab beenden.
//! Wirkt strikt pro Tab: nie auf andere Tabs, andere Panes, oder PaneCrews
//! eigenen Prozess.
//!
//! Läuft im selben 5-Sekunden-Tick wie `resource_monitor`s eigener
//! Titelleisten-Sampler — kein zweiter Hintergrund-Thread, dieselbe
//! Systemlast wie bereits vorhanden. `resource_monitor::start` ruft
//! `tick_all` einmal pro Durchlauf zusätzlich zu seiner eigenen Aggregation
//! auf.
//!
//! Warum aktives Polling statt einer vom Kernel erzwungenen Grenze:
//! `setrlimit(RLIMIT_AS)`/`ulimit -v` ist auf macOS nachweislich wirkungslos
//! (verifiziert vor dem Bau dieser Datei — das Limit ließ sich nicht einmal
//! setzen, "Invalid argument", und selbst ignoriert hätte es eine
//! Test-Allokation nicht verhindert). Die Durchsetzung hier läuft deshalb
//! komplett aus PaneCrew selbst heraus.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Pid, System};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::pty_commands::{self, PtyState, WindowPtyRegistry};

/// Anteil des Tab-eigenen Prozessbaums (Shell + alle rekursiven
/// Kindprozesse, RSS aufsummiert) am System-Gesamt-RAM, ab dem der Tab nur
/// noch eine sichtbare Warnmarkierung bekommt — keine Prozess-Aktion.
const SOFT_THRESHOLD_PERCENT: f32 = 20.0;

/// Ab hier greift PaneCrew aktiv ein (erst pausieren, bei Wiederholung
/// gezielt killen, erst danach den ganzen Tab beenden) — s. Kopfkommentar.
const HARD_THRESHOLD_PERCENT: f32 = 40.0;

/// Wie lange nach einem Fortsetzen bzw. einem gezielten Einzel-Kill
/// beobachtet wird, ob derselbe Tab die harte Schwelle erneut reißt, bevor
/// die nächste Eskalationsstufe greift.
const ESCALATION_WINDOW: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum StageKind {
    Normal,
    Warn,
    Paused,
    Cooldown,
}

struct TabGuardState {
    kind: StageKind,
    paused_pid: Option<u32>,
    cooldown_deadline: Option<Instant>,
    /// 0 nach dem ersten Pausieren/Fortsetzen, 1 nach dem ersten gezielten
    /// Einzel-Kill — ein zweiter Riss der harten Schwelle danach eskaliert
    /// direkt zum ganzen Tab statt eines dritten Einzel-Kills.
    strikes: u8,
}

impl Default for TabGuardState {
    fn default() -> Self {
        Self {
            kind: StageKind::Normal,
            paused_pid: None,
            cooldown_deadline: None,
            strikes: 0,
        }
    }
}

#[derive(Default)]
pub struct ResourceGuardState(Mutex<HashMap<String, TabGuardState>>);

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum TabStatus {
    Normal,
    Warn,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TabResourceStatusPayload {
    tab_id: String,
    status: TabStatus,
    percent: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TabPausedPayload {
    tab_id: String,
    percent: f32,
    pid: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TabSingleKillPayload {
    tab_id: String,
    percent: f32,
}

/// `reason` ist ein stabiler Schlüssel, keine fertige Nachricht — die
/// Übersetzung übernimmt das Frontend (i18n), dieselbe Trennung wie überall
/// sonst in der App (Projekt-Leitlinie gegen hartkodierte, unübersetzte
/// Strings).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TabTerminatedPayload {
    tab_id: String,
    percent: f32,
    reason: &'static str,
}

pub const EVENT_STATUS: &str = "pty:tab-resource-status";
pub const EVENT_PAUSED: &str = "pty:tab-paused";
pub const EVENT_SINGLE_KILL: &str = "pty:tab-single-kill";
pub const EVENT_TERMINATED: &str = "pty:tab-terminated";

const REASON_REPEATED_LIMIT_BREACH: &str = "memory-limit-exceeded-repeatedly";
/// s. `kill_manual` unten. `pub` (nicht `pub(crate)`) aus keinem funktionalen
/// Grund — der String selbst wird nirgends außerhalb dieser Datei
/// referenziert (das Frontend kennt ihn nur als Payload-Feld) — sondern nur,
/// damit ein späterer zweiter Aufrufer ihn nicht ein zweites Mal abtippen muss.
pub const REASON_MANUAL_KILL: &str = "manual-kill";

/// Eine reine Entscheidung des `step`-Automaten — die Wirkung (Signal senden,
/// Prozess anfassen) liegt beim Aufrufer (`tick_all`/`execute`), hier steht
/// nur, WAS zu tun ist.
#[derive(Debug, PartialEq, Eq)]
enum Action {
    Suspend(u32),
    KillSingle(u32),
    KillTab,
    EmitNormal,
    EmitWarn,
    EmitPaused(u32),
    EmitSingleKill,
    EmitTerminated,
}

struct StepInput {
    kind: StageKind,
    strikes: u8,
    cooldown_expired: bool,
    percent: f32,
    offender_pid: u32,
    offender_is_root: bool,
}

/// Reiner Entscheidungsautomat — keine Systemaufrufe, kein `Instant::now()`,
/// vollständig tabellengetrieben testbar (s. `tests` unten). Gibt den
/// nächsten `StageKind`, den ggf. neu zu merkenden pausierten pid, den neuen
/// Strike-Zähler und die auszuführenden `Action`s zurück.
fn step(input: StepInput) -> (StageKind, Option<u32>, u8, Vec<Action>) {
    match input.kind {
        StageKind::Paused => {
            // Eingefroren — nur ein explizites Fortsetzen (`resume` unten,
            // ausgelöst vom Nutzer-Klick, nicht von diesem Tick-Automaten)
            // verlässt diese Stufe.
            (StageKind::Paused, None, input.strikes, vec![])
        }
        StageKind::Cooldown => {
            if input.percent >= HARD_THRESHOLD_PERCENT {
                if input.offender_is_root || input.strikes >= 1 {
                    (
                        StageKind::Normal,
                        None,
                        0,
                        vec![Action::KillTab, Action::EmitTerminated],
                    )
                } else {
                    (
                        StageKind::Cooldown,
                        None,
                        1,
                        vec![Action::KillSingle(input.offender_pid), Action::EmitSingleKill],
                    )
                }
            } else if input.cooldown_expired {
                // Beobachtungsfenster verstrichen, ohne erneut zu reißen —
                // der Tab gilt wieder als normal überwacht.
                if input.percent > SOFT_THRESHOLD_PERCENT {
                    (StageKind::Warn, None, 0, vec![Action::EmitWarn])
                } else {
                    (StageKind::Normal, None, 0, vec![Action::EmitNormal])
                }
            } else {
                (StageKind::Cooldown, None, input.strikes, vec![])
            }
        }
        StageKind::Normal | StageKind::Warn => {
            if input.percent >= HARD_THRESHOLD_PERCENT {
                if input.offender_is_root {
                    // Der Verursacher IST die Shell selbst — kein isolierbarer
                    // Kindprozess, der sich pausieren/killen ließe, ohne die
                    // Shell selbst zu treffen. Direkt zum ganzen Tab.
                    (
                        StageKind::Normal,
                        None,
                        0,
                        vec![Action::KillTab, Action::EmitTerminated],
                    )
                } else {
                    (
                        StageKind::Paused,
                        Some(input.offender_pid),
                        0,
                        vec![
                            Action::Suspend(input.offender_pid),
                            Action::EmitPaused(input.offender_pid),
                        ],
                    )
                }
            } else if input.percent > SOFT_THRESHOLD_PERCENT {
                if input.kind == StageKind::Warn {
                    (StageKind::Warn, None, 0, vec![])
                } else {
                    (StageKind::Warn, None, 0, vec![Action::EmitWarn])
                }
            } else if input.kind == StageKind::Normal {
                (StageKind::Normal, None, 0, vec![])
            } else {
                (StageKind::Normal, None, 0, vec![Action::EmitNormal])
            }
        }
    }
}

/// Rekursive RSS- und CPU-Summe eines Tab-Prozessbaums ab `root` (Shell +
/// alle Nachfahren, per Eltern-Zeiger gefunden — nicht nur
/// Prozessgruppen-Mitglieder, s. Modul-Kopfkommentar: auch ein
/// Vordergrund-Job, der seine eigene Gruppe bekommen hat, muss mitgezählt
/// werden). `children` wird einmal pro Tick für ALLE Tabs gemeinsam aus dem
/// vollständig refreshten Prozesstisch aufgebaut (s. `tick_all`), nicht pro
/// Tab neu. Leer, wenn `root` selbst schon nicht mehr existiert (Wettlauf mit
/// einem parallelen Schließen). Der CPU-Wert ist roh in sysinfos
/// Konvention (0-100 PRO KERN) — dieselbe Rohgröße, die
/// `resource_monitor.rs`s eigene App-weite Aggregation vor der Division durch
/// `cpu_cores` verwendet; die Normalisierung (und für die App-weite Anzeige
/// zusätzlich die 15s-Glättung) bleibt Sache des jeweiligen Aufrufers.
pub(crate) fn walk_tree(
    system: &System,
    children: &HashMap<Pid, Vec<Pid>>,
    root: Pid,
) -> (u64, f32, Vec<(Pid, u64)>) {
    let mut total_rss: u64 = 0;
    let mut total_cpu: f32 = 0.0;
    let mut members = Vec::new();
    let mut visited = HashSet::new();
    let mut queue = VecDeque::from([root]);
    while let Some(pid) = queue.pop_front() {
        if !visited.insert(pid) {
            continue;
        }
        if let Some(process) = system.process(pid) {
            let rss = process.memory();
            total_rss += rss;
            total_cpu += process.cpu_usage();
            members.push((pid, rss));
        }
        if let Some(kids) = children.get(&pid) {
            queue.extend(kids.iter().copied());
        }
    }
    (total_rss, total_cpu, members)
}

fn execute(app: &AppHandle, tab_id: &str, percent: f32, action: Action) {
    match action {
        Action::Suspend(pid) => {
            if let Err(error) = suspend_process(pid) {
                log::warn!("resource_guard: suspending pid {pid} failed: {error}");
            }
        }
        Action::KillSingle(pid) => {
            if let Err(error) = kill_single_process(pid) {
                log::warn!("resource_guard: targeted kill of pid {pid} failed: {error}");
            }
        }
        Action::KillTab => {
            let state = app.state::<PtyState>();
            let registry = app.state::<WindowPtyRegistry>();
            registry.unregister(tab_id);
            if let Err(error) = pty_commands::kill(&state, tab_id) {
                log::warn!("resource_guard: tab kill failed: {error}");
            }
        }
        Action::EmitNormal => {
            let _ = app.emit(
                EVENT_STATUS,
                &TabResourceStatusPayload { tab_id: tab_id.to_string(), status: TabStatus::Normal, percent },
            );
        }
        Action::EmitWarn => {
            let _ = app.emit(
                EVENT_STATUS,
                &TabResourceStatusPayload { tab_id: tab_id.to_string(), status: TabStatus::Warn, percent },
            );
        }
        Action::EmitPaused(pid) => {
            let _ = app.emit(
                EVENT_PAUSED,
                &TabPausedPayload { tab_id: tab_id.to_string(), percent, pid },
            );
        }
        Action::EmitSingleKill => {
            let _ = app.emit(
                EVENT_SINGLE_KILL,
                &TabSingleKillPayload { tab_id: tab_id.to_string(), percent },
            );
        }
        Action::EmitTerminated => {
            let _ = app.emit(
                EVENT_TERMINATED,
                &TabTerminatedPayload {
                    tab_id: tab_id.to_string(),
                    percent,
                    reason: REASON_REPEATED_LIMIT_BREACH,
                },
            );
        }
    }
}

/// Normalisiert die rohen Baumsummen aus `walk_tree` auf dieselben 0-100-
/// Prozentskalen wie die App-weite Anzeige (RAM: Anteil am System-Gesamt-RAM,
/// CPU: sysinfos Pro-Kern-Rohgröße geteilt durch die Kernzahl) — reine
/// Arithmetik, für sich testbar ohne `System`/`AppHandle`.
fn tab_percentages(
    total_rss: u64,
    total_cpu_raw: f32,
    total_memory: u64,
    cpu_cores: f32,
) -> (f32, f32) {
    let mem_percent = (total_rss as f32 / total_memory as f32) * 100.0;
    let cpu_percent = if cpu_cores > 0.0 { total_cpu_raw / cpu_cores } else { 0.0 };
    (mem_percent, cpu_percent)
}

/// Ein Tick-Ergebnis pro noch lebendem Tab, an `resource_monitor.rs`
/// zurückgereicht, damit dessen Titelleisten-Hover-Popover (Pane→Tab-
/// Baumansicht) dieselbe Baumsumme anzeigen kann, die auch die
/// Eskalationskette selbst schon berechnet hat — kein zweiter Tree-Walk über
/// denselben, ohnehin schon einmal pro Tick vollständig refreshten
/// Prozesstisch.
pub struct TabResourceSample {
    pub tab_id: String,
    pub mem_percent: f32,
    pub cpu_percent: f32,
    /// Rohe RSS-Summe des Tab-Prozessbaums in Bytes — dieselbe Zahl, aus der
    /// `mem_percent` oben abgeleitet ist. Getrennt mitgereicht statt vom
    /// Frontend aus dem Prozentwert zurückgerechnet: das bräuchte dort
    /// zusätzlich das App-weite Gesamt-RAM UND würde Rundungsdrift einführen
    /// (der Prozentwert ist schon auf zwei Nachkommastellen im f32 gerundet).
    pub mem_bytes: u64,
    /// Rohe (nicht auf Kernzahl normalisierte) CPU-Summe des Tab-Prozessbaums
    /// in sysinfos Pro-Kern-Konvention — dasselbe Prinzip wie `mem_bytes`
    /// oben: getrennt von `cpu_percent` mitgereicht, damit `resource_monitor.rs`
    /// die App-weite CPU-Summe daraus aufbauen kann, statt sie aus dem schon
    /// normalisierten, schon gerundeten Prozentwert zurückzurechnen.
    pub cpu_raw: f32,
}

/// Von `resource_monitor`s 5-Sekunden-Tick zusätzlich zu dessen eigener
/// App-weiten Aggregation aufgerufen. `system` muss der Aufrufer bereits mit
/// `ProcessesToUpdate::All` (inkl. Speicher UND CPU) refresht haben — dieser
/// Aufruf selbst refresht nichts, er liest nur. `cpu_cores` normalisiert die
/// pro Baum aufsummierte sysinfo-Rohgröße (0-100 pro Kern) auf denselben
/// 0-100-Gesamtmaßstab, den auch `resource_monitor.rs`s eigene App-weite
/// CPU-Zahl verwendet — ohne die dortige 15s-Glättung, die ist Sache der
/// App-weiten Anzeige, nicht der einzelnen Tab-Zeile.
pub fn tick_all(
    app: &AppHandle,
    guard: &ResourceGuardState,
    system: &System,
    tab_roots: &[(String, u32)],
    total_memory: u64,
    cpu_cores: f32,
) -> Vec<TabResourceSample> {
    if total_memory == 0 {
        return Vec::new();
    }

    let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, process) in system.processes() {
        if let Some(parent) = process.parent() {
            children.entry(parent).or_default().push(*pid);
        }
    }

    let mut map = guard.0.lock().unwrap();
    // Ein Tab, der seit dem letzten Tick geschlossen wurde, darf hier keinen
    // Eintrag hinterlassen — sonst sammeln sich über die App-Laufzeit tote
    // Zustände an. Läuft bei jedem Tick statt an jeden Schließen-Pfad
    // angehängt zu werden: einfacher und deckt jeden Weg ab, auf dem ein Tab
    // verschwinden kann (Nutzer-Schließen, Fenster-Schließen, App-Beenden).
    let live: HashSet<&str> = tab_roots.iter().map(|(id, _)| id.as_str()).collect();
    map.retain(|tab_id, _| live.contains(tab_id.as_str()));

    let mut samples = Vec::with_capacity(tab_roots.len());

    for (tab_id, root_pid) in tab_roots {
        let root = Pid::from_u32(*root_pid);
        let (total_rss, total_cpu_raw, members) = walk_tree(system, &children, root);
        if members.is_empty() {
            // Prozess bereits weg (Wettlauf mit einem parallelen Schließen) —
            // kein Zustand für einen Tab führen, der gerade verschwindet, und
            // auch keine Stichprobe dafür melden.
            continue;
        }
        let (percent, cpu_percent) = tab_percentages(total_rss, total_cpu_raw, total_memory, cpu_cores);
        samples.push(TabResourceSample {
            tab_id: tab_id.clone(),
            mem_percent: percent,
            cpu_percent,
            mem_bytes: total_rss,
            cpu_raw: total_cpu_raw,
        });
        let offender = members
            .iter()
            .max_by_key(|(_, rss)| *rss)
            .map(|(pid, _)| *pid)
            .unwrap_or(root);
        let offender_is_root = offender == root;

        let entry = map.entry(tab_id.clone()).or_default();
        let cooldown_expired = entry
            .cooldown_deadline
            .map(|deadline| Instant::now() >= deadline)
            .unwrap_or(true);

        let (next_kind, next_pid, next_strikes, actions) = step(StepInput {
            kind: entry.kind,
            strikes: entry.strikes,
            cooldown_expired,
            percent,
            offender_pid: offender.as_u32(),
            offender_is_root,
        });

        entry.kind = next_kind;
        entry.strikes = next_strikes;
        entry.paused_pid = if next_kind == StageKind::Paused { next_pid } else { None };

        let started_new_cooldown = actions.iter().any(|a| matches!(a, Action::KillSingle(_)));
        if started_new_cooldown {
            entry.cooldown_deadline = Some(Instant::now() + ESCALATION_WINDOW);
        }
        if next_kind != StageKind::Cooldown {
            entry.cooldown_deadline = None;
        }

        for action in actions {
            execute(app, tab_id, percent, action);
        }
    }

    samples
}

/// Vom Frontend-Knopf "Fortsetzen" im Pause-Banner aufgerufen — setzt den
/// zuvor pausierten Prozess fort und eröffnet ein neues Beobachtungsfenster
/// (s. Modul-Kopfkommentar, Eskalation A): reißt derselbe Tab die harte
/// Schwelle innerhalb von `ESCALATION_WINDOW` erneut, killt der nächste Tick
/// gezielt nur diesen einen Prozess, nicht die ganze Shell.
#[tauri::command]
pub fn resource_guard_resume(guard: State<ResourceGuardState>, tab_id: String) -> Result<(), String> {
    let mut map = guard.0.lock().unwrap();
    let entry = map
        .get_mut(&tab_id)
        .ok_or_else(|| format!("unknown tab_id: {tab_id}"))?;
    if entry.kind != StageKind::Paused {
        return Err("tab is not paused".to_string());
    }
    let pid = entry
        .paused_pid
        .ok_or_else(|| "paused tab has no remembered pid".to_string())?;

    resume_process(pid).map_err(|e| e.to_string())?;

    entry.kind = StageKind::Cooldown;
    entry.paused_pid = None;
    entry.cooldown_deadline = Some(Instant::now() + ESCALATION_WINDOW);
    entry.strikes = 0;
    Ok(())
}

/// Vom Kontextmenü "Terminal hart beenden" aufgerufen (PaneTabs.tsx) —
/// derselbe Kill-Pfad wie Tier 4 der Eskalationskette (`Action::KillTab`
/// oben), aber nutzerausgelöst statt automatisch. Meldet der Oberfläche das
/// Ergebnis bewusst über einen EIGENEN Weg statt `execute(..., Action::
/// EmitTerminated)`: dessen `EmitTerminated`-Zweig verdrahtet `reason` fest
/// auf `REASON_REPEATED_LIMIT_BREACH` (kein Parameter), ein Aufruf von hier
/// würde `TabResourceBanner.tsx` also fälschlich einen Speicherverbrauch
/// behaupten, den es hier nie gab. Räumt aus demselben Grund wie
/// `Action::KillTab` bewusst NICHT den `ResourceGuardState`-Eintrag ab —
/// derselbe Tick-Automat, der einen ganz normal geschlossenen Tab schon
/// unbeanstandet als verwaisten Registereintrag stehen lässt.
#[tauri::command]
pub fn resource_guard_kill_manual(app: AppHandle, tab_id: String) {
    let state = app.state::<PtyState>();
    let registry = app.state::<WindowPtyRegistry>();
    registry.unregister(&tab_id);
    if let Err(error) = pty_commands::kill(&state, &tab_id) {
        log::warn!("resource_guard: manual kill failed: {error}");
    }
    let _ = app.emit(
        EVENT_TERMINATED,
        &TabTerminatedPayload {
            tab_id,
            percent: 0.0,
            reason: REASON_MANUAL_KILL,
        },
    );
}

#[cfg(unix)]
fn suspend_process(pid: u32) -> std::io::Result<()> {
    // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- raw signal delivery to a single already-known pid, no memory/pointer manipulation.
    let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGSTOP) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(unix)]
fn resume_process(pid: u32) -> std::io::Result<()> {
    // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- raw signal delivery to a single already-known pid, no memory/pointer manipulation.
    let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGCONT) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(unix)]
fn kill_single_process(pid: u32) -> std::io::Result<()> {
    // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- raw signal delivery to a single already-known pid, no memory/pointer manipulation.
    let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

/// Windows hat keinen offiziellen "pausiere einen ganzen Prozess"-Aufruf
/// (anders als `WinJob`/`TerminateJobObject` in `pty_manager.rs`, das reicht
/// nur zum Beenden, nicht zum Anhalten). `NtSuspendProcess`/`NtResumeProcess`
/// sind undokumentierte, aber seit Jahrzehnten stabile `ntdll.dll`-Exports —
/// dieselben, die Process Explorer/Task-Manager für ihre eigene
/// "Suspend Process"-Funktion nutzen. Dynamisch aufgelöst statt statisch
/// gebunden, weil sie nicht Teil der `winapi`-Crate-Bindings sind.
///
/// Implementiert nach Spezifikation, nicht ausführungsverifiziert — kein
/// Windows-Rechner in dieser Umgebung verfügbar (dieselbe Einschränkung wie
/// `pty_manager.rs`s `WinJob`).
#[cfg(windows)]
mod windows_primitives {
    use std::ffi::CString;
    use std::io;
    use winapi::shared::minwindef::FARPROC;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::libloaderapi::{GetProcAddress, LoadLibraryA};
    use winapi::um::processthreadsapi::{OpenProcess, TerminateProcess};
    use winapi::um::winnt::{HANDLE, PROCESS_SUSPEND_RESUME, PROCESS_TERMINATE};

    type NtSuspendResumeFn = unsafe extern "system" fn(HANDLE) -> i32;

    struct OwnedHandle(HANDLE);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- releasing our own owned handle.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    fn resolve_nt_fn(name: &str) -> Option<NtSuspendResumeFn> {
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- resolving a stable-but-undocumented ntdll export by name; the transmute below only ever runs against that specific, known symbol.
        unsafe {
            let module_name = CString::new("ntdll.dll").ok()?;
            let module = LoadLibraryA(module_name.as_ptr());
            if module.is_null() {
                return None;
            }
            let fn_name = CString::new(name).ok()?;
            let addr: FARPROC = GetProcAddress(module, fn_name.as_ptr());
            if addr.is_null() {
                return None;
            }
            Some(std::mem::transmute::<FARPROC, NtSuspendResumeFn>(addr))
        }
    }

    fn open_for(pid: u32, access: winapi::shared::minwindef::DWORD) -> io::Result<OwnedHandle> {
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- raw Win32 handle open on a known pid, no memory/pointer manipulation beyond the returned handle.
        let handle = unsafe { OpenProcess(access, 0, pid) };
        if handle.is_null() {
            Err(io::Error::last_os_error())
        } else {
            Ok(OwnedHandle(handle))
        }
    }

    fn other_error(message: impl Into<String>) -> io::Error {
        io::Error::new(io::ErrorKind::Other, message.into())
    }

    pub(super) fn suspend_process(pid: u32) -> io::Result<()> {
        let handle = open_for(pid, PROCESS_SUSPEND_RESUME)?;
        let func = resolve_nt_fn("NtSuspendProcess")
            .ok_or_else(|| other_error("NtSuspendProcess not resolvable"))?;
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- calling the resolved ntdll export with a process handle we just opened and own.
        let status = unsafe { func(handle.0) };
        if status < 0 {
            Err(other_error(format!("NtSuspendProcess failed: {status:#x}")))
        } else {
            Ok(())
        }
    }

    pub(super) fn resume_process(pid: u32) -> io::Result<()> {
        let handle = open_for(pid, PROCESS_SUSPEND_RESUME)?;
        let func = resolve_nt_fn("NtResumeProcess")
            .ok_or_else(|| other_error("NtResumeProcess not resolvable"))?;
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- see suspend_process above.
        let status = unsafe { func(handle.0) };
        if status < 0 {
            Err(other_error(format!("NtResumeProcess failed: {status:#x}")))
        } else {
            Ok(())
        }
    }

    pub(super) fn kill_single_process(pid: u32) -> io::Result<()> {
        let handle = open_for(pid, PROCESS_TERMINATE)?;
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- terminating a single process via a handle we just opened and own.
        let ok = unsafe { TerminateProcess(handle.0, 1) };
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
use windows_primitives::{kill_single_process, resume_process, suspend_process};

#[cfg(test)]
mod tests {
    use super::*;

    fn input(kind: StageKind, strikes: u8, cooldown_expired: bool, percent: f32, offender_is_root: bool) -> StepInput {
        StepInput { kind, strikes, cooldown_expired, percent, offender_pid: 4242, offender_is_root }
    }

    #[test]
    fn normal_stays_normal_below_soft_threshold() {
        let (kind, pid, strikes, actions) = step(input(StageKind::Normal, 0, true, 5.0, false));
        assert_eq!(kind, StageKind::Normal);
        assert_eq!(pid, None);
        assert_eq!(strikes, 0);
        assert!(actions.is_empty());
    }

    #[test]
    fn normal_transitions_to_warn_above_soft_threshold() {
        let (kind, _, _, actions) = step(input(StageKind::Normal, 0, true, 25.0, false));
        assert_eq!(kind, StageKind::Warn);
        assert_eq!(actions, vec![Action::EmitWarn]);
    }

    #[test]
    fn warn_does_not_re_emit_while_still_in_warn_range() {
        let (kind, _, _, actions) = step(input(StageKind::Warn, 0, true, 25.0, false));
        assert_eq!(kind, StageKind::Warn);
        assert!(actions.is_empty(), "must not re-emit on every tick while unchanged");
    }

    #[test]
    fn warn_falls_back_to_normal_and_emits_once() {
        let (kind, _, _, actions) = step(input(StageKind::Warn, 0, true, 5.0, false));
        assert_eq!(kind, StageKind::Normal);
        assert_eq!(actions, vec![Action::EmitNormal]);
    }

    #[test]
    fn hard_threshold_with_non_root_offender_pauses_that_process() {
        let (kind, pid, strikes, actions) = step(input(StageKind::Normal, 0, true, 45.0, false));
        assert_eq!(kind, StageKind::Paused);
        assert_eq!(pid, Some(4242));
        assert_eq!(strikes, 0);
        assert_eq!(actions, vec![Action::Suspend(4242), Action::EmitPaused(4242)]);
    }

    #[test]
    fn hard_threshold_with_root_offender_kills_the_whole_tab_immediately() {
        let (kind, pid, _, actions) = step(input(StageKind::Normal, 0, true, 45.0, true));
        assert_eq!(kind, StageKind::Normal);
        assert_eq!(pid, None);
        assert_eq!(actions, vec![Action::KillTab, Action::EmitTerminated]);
    }

    #[test]
    fn paused_stage_never_reclassifies_on_its_own() {
        let (kind, pid, strikes, actions) = step(input(StageKind::Paused, 0, true, 99.0, false));
        assert_eq!(kind, StageKind::Paused);
        assert_eq!(pid, None);
        assert_eq!(strikes, 0);
        assert!(actions.is_empty(), "only an explicit resume may leave Paused");
    }

    #[test]
    fn cooldown_first_retrip_kills_only_the_single_offending_process() {
        let (kind, _, strikes, actions) = step(input(StageKind::Cooldown, 0, false, 45.0, false));
        assert_eq!(kind, StageKind::Cooldown);
        assert_eq!(strikes, 1);
        assert_eq!(actions, vec![Action::KillSingle(4242), Action::EmitSingleKill]);
    }

    #[test]
    fn cooldown_second_retrip_after_a_strike_kills_the_whole_tab() {
        let (kind, _, _, actions) = step(input(StageKind::Cooldown, 1, false, 45.0, false));
        assert_eq!(kind, StageKind::Normal);
        assert_eq!(actions, vec![Action::KillTab, Action::EmitTerminated]);
    }

    #[test]
    fn cooldown_retrip_with_root_offender_escalates_straight_to_the_whole_tab() {
        let (kind, _, _, actions) = step(input(StageKind::Cooldown, 0, false, 45.0, true));
        assert_eq!(kind, StageKind::Normal);
        assert_eq!(actions, vec![Action::KillTab, Action::EmitTerminated]);
    }

    #[test]
    fn cooldown_waiting_without_retrip_stays_silent() {
        let (kind, _, strikes, actions) = step(input(StageKind::Cooldown, 0, false, 10.0, false));
        assert_eq!(kind, StageKind::Cooldown);
        assert_eq!(strikes, 0);
        assert!(actions.is_empty(), "must not act again before the window either expires or re-trips");
    }

    #[test]
    fn cooldown_expires_cleanly_back_to_warn_when_still_elevated() {
        let (kind, _, strikes, actions) = step(input(StageKind::Cooldown, 0, true, 25.0, false));
        assert_eq!(kind, StageKind::Warn);
        assert_eq!(strikes, 0);
        assert_eq!(actions, vec![Action::EmitWarn]);
    }

    #[test]
    fn cooldown_expires_cleanly_back_to_normal() {
        let (kind, _, strikes, actions) = step(input(StageKind::Cooldown, 0, true, 5.0, false));
        assert_eq!(kind, StageKind::Normal);
        assert_eq!(strikes, 0);
        assert_eq!(actions, vec![Action::EmitNormal]);
    }

    #[test]
    fn walk_tree_sums_a_process_and_its_descendants_but_not_unrelated_processes() {
        let mut system = System::new();
        system.refresh_all();
        let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
        // Ein einzelner echter, laufender Prozess (dieser Testprozess selbst)
        // reicht, um zu belegen, dass ein Root ohne bekannte Kinder korrekt
        // nur sich selbst summiert.
        let own_pid = sysinfo::get_current_pid().expect("own pid should be resolvable");
        let (total, _cpu, members) = walk_tree(&system, &children, own_pid);
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].0, own_pid);
        assert!(total > 0, "a running process should report non-zero RSS");

        // Ein unbekannter Nachfahre bleibt außen vor, solange `children` ihn
        // nicht unter diesem Root führt.
        children.insert(own_pid, vec![]);
        let (total_again, _cpu_again, members_again) = walk_tree(&system, &children, own_pid);
        assert_eq!(total_again, total);
        assert_eq!(members_again.len(), 1);
    }

    #[test]
    fn walk_tree_returns_empty_for_an_already_dead_pid() {
        let mut system = System::new();
        system.refresh_all();
        let children: HashMap<Pid, Vec<Pid>> = HashMap::new();
        // Eine absurd hohe pid existiert auf keinem realen System.
        let (total, cpu, members) = walk_tree(&system, &children, Pid::from_u32(u32::MAX - 1));
        assert_eq!(total, 0);
        assert_eq!(cpu, 0.0);
        assert!(members.is_empty());
    }

    #[test]
    fn tab_percentages_normalizes_ram_against_total_and_cpu_against_core_count() {
        let (mem, cpu) = tab_percentages(200, 150.0, 1000, 2.0);
        assert_eq!(mem, 20.0);
        assert_eq!(cpu, 75.0);
    }

    #[test]
    fn tab_percentages_reports_zero_cpu_instead_of_dividing_by_zero_cores() {
        // Derselbe Schutz wie `resource_monitor.rs`s eigene
        // `available_parallelism()`-Herleitung — hier zusätzlich abgesichert,
        // falls `tick_all` je mit 0 aufgerufen würde (kaputte Systemauskunft).
        let (_, cpu) = tab_percentages(0, 50.0, 1000, 0.0);
        assert_eq!(cpu, 0.0);
    }

    /// Proves the actual OS-level effect of the three primitives against a
    /// REAL process, not just that they compile — `ps -o stat=` reports `T`
    /// for a stopped process, `S`/`R` for a running one, distinct enough to
    /// tell suspend/resume apart from a no-op. unix-only, same reasoning as
    /// `pty_manager.rs`'s own `#[cfg(unix)] mod group_kill_tests`.
    #[cfg(unix)]
    mod primitives_against_a_real_process {
        use super::*;
        use std::time::{Duration, Instant};

        fn ps_stat(pid: u32) -> Option<String> {
            let output = std::process::Command::new("ps")
                .args(["-o", "stat=", "-p", &pid.to_string()])
                .output()
                .ok()?;
            if !output.status.success() {
                return None;
            }
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if text.is_empty() { None } else { Some(text) }
        }

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

        fn is_stopped(pid: u32) -> bool {
            ps_stat(pid).is_some_and(|stat| stat.starts_with('T'))
        }

        fn is_running(pid: u32) -> bool {
            ps_stat(pid).is_some_and(|stat| !stat.starts_with('T') && !stat.starts_with('Z'))
        }

        // A killed process whose parent (this test binary itself, via
        // `std::process::Command`) hasn't called `wait()` yet is a ZOMBIE,
        // not absent from `ps` — `ps -o stat=` still reports it (`Z...`)
        // until reaped. Dead-and-unreaped counts as "gone" for what this
        // test actually verifies (did SIGKILL take effect), same as
        // `pty_manager.rs`'s own `kill()` doc comment distinguishes "made
        // dead" from "reaped" as two separate concerns.
        fn is_gone(pid: u32) -> bool {
            match ps_stat(pid) {
                None => true,
                Some(stat) => stat.starts_with('Z'),
            }
        }

        #[test]
        fn suspend_then_resume_then_kill_a_real_process() {
            let mut child = std::process::Command::new("sleep")
                .arg("30")
                .spawn()
                .expect("spawning a real throwaway process should succeed");
            let pid = child.id();

            assert!(
                wait_for(|| is_running(pid), Duration::from_secs(2)),
                "sanity check: freshly spawned process should be running"
            );

            suspend_process(pid).expect("suspend should succeed against a real pid");
            assert!(
                wait_for(|| is_stopped(pid), Duration::from_secs(2)),
                "expected SIGSTOP to actually stop the process (ps STAT=T)"
            );

            resume_process(pid).expect("resume should succeed against a real pid");
            assert!(
                wait_for(|| is_running(pid), Duration::from_secs(2)),
                "expected SIGCONT to actually resume the process"
            );

            kill_single_process(pid).expect("kill should succeed against a real pid");
            assert!(
                wait_for(|| is_gone(pid), Duration::from_secs(2)),
                "expected SIGKILL to actually terminate the process"
            );

            // Reap it so it doesn't sit as a zombie for the rest of the test run.
            let _ = child.wait();
        }
    }
}
