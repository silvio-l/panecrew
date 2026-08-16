//! Multi-window lifecycle (Ticket 27): additional PaneCrew windows, each
//! with its own up-to-four-pane grid, all peers of "main" in the same
//! process under one Dock icon (Tauri's default grouping — nothing to opt
//! into). Pattern lifted from `about.rs`'s builder call, but unlike
//! `about.rs`'s singleton, every call here creates a NEW, independently
//! addressable window instead of refocusing an existing one.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{
    AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder, Window,
    WindowEvent,
};

use crate::pty_commands::{self, PtyState, WindowPtyRegistry};
use crate::session_store;

pub(crate) const MAIN: &str = "main";

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
pub(crate) const SECONDARY_LABEL_PREFIX: &str = "main-";

/// True for every window `window_open_new`/`open_restored` create — the set
/// `menu.rs`'s dynamic "Fenster" list shows, excluding the "about"/"settings"
/// utility windows (same exclusion `window_open_new`'s own `opener` search
/// above already applies).
pub(crate) fn is_content_window(label: &str) -> bool {
    label == MAIN || label.starts_with(SECONDARY_LABEL_PREFIX)
}

/// `(label, title, checked)` for every open content window, sorted by label
/// (same rationale as `menu.rs`'s own former copy of this: `MAIN` sorts
/// first, gets the plain "PaneCrew" title, no creation-order tracking is
/// needed or kept anywhere else). The one shared source both `menu.rs`'s
/// "Fenster" list AND `dock.rs`'s dock-menu window list build their own
/// native item type from — they can't share a native item type directly
/// (one needs `tauri::menu::CheckMenuItem`, the other a standalone
/// `muda::CheckMenuItem` outside Tauri's own menu tree, and neither crate
/// exposes a bridge between the two), but the ENUMERATION itself (which
/// windows, in what order, which one checked) has exactly one correct
/// answer and must not drift between the two menus that show it.
/// The focused content window (excludes "about"/"settings", same as
/// `is_content_window` above) — resolves the target for `menu.rs`'s custom
/// "Schließen" item, which (unlike `PredefinedMenuItem::close_window`) has no
/// window bound to it by the OS and must find one itself.
pub(crate) fn focused_content_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Option<tauri::WebviewWindow<R>> {
    app.webview_windows()
        .into_values()
        .find(|w| is_content_window(w.label()) && w.is_focused().unwrap_or(false))
}

/// Every open content window (excludes "about"/"settings") — backs
/// `menu.rs`'s "Alle Fenster schließen". Each returned window still goes
/// through `close()`'s own `CloseRequested` round-trip individually, so the
/// per-window confirm-dialog gate in `on_window_event` above applies exactly
/// as if each had been closed one at a time.
pub(crate) fn content_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<tauri::WebviewWindow<R>> {
    app.webview_windows()
        .into_values()
        .filter(|w| is_content_window(w.label()))
        .collect()
}

