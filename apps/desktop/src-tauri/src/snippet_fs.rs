//! The `://`-trigger's filesystem side: scaffolding `.panecrew/` for the
//! built-in `Init` System-Befehl (ADR 0006 — `.panecrew/` is a generic
//! project-config container, `snippets/` is one subfolder of it, not the
//! whole thing) — and, since Ticket 02, reading the real snippet Markdown
//! files it and users hand-author into that folder.

use std::collections::HashMap;
use std::path::Path;
use tauri::AppHandle;

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

/// A single parsed snippet Markdown file — frontmatter plus body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSnippet {
    pub trigger: String,
    pub description: String,
    /// Everything after the closing `---`, verbatim — no variable
    /// substitution (spec: static text only).
    pub body: String,
}

/// Trigger names the built-in `://` System-Befehle own. Kept in sync by hand
/// with the frontend's `systemCommands.ts` — there is no single
/// cross-language source for this fixed two-entry list, same as how
/// `adapters.ts`'s `ADAPTERS` isn't derived from Rust either.
const RESERVED_TRIGGERS: &[&str] = &["init", "reload-snippets"];

/// Parses one snippet file's content: a `---`-delimited YAML-shaped
/// frontmatter block (hand-rolled, not a real YAML parser — the shape is two
/// flat string keys, `trigger` and `description`, not worth a new dependency
/// for) followed by the body.
///
/// Splits each frontmatter line on the FIRST `:` rather than the last, so a
/// value that itself contains a colon (`description: Fix: the thing`)
/// survives intact instead of being cut at the wrong one.
pub fn parse_snippet_file(content: &str) -> Result<ParsedSnippet, String> {
    let mut rest = content;
    let (first_line, after_first) = split_line(rest);
    if first_line.trim() != "---" {
        return Err("missing opening \"---\" frontmatter delimiter".to_string());
    }
    rest = after_first;

    let mut trigger: Option<String> = None;
    let mut description: Option<String> = None;
    loop {
        let (line, after) = split_line(rest);
        if line.trim() == "---" {
            let body = after.strip_prefix('\n').unwrap_or(after);
            let trigger = trigger
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "missing \"trigger\" in frontmatter".to_string())?;
            let description = description
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "missing \"description\" in frontmatter".to_string())?;
            return Ok(ParsedSnippet {
                trigger,
                description,
                body: body.to_string(),
            });
        }
        if rest.is_empty() {
            return Err("missing closing \"---\" frontmatter delimiter".to_string());
        }

        if let Some(colon) = line.find(':') {
            let key = line[..colon].trim();
            let value = strip_matching_quotes(line[colon + 1..].trim());
            match key {
                "trigger" => trigger = Some(value.to_string()),
                "description" => description = Some(value.to_string()),
                // Unknown keys are ignored rather than rejected — the spec
                // only requires these two, and a stray key shouldn't turn a
                // valid snippet into a malformed one.
                _ => {}
            }
        }
        rest = after;
    }
}

/// The first line of `text` (without its terminator) and everything after it.
fn split_line(text: &str) -> (&str, &str) {
    match text.find('\n') {
        Some(index) => (text[..index].trim_end_matches('\r'), &text[index + 1..]),
        None => (text, ""),
    }
}

fn strip_matching_quotes(value: &str) -> &str {
    let bytes = value.as_bytes();
    if value.len() >= 2
        && ((bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\''))
    {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

/// Every `*.md` file directly in `dir`, parsed. A missing/unreadable
/// directory yields an empty list rather than an error — the normal state
/// before a project has ever run `://init`. A single malformed file is
/// logged and skipped, not allowed to fail the rest of the listing.
pub fn list_snippet_dir(dir: &Path) -> Vec<ParsedSnippet> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut snippets = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("md") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        match parse_snippet_file(&content) {
            Ok(parsed) => snippets.push(parsed),
            Err(error) => {
                log::warn!("skipping malformed snippet {}: {error}", path.display());
            }
        }
    }
    snippets
}

/// Combines project and user snippets into the list the `://` popup shows:
/// project wins on a trigger-name collision (`project` is iterated first,
/// `HashMap::entry().or_insert()` keeps only the first writer), and a
/// snippet using a reserved System-Befehl trigger name is dropped rather than
/// shadowing the built-in (spec, story 20).
///
/// Sorted by trigger name for a deterministic, testable order — the two
/// source directories have no inherent ordering relative to each other.
pub fn merge_snippets(project: Vec<ParsedSnippet>, user: Vec<ParsedSnippet>) -> Vec<ParsedSnippet> {
    let mut by_trigger: HashMap<String, ParsedSnippet> = HashMap::new();
    for snippet in project.into_iter().chain(user) {
        if RESERVED_TRIGGERS.contains(&snippet.trigger.as_str()) {
            log::warn!(
                "skipping snippet using reserved trigger name \"{}\"",
                snippet.trigger
            );
            continue;
        }
        by_trigger.entry(snippet.trigger.clone()).or_insert(snippet);
    }
    let mut merged: Vec<ParsedSnippet> = by_trigger.into_values().collect();
    merged.sort_by(|a, b| a.trigger.cmp(&b.trigger));
    merged
}

