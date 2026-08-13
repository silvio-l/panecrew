//! Extension configuration contribution (ticket 08): parses a
//! `contributes.configuration.properties` block — the same VS Code-shaped brandlint-ok: funktionaler Formatvergleich, kein Marketing
//! object VS Code's own `package.json` uses (a map keyed by the FULL, brandlint-ok: funktionaler Formatvergleich, kein Marketing
//! author-written setting id, e.g. `"my-extension.retryCount"`) — into
//! `ConfigRegistry` entries, plus the runtime read/write permission gate for
//! an extension's own settings namespace.
//!
//! No Deno extension host exists yet (its own, much larger effort) — this
//! module is deliberately data-only and tested against synthetic manifests,
//! per the ticket's own scope. The two pieces here are exactly what such a
//! host would call: once at load time (`register_contributed_settings`) and
//! on every runtime config read/write an extension attempts
//! (`extension_may_read`/`extension_may_write`).

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::config_registry::{ConfigRegistry, Description, RegistrationError, SchemaEntry, SettingType, Source};

/// One property of `contributes.configuration.properties`, VS Code's own brandlint-ok: funktionaler Formatvergleich, kein Marketing
/// shape. `enum` (if present) makes the setting an `Enum`, regardless of
/// `value_type` — the same convention VS Code itself uses (`enum` normally brandlint-ok: funktionaler Formatvergleich, kein Marketing
/// pairs with `"type": "string"`).
#[derive(Debug, Deserialize)]
pub struct ConfigurationProperty {
    #[serde(rename = "type")]
    pub value_type: ConfigurationValueType,
    pub default: serde_json::Value,
    pub description: String,
    #[serde(default)]
    pub r#enum: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConfigurationValueType {
    String,
    Number,
    Boolean,
}

/// `contributes.configuration.properties` — a `BTreeMap` (not `HashMap`) so
/// registration order is deterministic, matching `ConfigRegistry::schema()`'s
/// own "registration order" documentation and keeping test assertions on
/// registered-key order stable.
pub type ConfigurationContribution = BTreeMap<String, ConfigurationProperty>;

fn to_setting_type(property: &ConfigurationProperty) -> SettingType {
    match &property.r#enum {
        Some(options) => SettingType::Enum(options.clone()),
        None => match property.value_type {
            ConfigurationValueType::String => SettingType::String,
            ConfigurationValueType::Number => SettingType::Number,
            ConfigurationValueType::Boolean => SettingType::Boolean,
        },
    }
}

/// Registers every property of a manifest's `contributes.configuration` under
/// `extension_id`'s namespace — through the exact same public
/// `ConfigRegistry::register` Core settings go through (`config_core.rs`),
/// so an extension gets no privileged path and no special-cased validation.
/// Declaring this block requires no permission grant (story 29): it's pure
/// data, no code runs to produce it.
///
/// Stages every entry on a scratch copy of `registry` first and only
/// commits that copy back if every single one registers cleanly — a config
/// contribution never becomes "half wired in": one rejected entry (namespace
/// squat or duplicate key) means NONE of the manifest's entries end up
/// registered, not just the ones after the failure. Keys are staged in
/// `BTreeMap` (sorted) order, so which specific entry a synthetic test
/// expects to fail is deterministic.
pub fn register_contributed_settings(
    registry: &mut ConfigRegistry,
    extension_id: &str,
    contribution: &ConfigurationContribution,
) -> Result<(), RegistrationError> {
    let mut staged = registry.clone();
    for (key, property) in contribution {
        let entry = SchemaEntry {
            key: key.clone(),
            setting_type: to_setting_type(property),
            default: property.default.clone(),
            description: Description::Literal(property.description.clone()),
            source: Source::Extension(extension_id.to_string()),
        };
        staged.register(entry)?;
    }
    *registry = staged;
    Ok(())
}

fn key_belongs_to(extension_id: &str, key: &str) -> bool {
    key.starts_with(&format!("{extension_id}."))
}

/// Whether `extension_id` may read `key`'s resolved value at runtime: it
/// must hold `read:config` AND `key` must fall under its own namespace.
/// Holding the right never grants access to Core or another extension's
/// keys (story 32) — there is no separate check for that elsewhere, this
/// function IS the whole gate a future host command handler calls.
pub fn extension_may_read(extension_id: &str, granted_rights: &[String], key: &str) -> bool {
    granted_rights.iter().any(|right| right == "read:config") && key_belongs_to(extension_id, key)
}

