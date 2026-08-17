//! Generic, topic-keyed pub/sub for state that lives only in a window's own
//! frontend memory (React state that is never persisted or otherwise known
//! to Rust) and that another window's frontend wants to read anyway — e.g.
//! `resourceUsageTree.ts`'s pane/tab structure for the title-bar resource
//! popover. Deliberately minimal: one store, one publish command, one
//! snapshot command, one change event, one removal event. No per-topic
//! schema, no request/reply — any feature needing this reaches for the same
//! three primitives instead of inventing its own event pair.
//!
//! Origin is always the PUBLISHING window's own `Window::label()`, read
//! server-side from the command's injected `Window` argument — never a
//! caller-supplied field — the same discipline `WindowPtyRegistry`
//! (`pty_commands.rs`) already uses for `tab_id` -> window ownership, so a
//! window can't spoof another window's entry.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Window};

pub const CHANGED_EVENT: &str = "window-state:changed";
pub const REMOVED_EVENT: &str = "window-state:removed";

/// `window_label -> topic -> value`. Values are opaque JSON — this module
/// only ever moves them, never interprets them.
#[derive(Default)]
pub struct WindowStateStore(Mutex<HashMap<String, HashMap<String, serde_json::Value>>>);

#[derive(Clone, Serialize)]
struct ChangedPayload {
    #[serde(rename = "windowLabel")]
    window_label: String,
    topic: String,
    value: serde_json::Value,
}

#[derive(Clone, Serialize)]
struct RemovedPayload {
    #[serde(rename = "windowLabel")]
    window_label: String,
}

/// Publishes `value` under `topic` as this window's entry, replacing
/// whatever it previously published under the same topic, then broadcasts
/// the new value to every window (itself included — consumers filter their
/// own label out at the call site when that matters, e.g. the resource
/// popover's own window already has this data locally and skips it).
#[tauri::command]
pub fn window_state_publish<R: Runtime>(
    window: Window<R>,
    store: State<WindowStateStore>,
    topic: String,
    value: serde_json::Value,
) {
    let window_label = window.label().to_string();
    store
        .0
        .lock()
        .unwrap()
        .entry(window_label.clone())
        .or_default()
        .insert(topic.clone(), value.clone());

    let payload = ChangedPayload {
        window_label,
        topic,
        value,
    };
    if let Err(error) = window.app_handle().emit(CHANGED_EVENT, payload) {
        eprintln!("PaneCrew: window-state:changed konnte nicht gesendet werden: {error}");
    }
}

/// Every window's currently published value for `topic`, for a just-mounted
/// consumer to catch up on entries published before it started listening —
/// the change event alone only reaches listeners registered before a given
/// publish. Split from the `#[tauri::command]` wrapper below so it's
/// unit-testable without constructing a `State<'_, _>` by hand (same
/// reasoning as `pty_commands.rs`'s `kill_all_for_window`).
fn snapshot_topic(store: &WindowStateStore, topic: &str) -> HashMap<String, serde_json::Value> {
    store
        .0
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(window_label, topics)| {
            topics
                .get(topic)
                .map(|value| (window_label.clone(), value.clone()))
        })
        .collect()
}

#[tauri::command]
pub fn window_state_snapshot(
    store: State<WindowStateStore>,
    topic: String,
) -> HashMap<String, serde_json::Value> {
    snapshot_topic(&store, &topic)
}

/// Drops every topic `window_label` ever published and tells the other
/// windows, so a closed window's entries don't linger in their consumers
/// forever. Called from `windows.rs`'s `on_window_event`, at the same spot
/// as `pty_commands::kill_all_for_window` — after the active-session
/// confirmation gate has let the close through, before the quitting-close
/// early return, so it runs exactly once per real close and never on a
/// halted-then-cancelled one.
pub fn remove_window<R: Runtime>(app: &AppHandle<R>, store: &WindowStateStore, window_label: &str) {
    let had_entries = store.0.lock().unwrap().remove(window_label).is_some();
    if !had_entries {
        return;
    }
    let payload = RemovedPayload {
        window_label: window_label.to_string(),
    };
    if let Err(error) = app.emit(REMOVED_EVENT, payload) {
        eprintln!("PaneCrew: window-state:removed konnte nicht gesendet werden: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_only_returns_entries_for_the_requested_topic() {
        let store = WindowStateStore::default();
        {
            let mut map = store.0.lock().unwrap();
            map.entry("win-a".into())
                .or_default()
                .insert("pane-tree".into(), serde_json::json!(["a"]));
            map.entry("win-a".into())
                .or_default()
                .insert("other-topic".into(), serde_json::json!("irrelevant"));
            map.entry("win-b".into())
                .or_default()
                .insert("pane-tree".into(), serde_json::json!(["b"]));
        }

        let snapshot = snapshot_topic(&store, "pane-tree");
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot["win-a"], serde_json::json!(["a"]));
        assert_eq!(snapshot["win-b"], serde_json::json!(["b"]));
    }

    /// `remove_window` (the function `windows.rs`'s `on_window_event` calls
    /// on an actual close) must drop only the closed window's own entries,
    /// leaving every other window's published topics untouched.
    #[test]
    fn remove_window_drops_only_that_windows_entries() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app should build");
        let store = WindowStateStore::default();
        {
            let mut map = store.0.lock().unwrap();
            map.entry("win-a".into())
                .or_default()
                .insert("pane-tree".into(), serde_json::json!(["a"]));
            map.entry("win-b".into())
                .or_default()
                .insert("pane-tree".into(), serde_json::json!(["b"]));
        }

        remove_window(app.handle(), &store, "win-a");

        let snapshot = snapshot_topic(&store, "pane-tree");
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot["win-b"], serde_json::json!(["b"]));
    }

    /// A window with nothing published yet is a no-op, not a panic or a
    /// spurious broadcast — `remove_window`'s `had_entries` guard is what
    /// this pins.
    #[test]
    fn remove_window_on_a_window_with_no_entries_is_a_no_op() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app should build");
        let store = WindowStateStore::default();
        store
            .0
            .lock()
            .unwrap()
            .entry("win-a".into())
            .or_default()
            .insert("pane-tree".into(), serde_json::json!(["a"]));

        remove_window(app.handle(), &store, "win-never-published");

        let snapshot = snapshot_topic(&store, "pane-tree");
        assert_eq!(snapshot.len(), 1);
    }
}
