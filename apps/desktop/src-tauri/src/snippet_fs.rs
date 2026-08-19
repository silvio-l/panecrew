//! The `://`-trigger's filesystem side: scaffolding `.panecrew/` for the
//! built-in `Init` System-Befehl (ADR 0006 — `.panecrew/` is a generic
//! project-config container, `snippets/` is one subfolder of it, not the
//! whole thing).
//!
//! Ticket 01 scope only: creating the folder and its example files. Parsing
//! real snippet Markdown+frontmatter and merging project/user directories is
//! Ticket 02's own module addition here, not built yet.

use std::path::Path;

/// Example snippet files `://init` writes into a fresh `.panecrew/snippets/`
/// — plain content, no variable substitution (spec: static text only).
const EXAMPLE_SNIPPETS: &[(&str, &str)] = &[
    (
        "hello.md",
        "---\ntrigger: hello\ndescription: Insert a friendly greeting\n---\nHello from PaneCrew!\n",
    ),
    (
        "commit-message.md",
        "---\ntrigger: commit\ndescription: Conventional commit message template\n---\ntype(scope): summary\n\nWhy this change was needed.\n",
    ),
];

/// Scaffolds `.panecrew/` and `.panecrew/snippets/` under `project_dir` if
/// missing, writing only the example files that don't already exist —
/// running it again (e.g. after an app update ships new examples) never
/// overwrites a user's own customizations.
pub fn snippet_init_dir(project_dir: &Path) -> Result<(), String> {
    let snippets_dir = project_dir.join(".panecrew").join("snippets");
    std::fs::create_dir_all(&snippets_dir)
        .map_err(|error| format!("could not create {}: {error}", snippets_dir.display()))?;

    for (name, content) in EXAMPLE_SNIPPETS {
        let path = snippets_dir.join(name);
        if path.exists() {
            continue;
        }
        std::fs::write(&path, content)
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    }
    Ok(())
}

// `async`: filesystem work must not run on the thread that dispatches IPC —
// same reasoning as `path_probe.rs`'s commands.
#[tauri::command(async)]
pub fn snippet_init(project_path: String) -> Result<(), String> {
    snippet_init_dir(Path::new(&project_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway tree under the system temp dir, removed by `drop` — same
    /// shape as `explorer_fs.rs`'s own `Fixture`.
    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new(name: &str) -> Self {
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
            let root = std::env::temp_dir()
                .join(format!("panecrew-snippet-fs-{}-{name}", std::process::id()));
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
    fn creates_every_example_file_in_an_empty_project() {
        let fixture = Fixture::new("empty");

        snippet_init_dir(&fixture.0).expect("init should succeed");

        let snippets_dir = fixture.0.join(".panecrew").join("snippets");
        for (name, content) in EXAMPLE_SNIPPETS {
            let written = std::fs::read_to_string(snippets_dir.join(name))
                .unwrap_or_else(|_| panic!("{name} should have been created"));
            assert_eq!(&written, content);
        }
    }

    #[test]
    fn leaves_an_existing_example_file_untouched_and_only_creates_the_missing_ones() {
        let fixture = Fixture::new("partial");
        let snippets_dir = fixture.0.join(".panecrew").join("snippets");
        std::fs::create_dir_all(&snippets_dir).expect("fixture dir should be creatable");
        let (first_name, _) = EXAMPLE_SNIPPETS[0];
        std::fs::write(
            snippets_dir.join(first_name),
            "--- customized by the user ---",
        )
        .expect("fixture file should be writable");

        snippet_init_dir(&fixture.0).expect("init should succeed");

        let untouched = std::fs::read_to_string(snippets_dir.join(first_name))
            .expect("existing file should still be there");
        assert_eq!(untouched, "--- customized by the user ---");

        let (second_name, second_content) = EXAMPLE_SNIPPETS[1];
        let created = std::fs::read_to_string(snippets_dir.join(second_name))
            .expect("missing example should have been created");
        assert_eq!(&created, second_content);
    }

    #[test]
    fn running_init_twice_stays_a_no_op_the_second_time() {
        let fixture = Fixture::new("idempotent");

        snippet_init_dir(&fixture.0).expect("first init should succeed");
        snippet_init_dir(&fixture.0).expect("second init should succeed");

        let snippets_dir = fixture.0.join(".panecrew").join("snippets");
        for (name, content) in EXAMPLE_SNIPPETS {
            let written = std::fs::read_to_string(snippets_dir.join(name)).expect("still there");
            assert_eq!(&written, content);
        }
    }
}
