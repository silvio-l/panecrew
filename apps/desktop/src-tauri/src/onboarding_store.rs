//! Onboarding state — `onboarding.json` in the app-data dir, layered on the
//! generic `json_store.rs` (same shape as `settings_store.rs` over
//! `settings.json`). Two phases: `wizard_completed` (the mandatory
//! Initial-Setup-Wizard, phase 1) and `completed` (the contextual in-app
//! tour reaching the Aha-Moment, phase 2 — same field/semantics as before
//! this phase split).
//!
//! `wizard_completed` is a NEW field added after `completed` already shipped
//! (see `docs/decisions.md`, 2026-08-16). An `onboarding.json` written by an
//! earlier release only has `completed`; `serde(default)` reads that as
//! `wizard_completed: false`, which on its own would force every existing
//! user back through the wizard on their next launch. `load_state` corrects
//! for that below: a file that already has `completed: true` predates the
//! wizard's existence entirely, so it's read as having implicitly passed
//! it. Only a fresh (missing-file) install gets `wizard_completed: false`
//! for real.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

const FILE_NAME: &str = "onboarding.json";

/// Broadcast to every window whenever state changes, so a restart triggered
/// from the Settings window is reflected in the main window without a poll
/// (same pattern as `settings_commands::CHANGED_EVENT`).
const CHANGED_EVENT: &str = "onboarding:changed";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingState {
    pub completed: bool,
    #[serde(default)]
    pub wizard_completed: bool,
}

fn onboarding_path(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join(FILE_NAME)
}

pub fn load_state(dir: &std::path::Path) -> OnboardingState {
    let mut state: OnboardingState =
        crate::json_store::read_json(&onboarding_path(dir), OnboardingState::default());
    // Migration guard for pre-wizard `onboarding.json` files — see module
    // doc comment above.
    state.wizard_completed = state.wizard_completed || state.completed;
    state
}

pub fn save_state(dir: &std::path::Path, state: OnboardingState) -> Result<(), String> {
    crate::json_store::write_json_atomic(&onboarding_path(dir), &state)
}

#[tauri::command(async)]
pub fn onboarding_get_state(app: AppHandle) -> Result<OnboardingState, String> {
    let dir = crate::settings_commands::app_data_dir(&app)?;
    Ok(load_state(&dir))
}

#[tauri::command(async)]
pub fn onboarding_set_completed(app: AppHandle, completed: bool) -> Result<(), String> {
    let dir = crate::settings_commands::app_data_dir(&app)?;
    let mut state = load_state(&dir);
    state.completed = completed;
    save_state(&dir, state)?;
    emit_changed(&app, state);
    Ok(())
}

/// Restarting via Settings resets BOTH phases at once — the wizard is
/// grid-independent and always visible, so it's the one reliable way to
/// make "Einführung neu starten" show something no matter the current grid
/// state (a bare `completed: false` reset previously depended on an empty
/// grid slot existing to render anything at all).
#[tauri::command(async)]
pub fn onboarding_restart(app: AppHandle) -> Result<(), String> {
    let dir = crate::settings_commands::app_data_dir(&app)?;
    let state = OnboardingState {
        completed: false,
        wizard_completed: false,
    };
    save_state(&dir, state)?;
    emit_changed(&app, state);
    Ok(())
}

#[tauri::command(async)]
pub fn onboarding_set_wizard_completed(app: AppHandle, completed: bool) -> Result<(), String> {
    let dir = crate::settings_commands::app_data_dir(&app)?;
    let mut state = load_state(&dir);
    state.wizard_completed = completed;
    save_state(&dir, state)?;
    emit_changed(&app, state);
    Ok(())
}

fn emit_changed<R: Runtime>(app: &AppHandle<R>, state: OnboardingState) {
    if let Err(error) = app.emit(CHANGED_EVENT, state) {
        eprintln!("PaneCrew: onboarding:changed konnte nicht gesendet werden: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new(name: &str) -> Self {
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
            let root = std::env::temp_dir()
                .join(format!("panecrew-onboarding-store-{}-{name}", std::process::id()));
            std::fs::remove_dir_all(&root).ok();
            std::fs::create_dir_all(&root).expect("test fixture root should be creatable");
            Self(root)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    #[test]
    fn a_missing_file_reads_as_not_completed() {
        let fixture = Fixture::new("missing");

        let state = load_state(&fixture.0);

        assert_eq!(
            state,
            OnboardingState {
                completed: false,
                wizard_completed: false,
            }
        );
    }

    #[test]
    fn saved_completion_round_trips() {
        let fixture = Fixture::new("roundtrip");
        let saved = OnboardingState {
            completed: true,
            wizard_completed: true,
        };

        save_state(&fixture.0, saved).expect("should save");
        let state = load_state(&fixture.0);

        assert_eq!(state, saved);
    }

    #[test]
    fn a_reset_after_completion_round_trips_back_to_not_completed() {
        let fixture = Fixture::new("reset");
        save_state(
            &fixture.0,
            OnboardingState {
                completed: true,
                wizard_completed: true,
            },
        )
        .expect("should save");

        save_state(
            &fixture.0,
            OnboardingState {
                completed: false,
                wizard_completed: false,
            },
        )
        .expect("should save");
        let state = load_state(&fixture.0);

        assert_eq!(
            state,
            OnboardingState {
                completed: false,
                wizard_completed: false,
            }
        );
    }

    /// The migration case this module's doc comment describes: an
    /// `onboarding.json` written by a pre-wizard release only ever
    /// serialized `completed`. Deserializing that exact byte sequence must
    /// not force a returning user back through the wizard.
    #[test]
    fn a_pre_wizard_file_with_only_completed_infers_wizard_completed() {
        let fixture = Fixture::new("pre-wizard-migration");
        std::fs::write(onboarding_path(&fixture.0), r#"{"completed":true}"#)
            .expect("fixture file should be writable");

        let state = load_state(&fixture.0);

        assert_eq!(
            state,
            OnboardingState {
                completed: true,
                wizard_completed: true,
            }
        );
    }

    /// Same pre-wizard file shape, but the tour was never finished either —
    /// must stay `false`, not get force-completed by the migration guard.
    #[test]
    fn a_pre_wizard_file_with_completed_false_stays_not_wizard_completed() {
        let fixture = Fixture::new("pre-wizard-migration-incomplete");
        std::fs::write(onboarding_path(&fixture.0), r#"{"completed":false}"#)
            .expect("fixture file should be writable");

        let state = load_state(&fixture.0);

        assert_eq!(
            state,
            OnboardingState {
                completed: false,
                wizard_completed: false,
            }
        );
    }

    #[test]
    fn onboarding_restart_resets_both_phases_even_from_fully_completed() {
        let fixture = Fixture::new("restart");
        save_state(
            &fixture.0,
            OnboardingState {
                completed: true,
                wizard_completed: true,
            },
        )
        .expect("should save");

        // `onboarding_restart` itself needs an `AppHandle`, so this test
        // exercises the same reset shape it writes rather than the tauri
        // command wrapper directly.
        save_state(
            &fixture.0,
            OnboardingState {
                completed: false,
                wizard_completed: false,
            },
        )
        .expect("should save");
        let state = load_state(&fixture.0);

        assert_eq!(
            state,
            OnboardingState {
                completed: false,
                wizard_completed: false,
            }
        );
    }
}