/// Same as `extension_may_read`, gated on `write:config` instead.
pub fn extension_may_write(extension_id: &str, granted_rights: &[String], key: &str) -> bool {
    granted_rights.iter().any(|right| right == "write:config") && key_belongs_to(extension_id, key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manifest(json_str: &str) -> ConfigurationContribution {
        serde_json::from_str(json_str).expect("synthetic manifest fixture should parse")
    }

    #[test]
    fn a_valid_manifest_registers_its_entries_under_the_extension_namespace() {
        let mut registry = ConfigRegistry::new();
        let contribution = manifest(
            r#"{
                "my-extension.retryCount": { "type": "number", "default": 3, "description": "How many times to retry." },
                "my-extension.mode": { "type": "string", "default": "fast", "description": "Mode.", "enum": ["fast", "accurate"] }
            }"#,
        );

        register_contributed_settings(&mut registry, "my-extension", &contribution)
            .expect("well-namespaced manifest should register cleanly");

        let retry = registry.find("my-extension.retryCount").expect("should be registered");
        assert_eq!(retry.setting_type, SettingType::Number);
        assert_eq!(retry.default, json!(3));
        assert_eq!(retry.source, Source::Extension("my-extension".to_string()));

        let mode = registry.find("my-extension.mode").expect("should be registered");
        assert_eq!(
            mode.setting_type,
            SettingType::Enum(vec!["fast".to_string(), "accurate".to_string()])
        );
    }

    #[test]
    fn a_key_not_namespaced_under_its_own_extension_id_is_rejected_outright() {
        let mut registry = ConfigRegistry::new();
        let contribution = manifest(
            r#"{ "someone-elses-key": { "type": "string", "default": "x", "description": "d" } }"#,
        );

        let result = register_contributed_settings(&mut registry, "my-extension", &contribution);

        assert_eq!(
            result,
            Err(RegistrationError::InvalidNamespace("someone-elses-key".to_string()))
        );
        assert!(
            registry.schema().is_empty(),
            "nothing from a rejected manifest should be registered"
        );
    }

    /// The scenario ticket 02 already proved at the registry level, now
    /// proven reachable through manifest parsing: an extension cannot squat
    /// a CORE namespace either, not just another extension's.
    #[test]
    fn a_manifest_attempting_to_squat_a_core_namespace_is_rejected() {
        let mut registry = ConfigRegistry::new();
        let contribution = manifest(
            r#"{ "terminal.shell": { "type": "string", "default": "/bin/zsh", "description": "d" } }"#,
        );

        let result = register_contributed_settings(&mut registry, "not-terminal", &contribution);

        assert_eq!(
            result,
            Err(RegistrationError::InvalidNamespace("terminal.shell".to_string()))
        );
    }

    /// The harder squat: an extension literally naming ITSELF `terminal` —
    /// its own id IS the prefix its keys use, so the plain namespace-format
    /// check alone would let this through. Requires Core to have registered
    /// `terminal.*` first, which `config_core.rs` always does before any
    /// extension loads.
    #[test]
    fn a_manifest_from_an_extension_literally_named_after_a_core_category_is_rejected() {
        let mut registry = ConfigRegistry::new();
        registry
            .register(crate::config_registry::SchemaEntry {
                key: "terminal.shell".to_string(),
                setting_type: SettingType::String,
                default: json!("/bin/zsh"),
                description: crate::config_registry::Description::I18nKey(
                    "settings.terminal.shell.description".to_string(),
                ),
                source: crate::config_registry::Source::Core,
            })
            .expect("core registration should succeed");
        let contribution = manifest(
            r#"{ "terminal.newSetting": { "type": "string", "default": "evil", "description": "d" } }"#,
        );

        let result = register_contributed_settings(&mut registry, "terminal", &contribution);

        assert_eq!(
            result,
            Err(RegistrationError::InvalidNamespace("terminal.newSetting".to_string()))
        );
        assert!(registry.find("terminal.newSetting").is_none());
    }

    #[test]
    fn a_partially_invalid_manifest_registers_nothing_at_all() {
        let mut registry = ConfigRegistry::new();
        let contribution = manifest(
            r#"{
                "my-extension.valid": { "type": "boolean", "default": true, "description": "d" },
                "someone-elses.invalid": { "type": "boolean", "default": true, "description": "d" }
            }"#,
        );

        let result = register_contributed_settings(&mut registry, "my-extension", &contribution);

        assert!(result.is_err());
        assert!(
            registry.find("my-extension.valid").is_none(),
            "a manifest is all-or-nothing — the valid entry before the rejected one must not survive either"
        );
    }

    #[test]
    fn declaring_configuration_alone_requires_no_permission_entry() {
        // Story 29: registration takes no `granted_rights` parameter at
        // all — there is nothing to check, by construction, for pure
        // declaration.
        let mut registry = ConfigRegistry::new();
        let contribution = manifest(
            r#"{ "my-extension.setting": { "type": "boolean", "default": true, "description": "d" } }"#,
        );

        assert!(register_contributed_settings(&mut registry, "my-extension", &contribution).is_ok());
    }

    #[test]
    fn reading_its_own_setting_requires_the_read_config_right() {
        assert!(!extension_may_read("my-extension", &[], "my-extension.retryCount"));
        assert!(extension_may_read(
            "my-extension",
            &["read:config".to_string()],
            "my-extension.retryCount"
        ));
    }

    #[test]
    fn writing_its_own_setting_requires_the_write_config_right() {
        assert!(!extension_may_write("my-extension", &[], "my-extension.retryCount"));
        assert!(extension_may_write(
            "my-extension",
            &["write:config".to_string()],
            "my-extension.retryCount"
        ));
    }

    #[test]
    fn holding_read_config_never_grants_access_to_a_core_setting() {
        let rights = vec!["read:config".to_string()];

        assert!(!extension_may_read("my-extension", &rights, "terminal.shell"));
    }

    #[test]
    fn holding_write_config_never_grants_access_to_another_extensions_setting() {
        let rights = vec!["write:config".to_string()];

        assert!(!extension_may_write("my-extension", &rights, "other-extension.setting"));
    }

    #[test]
    fn holding_only_read_config_does_not_also_grant_write() {
        let rights = vec!["read:config".to_string()];

        assert!(!extension_may_write("my-extension", &rights, "my-extension.setting"));
    }
}
