//! Whole-session persistence (Ticket 06, v2 schema per Ticket 17): windows,
//! each with a grid template, slot→project assignments, per-pane terminal
//! tabs/file tab, and each slot's last-opened explorer file, written to
//! `session.json` in the app-data dir. The PTY process itself is never
//! persisted — restoring a pane only respawns fresh shells for its terminal
//! tabs in the right `cwd` (the frontend's job), this module only
//! round-trips the JSON.
//!
//! v2 is a hard cutover (Ticket 17): no v1 migration/compat code. A v1 file
//! (top-level `template`/`slots` instead of `windows`) simply fails to
//! deserialize into this shape and `read_session` returns `None`, exactly
//! like a missing or corrupt file — the app starts at the picker instead of
//! failing to launch.
//!
//! `read_session` also validates every `project_path` against the real
//! filesystem: a folder that no longer exists must fall back to an empty
//! slot silently (project guideline, ticket 06) rather than surfacing an error or
//! failing the whole restore.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "session.json";

/// One PTY-backed terminal tab within a pane. `title` is a user-set rename;
/// number and colour are index-derived UI state (Spec 2026-08-12: "konkretes
/// Farbschema ist Implementierungsdetail"), not persisted.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct PersistedTerminalTab {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// The at-most-one file tab of a pane (Spec: "höchstens einen File-Tab pro
/// Pane"), always ordered after every terminal tab in the live tab strip.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct PersistedFileTab {
    /// Project-relative path, same convention as the pre-v2
    /// `last_selected_file` field it replaces.
    pub path: String,
}

/// Which of a pane's tabs is active. A plain index would silently misparse
/// after either array changed shape independently; the explicit `kind` tag
/// makes "which tab" unambiguous regardless of how many terminal tabs exist.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActiveTab {
    Terminal { index: usize },
    File,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct PersistedPane {
    pub project_path: String,
    pub terminal_tabs: Vec<PersistedTerminalTab>,
    pub active_tab: ActiveTab,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_tab: Option<PersistedFileTab>,
    /// Chosen CLI-tool adapter (Ticket 17 cross-cutting note: identified as a
    /// missing field in round-1 research, added here). References the
    /// adapter manifest from Ticket 12; `None` means a bare shell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adapter_id: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq)]
pub struct PersistedWindow {
    pub template: String,
    pub slots: Vec<Option<PersistedPane>>,
    /// Grid-track ratios for the template's cut lines (not its topology —
    /// Ticket 03 stays closed on that point). Empty means "use the
    /// template's own default ratios".
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub split_ratios: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximized_pane_id: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq, Default)]
pub struct SessionState {
    pub windows: Vec<PersistedWindow>,
    /// Which folders the user has *expanded* in the explorer tree, keyed by
    /// absolute project path rather than by pane: the live explorer state is
    /// itself bound to `project.path` (`ExplorerPanel` remounts on that key,
    /// not on a pane/slot id — the same project open in two panes shares one
    /// live tree). Deliberately the expanded set, not the collapsed one
    /// (2026-08-12): the frontend default is "everything collapsed", which
    /// would make the collapsed set equal to *every folder in the project* —
    /// storing the deviation from the default instead keeps this a handful
    /// of paths. Unchanged by the v2 cutover itself, just carried over.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub expanded_folders: HashMap<String, Vec<String>>,
    /// Explorer panel width in CSS pixels (Ticket 17: already a live UI
    /// feature, `App.tsx`'s resize handle — this is only its persistence).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explorer_width: Option<f64>,
}

fn session_path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// Reads the persisted session, or `None` if there is none yet, the file is
/// unreadable, or it fails to parse — a corrupt, foreign, or v1-shaped file
/// must not fail app startup (same "survivable, not fatal" stance as
/// `launch.rs`), it just means starting at the picker exactly as on first
/// launch.
pub fn read_session(dir: &Path) -> Option<SessionState> {
    let bytes = std::fs::read(session_path(dir)).ok()?;
    let mut state: SessionState = serde_json::from_slice(&bytes).ok()?;
    for window in &mut state.windows {
        for slot in &mut window.slots {
            if let Some(pane) = slot {
                if !Path::new(&pane.project_path).is_dir() {
                    *slot = None;
                }
            }
        }
    }
    // Prune entries for projects no longer occupying any surviving slot in
    // any window — otherwise a closed pane's expand state accumulates in the
    // file forever, growing it for no restorable benefit.
    let live_paths: std::collections::HashSet<&str> = state
        .windows
        .iter()
        .flat_map(|window| window.slots.iter())
        .flatten()
        .map(|pane| pane.project_path.as_str())
        .collect();
    state
        .expanded_folders
        .retain(|project_path, _| live_paths.contains(project_path.as_str()));
    Some(state)
}

