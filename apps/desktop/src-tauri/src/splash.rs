use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, State, Window};

/// Das Hauptfenster startet unsichtbar und wird erst freigegeben, wenn beide
/// Seiten so weit sind: das Splash-Video ist durchgelaufen UND das Frontend des
/// Hauptfensters hat gemountet. Ohne das zweite Signal könnte ein langsamer
/// Kaltstart ein noch leeres Fenster aufdecken.
#[derive(Default)]
pub struct RevealGate(Mutex<Signals>);

#[derive(Default)]
struct Signals {
    splash_finished: bool,
    main_ready: bool,
    revealed: bool,
}

/// Letzte Rückfallebene. Beide Fenster starten unsichtbar, also bliebe die App
/// dauerhaft unsichtbar, wenn das Splash-Dokument gar nicht erst lädt — dann
/// läuft auch keine der Zeitschranken im Splash-Frontend. Die Frist liegt
/// bewusst hinter deren 6 s, damit sie den regulären Ablauf nie abschneidet.
const WATCHDOG: Duration = Duration::from_secs(8);

/// Same logical sizes as `tauri.conf.json`'s window entries — kept here too
/// since `position_on_launch_monitor` below needs them and the JSON config
/// has no Rust-side counterpart to read them back from.
const SPLASH_WIDTH: f64 = 940.0;
const SPLASH_HEIGHT: f64 = 590.0;
const MAIN_WIDTH: f64 = 1440.0;
const MAIN_HEIGHT: f64 = 900.0;

/// Decides which monitor the app is starting on and moves BOTH "main" and
/// "splashscreen" onto it, centered, instead of trusting either window's own
/// declarative/OS-default placement (2026-08-14 multi-monitor report). Only
/// `splashscreen` declares `"center": true` in `tauri.conf.json` — "main" has
/// no `center`/`x`/`y` there at all, so by the time `.setup()` runs (it's
/// config-declared, so it exists — just hidden — before this is called) the
/// OS/window manager has already put it wherever it likes, which need not be
/// the same monitor splash centers on. An earlier version of this function
/// (2026-08-17) read "main"'s own position back via `current_monitor()` and
/// moved splash to match it — that only makes splash agree with an arbitrary
/// placement, it doesn't make either window correct. The only real signal for
/// "where the user is" at launch is the OS cursor position: for a
/// Dock/Finder/Spotlight launch it's exactly where the user just clicked; for
/// `pnpm tauri dev` from a terminal it's a best-effort guess with no better
/// signal available — an inherent limitation of that launch path, not
/// something this function can fix. Deciding the monitor once from the
/// cursor and moving both windows onto it guarantees splash and the eventual
/// reveal always land on the same, deliberately-chosen screen. Best-effort
/// throughout: a failed platform query (headless CI, an environment without a
/// cursor) leaves each window's declarative/OS default in place — called
/// once from `run()`'s `setup()`, before the splash-reveal watchdog arms, so
/// the reposition always lands before either window can ever become visible.
pub fn position_on_launch_monitor(app: &AppHandle) {
    let Some(monitor) = launch_monitor(app) else {
        return;
    };

    if let Some(splash) = app.get_webview_window("splashscreen") {
        center_on_monitor(&splash, &monitor, SPLASH_WIDTH, SPLASH_HEIGHT);
    }
    if let Some(main) = app.get_webview_window("main") {
        center_on_monitor(&main, &monitor, MAIN_WIDTH, MAIN_HEIGHT);
    }
}

/// `Monitor::position()`/`size()` are physical pixels, but `set_position`
/// must get a `LogicalPosition`, not a `PhysicalPosition` built from them
/// directly — empirically confirmed on this machine's 2x Retina display: a
/// `PhysicalPosition` here lands the window at exactly 2x the intended
/// offset (`set_position` doesn't divide it back down by the scale factor on
/// this platform/version), so the conversion has to happen on this side.
fn center_on_monitor(
    window: &tauri::WebviewWindow,
    monitor: &tauri::Monitor,
    logical_width: f64,
    logical_height: f64,
) {
    let scale_factor = monitor.scale_factor();
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let logical_monitor_x = monitor_position.x as f64 / scale_factor;
    let logical_monitor_y = monitor_position.y as f64 / scale_factor;
    let logical_monitor_width = monitor_size.width as f64 / scale_factor;
    let logical_monitor_height = monitor_size.height as f64 / scale_factor;
    let x = logical_monitor_x + (logical_monitor_width - logical_width) / 2.0;
    let y = logical_monitor_y + (logical_monitor_height - logical_height) / 2.0;

    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
}

/// The monitor under the OS cursor at launch — see
/// `position_on_launch_monitor`'s doc comment for why this is the best
/// available signal for "where the user is".
fn launch_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    let cursor = app.cursor_position().ok()?;
    app.monitor_from_point(cursor.x, cursor.y).ok().flatten()
}

pub fn arm_watchdog(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(WATCHDOG);
        let gate = app.state::<RevealGate>();
        signal(&app, gate.inner(), |signals| {
            signals.splash_finished = true;
            signals.main_ready = true;
        });
    });
}

/// Das Splash-Fenster deckt sich selbst auf, sobald sein erster Videoframe steht.
/// Vorher ist es unsichtbar, weil ein frisches WKWebView davor kurz weiß malt.
#[tauri::command]
pub fn splash_visible(app: AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.show();
        let _ = splash.set_focus();
    }
}

#[tauri::command]
pub fn splash_finished(app: AppHandle, gate: State<'_, RevealGate>) {
    signal(&app, &gate, |signals| signals.splash_finished = true);
}

/// Ticket 27, landmine 4: every window's frontend mounts the same bootstrap
/// and would otherwise all race to flip this same process-wide flag — a
/// second window's own mount has nothing to do with whether "main" is ready
/// to be revealed from behind the splash, so it must not participate in that
/// gate at all.
#[tauri::command]
pub fn main_ready(window: Window, app: AppHandle, gate: State<'_, RevealGate>) {
    if window.label() != "main" {
        return;
    }
    signal(&app, &gate, |signals| signals.main_ready = true);
}

fn signal(app: &AppHandle, gate: &RevealGate, mark: impl FnOnce(&mut Signals)) {
    let ready = {
        let mut signals = gate.0.lock().expect("reveal gate poisoned");
        mark(&mut signals);
        let ready = signals.splash_finished && signals.main_ready && !signals.revealed;
        signals.revealed |= ready;
        ready
    };

    if ready {
        reveal(app.clone());
    }
}

fn reveal(app: AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let _ = main.show();
    let _ = main.set_focus();

    // Ticket 27: Sekundärfenster, die `windows::restore_persisted_windows`
    // beim Start bereits geöffnet, aber `visible(false)` gelassen hat —
    // erst hier, zusammen mit "main", sichtbar machen, damit ein langsamer
    // Kaltstart nicht ein zweites Fenster vor dem Splash aufblitzen lässt.
    // "main" behält den Fokus, den es gerade eben gesetzt hat.
    for window in app.webview_windows().values() {
        if window.label() != "main" && window.label().starts_with("main-") {
            let _ = window.show();
        }
    }

    // Der Splash bleibt einen Wimpernschlag über dem aufgedeckten Hauptfenster
    // stehen: dessen erster Frame entsteht auf macOS erst nach `show()`, und der
    // Splash deckt genau diese Lücke ab.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(120));
        if let Some(splash) = app.get_webview_window("splashscreen") {
            let _ = splash.close();
        }
    });
}
