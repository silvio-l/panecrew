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

use tauri::AppHandle;

use crate::menu;
use crate::settings_commands::app_data_dir;

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
    /// Stable window identity (Ticket 27), the native `WebviewWindow` label.
    /// Mandatory, no `#[serde(default)]`: a pre-Ticket-27 file has no way to
    /// supply one, and guessing (e.g. always "main") would silently collapse
    /// a multi-window session down to one window on the first save after
    /// upgrade. Same hard-cutover stance as the v1→v2 schema change above —
    /// a session file predating this field fails to deserialize and the app
    /// starts at the picker, exactly like a missing file.
    pub label: String,
    pub template: String,
    pub slots: Vec<Option<PersistedPane>>,
    /// Grid-track ratios for the template's cut lines (not its topology —
    /// Ticket 03 stays closed on that point). Empty means "use the
    /// template's own default ratios".
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub split_ratios: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximized_pane_id: Option<String>,
    /// Rotation-mode config (Ticket 19) — whether it was running and at
    /// which interval, so a restored focus-mode window resumes the same
    /// rotation instead of silently dropping it. `None`/absent means
    /// inactive, not "unknown"; there is no separate default-interval
    /// constant here because the frontend's own `ROTATION_INTERVALS_MS`
    /// preset list already owns that value, this field only round-trips it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation_active: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation_interval_ms: Option<u32>,
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
    /// Recently opened project paths, most-recent-first (Ticket 22) — an
    /// app-wide global like `expanded_folders`/`explorer_width` above, not
    /// scoped to a window or slot. The frontend owns the recency ordering
    /// and the 8-entry cap (it already holds the live list to compute
    /// "move to front, dedupe, truncate"); this module only round-trips
    /// whatever it is given, then prunes on read below.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent_projects: Vec<String>,
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
    // A recent-projects entry pointing at a folder that no longer exists
    // (moved, deleted, unmounted volume) would just fail to open on click —
    // same "survivable, not fatal" pruning as the slot validation above,
    // just filtering a flat list instead of nulling a slot.
    state
        .recent_projects
        .retain(|project_path| Path::new(project_path).is_dir());
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
    let dir = app_data_dir(&app).ok()?;
    read_session(&dir)
}

#[tauri::command(async)]
pub fn session_save(app: AppHandle, state: SessionState) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    write_session(&dir, &state)
}

/// Per-window save (Ticket 27): each open window is its own webview process
/// context and only knows its own grid state, not the others' — a naive
/// `session_save` of a full `SessionState` built from one window would throw
/// every other open window's entry out of the file. This reads the file,
/// replaces the entry whose `label` matches (or appends one if this window
/// hasn't saved before), and writes the merged result back — same
/// read-modify-write-atomically pattern the rest of this module already
/// uses, just scoped to one array entry instead of the whole document.
///
/// `expanded_folders`/`explorer_width`/`recent_projects` are window-agnostic
/// globals that predate multi-window (Ticket 17) and stay that way — but the
/// frontend's autosave effect now saves per-window via this command instead
/// of the whole-array `session_save`, so without a way to carry them here
/// too, all three fields would simply stop being persisted the moment a
/// second window exists. `Some` overwrites the stored value, `None` leaves it
/// exactly as read — callers that don't own that piece of state (e.g. a save
/// triggered purely by a grid change) pass `None` rather than resending a
/// value they don't have.
#[tauri::command(async)]
pub fn session_save_window(
    app: AppHandle,
    window: PersistedWindow,
    expanded_folders: Option<HashMap<String, Vec<String>>>,
    explorer_width: Option<f64>,
    recent_projects: Option<Vec<String>>,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    let mut state = read_session(&dir).unwrap_or_default();
    match state.windows.iter_mut().find(|w| w.label == window.label) {
        Some(existing) => *existing = window,
        None => state.windows.push(window),
    }
    if let Some(expanded_folders) = expanded_folders {
        state.expanded_folders = expanded_folders;
    }
    if let Some(explorer_width) = explorer_width {
        state.explorer_width = Some(explorer_width);
    }
    let recent_projects_changed = recent_projects.is_some();
    if let Some(recent_projects) = recent_projects {
        state.recent_projects = recent_projects;
    }
    write_session(&dir, &state)?;
    // Hält `menu.rs`s dynamisches "Zuletzt geöffnete Projekte"-Untermenü
    // aktuell — dieselbe Rebuild-die-ganze-Leiste-Begründung wie bei der
    // "Fenster"-Liste (`lib.rs`s `on_window_event`), nur hier ausgelöst vom
    // Frontend-Autosave-Effekt statt einem nativen Fensterereignis. Nur bei
    // einer tatsächlichen Änderung, nicht bei jedem reinen Grid-Save (die
    // meisten Aufrufe reichen `recent_projects: None` durch).
    if recent_projects_changed {
        menu::refresh(&app);
    }
    Ok(())
}

