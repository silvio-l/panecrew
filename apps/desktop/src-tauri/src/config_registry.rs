//! The configuration registry: the single source of truth for what's
//! configurable and what its current value is. Plain Rust, no Tauri types —
//! callable and testable directly, independent of the `Mutex`-wrapped Tauri
//! managed state it's held behind at the command layer (`settings_commands.rs`,
//! ticket 03).
//!
//! Core settings (`config_core.rs`) and a future extension's
//! `contributes.configuration` (`config_manifest.rs`) register through the
//! exact same public API here — there is no privileged, Core-only
//! registration path.

use std::collections::HashMap;

/// Where a schema entry came from. `Core` keys are registered directly under
/// their own dotted path (`terminal.shell`); anything else must be an
/// extension ID whose keys are namespaced under it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Source {
    Core,
    Extension(String),
}

/// A setting's value shape. `Enum`'s variants are the only values
/// `validate_value` accepts for that entry — this is deliberately smaller
/// than a general JSON-Schema type system (no arrays/objects), matching the
/// spec's `type`/`default`/`description`/`enum` scope.
#[derive(Clone, Debug, PartialEq)]
pub enum SettingType {
    String,
    Number,
    Boolean,
    Enum(Vec<String>),
}

/// A setting's human-readable description. Core settings carry an i18n key
/// resolved frontend-side through `react-i18next` (this project's
/// ESLint-enforced rule: no hardcoded UI strings) — the registry itself never
/// renders text, so it never needs the resolved value. An extension manifest
/// cannot ship into this app's locale bundles, so its own settings carry a
/// literal string instead.
#[derive(Clone, Debug, PartialEq)]
pub enum Description {
    I18nKey(String),
    Literal(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct SchemaEntry {
    /// Fully namespaced key: `terminal.shell` for Core, `<extensionId>.<key>`
    /// for an extension.
    pub key: String,
    pub setting_type: SettingType,
    pub default: serde_json::Value,
    pub description: Description,
    pub source: Source,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RegistrationError {
    /// Key already registered (by any source, including the same one).
    DuplicateKey(String),
    /// A non-Core registration whose key isn't `<extensionId>.<rest>`, or a
    /// key that collides with another source's namespace — including an
    /// attempt to squat a Core namespace like `terminal.*`.
    InvalidNamespace(String),
}

impl std::fmt::Display for RegistrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RegistrationError::DuplicateKey(key) => {
                write!(f, "Setting-Key bereits registriert: {key}")
            }
            RegistrationError::InvalidNamespace(key) => {
                write!(f, "Setting-Key nicht korrekt namespaced: {key}")
            }
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum ValidationError {
    WrongType { expected: SettingType },
    NotAnEnumMember { allowed: Vec<String> },
}

/// Ordered by registration so the editor (ticket 04) can render a stable,
/// predictable category/tree order instead of a HashMap's arbitrary one.
/// `Clone`: lets `config_manifest.rs` stage a whole manifest's entries on a
/// scratch copy and only commit it if every entry registers cleanly.
///
/// `index` mirrors `entries` as key→position, so key lookup (`find`, and the
/// duplicate-key check in `register`) is O(1) instead of an O(n) scan —
/// relevant once extensions start registering their own settings keys
/// (ticket 13). `entries` stays the ordering source of truth; `index` is
/// purely a derived accelerator kept in lockstep on every insert.
#[derive(Default, Clone)]
pub struct ConfigRegistry {
    entries: Vec<SchemaEntry>,
    index: HashMap<String, usize>,
}

impl ConfigRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers one schema entry. `Core` keys are trusted as-is (this is
    /// still the one public path, just called by `config_core.rs` with a
    /// fixed `Source::Core`, same as `config_manifest.rs` calls it per
    /// extension). Any other source's key must start with
    /// `"<extension-id>."` — enforced here, not left to callers, so a
    /// mistake in a future extension's manifest parsing can never let it
    /// squat another namespace.
    pub fn register(&mut self, entry: SchemaEntry) -> Result<(), RegistrationError> {
        if let Source::Extension(id) = &entry.source {
            let prefix = format!("{id}.");
            if id.is_empty() || !entry.key.starts_with(&prefix) || entry.key == prefix {
                return Err(RegistrationError::InvalidNamespace(entry.key));
            }
            // An extension literally naming itself after an existing Core
            // category (e.g. `id == "terminal"`) would otherwise pass the
            // prefix check above for ANY key under that category, not just
            // the one that happens to collide on `DuplicateKey` — so the
            // squat has to be caught by category, not by exact key.
            let squats_core_namespace = self.entries.iter().any(|existing| {
                existing.source == Source::Core && existing.key.split('.').next() == Some(id.as_str())
            });
            if squats_core_namespace {
                return Err(RegistrationError::InvalidNamespace(entry.key));
            }
        }
        if self.index.contains_key(&entry.key) {
            return Err(RegistrationError::DuplicateKey(entry.key));
        }
        let position = self.entries.len();
        self.index.insert(entry.key.clone(), position);
        self.entries.push(entry);
        Ok(())
    }

    /// Schema in registration order — Core categories first (as
    /// `config_core.rs` registers them), then whatever extensions have
    /// registered since.
    pub fn schema(&self) -> &[SchemaEntry] {
        &self.entries
    }

    pub fn find(&self, key: &str) -> Option<&SchemaEntry> {
        self.index.get(key).map(|&position| &self.entries[position])
    }

    /// Registered default merged with `overrides` — an override wins,
    /// missing key falls back to the schema default. `overrides` is
    /// `settings.json`'s parsed content, handed in by the caller
    /// (`settings_store.rs`/`settings_commands.rs`) rather than owned here:
    /// this function stays pure and independent of any file I/O.
    pub fn resolve(
        &self,
        overrides: &serde_json::Map<String, serde_json::Value>,
    ) -> HashMap<String, serde_json::Value> {
        self.entries
            .iter()
            .map(|entry| {
                let value = overrides
                    .get(&entry.key)
                    .cloned()
                    .unwrap_or_else(|| entry.default.clone());
                (entry.key.clone(), value)
            })
            .collect()
    }
}

/// Checks `value` against `entry`'s declared type — used before persisting a
/// value through the command layer (ticket 03) and before accepting a raw-JSON
/// edit (ticket 07), so a broken write can never reach `settings.json`.
pub fn validate_value(
    entry: &SchemaEntry,
    value: &serde_json::Value,
) -> Result<(), ValidationError> {
    match &entry.setting_type {
        SettingType::String => {
            if value.is_string() {
                Ok(())
            } else {
                Err(ValidationError::WrongType {
                    expected: SettingType::String,
                })
            }
        }
        SettingType::Number => {
            if value.is_number() {
                Ok(())
            } else {
                Err(ValidationError::WrongType {
                    expected: SettingType::Number,
                })
            }
        }
        SettingType::Boolean => {
            if value.is_boolean() {
                Ok(())
            } else {
                Err(ValidationError::WrongType {
                    expected: SettingType::Boolean,
                })
            }
        }
        SettingType::Enum(allowed) => match value.as_str() {
            Some(candidate) if allowed.iter().any(|option| option == candidate) => Ok(()),
            _ => Err(ValidationError::NotAnEnumMember {
                allowed: allowed.clone(),
            }),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_entry(key: &str, setting_type: SettingType, default: serde_json::Value) -> SchemaEntry {
        SchemaEntry {
            key: key.to_string(),
            setting_type,
            default,
            description: Description::I18nKey(format!("settings.{key}.description")),
            source: Source::Core,
        }
    }

    #[test]
    fn a_key_with_no_override_resolves_to_its_registered_default() {
        let mut registry = ConfigRegistry::new();
        registry
            .register(core_entry(
                "terminal.shell",
                SettingType::String,
                serde_json::json!("/bin/zsh"),
            ))
            .expect("registration should succeed");

        let resolved = registry.resolve(&serde_json::Map::new());

        assert_eq!(
            resolved.get("terminal.shell"),
            Some(&serde_json::json!("/bin/zsh"))
        );
    }

    #[test]
    fn an_override_wins_over_the_registered_default() {
        let mut registry = ConfigRegistry::new();
        registry
            .register(core_entry(
                "terminal.shell",
                SettingType::String,
                serde_json::json!("/bin/zsh"),
            ))
            .expect("registration should succeed");
        let mut overrides = serde_json::Map::new();
        overrides.insert("terminal.shell".to_string(), serde_json::json!("/bin/fish"));

        let resolved = registry.resolve(&overrides);

        assert_eq!(
            resolved.get("terminal.shell"),
            Some(&serde_json::json!("/bin/fish"))
        );
    }

    #[test]
    fn core_categories_register_through_the_public_api_with_no_special_path() {
        let mut registry = ConfigRegistry::new();

        let result = registry.register(core_entry(
            "appearance.theme",
            SettingType::Enum(vec!["system".into(), "light".into(), "dark".into()]),
            serde_json::json!("system"),
        ));

        assert!(result.is_ok());
        assert_eq!(registry.schema().len(), 1);
        assert_eq!(registry.schema()[0].source, Source::Core);
    }

    #[test]
    fn an_extension_key_is_registered_under_its_enforced_namespace() {
        let mut registry = ConfigRegistry::new();

        let result = registry.register(SchemaEntry {
            key: "my-extension.retryCount".to_string(),
            setting_type: SettingType::Number,
            default: serde_json::json!(3),
            description: Description::Literal("How many retries.".to_string()),
            source: Source::Extension("my-extension".to_string()),
        });

        assert!(result.is_ok());
        assert!(registry.find("my-extension.retryCount").is_some());
    }

    #[test]
    fn an_extension_key_not_namespaced_under_its_own_id_is_rejected() {
        let mut registry = ConfigRegistry::new();

        let result = registry.register(SchemaEntry {
            key: "other-extension.retryCount".to_string(),
            setting_type: SettingType::Number,
            default: serde_json::json!(3),
            description: Description::Literal("How many retries.".to_string()),
            source: Source::Extension("my-extension".to_string()),
        });

        assert_eq!(
            result,
            Err(RegistrationError::InvalidNamespace(
                "other-extension.retryCount".to_string()
            ))
        );
    }

    #[test]
    fn an_extension_cannot_register_a_core_key_under_a_mismatched_id() {
        let mut registry = ConfigRegistry::new();

        let result = registry.register(SchemaEntry {
            key: "terminal.shell".to_string(),
            setting_type: SettingType::String,
            default: serde_json::json!("/bin/evil"),
            description: Description::Literal("Squat attempt.".to_string()),
            source: Source::Extension("not-terminal".to_string()),
        });

        assert_eq!(
            result,
            Err(RegistrationError::InvalidNamespace(
                "terminal.shell".to_string()
            ))
        );
    }

    /// The scenario the previous test's name promised but didn't cover: an
    /// extension literally naming ITSELF after an already-registered Core
    /// category passes the plain prefix check (its own id IS the prefix),
    /// so the squat has to be caught separately, by category collision with
    /// an existing `Source::Core` entry.
    #[test]
    fn an_extension_cannot_squat_a_core_namespace_by_naming_itself_after_it() {
        let mut registry = ConfigRegistry::new();
        registry
            .register(core_entry(
                "terminal.shell",
                SettingType::String,
                serde_json::json!("/bin/zsh"),
            ))
            .expect("core registration should succeed");

        let result = registry.register(SchemaEntry {
            key: "terminal.newSetting".to_string(),
            setting_type: SettingType::String,
            default: serde_json::json!("evil"),
            description: Description::Literal("Squat attempt.".to_string()),
            source: Source::Extension("terminal".to_string()),
        });

        assert_eq!(
            result,
            Err(RegistrationError::InvalidNamespace(
                "terminal.newSetting".to_string()
            ))
        );
    }

    #[test]
    fn a_duplicate_key_is_rejected() {
        let mut registry = ConfigRegistry::new();
        registry
            .register(core_entry(
                "grid.defaultTemplate",
                SettingType::Enum(vec!["single".into(), "split".into(), "quad".into()]),
                serde_json::json!("quad"),
            ))
            .expect("first registration should succeed");

        let result = registry.register(core_entry(
            "grid.defaultTemplate",
            SettingType::Enum(vec!["single".into(), "split".into(), "quad".into()]),
            serde_json::json!("single"),
        ));

        assert_eq!(
            result,
            Err(RegistrationError::DuplicateKey(
                "grid.defaultTemplate".to_string()
            ))
        );
    }

    #[test]
    fn validate_value_accepts_matching_types_and_rejects_mismatches() {
        let entry = core_entry(
            "terminal.fontSize",
            SettingType::Number,
            serde_json::json!(13),
        );

        assert!(validate_value(&entry, &serde_json::json!(14)).is_ok());
        assert!(validate_value(&entry, &serde_json::json!("14")).is_err());
    }

    #[test]
    fn validate_value_accepts_only_declared_enum_members() {
        let entry = core_entry(
            "appearance.theme",
            SettingType::Enum(vec!["system".into(), "light".into(), "dark".into()]),
            serde_json::json!("system"),
        );

        assert!(validate_value(&entry, &serde_json::json!("light")).is_ok());
        assert_eq!(
            validate_value(&entry, &serde_json::json!("solarized")),
            Err(ValidationError::NotAnEnumMember {
                allowed: vec![
                    "system".to_string(),
                    "light".to_string(),
                    "dark".to_string()
                ]
            })
        );
    }

    #[test]
    fn schema_preserves_registration_order() {
        let mut registry = ConfigRegistry::new();
        registry
            .register(core_entry(
                "terminal.shell",
                SettingType::String,
                serde_json::json!(""),
            ))
            .unwrap();
        registry
            .register(core_entry(
                "explorer.confirmBeforeDelete",
                SettingType::Boolean,
                serde_json::json!(true),
            ))
            .unwrap();

        let keys: Vec<&str> = registry
            .schema()
            .iter()
            .map(|entry| entry.key.as_str())
            .collect();
        assert_eq!(keys, vec!["terminal.shell", "explorer.confirmBeforeDelete"]);
    }

    /// Fixture: registers `size` Core entries named `bulk.key00000` ..
    /// `bulk.key{size-1}`, each defaulting to its own numeric index — enough
    /// to exercise `find`/`resolve` at a registry size no hand-written test
    /// above bothers with, and to give the scaling test in this module
    /// something to measure against.
    fn bulk_registry(size: usize) -> ConfigRegistry {
        let mut registry = ConfigRegistry::new();
        for i in 0..size {
            registry
                .register(core_entry(
                    &format!("bulk.key{i:06}"),
                    SettingType::Number,
                    serde_json::json!(i),
                ))
                .expect("bulk registration should succeed");
        }
        registry
    }

    #[test]
    fn find_and_resolve_stay_correct_with_a_large_number_of_registered_entries() {
        let size = 5_000;
        let registry = bulk_registry(size);

        // find() locates an arbitrary key correctly at this scale.
        let entry = registry.find("bulk.key002500").expect("entry should be found");
        assert_eq!(entry.default, serde_json::json!(2500));

        // A key that was never registered still correctly misses.
        assert!(registry.find("bulk.key999999-does-not-exist").is_none());

        // defaults→user merge order is unchanged: an override wins for the
        // one key it targets, every other key still falls back to its own
        // registered default — regardless of registry size.
        let mut overrides = serde_json::Map::new();
        overrides.insert("bulk.key000010".to_string(), serde_json::json!(999_999));

        let resolved = registry.resolve(&overrides);
        assert_eq!(
            resolved.get("bulk.key000010"),
            Some(&serde_json::json!(999_999))
        );
        assert_eq!(resolved.get("bulk.key000011"), Some(&serde_json::json!(11)));
        assert_eq!(resolved.len(), size);

        // schema() still preserves registration order at this scale too.
        let keys: Vec<&str> = registry
            .schema()
            .iter()
            .map(|entry| entry.key.as_str())
            .collect();
        assert_eq!(keys.first(), Some(&"bulk.key000000"));
        assert_eq!(keys.last(), Some(&"bulk.key004999"));
    }

    #[test]
    fn find_lookup_time_does_not_scale_linearly_with_registry_size() {
        /// Times `lookups` calls to `find()` against `registry` (size
        /// `size`), cycling through its keys. Keys are pre-formatted before
        /// timing starts so `format!`'s own cost — identical for both
        /// registry sizes — never counts against the measurement.
        fn measure_find(registry: &ConfigRegistry, size: usize, lookups: usize) -> std::time::Duration {
            let keys: Vec<String> = (0..lookups)
                .map(|i| format!("bulk.key{:06}", i % size))
                .collect();

            // Warm-up: first touch of these keys/pages shouldn't count
            // against either measurement.
            for key in &keys {
                std::hint::black_box(registry.find(key));
            }

            let start = std::time::Instant::now();
            for key in &keys {
                std::hint::black_box(registry.find(key));
            }
            start.elapsed()
        }

        let small_size = 200;
        let large_size = 20_000; // 100x larger registry
        let lookups = 20_000;

        let small_registry = bulk_registry(small_size);
        let large_registry = bulk_registry(large_size);

        let small_duration = measure_find(&small_registry, small_size, lookups);
        let large_duration = measure_find(&large_registry, large_size, lookups);

        let scale_factor =
            large_duration.as_secs_f64() / small_duration.as_secs_f64().max(1e-9);

        // A linear scan would scale ~1:1 with registry size, i.e. ~100x here
        // (the previous, discarded attempt at this test measured ~113.5x for
        // exactly this 100x size ratio). An indexed (HashMap-backed) lookup
        // should stay roughly flat regardless of registry size. The
        // threshold is deliberately far below 100x — generous enough to
        // absorb machine noise, but nowhere near what a linear scan would
        // produce, so it still proves the absence of one.
        assert!(
            scale_factor < 10.0,
            "lookup time scaled {scale_factor:.1}x for a {}x larger registry \
             ({small_duration:?} -> {large_duration:?}) — this points at a \
             linear scan, not an indexed lookup",
            large_size / small_size
        );
    }
}
