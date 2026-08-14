//! Thin Tauri-command wrappers over `config_registry` + `settings_store` —
//! same shape as `pty_commands.rs` over `pty_manager`: validate, delegate,
//! emit. No lifecycle/business logic lives here.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::config_registry::{ConfigRegistry, Description, SettingType, Source};
use crate::settings_store;

pub struct ConfigRegistryState(pub Mutex<ConfigRegistry>);

/// Emitted to every open window (not just the settings window) whenever a
/// value changes, so main/about/settings can all live-reload theme and other
/// immediate-effect settings together (ticket 05).
const CHANGED_EVENT: &str = "settings:changed";

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SettingTypeDto {
    String,
    Number,
    Boolean,
    Enum { options: Vec<String> },
}

impl From<&SettingType> for SettingTypeDto {
    fn from(value: &SettingType) -> Self {
        match value {
            SettingType::String => SettingTypeDto::String,
            SettingType::Number => SettingTypeDto::Number,
            SettingType::Boolean => SettingTypeDto::Boolean,
            SettingType::Enum(options) => SettingTypeDto::Enum {
                options: options.clone(),
            },
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DescriptionDto {
    I18nKey { key: String },
    Literal { text: String },
}

impl From<&Description> for DescriptionDto {
    fn from(value: &Description) -> Self {
        match value {
            Description::I18nKey(key) => DescriptionDto::I18nKey { key: key.clone() },
            Description::Literal(text) => DescriptionDto::Literal { text: text.clone() },
        }
    }
}

#[derive(Serialize, Clone)]
pub struct SchemaEntryDto {
    key: String,
    #[serde(rename = "type")]
    setting_type: SettingTypeDto,
    default: serde_json::Value,
    description: DescriptionDto,
    /// The key's leading segment (`"terminal"` for `terminal.shell`,
    /// `"my-extension"` for `my-extension.retryCount`) — the grouping the
    /// editor's category tree renders on (ticket 04/09).
    category: String,
    source: String,
}

fn category_of(key: &str) -> String {
    key.split('.').next().unwrap_or(key).to_string()
}

fn to_dto(entry: &crate::config_registry::SchemaEntry) -> SchemaEntryDto {
    SchemaEntryDto {
        key: entry.key.clone(),
        setting_type: (&entry.setting_type).into(),
        default: entry.default.clone(),
        description: (&entry.description).into(),
        category: category_of(&entry.key),
        source: match &entry.source {
            Source::Core => "core".to_string(),
            Source::Extension(id) => id.clone(),
        },
    }
}

pub(crate) fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Anwendungsverzeichnis nicht verfügbar: {error}"))
}

/// `value: None` (used for the "*" bulk key the raw-JSON save path emits)
/// tells every listener to reload the whole resolved-values map; a concrete
/// key+value lets a listener update just that one entry without a round
/// trip back through `settings_get_values` — the payload carries the new
/// truth itself instead of just announcing that truth changed.
#[derive(Serialize, Clone)]
struct ChangedPayload {
    key: String,
    value: Option<serde_json::Value>,
}

fn emit_changed(app: &AppHandle, key: &str, value: Option<serde_json::Value>) {
    let payload = ChangedPayload {
        key: key.to_string(),
        value,
    };
    if let Err(error) = app.emit(CHANGED_EVENT, payload) {
        eprintln!("PaneCrew: settings:changed konnte nicht gesendet werden: {error}");
    }
}

#[tauri::command]
pub fn settings_get_schema(registry: State<ConfigRegistryState>) -> Vec<SchemaEntryDto> {
    let registry = registry.0.lock().expect("config registry poisoned");
    registry.schema().iter().map(to_dto).collect()
}

// `async`: file I/O must not run on the thread that dispatches IPC, same
// reasoning as every other file-touching command in this codebase
// (`explorer_fs.rs::explorer_read_tree`, `session_store::session_load`).
#[tauri::command(async)]
pub fn settings_get_values(
    app: AppHandle,
    registry: State<ConfigRegistryState>,
) -> Result<HashMap<String, serde_json::Value>, String> {
    let dir = app_data_dir(&app)?;
    let overrides = settings_store::load_overrides(&dir);
    let registry = registry.0.lock().expect("config registry poisoned");
    Ok(registry.resolve(&overrides))
}

#[tauri::command(async)]
pub fn settings_set_value(
    app: AppHandle,
    registry: State<ConfigRegistryState>,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    {
        let registry = registry.0.lock().expect("config registry poisoned");
        let entry = registry
            .find(&key)
            .ok_or_else(|| format!("Unbekanntes Setting: {key}"))?;
        crate::config_registry::validate_value(entry, &value)
            .map_err(|error| format!("Ungültiger Wert für {key}: {error:?}"))?;
    }
    let dir = app_data_dir(&app)?;
    settings_store::set_override(&dir, &key, value.clone())?;
    emit_changed(&app, &key, Some(value));
    Ok(())
}

#[tauri::command(async)]
pub fn settings_reset_value(
    app: AppHandle,
    registry: State<ConfigRegistryState>,
    key: String,
) -> Result<(), String> {
    let default = {
        let registry = registry.0.lock().expect("config registry poisoned");
        registry
            .find(&key)
            .ok_or_else(|| format!("Unbekanntes Setting: {key}"))?
            .default
            .clone()
    };
    let dir = app_data_dir(&app)?;
    settings_store::remove_override(&dir, &key)?;
    emit_changed(&app, &key, Some(default));
    Ok(())
}

/// The raw text of `settings.json`, for the JSON-mode editor (ticket 07).
#[tauri::command(async)]
pub fn settings_read_raw(app: AppHandle) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    Ok(settings_store::read_raw(&dir))
}

/// Parses `raw` as a JSON object and validates every key against the
/// registry's schema, without touching disk — factored out of
/// `settings_write_raw` so the validation itself is unit-testable without a
/// running Tauri app (same reasoning as `pty_commands::resolve_shell`).
/// Ticket 07's "never silently overwrite the last-good `settings.json`"
/// guarantee falls directly out of the calling order in
/// `settings_write_raw`: nothing reaches `settings_store::write_overrides`
/// unless this returns `Ok`.
fn parse_and_validate_raw(registry: &ConfigRegistry, raw: &str) -> Result<settings_store::Overrides, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(raw).map_err(|error| format!("Ungültiges JSON: {error}"))?;
    let overrides = parsed
        .as_object()
        .cloned()
        .ok_or_else(|| "settings.json muss ein JSON-Objekt sein".to_string())?;

