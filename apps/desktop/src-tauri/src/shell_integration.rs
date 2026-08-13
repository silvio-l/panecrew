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
            // `-l`: a Finder-launched app's PTY isn't a login shell by
            // default, unlike the defaults of interactive terminal apps — so
            // without this, `.zprofile` (where Homebrew's and nvm's own
            // installers put PATH setup, not `.zshrc`) never runs, and tools
            // installed through them silently vanish from every pane
            // (2026-08-12, reported as `node: command not found` from inside
            // a pane's TUI agent). panecrew.zshenv sources the user's real
            // `.zprofile` itself — see the comment there for why zsh's own
            // automatic lookup can't be relied on once ZDOTDIR points here.
            args: vec!["-l".into()],
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
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

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
    fn zsh_is_wrapped_via_zdotdir_plus_a_login_flag() {
        let integration = for_shell("/bin/zsh", Path::new("/pc"));

        assert_eq!(
            integration.args,
            vec!["-l"],
            "login mode is what makes zsh read .zprofile — see panecrew.zshenv"
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

    /// The wrapper appends itself to `PROMPT_COMMAND`; it must never replace
    /// one the user's own rc installed. Run against a real bash through a real
    /// PTY, because the failure this guards against (a `--rcfile` that quietly
    /// drops the user's hook) only shows up once bash has actually parsed it.
    #[test]
    fn the_bash_wrapper_keeps_the_users_own_prompt_command() {
        let root = std::env::temp_dir().join(format!("panecrew-bash-{}", std::process::id()));
        materialize(&root).expect("materialize should succeed");
        let home = root.join("home");
        std::fs::create_dir_all(&home).expect("home should be creatable");
        std::fs::write(
            home.join(".bashrc"),
            "PROMPT_COMMAND='echo user-hook-ran'\nexport USER_RC_WAS_SOURCED=yes\n",
        )
        .expect("fake .bashrc should be writable");

        let mut args = for_shell("/bin/bash", &root).args;
        args.extend([
            "-i".into(),
            "-c".into(),
            "eval \"$PROMPT_COMMAND\"; echo \"sourced=$USER_RC_WAS_SOURCED\"".into(),
        ]);

        let output: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let collected = output.clone();
        let handle = crate::pty_manager::spawn(
            crate::pty_manager::SpawnOptions {
                cmd: "bash".into(),
                args,
                cwd: std::env::temp_dir(),
                env: vec![("HOME".into(), home.to_string_lossy().into_owned())],
                cols: 80,
                rows: 24,
            },
            move |bytes| collected.lock().unwrap().extend_from_slice(bytes),
        )
        .expect("spawn should succeed");

        let saw = |needle: &str| {
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(5) {
                if String::from_utf8_lossy(&output.lock().unwrap()).contains(needle) {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            false
        };

        let kept_user_hook = saw("user-hook-ran");
        let sourced_user_rc = saw("sourced=yes");
        // PaneCrew's own hook, appended behind the user's: the OSC 7 report.
        let reported_cwd = saw("\u{1b}]7;file://");

        let _ = handle.kill();
        let _ = std::fs::remove_dir_all(&root);
        assert!(
            kept_user_hook,
            "the user's own PROMPT_COMMAND must still run"
        );
        assert!(
            sourced_user_rc,
            "the user's own .bashrc must still be sourced"
        );
        assert!(reported_cwd, "PaneCrew's own hook must run alongside it");
    }

    /// The whole point of the `-l` flag added in `for_shell` (2026-08-12): a
    /// pane's zsh must read the user's real `.zprofile` — where Homebrew's
    /// and nvm's own installers put PATH setup, not `.zshrc` — same as it
    /// already does in Terminal.app. Run through a real PTY, same
    /// reasoning as the bash test above: the ZDOTDIR hand-off only proves
    /// itself once zsh has actually walked its own startup-file chain.
    #[test]
    fn the_login_flag_makes_zsh_source_the_users_own_zprofile() {
        let root = std::env::temp_dir().join(format!("panecrew-zsh-{}", std::process::id()));
        materialize(&root).expect("materialize should succeed");
        let home = root.join("home");
        std::fs::create_dir_all(&home).expect("home should be creatable");
        std::fs::write(
            home.join(".zprofile"),
            "export USER_ZPROFILE_WAS_SOURCED=yes\n",
        )
        .expect("fake .zprofile should be writable");

        let integration = for_shell("/bin/zsh", &root);
        let mut env = integration.env;
        env.push(("HOME".into(), home.to_string_lossy().into_owned()));
        // Overrides whatever `for_shell` captured from *this test process's*
        // own ambient ZDOTDIR (non-empty on a machine that sets one, e.g. via
        // its own .zshenv) — production always reflects the real launching
        // environment, but this fixture's home must win here regardless of
        // what happens to be set on the machine running the test.
        env.push(("PANECREW_USER_ZDOTDIR".into(), String::new()));
        let mut args = integration.args;
        args.extend([
            "-c".into(),
            "echo \"sourced=$USER_ZPROFILE_WAS_SOURCED\"".into(),
        ]);

        let output: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let collected = output.clone();
        let handle = crate::pty_manager::spawn(
            crate::pty_manager::SpawnOptions {
                cmd: "zsh".into(),
                args,
                cwd: std::env::temp_dir(),
                env,
                cols: 80,
                rows: 24,
            },
            move |bytes| collected.lock().unwrap().extend_from_slice(bytes),
        )
        .expect("spawn should succeed");

        let saw = |needle: &str| {
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(5) {
                if String::from_utf8_lossy(&output.lock().unwrap()).contains(needle) {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            false
        };

        let sourced = saw("sourced=yes");
        let _ = handle.kill();
        let _ = std::fs::remove_dir_all(&root);
        assert!(sourced, "the user's own .zprofile must be sourced under -l");
    }

    /// bash can't take the same `-l` route as zsh (the module doc explains
    /// why: it would silently disable --rcfile), so panecrew.bashrc sources
    /// the login-profile file itself. Same real-PTY reasoning as the two
    /// tests above.
    #[test]
    fn the_bash_wrapper_sources_the_users_own_login_profile() {
        let root = std::env::temp_dir().join(format!("panecrew-bash-profile-{}", std::process::id()));
        materialize(&root).expect("materialize should succeed");
        let home = root.join("home");
        std::fs::create_dir_all(&home).expect("home should be creatable");
        std::fs::write(
            home.join(".bash_profile"),
            "export USER_PROFILE_WAS_SOURCED=yes\n",
        )
        .expect("fake .bash_profile should be writable");

        let mut args = for_shell("/bin/bash", &root).args;
        args.extend([
            // -i: --rcfile is only honored for an interactive bash — see the
            // existing PROMPT_COMMAND test above, which needs the same flag.
            "-i".into(),
            "-c".into(),
            "echo \"sourced=$USER_PROFILE_WAS_SOURCED\"".into(),
        ]);

        let output: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let collected = output.clone();
        let handle = crate::pty_manager::spawn(
            crate::pty_manager::SpawnOptions {
                cmd: "bash".into(),
                args,
                cwd: std::env::temp_dir(),
                env: vec![("HOME".into(), home.to_string_lossy().into_owned())],
                cols: 80,
                rows: 24,
            },
            move |bytes| collected.lock().unwrap().extend_from_slice(bytes),
        )
        .expect("spawn should succeed");

        let saw = |needle: &str| {
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(5) {
                if String::from_utf8_lossy(&output.lock().unwrap()).contains(needle) {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            false
        };

        let sourced = saw("sourced=yes");
        let _ = handle.kill();
        let _ = std::fs::remove_dir_all(&root);
        assert!(
            sourced,
            "the user's own .bash_profile must be sourced even without -l"
        );
    }
}