/// Same temp-file-then-atomic-rename pattern as
/// `explorer_fs::explorer_write_file`: a crash between writing and renaming
/// leaves either the previous session or the new one intact on disk, never a
/// half-written file that fails to parse on the next launch.
pub fn write_session(dir: &Path, state: &SessionState) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("Anwendungsverzeichnis konnte nicht angelegt werden: {error}"))?;
    let path = session_path(dir);
    let json = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Sitzung konnte nicht serialisiert werden: {error}"))?;

    let temp_path = dir.join(format!(".{FILE_NAME}.panecrew-tmp-{}", std::process::id()));
    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temp_path)?;
        file.write_all(&json)?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        std::fs::remove_file(&temp_path).ok();
        return Err(format!("Sitzung konnte nicht geschrieben werden: {error}"));
    }
    std::fs::rename(&temp_path, &path)
        .map_err(|error| format!("Sitzung konnte nicht gespeichert werden: {error}"))
}

// `async`: file I/O must not run on the thread that dispatches IPC (see
// `explorer_fs.rs::explorer_read_tree` for the source-verified reasoning).
// `session_save` in particular fires on every grid/selection change once
// hydrated — a hot path, not just a one-off startup read.
#[tauri::command(async)]
pub fn session_load(app: AppHandle) -> Option<SessionState> {
    let dir = app.path().app_data_dir().ok()?;
    read_session(&dir)
}

