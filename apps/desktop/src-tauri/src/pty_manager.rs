use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

/// Batch bound for coalescing PTY reads into IPC messages: whichever is hit
/// first flushes. A token-streaming CLI agent produces many small reads —
/// without this, each one became its own Tauri channel message (full IPC
/// overhead per read). 4096 mirrors the reader's own buffer size; 8ms keeps
/// latency for a human typing/watching output imperceptible.
const OUTPUT_BATCH_MAX_BYTES: usize = 4096;
const OUTPUT_BATCH_MAX_DELAY: Duration = Duration::from_millis(8);

pub struct SpawnOptions {
    pub cmd: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// Set after PaneCrew's own defaults, so a caller can override them.
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

/// The user's login shell (`$SHELL` on Unix, `%COMSPEC%` on Windows),
/// falling back to a platform-generic shell if the env var is unset.
pub fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

/// Owns a running PTY's writer, resize handle, and child process. The reader
/// side is never stored here — it's consumed by its own thread in `spawn`,
/// since `try_clone_reader` gives an owned reader that can block on `read`
/// independently of anything callers do with the handle.
pub struct PtyHandle {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
}

pub fn spawn<F>(opts: SpawnOptions, on_output: F) -> anyhow::Result<PtyHandle>
where
    F: Fn(&[u8]) + Send + 'static,
{
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: opts.rows,
        cols: opts.cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new(opts.cmd);
    cmd.args(opts.args);
    cmd.cwd(opts.cwd);
    // portable-pty sets no TERM of its own — without one, curses/Ink-based
    // CLI tools (the whole reason this app exists) can't detect color/cursor
    // capabilities. A Finder-launched app inherits launchd's bare env, not a
    // shell's, so this can't rely on the parent process already having it.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // Bare `ls` (and the other BSD file utilities) stay monochrome until this
    // is set, which is the single biggest reason a fresh pane looks lifeless.
    // Verified on this macOS against a real TTY — `-G` and `CLICOLOR_FORCE`
    // are no-ops there, `CLICOLOR` is not. It is only a default: the user's
    // own rc files run after this and can still unset it. Deliberately the
    // only thing we do about default colors — PaneCrew never writes to
    // anyone's shell config.
    cmd.env("CLICOLOR", "1");
    for (key, value) in opts.env {
        cmd.env(key, value);
    }
    let child = pair.slave.spawn_command(cmd)?;

    let mut reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;

    // Two threads, not one: `reader.read` is a blocking OS call with no
    // timeout, so a single thread can't also watch a clock to enforce the
    // time half of the batch bound. The reader thread stays a tight
    // read-and-forward loop; the batching below owns the size/time tradeoff
    // via `recv_timeout` on the channel between them.
    //
    // Bounded, not `mpsc::channel`: an unbounded queue would let the reader
    // drain the PTY as fast as the OS delivers it regardless of whether the
    // batching thread (and IPC beyond it) keeps up, which trades away the
    // backpressure a slow consumer used to apply — the writing process would
    // no longer throttle against a full PTY buffer, it would just pile up
    // here instead. A small bound makes `tx.send` block once the batching
    // side falls behind, restoring that.
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(32);
    thread::spawn(move || {
        // Raw bytes only: a chunk boundary can land mid-UTF-8-codepoint or
        // mid-ANSI-escape, so decoding happens in xterm.js on the frontend,
        // never here.
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    thread::spawn(move || {
        let mut pending: Vec<u8> = Vec::with_capacity(OUTPUT_BATCH_MAX_BYTES);
        let mut deadline: Option<Instant> = None;
        loop {
            let timeout = deadline.map_or(Duration::from_secs(3600), |d| {
                d.saturating_duration_since(Instant::now())
            });
            match rx.recv_timeout(timeout) {
                Ok(chunk) => {
                    if pending.is_empty() {
                        deadline = Some(Instant::now() + OUTPUT_BATCH_MAX_DELAY);
                    }
                    pending.extend_from_slice(&chunk);
                    if pending.len() >= OUTPUT_BATCH_MAX_BYTES {
                        on_output(&pending);
                        pending.clear();
                        deadline = None;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() {
                        on_output(&pending);
                        pending.clear();
                    }
                    deadline = None;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if !pending.is_empty() {
                        on_output(&pending);
                    }
                    break;
                }
            }
        }
    });

    Ok(PtyHandle {
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        child: Mutex::new(child),
    })
}

impl PtyHandle {
    pub fn write(&self, data: &[u8]) -> anyhow::Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> anyhow::Result<()> {
        let master = self.master.lock().unwrap();
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn kill(&self) -> anyhow::Result<()> {
        let mut child = self.child.lock().unwrap();
        child.kill()?;
        Ok(())
    }
}

// Test-only: no production caller queries child liveness (v0.1 has no exit
// signal, see the IPC contract), so this stays out of the public surface
// rather than sit as speculative API. `pub(crate)` (not private) so
// `pty_commands`'s own tests can prove its overwrite-kills-the-old-handle
// behavior via the real OS process, not just this module's tests.
#[cfg(test)]
impl PtyHandle {
    pub(crate) fn has_exited(&self) -> anyhow::Result<bool> {
        let mut child = self.child.lock().unwrap();
        Ok(child.try_wait()?.is_some())
    }

    pub(crate) fn pid(&self) -> Option<u32> {
        self.child.lock().unwrap().process_id()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    fn wait_for<F: Fn() -> bool>(predicate: F, timeout: Duration) -> bool {
        let start = Instant::now();
        while start.elapsed() < timeout {
            if predicate() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        predicate()
    }

    /// Spawns `sh` (bare, or `-c <script>`) with a shared output collector —
    /// every test below needs exactly this pair and differed only in
    /// boilerplate, not intent.
    fn spawn_sh(script: Option<&str>) -> (PtyHandle, Arc<Mutex<Vec<u8>>>) {
        let output: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let output_clone = output.clone();
        let args = script.map_or_else(Vec::new, |s| vec!["-c".to_string(), s.to_string()]);

        let handle = spawn(
            SpawnOptions {
                cmd: "sh".into(),
                args,
                // nosemgrep: rust.lang.security.temp-dir.temp-dir -- arbitrary real cwd for a test-only PTY spawn, not a security operation.
                cwd: std::env::temp_dir(),
                env: vec![],
                cols: 80,
                rows: 24,
            },
            move |bytes| {
                output_clone.lock().unwrap().extend_from_slice(bytes);
            },
        )
        .expect("spawn should succeed");

        (handle, output)
    }

    fn saw(output: &Arc<Mutex<Vec<u8>>>, needle: &str) -> bool {
        wait_for(
            || String::from_utf8_lossy(&output.lock().unwrap()).contains(needle),
            Duration::from_secs(5),
        )
    }

    #[test]
    fn default_shell_returns_a_non_empty_program() {
        assert!(!default_shell().is_empty());
    }

    #[test]
    fn spawn_runs_command_and_delivers_output() {
        let (handle, output) = spawn_sh(Some("echo hello-from-pty"));

        let saw_output = saw(&output, "hello-from-pty");

        drop(handle);
        assert!(saw_output, "expected PTY output to contain command output");
    }

    // portable-pty 0.9.0 sets no TERM at all — a Finder-launched app inherits
    // launchd's bare environment, not a shell's. Without this, curses/Ink-
    // based CLI tools (the ones this app exists to host) can't detect
    // capabilities and the ANSI theme in `readTerminalTheme()` goes inert.
    //
    // A dev shell (and thus `cargo test`) already has TERM/COLORTERM set, so
    // asserting the child sees them proves nothing on its own — that would
    // pass by inheritance even with no fix. Clearing them from *this*
    // process first means a pass can only come from `spawn`'s own `cmd.env`,
    // reproducing the launchd case this test exists for. No other test here
    // reads these vars, so mutating process env is safe despite parallel
    // test threads.
    #[test]
    fn spawn_sets_a_color_capable_term_for_the_child() {
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- test-only env mutation, see the safety comment above.
        unsafe {
            std::env::remove_var("TERM");
            std::env::remove_var("COLORTERM");
            std::env::remove_var("CLICOLOR");
        }

        let (handle, output) = spawn_sh(Some(
            "echo \"term=$TERM colorterm=$COLORTERM clicolor=$CLICOLOR\"",
        ));

        let saw_term = saw(
            &output,
            "term=xterm-256color colorterm=truecolor clicolor=1",
        );

        handle.kill().expect("kill should succeed");
        assert!(
            saw_term,
            "expected the child to get a color-capable TERM/COLORTERM even without one in the parent process"
        );
    }

    #[test]
    fn write_sends_input_to_the_running_shell() {
        let (handle, output) = spawn_sh(None);

        handle
            .write(b"echo ping-write\n")
            .expect("write should succeed");

        let saw_output = saw(&output, "ping-write");

        handle.kill().expect("kill should succeed");
        assert!(saw_output, "expected shell to echo written input's output");
    }

    #[test]
    fn resize_updates_the_ptys_reported_dimensions() {
        let (handle, output) = spawn_sh(None);

        handle.resize(120, 40).expect("resize should succeed");

        // stty confirms the kernel-side PTY window size, not just an
        // in-process struct field, so this proves resize() reaches the OS.
        handle.write(b"stty size\n").expect("write should succeed");

        let saw_new_size = saw(&output, "40 120");

        handle.kill().expect("kill should succeed");
        assert!(
            saw_new_size,
            "expected `stty size` to report the resized dimensions"
        );
    }

    // Discriminating property: many writes spaced further apart than a
    // single OS read cycle but closer than `OUTPUT_BATCH_MAX_DELAY` must
    // still land in far fewer `on_output` calls than writes — proving the
    // batching thread coalesces by time, not just by accident. `cat` echoes
    // each line back almost immediately, and canonical-mode PTYs also echo
    // the raw input itself, so 30 writes 2ms apart produce ~60 echoed lines
    // in total. Verified red against the pre-fix single-thread reader (56
    // `on_output` calls for those ~60 lines, essentially one per line) before
    // writing the assertion below.
    #[test]
    fn spawn_batches_closely_spaced_reads_into_fewer_ipc_sends() {
        let call_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let call_count_clone = call_count.clone();
        let output: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let output_clone = output.clone();

        let handle = spawn(
            SpawnOptions {
                cmd: "cat".into(),
                args: vec![],
                // nosemgrep: rust.lang.security.temp-dir.temp-dir -- arbitrary real cwd for a test-only PTY spawn, not a security operation.
                cwd: std::env::temp_dir(),
                env: vec![],
                cols: 80,
                rows: 24,
            },
            move |bytes| {
                call_count_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                output_clone.lock().unwrap().extend_from_slice(bytes);
            },
        )
        .expect("spawn should succeed");

        const WRITE_COUNT: usize = 30;
        for i in 0..WRITE_COUNT {
            handle
                .write(format!("{i}\n").as_bytes())
                .expect("write should succeed");
            std::thread::sleep(Duration::from_millis(2));
        }

        let saw_last_echo = saw(&output, "29");

        handle.kill().expect("kill should succeed");
        assert!(saw_last_echo, "expected all writes to be echoed back");
        let calls = call_count.load(std::sync::atomic::Ordering::SeqCst);
        assert!(
            calls < WRITE_COUNT,
            "expected batching to coalesce ~{} echoed lines from {WRITE_COUNT} writes into far fewer than {WRITE_COUNT} on_output calls, got {calls}",
            WRITE_COUNT * 2
        );
    }

    #[test]
    fn kill_terminates_the_child_process() {
        let (handle, _output) = spawn_sh(Some("sleep 30"));

        handle.kill().expect("kill should succeed");

        let exited = wait_for(
            || handle.has_exited().unwrap_or(false),
            Duration::from_secs(5),
        );
        assert!(exited, "expected killed child process to have exited");
    }
}