/// Wire shape for `snippet_list`'s response — the frontend's
/// `SnippetCandidate` adds `kind: "snippet"` itself, since this command only
/// ever returns real (never System-Befehl) entries.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetDto {
    pub trigger: String,
    pub description: String,
    pub body: String,
}

impl From<ParsedSnippet> for SnippetDto {
    fn from(snippet: ParsedSnippet) -> Self {
        Self {
            trigger: snippet.trigger,
            description: snippet.description,
            body: snippet.body,
        }
    }
}

/// Reads and merges `{project_path}/.panecrew/snippets/` and
/// `app_data_dir()/snippets/` — the one read-at-startup pass the spec calls
/// for (no filesystem watching); `://reload-snippets` (Ticket 03) re-runs
/// this same command on demand instead.
// `async`: same reasoning as `snippet_init` above.
#[tauri::command(async)]
pub fn snippet_list(project_path: String, app: AppHandle) -> Result<Vec<SnippetDto>, String> {
    let project_dir = Path::new(&project_path).join(".panecrew").join("snippets");
    let user_dir = crate::settings_commands::app_data_dir(&app)?.join("snippets");

    let project = list_snippet_dir(&project_dir);
    let user = list_snippet_dir(&user_dir);
    Ok(merge_snippets(project, user)
        .into_iter()
        .map(SnippetDto::from)
        .collect())
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

        fn write(&self, relative: &str, content: &str) {
            std::fs::write(self.0.join(relative), content)
                .expect("fixture file should be writable");
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

    #[test]
    fn parses_a_well_formed_snippet_file() {
        let parsed = parse_snippet_file(
            "---\ntrigger: hello\ndescription: A friendly greeting\n---\nHello there!\n",
        )
        .expect("well-formed file should parse");

        assert_eq!(
            parsed,
            ParsedSnippet {
                trigger: "hello".to_string(),
                description: "A friendly greeting".to_string(),
                body: "Hello there!\n".to_string(),
            }
        );
    }

    #[test]
    fn a_colon_inside_the_description_value_does_not_truncate_it() {
        let parsed = parse_snippet_file(
            "---\ntrigger: fix\ndescription: Fix: the thing that broke\n---\nbody\n",
        )
        .expect("should parse");

        assert_eq!(parsed.description, "Fix: the thing that broke");
    }

    #[test]
    fn rejects_a_file_missing_the_opening_delimiter() {
        assert!(parse_snippet_file("trigger: hello\ndescription: x\n---\nbody").is_err());
    }

    #[test]
    fn rejects_a_file_missing_the_closing_delimiter() {
        assert!(parse_snippet_file("---\ntrigger: hello\ndescription: x\nbody").is_err());
    }

    #[test]
    fn rejects_a_file_missing_the_trigger_key() {
        assert!(parse_snippet_file("---\ndescription: x\n---\nbody").is_err());
    }

    #[test]
    fn rejects_a_file_missing_the_description_key() {
        assert!(parse_snippet_file("---\ntrigger: hello\n---\nbody").is_err());
    }

    #[test]
    fn a_malformed_file_is_skipped_without_failing_the_rest_of_the_listing() {
        let fixture = Fixture::new("malformed-listing");
        fixture.write(
            "good.md",
            "---\ntrigger: good\ndescription: fine\n---\nbody\n",
        );
        fixture.write("bad.md", "not even frontmatter");
        // A non-`.md` file in the same directory is ignored outright, not
        // even attempted as a snippet.
        fixture.write("notes.txt", "---\ntrigger: x\ndescription: x\n---\n");

        let snippets = list_snippet_dir(&fixture.0);

        assert_eq!(
            snippets,
            vec![parse_snippet_file("---\ntrigger: good\ndescription: fine\n---\nbody\n").unwrap()]
        );
    }

    #[test]
    fn merge_prefers_the_project_snippet_on_a_trigger_name_collision() {
        let project = vec![ParsedSnippet {
            trigger: "commit".to_string(),
            description: "project version".to_string(),
            body: "project body".to_string(),
        }];
        let user = vec![ParsedSnippet {
            trigger: "commit".to_string(),
            description: "user version".to_string(),
            body: "user body".to_string(),
        }];

        let merged = merge_snippets(project, user);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].description, "project version");
    }

    #[test]
    fn merge_keeps_non_colliding_snippets_from_both_sides() {
        let project = vec![ParsedSnippet {
            trigger: "a".to_string(),
            description: "d".to_string(),
            body: "b".to_string(),
        }];
        let user = vec![ParsedSnippet {
            trigger: "b".to_string(),
            description: "d".to_string(),
            body: "b".to_string(),
        }];

        let merged = merge_snippets(project, user);

        assert_eq!(
            merged
                .iter()
                .map(|s| s.trigger.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
    }

    #[test]
    fn merge_excludes_a_snippet_using_a_reserved_system_trigger_name() {
        let project = vec![ParsedSnippet {
            trigger: "init".to_string(),
            description: "shadow attempt".to_string(),
            body: "".to_string(),
        }];

        let merged = merge_snippets(project, Vec::new());

        assert!(merged.is_empty());
    }
}
