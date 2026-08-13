//! Read-only "does this resolve to a directory?" probe for the terminal's
//! inline suggestions.
//!
//! Shell history files record no working directory, so a history entry like
//! `cd Desktop` says nothing about whether `Desktop` exists where the pane's
//! shell currently stands. This is the check that turns that guess into a
//! fact. It lives in Rust for the same reason `shell_history` does: the
//! webview has no filesystem access in this app at all.

use std::path::{Path, PathBuf};

// `async`: same reasoning as `explorer_fs.rs::explorer_read_tree` — a
// filesystem probe must not run on the thread that dispatches IPC.
#[tauri::command(async)]
pub fn path_is_directory(cwd: String, path: String) -> bool {
    // `is_dir` follows symlinks, which is what `cd` does too.
    resolve(Path::new(&cwd), &path).is_some_and(|resolved| resolved.is_dir())
}

/// How many names one `cd` popup can ever show.
///
/// A home directory or `/usr/lib` has hundreds of subdirectories; listing them
/// all would be a wall of text nobody scrolls, and a payload nobody reads. The
/// cap applies AFTER sorting, so it always cuts the tail of one stable list
/// rather than whatever `read_dir` happened to yield first.
const MAX_SUBDIRECTORIES: usize = 50;

/// The subdirectories of `cwd`/`directory` whose name starts with `prefix`.
///
/// The caller splits the typed path itself — `src/te` arrives as
/// `directory = "src/"` plus `prefix = "te"` — because that split is plain
/// string work. Turning `directory` into a real path is not: `~`, relative and
/// absolute forms all resolve here, through the same `resolve` the directory
/// probe uses, so the frontend never has to know what a home directory is.
///
/// Read-only and exactly one level deep. An unreadable or missing directory is
/// not an error worth surfacing — while a path is being typed it is the normal
/// state, and an empty list is already the honest answer ("nothing to offer").
// `async`: same reasoning as `path_is_directory` above.
#[tauri::command(async)]
pub fn list_subdirectories(cwd: String, directory: String, prefix: String) -> Vec<String> {
    let base = if directory.is_empty() {
        PathBuf::from(&cwd)
    } else {
        match resolve(Path::new(&cwd), &directory) {
            Some(path) => path,
            None => return Vec::new(),
        }
    };
    let Ok(entries) = std::fs::read_dir(base) else {
        return Vec::new();
    };

    // Dot directories only on request — the convention every shell follows,
    // and the reason `cd ` in a repo root doesn't open with `.git`.
    let hidden_wanted = prefix.starts_with('.');
    // Case-insensitive, because the machines this runs on are: on macOS's APFS
    // and on Windows, `cd sr` really does reach `Src`. A case-sensitive filter
    // would offer less than `cd` itself can do. Whatever is accepted is the
    // real name, not the typed spelling — see `completionInsert` on the
    // frontend side.
    let needle = prefix.to_lowercase();

    let mut names: Vec<String> = entries
        .flatten()
        // `is_dir` on the path follows symlinks, unlike `entry.file_type()` —
        // same reason as in `path_is_directory`: a symlinked directory is one
        // `cd` can enter.
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| {
            (hidden_wanted || !name.starts_with('.')) && name.to_lowercase().starts_with(&needle)
        })
        .collect();
    names.sort_by(|a, b| {
        a.to_lowercase()
            .cmp(&b.to_lowercase())
            .then_with(|| a.cmp(b))
    });
    names.truncate(MAX_SUBDIRECTORIES);
    names
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

    /// A throwaway tree under the system temp dir, removed by `drop`.
    struct Fixture(PathBuf);

    impl Fixture {
        fn new(name: &str, entries: &[&str]) -> Self {
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
            let root = std::env::temp_dir()
                .join(format!("panecrew-subdirs-{}-{name}", std::process::id()));
            std::fs::remove_dir_all(&root).ok();
            for entry in entries {
                match entry.strip_suffix('/') {
                    Some(dir) => std::fs::create_dir_all(root.join(dir)),
                    None => std::fs::create_dir_all(root.join(entry).parent().expect("has parent"))
                        .and_then(|()| std::fs::write(root.join(entry), b"x")),
                }
                .expect("test fixture should be creatable");
            }
            Self(root)
        }

        fn cwd(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    #[test]
    fn lists_only_directories_and_sorts_them() {
        let fixture = Fixture::new("plain", &["src/", "docs/", "README.md", "apps/"]);

        assert_eq!(
            list_subdirectories(fixture.cwd(), String::new(), String::new()),
            vec!["apps", "docs", "src"]
        );
    }

    #[test]
    fn filters_by_prefix_regardless_of_case() {
        // On the case-insensitive filesystems this app targets, `cd sr` really
        // does reach `Src` — offering less than `cd` can do would be the bug.
        let fixture = Fixture::new("prefix", &["src/", "Srv/", "docs/"]);

        assert_eq!(
            list_subdirectories(fixture.cwd(), String::new(), "sr".into()),
            vec!["src", "Srv"]
        );
    }

    #[test]
    fn hides_dot_directories_until_the_prefix_asks_for_them() {
        let fixture = Fixture::new("hidden", &[".git/", ".cache/", "src/"]);

        assert_eq!(
            list_subdirectories(fixture.cwd(), String::new(), String::new()),
            vec!["src"]
        );
        assert_eq!(
            list_subdirectories(fixture.cwd(), String::new(), ".".into()),
            vec![".cache", ".git"]
        );
    }

    #[test]
    fn lists_one_level_below_a_typed_directory() {
        let fixture = Fixture::new("nested", &["src/terminal/", "src/test/", "src/App.tsx"]);

        assert_eq!(
            list_subdirectories(fixture.cwd(), "src/".into(), "te".into()),
            vec!["terminal", "test"]
        );
    }

    #[test]
    fn answers_an_unreadable_or_unresolvable_directory_with_nothing() {
        let fixture = Fixture::new("missing", &["src/"]);

        assert!(list_subdirectories(fixture.cwd(), "nope/".into(), String::new()).is_empty());
        // `~someone` — the one form `resolve` deliberately refuses.
        assert!(list_subdirectories(fixture.cwd(), "~someone/".into(), String::new()).is_empty());
    }

    #[test]
    fn caps_the_list_after_sorting_it() {
        let names: Vec<String> = (0..60).map(|index| format!("dir{index:02}/")).collect();
        let fixture = Fixture::new(
            "capped",
            &names.iter().map(String::as_str).collect::<Vec<_>>(),
        );

        let listed = list_subdirectories(fixture.cwd(), String::new(), String::new());

        assert_eq!(listed.len(), MAX_SUBDIRECTORIES);
        // The cut is the tail of one stable list, not an arbitrary 50 of 60.
        assert_eq!(listed.first().map(String::as_str), Some("dir00"));
        assert_eq!(listed.last().map(String::as_str), Some("dir49"));
    }

    #[test]
    fn reports_directories_but_not_files_or_missing_paths() {
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- just a real, existing directory to probe, not a security operation.
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
