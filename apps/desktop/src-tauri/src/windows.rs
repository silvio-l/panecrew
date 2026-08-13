//! Multi-window lifecycle (Ticket 27): additional PaneCrew windows, each
//! with its own up-to-four-pane grid, all peers of "main" in the same
//! process under one Dock icon (Tauri's default grouping — nothing to opt
//! into). Pattern lifted from `about.rs`'s builder call, but unlike
//! `about.rs`'s singleton, every call here creates a NEW, independently
//! addressable window instead of refocusing an existing one.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};

use crate::pty_commands::{self, PtyState, WindowPtyRegistry};
use crate::session_store;

const MAIN: &str = "main";

/// Chrome settings mirrored from `tauri.conf.json`'s "main" entry so a
/// second window looks like the same app, not a plain default-decorated
/// window — these only exist in the static config today because "main" is
/// the sole window Tauri creates at startup; every window this module opens
/// at runtime has to restate them itself.
const WIDTH: f64 = 1200.0;
const HEIGHT: f64 = 800.0;
const MIN_WIDTH: f64 = 960.0;
const MIN_HEIGHT: f64 = 600.0;
const BACKGROUND: &str = "#121314";

/// Traffic-light dot position, same values as `tauri.conf.json`'s
/// `trafficLightPosition`. Missing this call previously left every
/// runtime-created window's controls at macOS's own default spot instead of
/// the one `TitleBar.tsx`'s `TRAFFIC_LIGHT_INSET` (84px) was measured
/// against — the dots looked "off" AND, since their native hit-test area no
/// longer lined up with where the capsule draws its own drag region, mouse-
/// downs meant to drag the window could land on dead space between the two
/// instead (2026-08-13, user report: "kann das Fenster nicht hin und her
/// schieben" on secondary windows).
const TRAFFIC_LIGHT_X: f64 = 21.0;
const TRAFFIC_LIGHT_Y: f64 = 27.5;

/// Cascading offset between successive new windows — each window lands
/// visibly offset from its opener instead of stacked exactly on top of it
/// (brandlint-ok: funktionaler Verhaltensvergleich, kein Marketing — dieselbe
/// Idee wie VS Codes eigene "New Window"-Platzierung).
const CASCADE_STEP: f64 = 32.0;

/// Set once in `RunEvent::ExitRequested` (Ticket 27, landmine 3): Tauri fires
/// `CloseRequested` for every window individually even when the whole app is
/// quitting (Cmd+Q, Dock "Quit"), and a handler that always dropped that
/// window's session entry on `CloseRequested` would empty `session.json` out
/// from under a full-app quit instead of leaving it for the next launch to
/// restore. This flag is how the handler tells the two cases apart.
#[derive(Default)]
pub struct QuittingFlag(AtomicBool);

