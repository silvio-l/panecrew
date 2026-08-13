//! The settings editor's own window — modelled on `about.rs`'s singleton
//! open/raise pattern, but deliberately NOT `about.rs`'s modal/`always_on_top`
//! behaviour: this is a normal, focusable, resizable sibling window that
//! never blocks or dims the main window (story 9 of the spec).

use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "settings";

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
    reveal(&app);
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

/// Singleton: a second call brings the existing window to the front instead
/// of opening a duplicate (story 10).
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

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

    if let Err(error) = builder.build() {
        eprintln!("PaneCrew: Einstellungen-Fenster konnte nicht geöffnet werden: {error}");
        return;
    }

    arm_reveal_watchdog(app);
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