    for (key, value) in &overrides {
        let entry = registry
            .find(key)
            .ok_or_else(|| format!("Unbekanntes Setting: {key}"))?;
        crate::config_registry::validate_value(entry, value)
            .map_err(|error| format!("Ungültiger Wert für {key}: {error:?}"))?;
    }

    Ok(overrides)
}

/// Validates the whole parsed overlay against the schema before persisting —
/// the raw-JSON mode's save path (ticket 07). A single invalid key fails the
/// whole save; `settings.json` on disk is never touched on failure.
#[tauri::command(async)]
pub fn settings_write_raw(
    app: AppHandle,
    registry: State<ConfigRegistryState>,
    raw: String,
) -> Result<(), String> {
    let overrides = {
        let registry = registry.0.lock().expect("config registry poisoned");
        parse_and_validate_raw(&registry, &raw)?
    };

    let dir = app_data_dir(&app)?;
    settings_store::write_overrides(&dir, &overrides)?;
    emit_changed(&app, "*", None);
    Ok(())
}

/// `window` is auto-injected by Tauri as the IPC caller's own window (Tauri 2
/// resolves any `Window`/`WebviewWindow`-typed command parameter this way) —
/// needed so `settings_window::show` can center the Settings window over
/// whichever window/monitor the user actually clicked the gear icon in,
/// instead of always the primary monitor (2026-08-14 multi-monitor report).
#[tauri::command]
pub fn settings_open_window(app: AppHandle, window: tauri::Window) {
    crate::settings_window::show(&app, &window);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config_core::register_core_settings;

    fn registry_with_core_settings() -> ConfigRegistry {
        let mut registry = ConfigRegistry::new();
        register_core_settings(&mut registry).expect("core settings should register cleanly");
        registry
    }

    #[test]
    fn syntactically_invalid_json_is_rejected_with_a_clear_error() {
        let registry = registry_with_core_settings();

        let result = parse_and_validate_raw(&registry, "{ not valid json");

        assert!(result.is_err());
    }

    #[test]
    fn a_top_level_value_that_is_not_an_object_is_rejected() {
        let registry = registry_with_core_settings();

        let result = parse_and_validate_raw(&registry, "[1, 2, 3]");

        assert!(result.is_err());
    }

    #[test]
    fn an_unregistered_key_is_rejected() {
        let registry = registry_with_core_settings();

        let result = parse_and_validate_raw(&registry, r#"{"not.a.real.setting": true}"#);

        assert!(result.is_err());
    }

    #[test]
    fn a_value_of_the_wrong_type_for_its_setting_is_rejected() {
        let registry = registry_with_core_settings();

        // `terminal.fontSize` is `Number` — a string here must fail, not
        // silently coerce.
        let result = parse_and_validate_raw(&registry, r#"{"terminal.fontSize": "not a number"}"#);

        assert!(result.is_err());
    }

    #[test]
    fn an_enum_value_outside_its_declared_options_is_rejected() {
        let registry = registry_with_core_settings();

        let result = parse_and_validate_raw(&registry, r#"{"appearance.theme": "solarized"}"#);

        assert!(result.is_err());
    }

    #[test]
    fn valid_type_matching_overrides_are_accepted_and_returned_unchanged() {
        let registry = registry_with_core_settings();
        let raw = r#"{"terminal.shell": "/bin/fish", "appearance.theme": "dark"}"#;

        let overrides = parse_and_validate_raw(&registry, raw).expect("should validate cleanly");

        assert_eq!(
            overrides.get("terminal.shell"),
            Some(&serde_json::json!("/bin/fish"))
        );
        assert_eq!(
            overrides.get("appearance.theme"),
            Some(&serde_json::json!("dark"))
        );
    }

    #[test]
    fn an_empty_object_validates_as_zero_overrides() {
        let registry = registry_with_core_settings();

        let overrides = parse_and_validate_raw(&registry, "{}").expect("should validate cleanly");

        assert!(overrides.is_empty());
    }
}