#[tauri::command(async)]
pub fn session_save(app: AppHandle, state: SessionState) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Anwendungsverzeichnis nicht verfügbar: {error}"))?;
    write_session(&dir, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway app-data dir under the system temp dir, removed by
    /// `drop` — same shape as `explorer_fs.rs`'s own `Fixture`.
    struct Fixture(PathBuf);

    impl Fixture {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "panecrew-session-store-{}-{name}",
                std::process::id()
            ));
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

    fn terminal_only_pane(project_path: &str) -> Option<PersistedPane> {
        Some(PersistedPane {
            project_path: project_path.to_string(),
            terminal_tabs: vec![PersistedTerminalTab { title: None }],
            active_tab: ActiveTab::Terminal { index: 0 },
            file_tab: None,
            adapter_id: None,
        })
    }

    #[test]
    fn a_missing_session_file_reads_as_none() {
        let fixture = Fixture::new("missing");

        assert_eq!(read_session(&fixture.0), None);
    }

    #[test]
    fn a_corrupt_session_file_reads_as_none_instead_of_failing() {
        let fixture = Fixture::new("corrupt");
        std::fs::write(session_path(&fixture.0), b"not json").expect("fixture write");

        assert_eq!(read_session(&fixture.0), None);
    }

    /// The whole point of the hard cutover (Ticket 17): a v1 file has
    /// top-level `template`/`slots` instead of `windows`, so it is missing a
    /// required field and fails to deserialize outright — no partial parse,
    /// no migration, just the same "start at the picker" fallback as a
    /// missing file.
    #[test]
    fn a_v1_shaped_session_file_fails_to_parse_and_reads_as_none() {
        let fixture = Fixture::new("v1-cutover");
        std::fs::write(
            session_path(&fixture.0),
            br#"{"template":"single","slots":[{"project_path":"/some/project"}]}"#,
        )
        .expect("fixture write");

        assert_eq!(read_session(&fixture.0), None);
    }

    #[test]
    fn round_trips_the_full_v2_state_through_write_and_read() {
        let fixture = Fixture::new("roundtrip");
        // The two project paths must actually exist on disk — `read_session`
        // validates every slot against the real filesystem.
        let project_a = fixture.0.join("project-a");
        let project_b = fixture.0.join("project-b");
        std::fs::create_dir_all(&project_a).expect("fixture dir");
        std::fs::create_dir_all(&project_b).expect("fixture dir");
        let project_a = project_a.to_string_lossy().into_owned();
        let project_b = project_b.to_string_lossy().into_owned();
        let state = SessionState {
            windows: vec![
                PersistedWindow {
                    template: "split".to_string(),
                    slots: vec![
                        Some(PersistedPane {
                            project_path: project_a.clone(),
                            terminal_tabs: vec![
                                PersistedTerminalTab {
                                    title: Some("build".to_string()),
                                },
                                PersistedTerminalTab { title: None },
                            ],
                            active_tab: ActiveTab::Terminal { index: 1 },
                            file_tab: Some(PersistedFileTab {
                                path: "src/App.tsx".to_string(),
                            }),
                            adapter_id: Some("demo-agent".to_string()),
                        }),
                        terminal_only_pane(&project_b),
                    ],
                    split_ratios: vec![0.35, 0.65],
                    maximized_pane_id: Some("pane-1".to_string()),
                },
                PersistedWindow {
                    template: "quad".to_string(),
                    slots: vec![None, None, None, None],
                    split_ratios: Vec::new(),
                    maximized_pane_id: None,
                },
            ],
            expanded_folders: HashMap::from([(
                project_a.clone(),
                vec!["src".to_string(), "src/core".to_string()],
            )]),
            explorer_width: Some(260.0),
        };

        write_session(&fixture.0, &state).expect("should write");
        let read_back = read_session(&fixture.0).expect("should read back");

        assert_eq!(read_back, state);
    }

    #[test]
    fn prunes_expanded_folder_entries_for_projects_no_longer_in_any_slot_of_any_window() {
        let fixture = Fixture::new("prune-expanded");
        let project = fixture.0.join("kept-project");
        std::fs::create_dir_all(&project).expect("fixture dir");
        let kept_path = project.to_string_lossy().into_owned();
        let state = SessionState {
            windows: vec![PersistedWindow {
                template: "single".to_string(),
                slots: vec![terminal_only_pane(&kept_path)],
                split_ratios: Vec::new(),
                maximized_pane_id: None,
            }],
            expanded_folders: HashMap::from([
                (kept_path.clone(), vec!["src".to_string()]),
                ("/no/longer/open".to_string(), vec!["old".to_string()]),
            ]),
            explorer_width: None,
        };
        write_session(&fixture.0, &state).expect("should write");

        let read_back = read_session(&fixture.0).expect("should read back");

        assert_eq!(
            read_back.expanded_folders,
            HashMap::from([(kept_path, vec!["src".to_string()])]),
        );
    }

    #[test]
    fn drops_a_slot_whose_project_folder_no_longer_exists_instead_of_erroring() {
        let fixture = Fixture::new("missing-folder");
        let gone = fixture
            .0
            .join("gone-project")
            .to_string_lossy()
            .into_owned();
        let state = SessionState {
            windows: vec![PersistedWindow {
                template: "quad".to_string(),
                slots: vec![terminal_only_pane(&gone), None],
                split_ratios: Vec::new(),
                maximized_pane_id: None,
            }],
            expanded_folders: HashMap::new(),
            explorer_width: None,
        };
        write_session(&fixture.0, &state).expect("should write");

        let read_back = read_session(&fixture.0).expect("file itself is valid JSON");

        assert_eq!(read_back.windows[0].slots, vec![None, None]);
    }

    #[test]
    fn a_second_write_overwrites_the_first_rather_than_appending() {
        let fixture = Fixture::new("overwrite");
        let project = fixture.0.join("only-project");
        std::fs::create_dir_all(&project).expect("fixture dir");
        let path_string = project.to_string_lossy().into_owned();
        write_session(
            &fixture.0,
            &SessionState {
                windows: vec![PersistedWindow {
                    template: "single".to_string(),
                    slots: vec![terminal_only_pane(&path_string)],
                    split_ratios: Vec::new(),
                    maximized_pane_id: None,
                }],
                expanded_folders: HashMap::new(),
                explorer_width: None,
            },
        )
        .expect("first write");

        write_session(
            &fixture.0,
            &SessionState {
                windows: vec![PersistedWindow {
                    template: "quad".to_string(),
                    slots: vec![None, None, None, None],
                    split_ratios: Vec::new(),
                    maximized_pane_id: None,
                }],
                expanded_folders: HashMap::new(),
                explorer_width: None,
            },
        )
        .expect("second write");

        let read_back = read_session(&fixture.0).expect("should read back");
        assert_eq!(read_back.windows[0].template, "quad");
        assert_eq!(read_back.windows[0].slots, vec![None, None, None, None]);
    }

    #[test]
    fn leaves_no_temp_file_behind_after_a_successful_write() {
        let fixture = Fixture::new("write-no-litter");

        write_session(
            &fixture.0,
            &SessionState {
                windows: vec![PersistedWindow {
                    template: "quad".to_string(),
                    slots: vec![None, None, None, None],
                    split_ratios: Vec::new(),
                    maximized_pane_id: None,
                }],
                expanded_folders: HashMap::new(),
                explorer_width: None,
            },
        )
        .expect("should write");

        let leftovers: Vec<_> = std::fs::read_dir(&fixture.0)
            .expect("fixture dir readable")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains("panecrew-tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn creates_the_app_data_dir_if_it_does_not_exist_yet() {
        let fixture = Fixture::new("create-dir");
        let nested = fixture.0.join("nested").join("app-data");

        write_session(
            &nested,
            &SessionState {
                windows: vec![PersistedWindow {
                    template: "quad".to_string(),
                    slots: vec![None, None, None, None],
                    split_ratios: Vec::new(),
                    maximized_pane_id: None,
                }],
                expanded_folders: HashMap::new(),
                explorer_width: None,
            },
        )
        .expect("should create the directory and write");

        assert!(nested.is_dir());
        assert!(session_path(&nested).is_file());
    }
}