impl QuittingFlag {
    pub fn set(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    fn is_set(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Opens a new, independent PaneCrew window with its own up-to-four-pane
/// grid. Returns the generated label so nothing else needs to — the new
/// window bootstraps its own state client-side from its own `?window=`
/// query param (`useWindowIdentity`), it is never driven from here.
#[tauri::command]
pub fn window_open_new<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let label = format!("main-{}", nanoid());

    let opener = app.get_webview_window(MAIN).or_else(|| {
        app.webview_windows()
            .values()
            .find(|w| w.label() != "about" && w.label() != "settings")
            .cloned()
    });
    let cascade_index = app
        .webview_windows()
        .keys()
        .filter(|l| l.as_str() == MAIN || l.starts_with("main-"))
        .count();

    let mut builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(format!("index.html?window={label}").into()),
    )
    .title("PaneCrew")
    .inner_size(WIDTH, HEIGHT)
    .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
    .background_color(
        parse_hex_color(BACKGROUND).expect("BACKGROUND constant must be a valid #rrggbb color"),
    )
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .traffic_light_position(tauri::LogicalPosition::new(TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_Y))
    .hidden_title(true);

    if let Some(opener) = opener {
        if let Ok(position) = opener.outer_position() {
            let offset = CASCADE_STEP * cascade_index as f64;
            builder = builder.position(
                f64::from(position.x) + offset,
                f64::from(position.y) + offset,
            );
        }
    } else {
        builder = builder.center();
    }

    builder
        .build()
        .map(|_| label)
        .map_err(|error| format!("Neues Fenster konnte nicht geöffnet werden: {error}"))
}

/// Startup restore counterpart to `window_open_new` (Ticket 27): reopens one
/// PREVIOUSLY persisted secondary window by its existing `label` instead of
/// generating a fresh one — called once per non-"main" entry in
/// `session.json`'s `windows` array from `run()`'s `setup()`, before the
/// splash-reveal wait, so every restored window is already present (even
/// though still hidden behind its own default-transparent first paint) by
/// the time "main" is revealed. Unlike `window_open_new`, there is no
/// "opener" to cascade from — a cold start has no window position to offset
/// against yet — so restored windows simply center, same as the very first
/// "main" window Tauri itself creates from `tauri.conf.json`.
pub fn open_restored<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
    WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("index.html?window={label}").into()),
    )
    .title("PaneCrew")
    .inner_size(WIDTH, HEIGHT)
    .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
    .background_color(
        parse_hex_color(BACKGROUND).expect("BACKGROUND constant must be a valid #rrggbb color"),
    )
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .traffic_light_position(tauri::LogicalPosition::new(TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_Y))
    .hidden_title(true)
    .center()
    .visible(false)
    .build()
    .map(|_| ())
    .map_err(|error| format!("Fenster „{label}“ konnte nicht wiederhergestellt werden: {error}"))
}

/// `setup()`-time counterpart to `window_open_new` (Ticket 27): without this,
/// closing the app with two or more windows open and relaunching would only
/// ever restore "main" — `session_store`'s `windows` array remembers every
/// window that was open, but nothing before this function ever turned that
/// memory back into an actual `WebviewWindow`. Called once from `run()`'s
/// `setup()`, before `splash::arm_watchdog` — every restored window stays
/// `visible(false)` until `splash::reveal` shows it alongside "main", so a
/// slow cold start never flashes a second window into view ahead of the
/// splash gate. A single window failing to restore is survivable (same
/// "worst case: the picker" stance as a missing/corrupt session file
/// elsewhere) and never aborts startup.
pub fn restore_persisted_windows<R: Runtime>(app: &AppHandle<R>) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let Some(state) = session_store::read_session(&dir) else {
        return;
    };
    for window in &state.windows {
        if window.label == MAIN {
            continue;
        }
        if let Err(error) = open_restored(app, &window.label) {
            eprintln!("PaneCrew: {error}");
        }
    }
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

/// Random-enough, dependency-free label suffix — this only needs to avoid
/// colliding with other windows opened in the same process lifetime, not to
/// be cryptographically unpredictable, so a nanosecond timestamp is enough
/// (two calls landing in the same IPC dispatch tick would be the only way to
/// collide, and `window_open_new` runs to completion on the calling thread
/// before another invocation of it can start).
fn nanoid() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}")
}

/// Window-close cleanup (Ticket 27, landmines 3 + 5): kills every PTY this
/// window owned and drops its `session.json` entry — unless the whole app is
/// quitting, in which case every window's own `CloseRequested` fires too and
/// must leave the session file alone for the next launch's restore. Chained
/// with `about::on_window_event` in `lib.rs`, not a replacement for it —
/// About and Settings are utility windows with their own lifecycle and are
/// explicitly skipped here.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::CloseRequested { .. } = event else {
        return;
    };
    if window.label() == "about" || window.label() == "settings" {
        return;
    }

    let app = window.app_handle();
    let pty_state = app.state::<PtyState>();
    let registry = app.state::<WindowPtyRegistry>();
    pty_commands::kill_all_for_window(&pty_state, &registry, window.label());

    if app.state::<QuittingFlag>().is_set() {
        return;
    }
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    if let Some(mut state) = session_store::read_session(&dir) {
        state.windows.retain(|w| w.label != window.label());
        let _ = session_store::write_session(&dir, &state);
    }
}
