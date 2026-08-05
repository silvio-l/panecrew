//! Read-only "does this resolve to a directory?" probe for the terminal's
//! inline suggestions.
//!
//! Shell history files record no working directory, so a history entry like
//! `cd Desktop` says nothing about whether `Desktop` exists where the pane's
//! shell currently stands. This is the check that turns that guess into a
//! fact. It lives in Rust for the same reason `shell_history` does: the
//! webview has no filesystem access in this app at all.

use std::path::{Path, PathBuf};

#[tauri::command]
pub fn path_is_directory(cwd: String, path: String) -> bool {
    // `is_dir` follows symlinks, which is what `cd` does too.
    resolve(Path::new(&cwd), &path).is_some_and(|resolved| resolved.is_dir())
}

/// `None` for anything PaneCrew can't resolve on its own — a `~user` home, or
/// an empty path. Callers treat that as "not a directory", so an unresolvable
/// target simply never gets suggested.
fn resolve(cwd: &Path, path: &str) -> Option<PathBuf> {
    if path.is_empty() {
        return None;
    }
    if let Some(rest) = path.strip_prefix('~') {
        let home = crate::shell_history::home_dir()?;
        return match rest {
            "" => Some(home),
            _ => Some(home.join(rest.strip_prefix('/')?)),
        };
    }
    let path = Path::new(path);
    Some(if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_a_relative_target_against_the_given_cwd() {
        assert_eq!(
            resolve(Path::new("/a/b"), "c/d"),
            Some(PathBuf::from("/a/b/c/d"))
        );
        assert_eq!(
            resolve(Path::new("/a/b"), ".."),
            Some(PathBuf::from("/a/b/.."))
        );
    }

    #[test]
    fn leaves_an_absolute_target_alone() {
        assert_eq!(
            resolve(Path::new("/a/b"), "/etc"),
            Some(PathBuf::from("/etc"))
        );
    }

    #[test]
    fn expands_a_leading_tilde_but_not_another_users_home() {
        let home = crate::shell_history::home_dir().expect("test host should have a home");

        assert_eq!(resolve(Path::new("/a"), "~"), Some(home.clone()));
        assert_eq!(resolve(Path::new("/a"), "~/x"), Some(home.join("x")));
        assert_eq!(resolve(Path::new("/a"), "~someone/x"), None);
    }

    #[test]
    fn reports_directories_but_not_files_or_missing_paths() {
        let dir = std::env::temp_dir();
        let parent = dir.parent().expect("temp dir should have a parent");
        let name = dir
            .file_name()
            .expect("temp dir should have a name")
            .to_string_lossy()
            .into_owned();

        assert!(path_is_directory(
            parent.to_string_lossy().into_owned(),
            name
        ));
        assert!(!path_is_directory(
            dir.to_string_lossy().into_owned(),
            "panecrew-definitely-not-here".into()
        ));
    }
}
