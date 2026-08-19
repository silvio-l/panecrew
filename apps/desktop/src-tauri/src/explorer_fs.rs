//! Directory tree + file operations for the explorer.
//!
//! Stateless, like `path_probe.rs`: no persistent handle to manage, so this
//! stays a set of plain functions annotated `#[tauri::command]` rather than a
//! manager/commands split. `kind`/`FileKind` is deliberately absent from
//! `DirEntryNode` — that's a presentational concern the frontend derives from
//! the filename (see `types/project.ts`), not something Rust needs to know.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::io;
use std::path::Path;

/// Build output and dependency trees, large enough to dwarf a project's
/// actual source by orders of magnitude. Once also hid these from the plain
/// tree view (`explorer_read_dir`) — reverted (2026-08-16): the reference
/// editor's own `files.exclude` default only hides `.git`/`.svn`/`.hg`/
/// `.DS_Store`/`Thumbs.db`, NOT `node_modules` (that's `search.exclude`, a
/// completely separate, search-only list) — its Explorer shows the real
/// directory as it is, dependency/build noise included, and only keeps it
/// out of search results and (via its own `files.watcherExclude`, narrower
/// still) out of the heaviest watch churn. This list is now exactly that: a
/// search/watch-only exclusion, shared between `search_walk`/
/// `content_search_walk` below and `explorer_watch.rs`, never applied to the
/// tree itself.
const DENYLIST: &[&str] = &["node_modules", "target", "dist", "build", ".next", "out"];

/// Shared with `explorer_watch.rs` so recursive search and the filesystem
/// watcher can never drift apart on which directories to skip. NOT used by
/// the plain tree view (`explorer_read_dir`) — see `DENYLIST`'s doc comment.
pub(crate) fn is_ignored_entry(name: &str) -> bool {
    name == ".git" || DENYLIST.contains(&name)
}

/// One directory level, sorted (folders before files, both case-insensitive
/// — same convention `path_probe.rs` uses for its own directory listing) and
/// denylist-filtered, with no recursion and no shared budget across calls —
/// the reference editor's own lazy-expand model: a folder's children are
/// fetched only when the user opens it. This is what makes the explorer's
/// completeness independent of any folder's name or position: nothing here
/// can starve a sibling directory's listing, because there is no cap shared
/// across directories to starve.
#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct DirEntryNode {
    pub name: String,
    pub is_dir: bool,
}

#[tauri::command(async)]
pub fn explorer_read_dir(path: String) -> Result<Vec<DirEntryNode>, String> {
    // `filter: false` — the plain tree view shows the real directory as it
    // is, unlike the rekursiven Suchläufe unten (`search_walk`/
    // `content_search_walk`, beide weiter mit `filter: true`): anders als
    // eine Volltextsuche, die unbemerkt tausende Git-Objekte oder
    // Dependency-Dateien durchpflügen könnte, klappt der Nutzer hier jeden
    // Ordner selbst auf, wenn er hineinschauen will (siehe `DENYLIST`s
    // Kopfkommentar für die Referenz-Editor-Recherche, an der sich diese
    // Trennung orientiert).
    read_dir_entries(Path::new(&path), false)
        .map_err(|error| format!("Verzeichnis konnte nicht gelesen werden: {error}"))
}

/// Creates an empty file at `path`. Refuses to overwrite an existing one
/// (`create_new` fails atomically rather than racing a separate existence
/// check) and does not create a missing parent directory — this command
/// adds one entry to an already-visible folder, nothing more.
#[tauri::command]
pub fn explorer_create_file(path: String) -> Result<(), String> {
    std::fs::File::create_new(&path)
        .map(|_file| ())
        .map_err(|error| format!("Datei konnte nicht angelegt werden: {error}"))
}

/// Creates an empty directory at `path`. `create_dir`, not `create_dir_all`:
/// refuses both an already-existing target and a missing parent, for the
/// same reason `explorer_create_file` refuses both.
#[tauri::command]
pub fn explorer_create_directory(path: String) -> Result<(), String> {
    std::fs::create_dir(&path)
        .map_err(|error| format!("Ordner konnte nicht angelegt werden: {error}"))
}

/// Renames/moves a file or directory from `from` to `to`, refusing to
/// clobber an existing target — `std::fs::rename` has no atomic
/// rename-if-absent, so this accepts the same TOCTOU race
/// `explorer_create_file`'s comment already accepts for its own
/// existence check.
///
/// The one exception is a case-only rename on a case-insensitive filesystem
/// (macOS's default): there, `to` already "exists" as `from` itself under a
/// different spelling, and `try_exists` alone would reject a rename like
/// `Foo.ts` → `foo.ts` that changes nothing on disk but the letter case. This
/// is resolved by canonicalizing both sides — if `to` happens to exist AND
/// resolves to the very same entry as `from`, that's not a collision, it's
/// the rename itself.
#[tauri::command(async)]
pub fn explorer_rename(from: String, to: String) -> Result<(), String> {
    let from_path = Path::new(&from);
    let to_path = Path::new(&to);

    let same_entry = std::fs::canonicalize(from_path)
        .and_then(|from_real| std::fs::canonicalize(to_path).map(|to_real| from_real == to_real))
        .unwrap_or(false);

    if !same_entry && to_path.try_exists().unwrap_or(false) {
        return Err("Am Zielpfad existiert bereits ein Eintrag".to_string());
    }

    std::fs::rename(from_path, to_path)
        .map_err(|error| format!("Umbenennen fehlgeschlagen: {error}"))
}

/// Moves a file or directory to the system trash (Finder's Trash on macOS,
/// the Recycle Bin on Windows) rather than deleting it outright — the
/// explorer is the one place in the app that can remove a project file the
/// user never explicitly asked PaneCrew to touch, and an accidental delete
/// here should stay recoverable through the normal OS mechanism. The `trash`
/// crate figures out file-vs-directory itself; nothing here needs to.
#[tauri::command(async)]
pub fn explorer_delete(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|error| format!("Löschen fehlgeschlagen: {error}"))
}

/// The mini editor loads a whole file into one `<textarea>` — refusing
/// anything above a sane ceiling keeps that plan-text-only, in-memory
/// approach from freezing the app on an accidental huge file.
const MAX_EDITABLE_FILE_BYTES: u64 = 1024 * 1024;

