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
const WIDTH: f64 = 1440.0;
const HEIGHT: f64 = 900.0;
const MIN_WIDTH: f64 = 960.0;
const MIN_HEIGHT: f64 = 600.0;
const BACKGROUND: &str = "#121314";

/// Traffic-light dot position, same values as `tauri.conf.json`'s
/// `trafficLightPosition`. Missing this call previously left every
/// runtime-created window's controls at macOS's own default spot instead of
/// the one `TitleBar.tsx`'s `TRAFFIC_LIGHT_INSET` (84px) was measured
/// against — visibly crooked dots (2026-08-13, user report). Confirmed fixed
/// once rebuilt: the dots themselves now line up pixel-for-pixel with "main".
const TRAFFIC_LIGHT_X: f64 = 21.0;
const TRAFFIC_LIGHT_Y: f64 = 27.5;

/// `WebviewBuilder::accept_first_mouse` (verified against the `wry`/
/// `tauri-runtime` 2.11 source: `accept_first_mouse: bool`, default `false`)
/// — "whether clicking an inactive window also clicks through to the
/// webview", i.e. whether the click that activates a background window is
/// ALSO delivered to the webview or swallowed by the activation.
///
/// **This was NOT the cause of the "secondary windows can't be dragged"
/// report** (2026-08-13). An earlier revision of this comment claimed it
/// was, the setting was shipped on that theory, and the user reproduced the
/// bug unchanged afterwards. The real cause was an ACL/capability-scope
/// mismatch — see `capabilities/default.json` and the module tests below.
/// Do not let this constant send you back down that path.
///
/// It stays because it is a defensible fix for a *different*, genuine macOS
/// papercut (the first click on an unfocused window being spent purely on
/// activation), matching `tauri.conf.json`'s `acceptFirstMouse: true` on
/// "main" so every window behaves alike — but it is unvalidated, and it was
/// never the drag bug.
const ACCEPT_FIRST_MOUSE: bool = true;

/// Label prefix for every window this module creates at runtime. Load-bearing
/// beyond mere cosmetics: Tauri 2 scopes capabilities to window labels via
/// `glob::Pattern`, so `capabilities/default.json`'s `windows` array has to
/// match labels built from this prefix. It listed only the literal `"main"`
/// until 2026-08-13, which silently denied every `plugin:`/`core:` command to
/// secondary windows — dragging (`plugin:window|start_dragging`) and the
/// project folder picker (`dialog:allow-open`) among them. `tests` below
/// pins the two together.
const SECONDARY_LABEL_PREFIX: &str = "main-";

/// The single source for secondary-window labels — shared with the tests so a
/// regression can't be masked by a hardcoded example label.
fn new_window_label() -> String {
    format!("{SECONDARY_LABEL_PREFIX}{}", nanoid())
}

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

    pub(crate) fn is_set(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Opens a new, independent PaneCrew window with its own up-to-four-pane
/// grid. Returns the generated label so nothing else needs to — the new
/// window bootstraps its own state client-side from its own `?window=`
/// query param (`useWindowIdentity`), it is never driven from here.
#[tauri::command]
pub fn window_open_new<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let label = new_window_label();

    let opener = app.get_webview_window(MAIN).or_else(|| {
        app.webview_windows()
            .values()
            .find(|w| w.label() != "about" && w.label() != "settings")
            .cloned()
    });
    let cascade_index = app
        .webview_windows()
        .keys()
        .filter(|l| l.as_str() == MAIN || l.starts_with(SECONDARY_LABEL_PREFIX))
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
    .traffic_light_position(tauri::LogicalPosition::new(TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_Y))
    .accept_first_mouse(ACCEPT_FIRST_MOUSE)
    .hidden_title(true);

    // `title_bar_style`/`TitleBarStyle::Overlay` model macOS's inset-traffic-
    // light chrome and only exist on `WebviewWindowBuilder` when compiled for
    // macOS (verified against a real Windows CI build failure, 2026-08-14:
    // E0599 "no method named `title_bar_style`"). `tauri.conf.json`'s own
    // `titleBarStyle: "Overlay"` is JSON and silently ignored on non-macOS
    // targets, which is why only *this* runtime-builder call needed gating.
    #[cfg(target_os = "macos")]
    {
        builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay);
    }

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
    #[allow(unused_mut)] // only reassigned under the macOS-only cfg block below
    let mut builder = WebviewWindowBuilder::new(
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
    .traffic_light_position(tauri::LogicalPosition::new(TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_Y))
    .accept_first_mouse(ACCEPT_FIRST_MOUSE)
    .hidden_title(true);

    // See the matching comment in `window_open_new` above.
    #[cfg(target_os = "macos")]
    {
        builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay);
    }

    builder
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

