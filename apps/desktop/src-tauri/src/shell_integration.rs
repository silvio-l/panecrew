//! PaneCrew's own shell startup files, and the spawn-time flags that make a
//! shell read them.
//!
//! The hard rule this module exists to keep: **nothing here ever writes to a
//! file the user owns.** No appended line in `~/.zshrc`, no `~/.bash_profile`
//! edit. PaneCrew's files live in PaneCrew's own directory and are reached
//! only through `ZDOTDIR` (zsh) and `--rcfile` (bash) — two spawn-time
//! settings that vanish with the process. Each wrapper sources the user's own
//! rc first and then adds two things: an OSC 7 report of the working
//! directory, and a prompt that only appears if the user still has an
//! untouched OS-default one.

use std::io;
use std::path::Path;

/// What a shell needs at spawn time to read PaneCrew's wrapper.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ShellIntegration {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

const ZSHENV: &str = include_str!("../../shell-integration/panecrew.zshenv");
const ZSHRC: &str = include_str!("../../shell-integration/panecrew.zshrc");
const BASHRC: &str = include_str!("../../shell-integration/panecrew.bashrc");

/// Writes the wrapper files under `root`, overwriting whatever an older
/// version of PaneCrew left there.
///
/// Called once at startup rather than per spawn: four panes opening at once
/// would otherwise race on the same three files, and a half-written `.zshrc`
/// is a broken shell.
pub fn materialize(root: &Path) -> io::Result<()> {
    let zsh = root.join("zsh");
    std::fs::create_dir_all(&zsh)?;
    std::fs::write(zsh.join(".zshenv"), ZSHENV)?;
    std::fs::write(zsh.join(".zshrc"), ZSHRC)?;

    let bash = root.join("bash");
    std::fs::create_dir_all(&bash)?;
    std::fs::write(bash.join("rc"), BASHRC)?;

    Ok(())
}

/// Spawn flags for `shell`, or an empty set for shells PaneCrew has no wrapper
/// for (fish, cmd.exe, PowerShell). Those keep their own prompt and simply
/// report no working directory, which the frontend treats as "unknown" rather
/// than guessing.
pub fn for_shell(shell: &str, root: &Path) -> ShellIntegration {
    let Some(name) = Path::new(shell).file_name() else {
        return ShellIntegration::default();
    };
    let name = name.to_string_lossy();

    if name.contains("zsh") {
        let dir = root.join("zsh").to_string_lossy().into_owned();
        return ShellIntegration {
            args: vec![],
            env: vec![
                ("ZDOTDIR".into(), dir.clone()),
                // Passed separately from ZDOTDIR because the wrapper hands
                // ZDOTDIR back to the user's own value early and still needs
                // to know where it came from.
                ("PANECREW_ZDOTDIR".into(), dir),
                (
                    "PANECREW_USER_ZDOTDIR".into(),
                    std::env::var("ZDOTDIR").unwrap_or_default(),
                ),
            ],
        };
    }

    if name.contains("bash") {
        return ShellIntegration {
            args: vec![
                "--rcfile".into(),
                root.join("bash").join("rc").to_string_lossy().into_owned(),
            ],
            env: vec![],
        };
    }

    ShellIntegration::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materialize_writes_both_shells_wrappers() {
        let root = std::env::temp_dir().join(format!("panecrew-si-{}", std::process::id()));

        materialize(&root).expect("materialize should succeed");

        assert!(root.join("zsh/.zshenv").is_file());
        assert!(root.join("zsh/.zshrc").is_file());
        assert!(root.join("bash/rc").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn zsh_is_wrapped_via_zdotdir_not_arguments() {
        let integration = for_shell("/bin/zsh", Path::new("/pc"));

        assert!(
            integration.args.is_empty(),
            "zsh must not be given extra arguments — ZDOTDIR is the whole mechanism"
        );
        assert!(integration
            .env
            .contains(&("ZDOTDIR".into(), "/pc/zsh".into())));
        assert!(integration
            .env
            .contains(&("PANECREW_ZDOTDIR".into(), "/pc/zsh".into())));
    }

    #[test]
    fn bash_is_wrapped_via_rcfile() {
        let integration = for_shell("/bin/bash", Path::new("/pc"));

        assert_eq!(integration.args, vec!["--rcfile", "/pc/bash/rc"]);
        assert!(integration.env.is_empty());
    }

    #[test]
    fn a_shell_without_a_wrapper_is_left_alone() {
        // No half-measures for fish or cmd.exe: an unwrapped shell keeps its
        // own prompt and reports no cwd.
        assert_eq!(
            for_shell("/usr/local/bin/fish", Path::new("/pc")),
            ShellIntegration::default()
        );
        assert_eq!(
            for_shell("C:\\Windows\\System32\\cmd.exe", Path::new("/pc")),
            ShellIntegration::default()
        );
    }
}
