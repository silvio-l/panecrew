//! The settings editor's own window — modelled on `about.rs`'s singleton
//! open/raise pattern, but deliberately NOT `about.rs`'s modal/`always_on_top`
//! behaviour: this is a normal, focusable, resizable sibling window that
//! never blocks or dims the main window (story 9 of the spec).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};

const LABEL: &str = "settings";

/// Setzt `show()` VOR dem Erzeugen/Anzeigen — unterscheidet "der Nutzer hat
/// die Einstellungen tatsächlich geöffnet" von "das Fenster ist nur
/// vorgewärmt". `settings_visible` (vom Frontend beim Mount aufgerufen) darf
/// nur im ersten Fall tatsächlich aufdecken: `prewarm()` lässt sein Fenster
/// beim Start im Hintergrund rendern, dessen React-Mount feuert denselben
/// `settings_visible`-Aufruf wie ein echtes Öffnen — ohne dieses Flag würde
/// das vorgewärmte Fenster sich selbst sichtbar machen und den Fokus stehlen,
/// sobald sein erster Render fertig ist, Sekunden nach dem App-Start und
/// ohne jeden Klick.
static OPEN_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Same tone as `windows.rs`'s `BACKGROUND` / `theme.css`'s bare-`:root`
/// (dark-by-default) `--pc-app-background`. Painted natively before the
/// WebView's first document frame — without this the window briefly shows
/// the platform's own default white instead.
const BACKGROUND: &str = "#121314";

/// Same reasoning and value as `about.rs`'s `REVEAL_WATCHDOG`: last-resort
/// fallback if the frontend's ready signal never arrives, so the window can
/// never get stuck invisible.
const REVEAL_WATCHDOG: Duration = Duration::from_millis(1500);

#[tauri::command]
pub fn settings_visible(app: AppHandle) {
    if OPEN_REQUESTED.load(Ordering::SeqCst) {
        reveal(&app);
    }
}

/// Verhindert das Standard-`Destroyed` bei Schließen und versteckt das
/// Fenster nur — sonst würde der Prewarm-Gewinn (WKWebView + React + IPC
/// schon fertig gerendert) mit jedem ersten Schließen wieder verworfen und
/// beim nächsten Öffnen bräuchte es erneut den vollen, langsamen Kaltstart.
/// Registriert in `lib.rs`s `.on_window_event`, analog zu `about::on_window_event`.
///
/// Bewusst NICHT bei einem echten App-Quit (Cmd+Q/Dock „Beenden“): Tauri
/// feuert `CloseRequested` dabei für jedes Fenster einzeln, auch für dieses
/// versteckte — ein unbedingtes `prevent_close()` würde dann verhindern,
/// dass die App überhaupt beendet. `crate::windows::QuittingFlag` ist dasselbe
/// Unterscheidungsmerkmal, das `windows::on_window_event` schon dafür nutzt.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != LABEL {
        return;
    }
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if window
        .app_handle()
        .state::<crate::windows::QuittingFlag>()
        .is_set()
    {
        return;
    }
    api.prevent_close();
    let _ = window.hide();
}

fn reveal<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn arm_reveal_watchdog<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(REVEAL_WATCHDOG);
        reveal(&app);
    });
}

/// Erzeugt das Fenster unsichtbar im Hintergrund, ohne es je aufzudecken —
/// beim App-Start aufgerufen (`lib.rs`), damit `show()` später (der erste
/// echte Klick auf "Einstellungen") ein bereits fertig gerendertes Fenster
/// nur noch anzeigen muss, statt WKWebView + React + IPC-Rundreise komplett
/// neu anzustoßen. Genau das war die gemeldete Ladezeit/das graue Leerfenster
/// — kein Persistenz-/Korrektheitsproblem, sondern ein fehlendes Prewarm.
/// No-Op, falls das Fenster schon existiert (`show()` bereits gelaufen, oder
/// ein zweiter `prewarm()`-Aufruf).
pub fn prewarm(app: &AppHandle) {
    if app.get_webview_window(LABEL).is_some() {
        return;
    }
    if let Err(error) = build_hidden(app) {
        eprintln!("PaneCrew: Einstellungen-Fenster konnte nicht vorgewärmt werden: {error}");
    }
    // Bewusst KEIN arm_reveal_watchdog: dieses Fenster soll unsichtbar
    // bleiben, bis `show()` es explizit anfordert (setzt OPEN_REQUESTED) —
    // der Watchdog existiert nur für den Fall, dass ein ECHTES Öffnen ohne
    // Antwort vom Frontend bliebe.
}

/// Singleton: a second call brings the existing window to the front instead
/// of opening a duplicate (story 10).
pub fn show(app: &AppHandle) {
    OPEN_REQUESTED.store(true, Ordering::SeqCst);

    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    if let Err(error) = build_hidden(app) {
        eprintln!("PaneCrew: Einstellungen-Fenster konnte nicht geöffnet werden: {error}");
        return;
    }
    arm_reveal_watchdog(app);
}

fn build_hidden(app: &AppHandle) -> tauri::Result<()> {
    let title = if app.config().identifier.ends_with(".nightly") {
        "PaneCrew Nightly — Einstellungen"
    } else {
        "PaneCrew — Einstellungen"
    };

    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("settings.html".into()))
        .title(title)
        .inner_size(760.0, 560.0)
        .min_inner_size(560.0, 420.0)
        .background_color(
            parse_hex_color(BACKGROUND).expect("BACKGROUND constant must be a valid #rrggbb color"),
        )
        // Normal native decorations, normal resizing, no `always_on_top`: the
        // opposite of `about.rs` on every point that made that window modal.
        .resizable(true)
        .center()
        // Revealed only once the frontend has something to show (chrome +
        // "loading" text render at mount, before schema/values arrive) via
        // `settings_visible` below — same white-flash fix as `about.rs`.
        .visible(false);

    builder.build()?;
    Ok(())
}

fn parse_hex_color(hex: &str) -> Option<tauri::window::Color> {
    let hex = hex.strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
    Some(tauri::window::Color(r, g, b, 255))
}
