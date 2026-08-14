//! The settings editor's own window — modelled on `about.rs`'s singleton
//! open/raise pattern, but deliberately NOT `about.rs`'s modal/`always_on_top`
//! behaviour: this is a normal, focusable, resizable sibling window that
//! never blocks or dims the main window (story 9 of the spec).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{
    AppHandle, Manager, PhysicalPosition, Runtime, WebviewUrl, WebviewWindowBuilder, Window,
    WindowEvent,
};

const LABEL: &str = "settings";
const WIDTH: f64 = 760.0;
const HEIGHT: f64 = 560.0;

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
    // No opener at app-start — same primary-monitor `.center()` fallback as
    // always; `show()`'s first real invocation repositions it anyway.
    if let Err(error) = build_hidden(app, None) {
        eprintln!("PaneCrew: Einstellungen-Fenster konnte nicht vorgewärmt werden: {error}");
    }
    // Bewusst KEIN arm_reveal_watchdog: dieses Fenster soll unsichtbar
    // bleiben, bis `show()` es explizit anfordert (setzt OPEN_REQUESTED) —
    // der Watchdog existiert nur für den Fall, dass ein ECHTES Öffnen ohne
    // Antwort vom Frontend bliebe.
}

/// Singleton: a second call brings the existing window to the front instead
/// of opening a duplicate (story 10).
///
/// `opener` is the window the user actually triggered "Settings" from (the
/// IPC caller, auto-injected by Tauri into `settings_open_window` — see
/// `settings_commands.rs`) — NOT necessarily "main": with multiple windows
/// open, any of them can open Settings. Positioning off it, not off a
/// hardcoded default monitor, is what fixes the multi-monitor report: a
/// blind `.center()` always lands on the PRIMARY monitor, regardless of
/// which monitor `opener` (and the user) is actually on.
pub fn show(app: &AppHandle, opener: &Window) {
    OPEN_REQUESTED.store(true, Ordering::SeqCst);
    let position = centered_over(opener, WIDTH, HEIGHT);

    if let Some(window) = app.get_webview_window(LABEL) {
        // Repositions the SAME prewarmed/singleton window on every real open,
        // not just at first build: `prewarm()` below only ever centers on the
        // primary monitor (no opener exists yet at app-start), so without
        // this the window would carry that wrong position across its entire
        // hidden-singleton lifetime and only ever get it right by accident.
        if let Some((position, _scale_factor)) = position {
            let _ = window.set_position(position);
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    if let Err(error) = build_hidden(app, position) {
        eprintln!("PaneCrew: Einstellungen-Fenster konnte nicht geöffnet werden: {error}");
        return;
    }
    arm_reveal_watchdog(app);
}

/// Physical top-left position that centers a `target_width` × `target_height`
/// (logical px) window over `opener`, clamped to `opener`'s own monitor so a
/// window near a screen edge can't push the settings window half off-screen,
/// plus the scale factor it was computed with (callers that need LOGICAL
/// pixels — `WebviewWindowBuilder::position`, per its own doc comment — must
/// divide by this; `Window::set_position` takes the physical value as-is).
/// `None` if any of the underlying platform queries fail (headless/test
/// environments, a not-yet-mapped window) — callers fall back to `.center()`.
fn centered_over(
    opener: &Window,
    target_width: f64,
    target_height: f64,
) -> Option<(PhysicalPosition<i32>, f64)> {
    let opener_position = opener.outer_position().ok()?;
    let opener_size = opener.outer_size().ok()?;
    let scale_factor = opener.scale_factor().ok()?;

    let target_width = (target_width * scale_factor).round() as i32;
    let target_height = (target_height * scale_factor).round() as i32;

    let mut x = opener_position.x + (opener_size.width as i32 - target_width) / 2;
    let mut y = opener_position.y + (opener_size.height as i32 - target_height) / 2;

    if let Ok(Some(monitor)) = opener.current_monitor() {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let max_x = monitor_position.x + monitor_size.width as i32 - target_width;
        let max_y = monitor_position.y + monitor_size.height as i32 - target_height;
        x = x.clamp(monitor_position.x, max_x.max(monitor_position.x));
        y = y.clamp(monitor_position.y, max_y.max(monitor_position.y));
    }

    Some((PhysicalPosition::new(x, y), scale_factor))
}

fn build_hidden(app: &AppHandle, position: Option<(PhysicalPosition<i32>, f64)>) -> tauri::Result<()> {
    let title = if app.config().identifier.ends_with(".nightly") {
        "PaneCrew Nightly — Einstellungen"
    } else {
        "PaneCrew — Einstellungen"
    };

    let mut builder =
        WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("settings.html".into()))
            .title(title)
            .inner_size(WIDTH, HEIGHT)
            .min_inner_size(560.0, 420.0)
            .background_color(
                parse_hex_color(BACKGROUND)
                    .expect("BACKGROUND constant must be a valid #rrggbb color"),
            )
            // Normal native decorations, normal resizing, no `always_on_top`: the
            // opposite of `about.rs` on every point that made that window modal.
            .resizable(true)
            // Revealed only once the frontend has something to show (chrome +
            // "loading" text render at mount, before schema/values arrive) via
            // `settings_visible` below — same white-flash fix as `about.rs`.
            .visible(false);

    builder = match position {
        // `WebviewWindowBuilder::position` takes LOGICAL pixels (its own doc
        // comment) while `centered_over` computed physical ones — divide back
        // by the same scale factor, not the still-unbuilt window's own (which
        // doesn't exist yet to ask).
        Some((position, scale_factor)) => builder.position(
            f64::from(position.x) / scale_factor,
            f64::from(position.y) / scale_factor,
        ),
        // `prewarm()`'s first-ever build (no opener yet) and any environment
        // where `centered_over` couldn't resolve the opener's monitor.
        None => builder.center(),
    };

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
