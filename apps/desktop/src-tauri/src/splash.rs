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