/// Reads just the recent-projects list, for `menu.rs`'s dynamic "Zuletzt
/// geöffnete Projekte" submenu — same "always live, rebuild the whole bar"
/// philosophy as the "Fenster" window list (`windows::window_entries`), just
/// backed by the persisted session file instead of live window objects
/// (recent projects has no live in-process equivalent to introspect). A
/// missing/corrupt session file means "no recent projects yet", same as
/// every other `read_session` call site.
pub fn recent_projects<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<String> {
    app_data_dir(app)
        .ok()
        .and_then(|dir| read_session(&dir))
        .map(|state| state.recent_projects)
        .unwrap_or_default()
}

/// Counterpart to `session_save_window`, for the window-close path (Ticket
/// 27, landmine 3): removes exactly one window's entry by label rather than
/// requiring the caller to reconstruct and resend the other windows' state.
/// A label not present in the file is not an error — the window may never
/// have autosaved (e.g. closed within the same tick it was opened).
#[tauri::command(async)]
pub fn session_remove_window(app: AppHandle, label: String) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    let Some(mut state) = read_session(&dir) else {
        return Ok(());
    };
    state.windows.retain(|w| w.label != label);
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
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
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
                    label: "main".to_string(),
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
                    rotation_active: Some(true),
                    rotation_interval_ms: Some(15_000),
                },
                PersistedWindow {
                    label: "main-2".to_string(),
                    template: "quad".to_string(),
                    slots: vec![None, None, None, None],
                    split_ratios: Vec::new(),
                    maximized_pane_id: None,
                    rotation_active: None,
                    rotation_interval_ms: None,
                },
            ],
            expanded_folders: HashMap::from([(
                project_a.clone(),
                vec!["src".to_string(), "src/core".to_string()],
            )]),
            explorer_width: Some(260.0),
            recent_projects: vec![project_b.clone(), project_a.clone()],
        };

        write_session(&fixture.0, &state).expect("should write");
        let read_back = read_session(&fixture.0).expect("should read back");

        assert_eq!(read_back, state);
    }

    #[test]
    fn prunes_recent_projects_entries_for_folders_that_no_longer_exist() {
        let fixture = Fixture::new("prune-recent-projects");
        let kept = fixture.0.join("kept-project");
        std::fs::create_dir_all(&kept).expect("fixture dir");
        let kept_path = kept.to_string_lossy().into_owned();
        let gone_path = fixture
            .0
            .join("gone-project")
            .to_string_lossy()
            .into_owned();
        let state = SessionState {
            windows: Vec::new(),
            expanded_folders: HashMap::new(),
            explorer_width: None,
            recent_projects: vec![gone_path, kept_path.clone()],
        };
        write_session(&fixture.0, &state).expect("should write");

        let read_back = read_session(&fixture.0).expect("should read back");

        assert_eq!(read_back.recent_projects, vec![kept_path]);
    }

    #[test]
    fn prunes_expanded_folder_entries_for_projects_no_longer_in_any_slot_of_any_window() {
        let fixture = Fixture::new("prune-expanded");
        let project = fixture.0.join("kept-project");
        std::fs::create_dir_all(&project).expect("fixture dir");
        let kept_path = project.to_string_lossy().into_owned();
        let state = SessionState {
            windows: vec![PersistedWindow {
                label: "main".to_string(),
                template: "single".to_string(),
                slots: vec![terminal_only_pane(&kept_path)],
                split_ratios: Vec::new(),
                maximized_pane_id: None,
                rotation_active: None,
                rotation_interval_ms: None,
            }],
            expanded_folders: HashMap::from([
                (kept_path.clone(), vec!["src".to_string()]),
                ("/no/longer/open".to_string(), vec!["old".to_string()]),
            ]),
            explorer_width: None,
            recent_projects: Vec::new(),
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
                label: "main".to_string(),
                template: "quad".to_string(),
                slots: vec![terminal_only_pane(&gone), None],
                split_ratios: Vec::new(),
                maximized_pane_id: None,
                rotation_active: None,
                rotation_interval_ms: None,
            }],
            expanded_folders: HashMap::new(),
            explorer_width: None,
            recent_projects: Vec::new(),
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
                    label: "main".to_string(),
                    template: "single".to_string(),
                    slots: vec![terminal_only_pane(&path_string)],
                    split_ratios: Vec::new(),
                    maximized_pane_id: None,
                    rotation_active: None,
                    rotation_interval_ms: None,
                }],
                expanded_folders: HashMap::new(),
                explorer_width: None,
                recent_projects: Vec::new(),
            },
        )
        .expect("first write");

        write_session(
            &fixture.0,
            &SessionState {
                windows: vec![PersistedWindow {
                    label: "main".to_string(),
                    template: "quad".to_string(),
                    slots: vec![None, None, None, None],
                    split_ratios: Vec::new(),
                    maximized_pane_id: None,
                    rotation_active: None,
                    rotation_interval_ms: None,
                }],
                expanded_folders: HashMap::new(),
                explorer_width: None,
                recent_projects: Vec::new(),
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
                    label: "main".to_string(),
                    template: "quad".to_string(),
                    slots: vec![None, None, None, None],
                    split_ratios: Vec::new(),
                    maximized_pane_id: None,
                    rotation_active: None,
                    rotation_interval_ms: None,
                }],
                expanded_folders: HashMap::new(),
                explorer_width: None,
                recent_projects: Vec::new(),
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
                    label: "main".to_string(),
                    template: "quad".to_string(),
                    slots: vec![None, None, None, None],
                    split_ratios: Vec::new(),
                    maximized_pane_id: None,
                    rotation_active: None,
                    rotation_interval_ms: None,
                }],
                expanded_folders: HashMap::new(),
                explorer_width: None,
                recent_projects: Vec::new(),
            },
        )
        .expect("should create the directory and write");

        assert!(nested.is_dir());
        assert!(session_path(&nested).is_file());
    }

    fn empty_quad_window(label: &str) -> PersistedWindow {
        PersistedWindow {
            label: label.to_string(),
            template: "quad".to_string(),
            slots: vec![None, None, None, None],
            split_ratios: Vec::new(),
            maximized_pane_id: None,
            rotation_active: None,
            rotation_interval_ms: None,
        }
    }

    /// Ticket 27, landmine 2: two windows saving via `session_save_window` in
    /// sequence must not clobber each other's entry the way a naive
    /// full-array `session_save` from a single window would.
    #[test]
    fn session_save_window_merges_by_label_instead_of_overwriting_the_whole_file() {
        let fixture = Fixture::new("save-window-merge");

        session_save_window_for_test(&fixture.0, empty_quad_window("main"))
            .expect("first window save");
        session_save_window_for_test(&fixture.0, empty_quad_window("main-2"))
            .expect("second window save");

        let read_back = read_session(&fixture.0).expect("should read back");
        let mut labels: Vec<&str> = read_back.windows.iter().map(|w| w.label.as_str()).collect();
        labels.sort_unstable();
        assert_eq!(labels, vec!["main", "main-2"]);
    }

    /// A second save under the SAME label replaces that window's own entry
    /// in place rather than appending a duplicate.
    #[test]
    fn session_save_window_replaces_its_own_prior_entry_by_label() {
        let fixture = Fixture::new("save-window-replace");
        session_save_window_for_test(&fixture.0, empty_quad_window("main")).expect("first save");

        let mut updated = empty_quad_window("main");
        updated.template = "split".to_string();
        session_save_window_for_test(&fixture.0, updated).expect("second save");

        let read_back = read_session(&fixture.0).expect("should read back");
        assert_eq!(read_back.windows.len(), 1);
        assert_eq!(read_back.windows[0].template, "split");
    }

    /// `expanded_folders` entries are pruned on read for any project no
    /// window currently references (see `prunes_expanded_folder_entries_…`
    /// above) — the seeded window and every save below must keep carrying a
    /// slot for `kept_path`, or the assertions would be testing pruning
    /// instead of the globals-merge behavior this test is actually about.
    #[test]
    fn session_save_window_overwrites_expanded_folders_and_explorer_width_when_given() {
        let fixture = Fixture::new("save-window-globals-some");
        let project = fixture.0.join("kept-project");
        std::fs::create_dir_all(&project).expect("fixture dir");
        let kept_path = project.to_string_lossy().into_owned();

        let mut window = empty_quad_window("main");
        window.slots[0] = terminal_only_pane(&kept_path);
        let mut initial = SessionState {
            windows: vec![window.clone()],
            ..SessionState::default()
        };
        initial
            .expanded_folders
            .insert(kept_path.clone(), vec!["src".to_string()]);
        initial.explorer_width = Some(240.0);
        write_session(&fixture.0, &initial).expect("seed initial state");

        let folders = HashMap::from([(kept_path, vec!["src".to_string(), "docs".to_string()])]);
        session_save_window_with_globals_for_test(
            &fixture.0,
            window,
            Some(folders.clone()),
            Some(300.0),
            None,
        )
        .expect("save with globals");

        let read_back = read_session(&fixture.0).expect("should read back");
        assert_eq!(read_back.expanded_folders, folders);
        assert_eq!(read_back.explorer_width, Some(300.0));
    }

    /// `recent_projects`' own analogue to the two tests above — same
    /// merge-not-overwrite/leave-untouched contract, kept as a separate test
    /// rather than folded into `..._expanded_folders_and_explorer_width_...`
    /// because it needs its own (non-pruned) project paths rather than the
    /// slot-referenced `kept_path` those tests are built around.
    #[test]
    fn session_save_window_overwrites_recent_projects_when_given_and_leaves_it_untouched_when_none() {
        let fixture = Fixture::new("save-window-recent-projects");
        let project_a = fixture.0.join("project-a");
        let project_b = fixture.0.join("project-b");
        std::fs::create_dir_all(&project_a).expect("fixture dir");
        std::fs::create_dir_all(&project_b).expect("fixture dir");
        let project_a = project_a.to_string_lossy().into_owned();
        let project_b = project_b.to_string_lossy().into_owned();

        let window = empty_quad_window("main");
        session_save_window_with_globals_for_test(
            &fixture.0,
            window.clone(),
            None,
            None,
            Some(vec![project_a.clone()]),
        )
        .expect("seed recent_projects");
        let read_back = read_session(&fixture.0).expect("should read back");
        assert_eq!(read_back.recent_projects, vec![project_a.clone()]);

        // `None` leaves the previously saved list untouched — a save
        // triggered by a plain grid change, which doesn't own this state.
        session_save_window_for_test(&fixture.0, window.clone()).expect("save without globals");
        let read_back = read_session(&fixture.0).expect("should read back");
        assert_eq!(read_back.recent_projects, vec![project_a.clone()]);

        // `Some` overwrites it wholesale, exactly like `expanded_folders`.
        session_save_window_with_globals_for_test(
            &fixture.0,
            window,
            None,
            None,
            Some(vec![project_b.clone(), project_a.clone()]),
        )
        .expect("overwrite recent_projects");
        let read_back = read_session(&fixture.0).expect("should read back");
        assert_eq!(read_back.recent_projects, vec![project_b, project_a]);
    }

    #[test]
    fn session_save_window_leaves_expanded_folders_and_explorer_width_untouched_when_none() {
        let fixture = Fixture::new("save-window-globals-none");
        let project = fixture.0.join("kept-project");
        std::fs::create_dir_all(&project).expect("fixture dir");
        let kept_path = project.to_string_lossy().into_owned();

        let mut window = empty_quad_window("main");
        window.slots[0] = terminal_only_pane(&kept_path);
        let mut initial = SessionState {
            windows: vec![window.clone()],
            ..SessionState::default()
        };
        initial
            .expanded_folders
            .insert(kept_path.clone(), vec!["src".to_string()]);
        initial.explorer_width = Some(240.0);
        write_session(&fixture.0, &initial).expect("seed initial state");

        session_save_window_for_test(&fixture.0, window).expect("save");

        let read_back = read_session(&fixture.0).expect("should read back");
        assert_eq!(
            read_back.expanded_folders,
            HashMap::from([(kept_path, vec!["src".to_string()])]),
        );
        assert_eq!(read_back.explorer_width, Some(240.0));
    }

    /// Ticket 27, landmine 3's counterpart: closing one window must remove
    /// only that window's entry, leaving sibling windows' sessions intact.
    #[test]
    fn session_remove_window_drops_only_the_matching_label() {
        let fixture = Fixture::new("remove-window");
        session_save_window_for_test(&fixture.0, empty_quad_window("main"))
            .expect("first window save");
        session_save_window_for_test(&fixture.0, empty_quad_window("main-2"))
            .expect("second window save");

        session_remove_window_for_test(&fixture.0, "main-2").expect("remove");

        let read_back = read_session(&fixture.0).expect("should read back");
        assert_eq!(read_back.windows.len(), 1);
        assert_eq!(read_back.windows[0].label, "main");
    }

    #[test]
    fn session_remove_window_on_a_missing_file_is_a_harmless_no_op() {
        let fixture = Fixture::new("remove-window-missing-file");

        session_remove_window_for_test(&fixture.0, "main").expect("should not error");

        assert_eq!(read_session(&fixture.0), None);
    }

    /// The real commands take an `AppHandle` to resolve the app-data dir;
    /// these test-only wrappers exercise the exact same merge logic against
    /// a fixture directory directly, without needing a live Tauri app.
    fn session_save_window_for_test(dir: &Path, window: PersistedWindow) -> Result<(), String> {
        session_save_window_with_globals_for_test(dir, window, None, None, None)
    }

    fn session_save_window_with_globals_for_test(
        dir: &Path,
        window: PersistedWindow,
        expanded_folders: Option<HashMap<String, Vec<String>>>,
        explorer_width: Option<f64>,
        recent_projects: Option<Vec<String>>,
    ) -> Result<(), String> {
        let mut state = read_session(dir).unwrap_or_default();
        match state.windows.iter_mut().find(|w| w.label == window.label) {
            Some(existing) => *existing = window,
            None => state.windows.push(window),
        }
        if let Some(expanded_folders) = expanded_folders {
            state.expanded_folders = expanded_folders;
        }
        if let Some(explorer_width) = explorer_width {
            state.explorer_width = Some(explorer_width);
        }
        if let Some(recent_projects) = recent_projects {
            state.recent_projects = recent_projects;
        }
        write_session(dir, &state)
    }

    fn session_remove_window_for_test(dir: &Path, label: &str) -> Result<(), String> {
        let Some(mut state) = read_session(dir) else {
            return Ok(());
        };
        state.windows.retain(|w| w.label != label);
        write_session(dir, &state)
    }
}
