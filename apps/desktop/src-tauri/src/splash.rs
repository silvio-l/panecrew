use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, State};

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

#[tauri::command]
pub fn main_ready(app: AppHandle, gate: State<'_, RevealGate>) {
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