pub(crate) fn window_entries<R: Runtime>(app: &AppHandle<R>) -> Vec<(String, String, bool)> {
    let windows = app.webview_windows();
    let focused_label = windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .map(|w| w.label().to_string());
    let mut labels: Vec<String> = windows
        .keys()
        .filter(|label| is_content_window(label))
        .cloned()
        .collect();
    labels.sort();

    labels
        .into_iter()
        .enumerate()
        .map(|(index, label)| {
            let title = if label == MAIN {
                "PaneCrew".to_string()
            } else {
                format!("PaneCrew — Fenster {}", index + 1)
            };
            let checked = focused_label.as_deref() == Some(label.as_str());
            (label, title, checked)
        })
        .collect()
}

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

    /// Called when a `CloseRequested` gets halted for confirmation (below): a
    /// halted close means the quit did NOT go through, so the flag must not
    /// keep reading "quitting" for the rest of the process's life — a later,
    /// entirely unrelated single-window close would otherwise wrongly skip
    /// dropping its own `session.json` entry forever, the exact bug this type
    /// exists to prevent, just inverted.
    fn clear(&self) {
        self.0.store(false, Ordering::SeqCst);
    }

    pub(crate) fn is_set(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Event name `on_window_event` emits when it halts a `CloseRequested` for
/// active-session confirmation — mirrored in `App.tsx` as a plain string
/// literal (no shared constants module between Rust and TypeScript here).
const CLOSE_CONFIRM_EVENT: &str = "pc://window-close-requested";

/// Window labels that already answered "close anyway" to the active-session
/// confirmation below. `Window::close()` re-fires the very `CloseRequested`
/// this flag exists to gate — without consuming it here, a confirmed close
/// would ask the same question a second time on its own follow-up event.
#[derive(Default)]
pub struct ConfirmedCloseWindows(Mutex<HashSet<String>>);

impl ConfirmedCloseWindows {
    fn mark(&self, window_label: &str) {
        self.0.lock().unwrap().insert(window_label.to_string());
    }

    /// True (and consumed) if `window_label` was just confirmed; false, and
    /// nothing consumed, otherwise.
    fn take(&self, window_label: &str) -> bool {
        self.0.lock().unwrap().remove(window_label)
    }
}

/// Remembers, per window, whether `QuittingFlag` was set at the moment its
/// `CloseRequested` got halted for confirmation — captured there because
/// `QuittingFlag` itself is cleared at that same moment (see its doc comment)
/// so an unrelated later close doesn't misread a cancelled quit as still in
/// progress. Without this, a *confirmed* Cmd+Q would wrongly be treated as a
/// plain single-window close by the time its retry lands (the global flag
/// already reads `false` by then) and would drop that window's own
/// `session.json` entry instead of preserving it for the next launch's
/// restore, exactly the outcome quitting is supposed to avoid.
#[derive(Default)]
pub struct DeferredQuitState(Mutex<std::collections::HashMap<String, bool>>);

impl DeferredQuitState {
    fn remember(&self, window_label: &str, was_quitting: bool) {
        self.0
            .lock()
            .unwrap()
            .insert(window_label.to_string(), was_quitting);
    }

    /// Consumes and returns the remembered value if this window was deferred
    /// earlier; `None` if it never was (nothing to lose, so it never went
    /// through the confirmation gate at all).
    fn recall(&self, window_label: &str) -> Option<bool> {
        self.0.lock().unwrap().remove(window_label)
    }
}

/// Frontend's answer to `CLOSE_CONFIRM_EVENT`: the user confirmed losing this
/// window's running terminal sessions. Marks the window as confirmed, then
/// re-issues the close so `on_window_event` below runs the real teardown
/// (PTY kill, session-entry drop, possible `app.exit`) instead of asking a
/// second time.
#[tauri::command]
pub fn window_close_confirmed<R: Runtime>(
    window: Window<R>,
    confirmed: State<ConfirmedCloseWindows>,
) -> Result<(), String> {
    confirmed.mark(window.label());
    window
        .close()
        .map_err(|error| format!("Fenster konnte nicht geschlossen werden: {error}"))
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
    .accept_first_mouse(ACCEPT_FIRST_MOUSE);

    // `title_bar_style`/`traffic_light_position`/`hidden_title` model macOS's
    // inset-traffic-light overlay chrome and are all three `#[cfg(target_os =
    // "macos")]` on `WebviewWindowBuilder` itself (verified against the
    // vendored `tauri` 2.11.5 source, `src/webview/webview_window.rs`, after
    // TWO real Windows CI build failures, 2026-08-14: E0599 on
    // `title_bar_style` first, then -- once that alone was gated -- the same
    // on `traffic_light_position`, which the FIRST error had silently
    // shadowed via rustc's cascading-error suppression on the same chain).
    // `tauri.conf.json`'s own `titleBarStyle: "Overlay"` is JSON and silently
    // ignored on non-macOS targets, which is why only these runtime-builder
    // calls needed gating, not the static config.
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(tauri::LogicalPosition::new(
                TRAFFIC_LIGHT_X,
                TRAFFIC_LIGHT_Y,
            ))
            .hidden_title(true);
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

    let result = builder
        .build()
        .map(|_| label)
        .map_err(|error| format!("Neues Fenster konnte nicht geöffnet werden: {error}"));
    if result.is_ok() {
        crate::menu::refresh(&app);
    }
    result
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
    .accept_first_mouse(ACCEPT_FIRST_MOUSE);

    // See the matching comment in `window_open_new` above.
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(tauri::LogicalPosition::new(
                TRAFFIC_LIGHT_X,
                TRAFFIC_LIGHT_Y,
            ))
            .hidden_title(true);
    }

    let result = builder
        .center()
        .visible(false)
        .build()
        .map(|_| ())
        .map_err(|error| {
            format!("Fenster „{label}“ konnte nicht wiederhergestellt werden: {error}")
        });
    if result.is_ok() {
        crate::menu::refresh(app);
    }
    result
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
/// must leave the session file alone for the next launch's restore. First
/// gated behind the active-session confirmation above (2026-08-16): a
/// misplaced Cmd+Q or a stray click on the traffic-light X must not silently
/// discard running terminal sessions, so the actual teardown below only runs
/// once `ConfirmedCloseWindows` says the frontend has agreed to it — or
/// there was never anything running in this window to lose in the first
/// place. Chained with `about::on_window_event` in `lib.rs`, not a
/// replacement for it — About and Settings are utility windows with their
/// own lifecycle and are explicitly skipped here.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if window.label() == "about" || window.label() == "settings" {
        return;
    }

    let app = window.app_handle();
    let pty_state = app.state::<PtyState>();
    let registry = app.state::<WindowPtyRegistry>();
    let quitting_flag = app.state::<QuittingFlag>();
    let deferred_quit = app.state::<DeferredQuitState>();

    // Halt the close — OS traffic-light X and Cmd+Q alike, both arrive here
    // as a `CloseRequested` for this window — until the frontend confirms
    // losing whatever's still running in it. Nothing to lose (no PTYs
    // registered) skips straight through, same as an already-confirmed close.
    let confirmed = app.state::<ConfirmedCloseWindows>();
    let is_confirmed_retry = confirmed.take(window.label());
    if !is_confirmed_retry && !registry.tab_ids_for_window(window.label()).is_empty() {
        let was_quitting = quitting_flag.is_set();
        deferred_quit.remember(window.label(), was_quitting);
        // A halted close means the quit (if any) did not go through — see
        // `QuittingFlag::clear`'s doc comment.
        quitting_flag.clear();
        api.prevent_close();
        let _ = window.emit_to(window.label(), CLOSE_CONFIRM_EVENT, ());
        return;
    }

    pty_commands::kill_all_for_window(&pty_state, &registry, window.label());

    // For a window that was deferred above, use the quitting-state captured
    // back then, not the global flag's current value — it may have just been
    // cleared by a sibling window's own, unrelated deferral. Everything else
    // (nothing was ever running, so it never went through the gate) still
    // reads the flag live, exactly as before this confirmation step existed.
    let is_quitting_close = deferred_quit
        .recall(window.label())
        .unwrap_or_else(|| quitting_flag.is_set());
    if is_quitting_close {
        return;
    }
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    if let Some(mut state) = session_store::read_session(&dir) {
        state.windows.retain(|w| w.label != window.label());
        let _ = session_store::write_session(&dir, &state);
    }

    // Settings/About never destroy themselves on close — `settings_window.rs`/
    // `about.rs` intercept `CloseRequested` and only `hide()`, precisely so
    // reopening them is instant instead of a full WKWebView+React cold start.
    // That means tao's own window map never empties out while either of them
    // exists, so its "last window destroyed → fire ExitRequested" check
    // (`tauri-runtime-wry`) never fires on its own once every PANE window is
    // gone — the app was found sitting orphaned in the Dock with zero visible
    // windows (2026-08-14 report: Settings left open, then main pane window
    // closed). PaneCrew is a single-purpose grid tool, not a document app, so
    // "no more pane windows" should mean "fully quit", utility windows
    // notwithstanding — checked and triggered explicitly here since tao can't
    // know the difference between a pane and a utility window on its own.
    let other_pane_windows_remain = app.webview_windows().keys().any(|label| {
        let label = label.as_str();
        label != window.label() && (label == MAIN || label.starts_with(SECONDARY_LABEL_PREFIX))
    });
    if !other_pane_windows_remain {
        app.exit(0);
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
    use super::{new_window_label, window_entries, ConfirmedCloseWindows, DeferredQuitState, MAIN};
    use std::collections::BTreeSet;

    /// `WindowEvent::CloseRequested`'s `api` can only be constructed by the
    /// tauri runtime itself (`CloseRequestApi`'s inner `Sender` is crate-
    /// private), so `on_window_event`'s branching can't be driven end-to-end
    /// from this crate's own tests — this pins the state machine it leans on
    /// instead: ask once, then let the confirmed retry straight through.
    #[test]
    fn confirmed_close_is_asked_once_then_consumed() {
        let confirmed = ConfirmedCloseWindows::default();
        assert!(!confirmed.take("main"), "nothing marked yet");

        confirmed.mark("main");
        assert!(confirmed.take("main"), "marked window must be consumed");
        assert!(
            !confirmed.take("main"),
            "a second close of the same window must ask again"
        );
    }

    /// Two windows track their confirmation independently — confirming one
    /// must not silently wave the other through.
    #[test]
    fn confirmed_close_does_not_leak_across_windows() {
        let confirmed = ConfirmedCloseWindows::default();
        confirmed.mark("main");
        assert!(!confirmed.take("main-other"));
        assert!(confirmed.take("main"));
    }

    /// Pins the exact bug a cancelled Cmd+Q used to reintroduce: without
    /// remembering the quitting-state at defer time, a window that answers
    /// "close anyway" after the *global* flag was already cleared (by its own
    /// earlier deferral, or a sibling's) would misread itself as a plain
    /// standalone close and drop its `session.json` entry instead of
    /// preserving it for the next launch's restore.
    #[test]
    fn deferred_quit_state_survives_the_global_flag_being_cleared_in_between() {
        let deferred = DeferredQuitState::default();
        assert_eq!(deferred.recall("main"), None, "nothing deferred yet");

        // Simulates: CloseRequested arrives while QuittingFlag is set (a real
        // Cmd+Q), gets halted for confirmation, and the global flag is
        // cleared right after — exactly what `on_window_event` does.
        deferred.remember("main", true);

        // A wholly unrelated window's own close (or a second read before the
        // retry) must not see this window's remembered state.
        assert_eq!(deferred.recall("main-other"), None);

        // The confirmed retry recalls the ORIGINAL quitting-state, not
        // whatever the global flag reads by now.
        assert_eq!(deferred.recall("main"), Some(true));
        assert_eq!(
            deferred.recall("main"),
            None,
            "a second recall must not still see the first deferral"
        );
    }

    /// `window_entries` on a freshly built mock app with no windows of its
    /// own: `mock_builder().build(...)` still creates zero windows, so this
    /// pins the empty case rather than assuming it from reading the code.
    #[test]
    fn no_windows_yields_no_entries() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app should build");
        assert_eq!(window_entries(app.handle()), Vec::new());
    }

    /// `"main"` sorts first purely from the label scheme (it is a strict
    /// prefix of every `"main-<nanoid>"` secondary label, and a prefix always
    /// sorts before the string it prefixes) and gets the plain "PaneCrew"
    /// title; secondary windows are numbered from the sorted position, not
    /// creation order — this is the part `window_entries` actually computes,
    /// as opposed to just forwarding `webview_windows()`.
    #[test]
    fn main_sorts_first_and_secondary_windows_are_numbered_by_label_order() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app should build");
        for label in ["main-zzz", MAIN, "main-aaa"] {
            tauri::WebviewWindowBuilder::new(
                &app,
                label,
                tauri::WebviewUrl::App("index.html".into()),
            )
            .build()
            .unwrap_or_else(|error| panic!("building window {label:?} should succeed: {error}"));
        }

        let entries = window_entries(app.handle());
        let labels: Vec<&str> = entries.iter().map(|(label, _, _)| label.as_str()).collect();
        assert_eq!(labels, vec![MAIN, "main-aaa", "main-zzz"]);

        let titles: Vec<&str> = entries.iter().map(|(_, title, _)| title.as_str()).collect();
        assert_eq!(
            titles,
            vec!["PaneCrew", "PaneCrew — Fenster 2", "PaneCrew — Fenster 3"]
        );
    }

    /// Utility windows (about/settings) must not pollute the "Fenster"/dock
    /// list — `is_content_window` is meant to filter exactly these out.
    #[test]
    fn non_content_windows_are_excluded() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app should build");
        for label in [MAIN, "about", "settings"] {
            tauri::WebviewWindowBuilder::new(
                &app,
                label,
                tauri::WebviewUrl::App("index.html".into()),
            )
            .build()
            .unwrap_or_else(|error| panic!("building window {label:?} should succeed: {error}"));
        }

        let labels: Vec<String> = window_entries(app.handle())
            .into_iter()
            .map(|(label, _, _)| label)
            .collect();
        assert_eq!(labels, vec![MAIN.to_string()]);
    }

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
