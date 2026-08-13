//! Resolves the `PROJECT_PATH` CLI argument (see `cli.rs`) into the one thing
//! the frontend actually needs at startup: an absolute path to hand straight
//! to `TerminalPane`, or nothing at all if the argument was missing, relative
//! to a directory that turned out not to exist, or not a directory.
//!
//! A bad path here must never fail the launch — PaneCrew falls back to the
//! project picker exactly as if no argument had been given, the same
//! "survivable, not fatal" stance `shell_integration` takes.

use std::path::Path;

use tauri::State;

/// Managed Tauri state: the resolved launch project, if any. Resolved once at
/// startup in `run()`, not re-checked per call — a path that stops existing
/// between launch and the frontend's first render is `TerminalPane`'s problem
/// (spawning a PTY there already handles a bad `cwd`), not this command's.
pub struct LaunchProject(pub Option<String>);

/// Resolves `cli_project` (relative paths are resolved against `launch_cwd`,
/// the process's own working directory at startup — the same directory a
/// shell would resolve a relative argument against) to an absolute,
/// `is_dir()`-confirmed path, or `None` for anything that doesn't check out.
pub fn resolve_launch_project(cli_project: Option<&Path>, launch_cwd: &Path) -> Option<String> {
    let requested = cli_project?;
    let absolute = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        launch_cwd.join(requested)
    };
    if !absolute.is_dir() {
        return None;
    }
    Some(absolute.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn get_launch_project(launch: State<LaunchProject>) -> Option<String> {
    launch.0.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_argument_resolves_to_nothing() {
        assert_eq!(resolve_launch_project(None, Path::new("/anywhere")), None);
    }

    #[test]
    fn an_absolute_existing_directory_resolves_as_is() {
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- just a real, absolute directory to test path resolution against, not a security operation.
        let dir = std::env::temp_dir();
        assert_eq!(
            resolve_launch_project(Some(&dir), Path::new("/irrelevant")),
            Some(dir.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn a_relative_argument_resolves_against_the_launch_cwd() {
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
        let cwd = std::env::temp_dir();
        let name = "panecrew-launch-relative-test";
        let target = cwd.join(name);
        std::fs::create_dir_all(&target).expect("test fixture dir should be creatable");

        let resolved = resolve_launch_project(Some(Path::new(name)), &cwd);

        std::fs::remove_dir(&target).ok();
        assert_eq!(resolved, Some(target.to_string_lossy().into_owned()));
    }

    #[test]
    fn a_path_that_is_not_a_directory_resolves_to_nothing() {
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch path, not a security operation.
        let file = std::env::temp_dir().join("panecrew-launch-not-a-dir-test");
        std::fs::write(&file, b"x").expect("test fixture file should be creatable");

        let resolved = resolve_launch_project(Some(&file), Path::new("/irrelevant"));

        std::fs::remove_file(&file).ok();
        assert_eq!(resolved, None);
    }

    #[test]
    fn a_missing_path_resolves_to_nothing() {
        assert_eq!(
            resolve_launch_project(
                Some(Path::new("/panecrew-definitely-not-here")),
                Path::new("/irrelevant"),
            ),
            None
        );
    }
}