/// Regression tests for the 2026-08-13 bug "secondary windows can't be dragged
/// and can't open the project picker".
///
/// Root cause: Tauri 2 gates every `plugin:`/`core:` IPC command on the
/// capabilities whose `windows` globs match the *window label* of the caller
/// (`tauri-2.11.5/src/webview/mod.rs` → `resolve_access`, matched in
/// `src/ipc/authority.rs` with `glob::Pattern::matches`). App-defined
/// `#[tauri::command]`s are exempt while the app ships no ACL manifest of its
/// own, and `tauri::ipc::Channel` traffic is exempt too — which is exactly why
/// secondary windows *looked* healthy (PTY panes ran fine, they use a Channel)
/// while `data-tauri-drag-region`'s `plugin:window|start_dragging` and the
/// folder picker's `dialog:allow-open` were silently denied.
///
/// These tests reimplement that matching against the REAL capability files and
/// the REAL label generator, so the capability scope and the label scheme
/// cannot drift apart again unnoticed.
#[cfg(test)]
mod tests {
    use super::{new_window_label, MAIN};
    use std::collections::BTreeSet;

    /// Every capability the app ships, by the filename Tauri picks them up from.
    const CAPABILITY_FILES: &[(&str, &str)] = &[
        ("default.json", include_str!("../capabilities/default.json")),
        ("about.json", include_str!("../capabilities/about.json")),
        (
            "settings.json",
            include_str!("../capabilities/settings.json"),
        ),
    ];

    /// The permission identifiers a window with `label` may actually use —
    /// the union over every capability whose `windows` globs match it.
    ///
    /// Only literal identifiers are collected, not the transitive expansion of
    /// permission *sets* like `core:default`; the two permissions asserted
    /// below are both spelled out explicitly in `default.json`, so no
    /// expansion is needed to catch this regression.
    fn granted_permissions(label: &str) -> BTreeSet<String> {
        let mut granted = BTreeSet::new();

        for (file, source) in CAPABILITY_FILES {
            let capability: serde_json::Value = serde_json::from_str(source)
                .unwrap_or_else(|error| panic!("{file} is not valid JSON: {error}"));

            // The model below matches on window labels. A capability that
            // additionally scoped itself to `webviews` would need webview
            // labels too — assert none does, rather than silently mismodel it.
            assert!(
                capability.get("webviews").is_none(),
                "{file} scopes itself to `webviews`; granted_permissions() only models `windows` \
                 and would report a wrong result — extend it before adding that field"
            );

            let windows = capability
                .get("windows")
                .and_then(|value| value.as_array())
                .unwrap_or_else(|| panic!("{file} has no `windows` array"));

            let matches_label = windows.iter().any(|pattern| {
                let pattern = pattern.as_str().expect("`windows` entries must be strings");
                glob::Pattern::new(pattern)
                    .unwrap_or_else(|error| panic!("{file}: invalid glob {pattern:?}: {error}"))
                    .matches(label)
            });
            if !matches_label {
                continue;
            }

            let permissions = capability
                .get("permissions")
                .and_then(|value| value.as_array())
                .unwrap_or_else(|| panic!("{file} has no `permissions` array"));
            for permission in permissions {
                // Entries are either a bare identifier string or an object
                // carrying an `identifier` plus scope (`opener:allow-open-path`).
                let identifier = permission
                    .as_str()
                    .or_else(|| permission.get("identifier").and_then(|id| id.as_str()))
                    .expect("permission entries are strings or objects with an `identifier`");
                granted.insert(identifier.to_string());
            }
        }

        granted
    }

    /// Commands a PaneCrew window cannot work without. `start_dragging` backs
    /// every `data-tauri-drag-region` in `TitleBar.tsx`; `dialog:allow-open`
    /// backs the project folder picker reached from `App.tsx`.
    const REQUIRED: &[&str] = &["core:window:allow-start-dragging", "dialog:allow-open"];

    #[test]
    fn main_window_may_drag_itself_and_open_the_folder_picker() {
        let granted = granted_permissions(MAIN);
        for permission in REQUIRED {
            assert!(
                granted.contains(*permission),
                "window {MAIN:?} is missing {permission:?}; granted: {granted:?}"
            );
        }
    }

    /// The actual regression: a runtime-created window's label must land in the
    /// same capability scope as "main". Before the fix, `default.json` listed
    /// the literal `"main"`, which no `main-<nanoid>` label ever matches.
    #[test]
    fn secondary_windows_may_drag_themselves_and_open_the_folder_picker() {
        let label = new_window_label();
        let granted = granted_permissions(&label);
        for permission in REQUIRED {
            assert!(
                granted.contains(*permission),
                "runtime-created window {label:?} is missing {permission:?} — its label matches no \
                 capability `windows` glob, so Tauri denies the command (granted: {granted:?})"
            );
        }
    }

    /// Labels are generated per call; the scope must hold for all of them, not
    /// just for whichever one a single test run happened to produce.
    #[test]
    fn every_generated_label_lands_in_the_same_scope() {
        for _ in 0..64 {
            let label = new_window_label();
            assert!(
                granted_permissions(&label).contains("core:window:allow-start-dragging"),
                "generated label {label:?} fell outside the capability scope"
            );
        }
    }
}