/// A file's on-disk identity at read time, round-tripped back into
/// `explorer_write_file` so it can refuse to overwrite a file that changed
/// underneath PaneCrew (e.g. a CLI agent editing the same tree) instead of
/// silently clobbering it.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileStamp {
    pub modified_ms: u64,
    pub len: u64,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct FileContents {
    /// Always LF-normalized, regardless of the file's actual line endings —
    /// a `<textarea>`'s `.value` normalizes to LF anyway, so this is what the
    /// frontend needs; `crlf` lets `explorer_write_file` restore the original
    /// ending on save instead of rewriting every line of a CRLF file.
    pub text: String,
    pub crlf: bool,
    pub stamp: FileStamp,
}

fn file_stamp(metadata: &std::fs::Metadata) -> Result<FileStamp, String> {
    let modified_ms = metadata
        .modified()
        .and_then(|modified| {
            modified
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| io::Error::other(error.to_string()))
        })
        .map_err(|error| format!("Änderungszeitpunkt konnte nicht gelesen werden: {error}"))?
        .as_millis() as u64;
    Ok(FileStamp {
        modified_ms,
        len: metadata.len(),
    })
}

/// Reads a file for the mini editor. The size check happens against
/// `metadata()` first, before any byte of the file is read into memory, so a
/// huge file is refused up front rather than after loading it.
// `async`: same reasoning as `explorer_read_dir` — full-file reads must not
// run on the thread that dispatches IPC.
#[tauri::command(async)]
pub fn explorer_read_file(path: String) -> Result<FileContents, String> {
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("Datei konnte nicht gelesen werden: {error}"))?;
    if metadata.is_dir() {
        return Err("Ordner können nicht im Editor geöffnet werden".to_string());
    }
    if metadata.len() > MAX_EDITABLE_FILE_BYTES {
        return Err(format!(
            "Datei ist zu groß für den Editor ({} Bytes, Grenze {MAX_EDITABLE_FILE_BYTES} Bytes)",
            metadata.len()
        ));
    }

    let bytes = std::fs::read(&path)
        .map_err(|error| format!("Datei konnte nicht gelesen werden: {error}"))?;
    // `from_utf8`, never the `_lossy` sibling: lossy decoding silently turns
    // invalid bytes into U+FFFD, and writing that back out would corrupt a
    // binary file instead of refusing to open it.
    let raw = String::from_utf8(bytes).map_err(|_error| {
        "Datei ist keine UTF-8-Textdatei und kann nicht bearbeitet werden".to_string()
    })?;
    let crlf = raw.contains("\r\n");
    let text = if crlf { raw.replace("\r\n", "\n") } else { raw };
    let stamp = file_stamp(&metadata)?;
    Ok(FileContents { text, crlf, stamp })
}

/// Larger than `MAX_EDITABLE_FILE_BYTES`: previews commonly include short
/// video clips, not just text-sized assets. Still bounded -- the whole file
/// is base64-encoded and sent as one IPC message, not streamed.
const MAX_PREVIEWABLE_MEDIA_BYTES: u64 = 50 * 1024 * 1024;

/// Reads a file's raw bytes for the image/video preview render mode (Ticket
/// 38), base64-encoded for transport as a single IPC/JSON string. Mirrors
/// `explorer_read_file`'s is-dir/size-ceiling checks; unlike that command,
/// there is no UTF-8 requirement -- the whole point here is displaying
/// binary content the text editor refuses to open. Mime-type/extension
/// routing stays entirely on the frontend (`mediaKind.ts`), which is also
/// what decides whether to call this command at all instead of
/// `explorer_read_file` -- this command itself trusts that choice and just
/// moves bytes.
// `async`: same reasoning as `explorer_read_file` -- a full-file read plus
// base64 encoding must not run on the thread that dispatches IPC.
#[tauri::command(async)]
pub fn explorer_read_media(path: String) -> Result<String, String> {
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("Datei konnte nicht gelesen werden: {error}"))?;
    if metadata.is_dir() {
        return Err("Ordner können nicht als Vorschau geöffnet werden".to_string());
    }
    if metadata.len() > MAX_PREVIEWABLE_MEDIA_BYTES {
        return Err(format!(
            "Datei ist zu groß für die Vorschau ({} Bytes, Grenze {MAX_PREVIEWABLE_MEDIA_BYTES} Bytes)",
            metadata.len()
        ));
    }

    let bytes = std::fs::read(&path)
        .map_err(|error| format!("Datei konnte nicht gelesen werden: {error}"))?;
    Ok(BASE64_STANDARD.encode(bytes))
}

/// Removes its temp file on drop — a `?` on any step between creating the
/// temp file and the final rename in `explorer_write_file` must not leave a
/// `.panecrew-tmp-*` file behind. Harmless to run after a successful rename
/// too: the temp path is already gone by then, so the removal is a no-op.
struct TempFileGuard(std::path::PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        std::fs::remove_file(&self.0).ok();
    }
}

/// Writes `contents` back to `path` — but only if `expected` (the stamp
/// `explorer_read_file` returned when the edit started) still matches the
/// file's current on-disk stamp. A mismatch means something outside
/// PaneCrew changed the file since — the most likely data-loss scenario in
/// an app whose whole point is a CLI agent editing the same tree the user
/// has open, so this refuses to write rather than silently clobbering it.
/// To force the write through anyway, call again with `expected` set to the
/// file's current stamp (e.g. re-read it first).
///
/// The write itself never touches the target in place: contents go to a
/// sibling temp file first, `sync_all()`'d before the rename, so a crash
/// between writing and renaming leaves either the old file or the new one
/// intact, never a half-written one.
// `async`: same reasoning as `explorer_read_dir` — the sync-then-rename
// write must not run on the thread that dispatches IPC.
#[tauri::command(async)]
pub fn explorer_write_file(
    path: String,
    contents: String,
    crlf: bool,
    expected: FileStamp,
) -> Result<FileStamp, String> {
    use std::io::Write;

    let path = std::fs::canonicalize(&path)
        .map_err(|error| format!("Datei konnte nicht gefunden werden: {error}"))?;
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("Datei konnte nicht gelesen werden: {error}"))?;
    if file_stamp(&metadata)? != expected {
        return Err("Datei wurde außerhalb von PaneCrew geändert".to_string());
    }

    let dir = path
        .parent()
        .ok_or_else(|| "Datei hat kein Elternverzeichnis".to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "Ungültiger Dateiname".to_string())?
        .to_string_lossy();
    // In the target's own directory, not `env::temp_dir()`: a rename across
    // filesystem/device boundaries isn't atomic (and can outright fail).
    let temp_path = dir.join(format!(".{file_name}.panecrew-tmp-{}", std::process::id()));

    let bytes = if crlf {
        contents.replace('\n', "\r\n").into_bytes()
    } else {
        contents.into_bytes()
    };

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|error| format!("Temporäre Datei konnte nicht angelegt werden: {error}"))?;
    let guard = TempFileGuard(temp_path.clone());
    file.write_all(&bytes)
        .map_err(|error| format!("Datei konnte nicht geschrieben werden: {error}"))?;
    // Without this, a crash right after the rename below can still leave a
    // 0-byte or partially flushed file — the actual corruption case "never
    // acceptable" refers to.
    file.sync_all()
        .map_err(|error| format!("Datei konnte nicht geschrieben werden: {error}"))?;
    drop(file);
    // Applies mode bits on unix, the readonly flag on windows — otherwise a
    // save silently drops e.g. a shell script's executable bit.
    std::fs::set_permissions(&temp_path, metadata.permissions()).ok();

    std::fs::rename(&temp_path, &path)
        .map_err(|error| format!("Datei konnte nicht gespeichert werden: {error}"))?;
    drop(guard);

    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("Datei konnte nicht gelesen werden: {error}"))?;
    file_stamp(&metadata)
}

/// One directory level, sorted folders-before-files (both case-insensitive —
/// same convention `path_probe.rs` uses for its own directory listing). No
/// recursion, no budget: the shared primitive behind `explorer_read_dir`
/// (lazy expansion), `search_walk` (full-tree name search) and
/// `content_search_walk` (full-tree content search).
///
/// `filter` applies `is_ignored_entry`'s denylist (`node_modules`/`target`/…
/// and `.git`) — `true` for the two recursive search walks, which would
/// otherwise silently churn through thousands of dependency files or opaque
/// git objects for no benefit. `explorer_read_dir` passes `false`: the plain
/// tree view shows the real directory as it is, the same split the reference
/// editor itself draws between `files.exclude` (near-empty by default) and
/// `search.exclude` (see `DENYLIST`'s doc comment).
fn read_dir_entries(dir: &Path, filter: bool) -> io::Result<Vec<DirEntryNode>> {
    let mut entries: Vec<std::fs::DirEntry> = std::fs::read_dir(dir)?.flatten().collect();

    if filter {
        entries.retain(|entry| !is_ignored_entry(&entry.file_name().to_string_lossy()));
    }

    // `is_dir()` on the resolved path, not `DirEntry::file_type()` — the
    // latter doesn't follow symlinks on Unix, which would flip a symlinked
    // directory into a "file" here.
    let mut dated: Vec<(std::fs::DirEntry, bool)> = entries
        .into_iter()
        .map(|entry| {
            let is_dir = entry.path().is_dir();
            (entry, is_dir)
        })
        .collect();

    dated.sort_by(|(a, a_is_dir), (b, b_is_dir)| {
        a_is_dir.cmp(b_is_dir).reverse().then_with(|| {
            a.file_name()
                .to_string_lossy()
                .to_lowercase()
                .cmp(&b.file_name().to_string_lossy().to_lowercase())
        })
    });

    Ok(dated
        .into_iter()
        .map(|(entry, is_dir)| DirEntryNode {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir,
        })
        .collect())
}

/// Matches capped at this count, not entries scanned — the cap is on
/// *relevant* results and is reported back via `SearchResult::truncated`
/// rather than silently dropping unrelated siblings.
const MAX_SEARCH_MATCHES: usize = 500;

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct SearchTreeNode {
    pub name: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<SearchTreeNode>>,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct SearchResult {
    pub nodes: Vec<SearchTreeNode>,
    pub truncated: bool,
}

/// Full-tree name search independent of the lazy per-directory loading above
/// — the explorer's search must still find a match nested under a folder the
/// user never expanded, so this walks the whole tree itself (denylist-
/// filtered, same as everywhere else) rather than searching only what's
/// already been loaded into the frontend's cache. Returns a pruned tree: only
/// the ancestor chain down to each match, not whole sibling subtrees that
/// don't match — same shape `types/treeFilter.ts`'s client-side `filterTree`
/// used to produce before this replaced it.
#[tauri::command(async)]
pub fn explorer_search_names(root: String, query: String) -> Result<SearchResult, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(SearchResult {
            nodes: Vec::new(),
            truncated: false,
        });
    }
    let mut matches = 0usize;
    let mut truncated = false;
    let nodes = search_walk(Path::new(&root), &needle, &mut matches, &mut truncated)
        .map_err(|error| format!("Suche fehlgeschlagen: {error}"))?;
    Ok(SearchResult { nodes, truncated })
}

fn search_walk(
    dir: &Path,
    needle: &str,
    matches: &mut usize,
    truncated: &mut bool,
) -> io::Result<Vec<SearchTreeNode>> {
    let entries = read_dir_entries(dir, true)?;
    let mut result = Vec::new();

    for entry in entries {
        if *matches >= MAX_SEARCH_MATCHES {
            *truncated = true;
            break;
        }

        let own_match = entry.name.to_lowercase().contains(needle);
        if entry.is_dir {
            let children = search_walk(&dir.join(&entry.name), needle, matches, truncated)?;
            if own_match || !children.is_empty() {
                if own_match {
                    *matches += 1;
                }
                result.push(SearchTreeNode {
                    name: entry.name,
                    is_dir: true,
                    children: Some(children),
                });
            }
        } else if own_match {
            *matches += 1;
            result.push(SearchTreeNode {
                name: entry.name,
                is_dir: false,
                children: None,
            });
        }
    }

    Ok(result)
}

/// A single line match inside one file — `line` is 1-indexed (the convention
/// every text editor and `grep -n` use, not the 0-indexed offset
/// `text.lines().enumerate()` produces internally).
#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct ContentMatch {
    pub line: u32,
    pub preview: String,
}

/// Same shape as `SearchTreeNode` (pruned ancestor chain, folders carry
/// `children`), but a leaf also carries its own line matches instead of just
/// existing/not-existing — content search has no equivalent of a name search's
/// single match-or-not per file. `skip_serializing_if` on `matches` keeps a
/// directory node's JSON free of a pointless empty array.
#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct ContentSearchNode {
    pub name: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<ContentSearchNode>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub matches: Vec<ContentMatch>,
}

#[derive(serde::Serialize, Debug, Clone, PartialEq, Eq)]
pub struct ContentSearchResult {
    pub nodes: Vec<ContentSearchNode>,
    pub truncated: bool,
}

/// Total line-match budget across the whole search, mirroring
/// `MAX_SEARCH_MATCHES`'s name-search budget and the same
/// capped-not-dropped/`truncated`-flagged contract.
const MAX_CONTENT_SEARCH_MATCHES: usize = 500;

/// A second, per-file budget on top of the total one above: without it, one
/// huge generated file (a lockfile, a minified bundle) full of matches could
/// alone exhaust the entire search's budget before any other file gets a
/// look-in.
const MAX_CONTENT_MATCHES_PER_FILE: usize = 20;

/// Files above this size are skipped by `metadata()` alone, no bytes read —
/// generous enough for real source files, small enough that a search never
/// has to load a multi-megabyte asset into memory just to scan it.
const MAX_SEARCHABLE_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// How many leading bytes are checked for a NUL byte to sniff "this is
/// binary, not text" — same heuristic `git` and most greps use, cheaper than
/// a full UTF-8 decode attempt on a multi-megabyte binary just to reject it.
const BINARY_SNIFF_BYTES: usize = 8000;

/// A single matched line is capped this long in the returned preview — a
/// minified file with a match on an otherwise multi-thousand-character line
/// must not blow up the response size over one hit.
const PREVIEW_MAX_CHARS: usize = 200;

/// Full-tree file-*contents* search, the sibling of `explorer_search_names`
/// above for full-text rather than filename matches. Same walk shape (full
/// tree, denylist-filtered, pruned-to-ancestors result, capped-with-
/// `truncated`-flag) — see that function's doc comment for the shared
/// rationale. Case-insensitive like the name search, for the same reason: a
/// search that's case-sensitive for contents but not names would be a bug
/// users feel, not a deliberate distinction.
#[tauri::command(async)]
pub fn explorer_search_contents(
    root: String,
    query: String,
) -> Result<ContentSearchResult, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(ContentSearchResult {
            nodes: Vec::new(),
            truncated: false,
        });
    }
    let mut matches = 0usize;
    let mut truncated = false;
    let nodes = content_search_walk(Path::new(&root), &needle, &mut matches, &mut truncated)
        .map_err(|error| format!("Inhaltssuche fehlgeschlagen: {error}"))?;
    Ok(ContentSearchResult { nodes, truncated })
}

fn content_search_walk(
    dir: &Path,
    needle: &str,
    matches: &mut usize,
    truncated: &mut bool,
) -> io::Result<Vec<ContentSearchNode>> {
    let entries = read_dir_entries(dir, true)?;
    let mut result = Vec::new();

    for entry in entries {
        if *matches >= MAX_CONTENT_SEARCH_MATCHES {
            *truncated = true;
            break;
        }

        let path = dir.join(&entry.name);
        if entry.is_dir {
            let children = content_search_walk(&path, needle, matches, truncated)?;
            if !children.is_empty() {
                result.push(ContentSearchNode {
                    name: entry.name,
                    is_dir: true,
                    children: Some(children),
                    matches: Vec::new(),
                });
            }
        } else {
            let file_matches = search_file_contents(&path, needle, matches)?;
            if !file_matches.is_empty() {
                result.push(ContentSearchNode {
                    name: entry.name,
                    is_dir: false,
                    children: None,
                    matches: file_matches,
                });
            }
        }
    }

    Ok(result)
}

/// Scans one file for `needle`, capped both against the shared total budget
/// (`matches`, so `truncated` stays accurate across the whole search) and
/// `MAX_CONTENT_MATCHES_PER_FILE` (a silent, unflagged cap — unlike the total
/// budget it isn't reported back, the same way the denylist itself isn't:
/// both are search-shape decisions, not something dropped un-intentionally).
/// Skips anything too large to be a real source file, anything that sniffs as
/// binary, and anything that isn't valid UTF-8 — "refuse rather than guess",
/// the same rule `explorer_read_file` already applies to the editor.
fn search_file_contents(
    path: &Path,
    needle: &str,
    matches: &mut usize,
) -> io::Result<Vec<ContentMatch>> {
    // `metadata`/`read` use `let Ok(..) = .. else` rather than `?`: a broken
    // symlink, a permission-restricted file, or a file deleted between
    // `read_dir_entries` and this read must not abort the whole search —
    // skipping one unreadable file is the same convention `read_dir_entries`
    // already applies to unreadable directory entries via `.flatten()`.
    let Ok(metadata) = std::fs::metadata(path) else {
        return Ok(Vec::new());
    };
    if metadata.len() > MAX_SEARCHABLE_FILE_BYTES {
        return Ok(Vec::new());
    }

    let Ok(bytes) = std::fs::read(path) else {
        return Ok(Vec::new());
    };
    if bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0) {
        return Ok(Vec::new());
    }
    let Ok(text) = String::from_utf8(bytes) else {
        return Ok(Vec::new());
    };

    let mut found = Vec::new();
    for (index, line) in text.lines().enumerate() {
        if *matches >= MAX_CONTENT_SEARCH_MATCHES || found.len() >= MAX_CONTENT_MATCHES_PER_FILE {
            break;
        }
        if line.to_lowercase().contains(needle) {
            *matches += 1;
            found.push(ContentMatch {
                line: (index + 1) as u32,
                preview: truncate_preview(line),
            });
        }
    }
    Ok(found)
}

fn truncate_preview(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() > PREVIEW_MAX_CHARS {
        let head: String = trimmed.chars().take(PREVIEW_MAX_CHARS).collect();
        format!("{head}…")
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway tree under the system temp dir, removed by `drop` — same
    /// shape as `path_probe.rs`'s own `Fixture`.
    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new(name: &str, entries: &[&str]) -> Self {
            // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch dir, not a security operation.
            let root = std::env::temp_dir().join(format!(
                "panecrew-explorer-fs-{}-{name}",
                std::process::id()
            ));
            std::fs::remove_dir_all(&root).ok();
            // `entries` may be empty (fixtures that only need a bare root to
            // create things into) — the loop below would then never call
            // `create_dir_all` at all, so the root itself needs its own call.
            std::fs::create_dir_all(&root).expect("test fixture root should be creatable");
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

        /// Writes real content to `relative` (creating parent directories as
        /// needed) — `new`'s own `entries` shorthand always writes `b"x"`,
        /// which is enough for name-search/listing tests but useless for
        /// content-search tests, which need to control what's actually on
        /// each line.
        fn write(&self, relative: &str, content: &[u8]) {
            let path = self.0.join(relative);
            std::fs::create_dir_all(path.parent().expect("fixture path has a parent"))
                .expect("fixture parent dir should be creatable");
            std::fs::write(path, content).expect("fixture file should be writable");
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    #[test]
    fn lists_folders_before_files_both_case_insensitive() {
        let fixture = Fixture::new(
            "sort",
            &["zeta/", "Alpha/", "readme.md", "Cargo.toml", "beta.rs"],
        );

        let entries =
            explorer_read_dir(fixture.0.to_string_lossy().into_owned()).expect("readable fixture");

        assert_eq!(
            entries,
            vec![
                DirEntryNode {
                    name: "Alpha".to_string(),
                    is_dir: true
                },
                DirEntryNode {
                    name: "zeta".to_string(),
                    is_dir: true
                },
                DirEntryNode {
                    name: "beta.rs".to_string(),
                    is_dir: false
                },
                DirEntryNode {
                    name: "Cargo.toml".to_string(),
                    is_dir: false
                },
                DirEntryNode {
                    name: "readme.md".to_string(),
                    is_dir: false
                },
            ]
        );
    }

    fn search_node(
        name: &str,
        is_dir: bool,
        children: Option<Vec<SearchTreeNode>>,
    ) -> SearchTreeNode {
        SearchTreeNode {
            name: name.to_string(),
            is_dir,
            children,
        }
    }

    #[test]
    fn read_dir_does_not_let_a_huge_early_alphabetical_sibling_starve_a_later_one() {
        // The original bug: a `walk()`-style shared budget, consumed depth-first,
        // let one huge early directory silently drop every alphabetically later
        // top-level sibling. `explorer_read_dir` has no recursion and no shared
        // budget at all, so this passes trivially — that's the point of the fix.
        let fixture = Fixture::new("read-dir-no-starvation", &[]);
        let huge_dir = fixture.0.join(".build");
        std::fs::create_dir_all(&huge_dir).expect("fixture dir");
        for index in 0..5001 {
            std::fs::write(huge_dir.join(format!("f{index}.txt")), b"x").expect("fixture write");
        }
        std::fs::write(fixture.0.join("zzz.txt"), b"x").expect("fixture write");

        let entries =
            explorer_read_dir(fixture.0.to_string_lossy().into_owned()).expect("readable fixture");

        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert!(
            names.contains(&".build"),
            "huge directory should still be listed"
        );
        assert!(
            names.contains(&"zzz.txt"),
            "later sibling must not be starved by the huge directory's size"
        );
    }

    #[test]
    fn read_dir_lists_one_level_only_without_recursing() {
        let fixture = Fixture::new("read-dir-one-level", &["dir/inside.txt", "top.txt"]);

        let entries =
            explorer_read_dir(fixture.0.to_string_lossy().into_owned()).expect("readable fixture");

        assert_eq!(
            entries,
            vec![
                DirEntryNode {
                    name: "dir".to_string(),
                    is_dir: true
                },
                DirEntryNode {
                    name: "top.txt".to_string(),
                    is_dir: false
                },
            ]
        );
    }

    #[test]
    fn read_dir_shows_everything_including_git_and_denylisted_directories() {
        // The plain tree view used to filter BOTH `.git` and `DENYLIST`
        // (`node_modules`/`target`/…) — the reported bug: the user could
        // never browse their own repo's real directory in the tree, `.git`
        // included. The reference editor's actual `files.exclude` default
        // only hides `.git`/`.svn`/`.hg`/`.DS_Store`/`Thumbs.db`, NOT
        // `node_modules` (that's the separate, search-only
        // `search.exclude`) — its Explorer just shows the real directory.
        // `explorer_read_dir` now
        // matches that: no filtering at all. Only the two recursive search
        // walks still skip both (see `search_names_excludes_git_directory`
        // and `search_names_excludes_denylisted_directories` below).
        let fixture = Fixture::new(
            "read-dir-denylist",
            &[".git/HEAD", "node_modules/left-pad/index.js", "src/main.rs"],
        );

        let entries =
            explorer_read_dir(fixture.0.to_string_lossy().into_owned()).expect("readable fixture");

        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, vec![".git", "node_modules", "src"]);
    }

    #[test]
    fn search_names_finds_a_nested_match_without_expanding_it_first() {
        let fixture = Fixture::new(
            "search-nested",
            &["src/deep/needle.rs", "src/deep/other.rs", "readme.md"],
        );

        let result = explorer_search_names(
            fixture.0.to_string_lossy().into_owned(),
            "needle".to_string(),
        )
        .expect("search should succeed");

        assert!(!result.truncated);
        assert_eq!(
            result.nodes,
            vec![search_node(
                "src",
                true,
                Some(vec![search_node(
                    "deep",
                    true,
                    Some(vec![search_node("needle.rs", false, None)])
                )])
            )]
        );
    }

    #[test]
    fn search_names_excludes_denylisted_directories() {
        let fixture = Fixture::new(
            "search-denylist",
            &["node_modules/needle/index.js", "src/needle.rs"],
        );

        let result = explorer_search_names(
            fixture.0.to_string_lossy().into_owned(),
            "needle".to_string(),
        )
        .expect("search should succeed");

        assert_eq!(
            result.nodes,
            vec![search_node(
                "src",
                true,
                Some(vec![search_node("needle.rs", false, None)])
            )]
        );
    }

    #[test]
    fn search_names_excludes_git_directory() {
        // Unlike `explorer_read_dir` (now shows `.git`, see
        // `read_dir_shows_git_but_excludes_denylisted_directories`), a
        // recursive name search must not silently descend into `.git`'s
        // object store — thousands of opaque, unhelpfully-named blobs.
        let fixture = Fixture::new(
            "search-git",
            &[".git/refs/needle", "src/needle.rs"],
        );

        let result = explorer_search_names(
            fixture.0.to_string_lossy().into_owned(),
            "needle".to_string(),
        )
        .expect("search should succeed");

        assert_eq!(
            result.nodes,
            vec![search_node(
                "src",
                true,
                Some(vec![search_node("needle.rs", false, None)])
            )]
        );
    }

    #[test]
    fn search_names_returns_empty_for_a_blank_query() {
        let fixture = Fixture::new("search-blank", &["file.txt"]);

        let result =
            explorer_search_names(fixture.0.to_string_lossy().into_owned(), "   ".to_string())
                .expect("search should succeed");

        assert!(result.nodes.is_empty());
        assert!(!result.truncated);
    }

    fn content_node(
        name: &str,
        is_dir: bool,
        children: Option<Vec<ContentSearchNode>>,
        matches: Vec<ContentMatch>,
    ) -> ContentSearchNode {
        ContentSearchNode {
            name: name.to_string(),
            is_dir,
            children,
            matches,
        }
    }

    fn content_match(line: u32, preview: &str) -> ContentMatch {
        ContentMatch {
            line,
            preview: preview.to_string(),
        }
    }

    #[test]
    fn search_contents_finds_a_nested_match_without_expanding_it_first() {
        let fixture = Fixture::new("content-nested", &[]);
        fixture.write(
            "src/deep/needle.rs",
            b"fn main() {\n    let needle = 1;\n}\n",
        );
        fixture.write("readme.md", b"nothing here");

        let result = explorer_search_contents(
            fixture.0.to_string_lossy().into_owned(),
            "needle".to_string(),
        )
        .expect("search should succeed");

        assert!(!result.truncated);
        assert_eq!(
            result.nodes,
            vec![content_node(
                "src",
                true,
                Some(vec![content_node(
                    "deep",
                    true,
                    Some(vec![content_node(
                        "needle.rs",
                        false,
                        None,
                        vec![content_match(2, "let needle = 1;")]
                    )]),
                    vec![]
                )]),
                vec![]
            )]
        );
    }

    #[test]
    fn search_contents_excludes_denylisted_directories() {
        let fixture = Fixture::new("content-denylist", &[]);
        fixture.write("node_modules/lib/index.js", b"needle inside a dependency");
        fixture.write("src/app.rs", b"// needle marker");

        let result = explorer_search_contents(
            fixture.0.to_string_lossy().into_owned(),
            "needle".to_string(),
        )
        .expect("search should succeed");

        assert_eq!(
            result.nodes,
            vec![content_node(
                "src",
                true,
                Some(vec![content_node(
                    "app.rs",
                    false,
                    None,
                    vec![content_match(1, "// needle marker")]
                )]),
                vec![]
            )]
        );
    }

    #[test]
    fn search_contents_is_case_insensitive() {
        let fixture = Fixture::new("content-case", &[]);
        fixture.write("file.txt", b"This Line Has NEEDLE in it");

        let result = explorer_search_contents(
            fixture.0.to_string_lossy().into_owned(),
            "needle".to_string(),
        )
        .expect("search should succeed");

        assert_eq!(
            result.nodes,
            vec![content_node(
                "file.txt",
                false,
                None,
                vec![content_match(1, "This Line Has NEEDLE in it")]
            )]
        );
    }

    #[test]
    fn search_contents_skips_binary_files() {
        let fixture = Fixture::new("content-binary", &[]);
        fixture.write("binary.dat", &[b'n', b'e', b'e', b'd', b'l', b'e', 0, 1, 2]);

        let result = explorer_search_contents(
            fixture.0.to_string_lossy().into_owned(),
            "needle".to_string(),
        )
        .expect("search should succeed");

        assert!(result.nodes.is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn search_contents_survives_a_broken_symlink() {
        let fixture = Fixture::new("content-broken-symlink", &[]);
        fixture.write("real.txt", b"needle here");
        std::os::unix::fs::symlink(
            fixture.0.join("does-not-exist"),
            fixture.0.join("dangling.txt"),
        )
        .expect("symlink creation should succeed");

        let result = explorer_search_contents(
            fixture.0.to_string_lossy().into_owned(),
            "needle".to_string(),
        )
        .expect("a broken symlink elsewhere in the tree must not abort the search");

        assert_eq!(
            result.nodes,
            vec![content_node(
                "real.txt",
                false,
                None,
                vec![content_match(1, "needle here")]
            )]
        );
    }

    #[test]
    fn search_contents_returns_empty_for_a_blank_query() {
        let fixture = Fixture::new("content-blank", &[]);
        fixture.write("file.txt", b"anything");

        let result =
            explorer_search_contents(fixture.0.to_string_lossy().into_owned(), "   ".to_string())
                .expect("search should succeed");

        assert!(result.nodes.is_empty());
        assert!(!result.truncated);
    }

    #[test]
    fn search_contents_per_file_cap_does_not_starve_a_sibling_file() {
        let fixture = Fixture::new("content-per-file-cap", &[]);
        let many_lines: String = (0..100)
            .map(|index| format!("needle line {index}\n"))
            .collect();
        fixture.write("huge.txt", many_lines.as_bytes());
        fixture.write("small.txt", b"needle once\n");

        let result = explorer_search_contents(
            fixture.0.to_string_lossy().into_owned(),
            "needle".to_string(),
        )
        .expect("search should succeed");

        let huge = result
            .nodes
            .iter()
            .find(|node| node.name == "huge.txt")
            .expect("huge.txt should still be listed");
        assert_eq!(huge.matches.len(), MAX_CONTENT_MATCHES_PER_FILE);
        let small = result
            .nodes
            .iter()
            .find(|node| node.name == "small.txt")
            .expect("small.txt must not be starved by huge.txt's own cap");
        assert_eq!(small.matches.len(), 1);
        assert!(!result.truncated);
    }

    #[test]
    fn search_contents_reports_truncated_once_the_total_cap_is_exceeded() {
        let fixture = Fixture::new("content-total-cap", &[]);
        let per_file: String = (0..MAX_CONTENT_MATCHES_PER_FILE)
            .map(|index| format!("needle {index}\n"))
            .collect();
        // 26 files × 20 matches each (the per-file cap) = 520, past
        // MAX_CONTENT_SEARCH_MATCHES (500).
        for file_index in 0..26 {
            fixture.write(&format!("file{file_index}.txt"), per_file.as_bytes());
        }

        let result = explorer_search_contents(
            fixture.0.to_string_lossy().into_owned(),
            "needle".to_string(),
        )
        .expect("search should succeed");

        assert!(result.truncated);
    }

    #[test]
    fn search_contents_truncates_an_overly_long_matched_line_in_the_preview() {
        let fixture = Fixture::new("content-long-line", &[]);
        let long_line = format!("{}needle{}", "a".repeat(300), "b".repeat(300));
        fixture.write("long.txt", long_line.as_bytes());

        let result = explorer_search_contents(
            fixture.0.to_string_lossy().into_owned(),
            "needle".to_string(),
        )
        .expect("search should succeed");

        let matches = &result.nodes[0].matches;
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].preview.chars().count(), PREVIEW_MAX_CHARS + 1);
        assert!(matches[0].preview.ends_with('…'));
    }

    #[test]
    fn errors_on_an_unreadable_root_instead_of_returning_an_empty_listing() {
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- test fixture scratch path, not a security operation.
        let missing = std::env::temp_dir().join("panecrew-explorer-fs-definitely-missing");

        assert!(explorer_read_dir(missing.to_string_lossy().into_owned()).is_err());
    }

    #[test]
    fn creates_an_empty_file() {
        let fixture = Fixture::new("create-file", &[]);
        let path = fixture.0.join("new.txt");

        explorer_create_file(path.to_string_lossy().into_owned()).expect("should create");

        assert_eq!(std::fs::read(&path).expect("file should exist"), b"");
    }

    #[test]
    fn refuses_to_overwrite_an_existing_file() {
        let fixture = Fixture::new("create-file-exists", &["already.txt"]);
        let path = fixture.0.join("already.txt");
        std::fs::write(&path, b"original").expect("fixture write");

        let result = explorer_create_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
        assert_eq!(
            std::fs::read(&path).expect("file should still exist"),
            b"original"
        );
    }

    #[test]
    fn refuses_to_create_a_file_whose_parent_directory_is_missing() {
        let fixture = Fixture::new("create-file-no-parent", &[]);
        let path = fixture.0.join("nope").join("new.txt");

        let result = explorer_create_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
        assert!(!path.exists());
    }

    #[test]
    fn creates_an_empty_directory() {
        let fixture = Fixture::new("create-dir", &[]);
        let path = fixture.0.join("new-folder");

        explorer_create_directory(path.to_string_lossy().into_owned()).expect("should create");

        assert!(path.is_dir());
    }

    #[test]
    fn refuses_to_create_a_directory_that_already_exists() {
        let fixture = Fixture::new("create-dir-exists", &["already/"]);
        let path = fixture.0.join("already");

        let result = explorer_create_directory(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn refuses_to_create_a_directory_whose_parent_is_missing() {
        let fixture = Fixture::new("create-dir-no-parent", &[]);
        let path = fixture.0.join("nope").join("new-folder");

        let result = explorer_create_directory(path.to_string_lossy().into_owned());

        assert!(result.is_err());
        assert!(!path.exists());
    }

    #[test]
    fn reads_a_normal_utf8_file_exactly() {
        let fixture = Fixture::new("read-utf8", &[]);
        let path = fixture.0.join("readme.md");
        std::fs::write(&path, "Hällo, Wörld\nzweite Zeile").expect("fixture write");

        let contents =
            explorer_read_file(path.to_string_lossy().into_owned()).expect("should read");

        assert_eq!(contents.text, "Hällo, Wörld\nzweite Zeile");
        assert!(!contents.crlf);
        assert_eq!(
            contents.stamp.len,
            "Hällo, Wörld\nzweite Zeile".len() as u64
        );
    }

    #[test]
    fn detects_and_normalizes_crlf_line_endings() {
        let fixture = Fixture::new("read-crlf", &[]);
        let path = fixture.0.join("windows.txt");
        std::fs::write(&path, b"first\r\nsecond\r\n").expect("fixture write");

        let contents =
            explorer_read_file(path.to_string_lossy().into_owned()).expect("should read");

        assert!(contents.crlf);
        assert_eq!(contents.text, "first\nsecond\n");
    }

    #[test]
    fn refuses_non_utf8_content_instead_of_returning_garbled_text() {
        let fixture = Fixture::new("read-non-utf8", &[]);
        let path = fixture.0.join("binary.dat");
        std::fs::write(&path, [0xFF, 0xFE, 0x00, 0x01]).expect("fixture write");

        let result = explorer_read_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn refuses_a_file_above_the_size_ceiling() {
        let fixture = Fixture::new("read-too-large", &[]);
        let path = fixture.0.join("huge.txt");
        std::fs::write(&path, vec![b'a'; (MAX_EDITABLE_FILE_BYTES + 1) as usize])
            .expect("fixture write");

        let result = explorer_read_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn reads_and_base64_encodes_a_media_files_raw_bytes() {
        let fixture = Fixture::new("read-media", &[]);
        let path = fixture.0.join("pixel.png");
        let bytes: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0x00];
        std::fs::write(&path, bytes).expect("fixture write");

        let encoded =
            explorer_read_media(path.to_string_lossy().into_owned()).expect("should read");

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("valid base64");
        assert_eq!(decoded, bytes);
    }

    #[test]
    fn refuses_to_read_a_directory_as_media() {
        let fixture = Fixture::new("read-media-directory", &["subdir/"]);
        let path = fixture.0.join("subdir");

        let result = explorer_read_media(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn refuses_a_media_file_above_the_preview_size_ceiling() {
        let fixture = Fixture::new("read-media-too-large", &[]);
        let path = fixture.0.join("huge.mp4");
        std::fs::write(
            &path,
            vec![b'a'; (MAX_PREVIEWABLE_MEDIA_BYTES + 1) as usize],
        )
        .expect("fixture write");

        let result = explorer_read_media(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn errors_reading_a_missing_media_file_instead_of_panicking() {
        let fixture = Fixture::new("read-media-missing", &[]);
        let path = fixture.0.join("nope.png");

        let result = explorer_read_media(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn refuses_to_open_a_directory_in_the_editor() {
        let fixture = Fixture::new("read-directory", &["subdir/"]);
        let path = fixture.0.join("subdir");

        let result = explorer_read_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn errors_on_a_missing_file_instead_of_panicking() {
        let fixture = Fixture::new("read-missing", &[]);
        let path = fixture.0.join("nope.txt");

        let result = explorer_read_file(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn write_then_read_round_trips_the_new_content() {
        let fixture = Fixture::new("write-roundtrip", &[]);
        let path = fixture.0.join("file.txt");
        std::fs::write(&path, "original").expect("fixture write");
        let path = path.to_string_lossy().into_owned();
        let stamp = explorer_read_file(path.clone()).expect("should read").stamp;

        explorer_write_file(path.clone(), "changed".to_string(), false, stamp)
            .expect("should write");

        assert_eq!(
            explorer_read_file(path).expect("should read back").text,
            "changed"
        );
    }

    #[test]
    fn refuses_to_write_when_the_file_changed_on_disk_since_the_stamp() {
        let fixture = Fixture::new("write-conflict", &[]);
        let path = fixture.0.join("file.txt");
        std::fs::write(&path, "original").expect("fixture write");
        let path_string = path.to_string_lossy().into_owned();
        let stale_stamp = explorer_read_file(path_string.clone())
            .expect("should read")
            .stamp;
        // Change the file "externally" (e.g. a CLI agent) after the stamp
        // was taken, without going through `explorer_write_file`.
        std::fs::write(&path, "changed by someone else").expect("simulated external edit");

        let result = explorer_write_file(
            path_string.clone(),
            "clobbered?".to_string(),
            false,
            stale_stamp,
        );

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(&path).expect("file should still exist"),
            "changed by someone else"
        );
    }

    #[test]
    fn leaves_no_temp_file_behind_after_a_conflict_refusal() {
        let fixture = Fixture::new("write-conflict-no-litter", &[]);
        let path = fixture.0.join("file.txt");
        std::fs::write(&path, "original").expect("fixture write");
        let path_string = path.to_string_lossy().into_owned();
        let stale_stamp = explorer_read_file(path_string.clone())
            .expect("should read")
            .stamp;
        std::fs::write(&path, "changed by someone else").expect("simulated external edit");

        let _ = explorer_write_file(path_string, "clobbered?".to_string(), false, stale_stamp);

        let leftovers: Vec<_> = std::fs::read_dir(&fixture.0)
            .expect("fixture dir readable")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains("panecrew-tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn preserves_the_original_files_permissions_after_a_write() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = Fixture::new("write-preserves-mode", &[]);
        let path = fixture.0.join("script.sh");
        std::fs::write(&path, "#!/bin/sh\necho hi").expect("fixture write");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("fixture chmod");
        let path_string = path.to_string_lossy().into_owned();
        let stamp = explorer_read_file(path_string.clone())
            .expect("should read")
            .stamp;

        explorer_write_file(path_string, "#!/bin/sh\necho bye".to_string(), false, stamp)
            .expect("should write");

        let mode = std::fs::metadata(&path)
            .expect("readable")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o755);
    }

    #[test]
    fn restores_crlf_line_endings_on_write() {
        let fixture = Fixture::new("write-crlf", &[]);
        let path = fixture.0.join("windows.txt");
        std::fs::write(&path, b"first\r\nsecond\r\n").expect("fixture write");
        let path_string = path.to_string_lossy().into_owned();
        let read = explorer_read_file(path_string.clone()).expect("should read");
        assert!(read.crlf);

        explorer_write_file(
            path_string,
            "first\nsecond\nthird".to_string(),
            true,
            read.stamp,
        )
        .expect("should write");

        let bytes = std::fs::read(&path).expect("readable");
        assert_eq!(bytes, b"first\r\nsecond\r\nthird");
    }

    #[test]
    fn refuses_to_write_a_file_that_does_not_exist() {
        let fixture = Fixture::new("write-missing", &[]);
        let path = fixture.0.join("nope.txt");

        let result = explorer_write_file(
            path.to_string_lossy().into_owned(),
            "content".to_string(),
            false,
            FileStamp {
                modified_ms: 0,
                len: 0,
            },
        );

        assert!(result.is_err());
    }

    #[test]
    fn renames_a_file() {
        let fixture = Fixture::new("rename-file", &["old.txt"]);
        let from = fixture.0.join("old.txt");
        let to = fixture.0.join("new.txt");

        explorer_rename(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .expect("should rename");

        assert!(!from.exists());
        assert!(to.exists());
    }

    #[test]
    fn renames_a_directory() {
        let fixture = Fixture::new("rename-dir", &["old/inside.txt"]);
        let from = fixture.0.join("old");
        let to = fixture.0.join("new");

        explorer_rename(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .expect("should rename");

        assert!(to.join("inside.txt").exists());
    }

    #[test]
    fn refuses_to_rename_onto_an_existing_different_target() {
        let fixture = Fixture::new("rename-collision", &["source.txt", "target.txt"]);
        let from = fixture.0.join("source.txt");
        let to = fixture.0.join("target.txt");
        std::fs::write(&to, "already here").expect("fixture write");

        let result = explorer_rename(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        );

        assert!(result.is_err());
        assert!(from.exists());
        assert_eq!(
            std::fs::read_to_string(&to).expect("readable"),
            "already here"
        );
    }

    #[test]
    fn allows_a_case_only_rename_on_a_case_insensitive_filesystem() {
        let fixture = Fixture::new("rename-case-only", &["Foo.txt"]);
        let from = fixture.0.join("Foo.txt");
        let to = fixture.0.join("foo.txt");

        // Only meaningful proof on a case-insensitive filesystem (macOS's
        // default) — elsewhere `from` and `to` are simply two different,
        // non-colliding paths, and this test degenerates into a no-op rename.
        let result = explorer_rename(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        );

        assert!(
            result.is_ok(),
            "case-only rename should not be treated as a collision"
        );
        assert!(to.exists());
    }

    #[test]
    fn refuses_to_rename_a_missing_source() {
        let fixture = Fixture::new("rename-missing-source", &[]);
        let from = fixture.0.join("nope.txt");
        let to = fixture.0.join("new.txt");

        let result = explorer_rename(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        );

        assert!(result.is_err());
    }

    #[test]
    #[ignore = "hits the real OS trash (Finder Trash / Recycle Bin) — not part \
                of the default suite so `cargo test` doesn't litter the user's \
                actual trash on every run; verify manually with \
                `cargo test -- --ignored deletes_a_file_to_trash`"]
    fn deletes_a_file_to_trash() {
        let fixture = Fixture::new("delete-file", &["gone.txt"]);
        let path = fixture.0.join("gone.txt");

        explorer_delete(path.to_string_lossy().into_owned()).expect("should delete");

        assert!(!path.exists());
    }

    #[test]
    #[ignore = "hits the real OS trash (Finder Trash / Recycle Bin) — not part \
                of the default suite so `cargo test` doesn't litter the user's \
                actual trash on every run; verify manually with \
                `cargo test -- --ignored deletes_a_non_empty_directory_to_trash`"]
    fn deletes_a_non_empty_directory_to_trash() {
        let fixture = Fixture::new("delete-dir", &["gone/inside.txt"]);
        let path = fixture.0.join("gone");

        explorer_delete(path.to_string_lossy().into_owned()).expect("should delete");

        assert!(!path.exists());
    }

    #[test]
    fn errors_deleting_a_missing_path_instead_of_panicking() {
        let fixture = Fixture::new("delete-missing", &[]);
        let path = fixture.0.join("nope.txt");

        let result = explorer_delete(path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }
}
