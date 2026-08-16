use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Arc;
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
    writer_tx: mpsc::Sender<Vec<u8>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    /// Windows-only job object the spawned process was assigned to at spawn
    /// time — see `WinJob` for why `kill()` needs this instead of just
    /// signaling the direct pid. `None` when job creation/assignment itself
    /// failed (degrades to single-pid kill, same as the unix path degrades
    /// when `process_group_leader()` comes back empty).
    #[cfg(windows)]
    job: Option<WinJob>,
}

/// Windows equivalent of a unix process group for `kill()`'s purposes: a job
/// object the spawned shell is assigned to right after spawn. Windows adds
/// every process a job-object member later creates to the same job
/// automatically (unless that child explicitly opts out), so
/// `TerminateJobObject` reaches a foreground dev server / CLI agent the
/// shell started, not just the shell's own pid — the same gap `kill()`
/// closes on unix via `killpg`.
///
/// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` is set so the OS itself tears down
/// every process still in the job if this handle is ever dropped without an
/// explicit `terminate()` (e.g. a panic mid-kill), instead of leaking them.
///
/// Implemented to spec, not executable-verified — no Windows machine
/// available in this environment to run it against a real job object.
#[cfg(windows)]
struct WinJob(winapi::shared::ntdef::HANDLE);

// The raw HANDLE is never touched concurrently — `PtyHandle::kill()` only
// ever calls `terminate()` through the same `&self` that guards it (no
// interior mutability needed, `TerminateJobObject`/`CloseHandle` are
// themselves thread-safe Win32 calls), so `Send`/`Sync` are safe to assert
// by hand for a type winapi's raw pointer typedef doesn't derive them for.
#[cfg(windows)]
unsafe impl Send for WinJob {}
#[cfg(windows)]
unsafe impl Sync for WinJob {}

#[cfg(windows)]
impl WinJob {
    /// `None` on any failure along the way (job creation, setting the
    /// kill-on-close limit, or assignment) — callers fall back to a
    /// single-pid kill rather than failing the whole spawn over a
    /// best-effort group-kill mechanism.
    fn wrap(raw_handle: winapi::shared::ntdef::HANDLE) -> Option<Self> {
        use std::mem::{size_of, zeroed};
        use std::ptr::null_mut;
        use winapi::um::handleapi::CloseHandle;
        use winapi::um::jobapi2::{
            AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        };
        use winapi::um::winnt::{
            JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- raw Win32 job-object setup, no memory sharing beyond the handle itself.
        unsafe {
            let job = CreateJobObjectW(null_mut(), null_mut());
            if job.is_null() {
                return None;
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let set_ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &mut info as *mut _ as *mut _,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if set_ok == 0 {
                CloseHandle(job);
                return None;
            }

            if AssignProcessToJobObject(job, raw_handle) == 0 {
                CloseHandle(job);
                return None;
            }

            Some(Self(job))
        }
    }

    /// Terminates every process the job has accumulated — the spawned shell
    /// plus any descendant it created, foreground or background.
    fn terminate(&self) {
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- raw Win32 call, no memory/pointer manipulation beyond the owned job handle.
        unsafe {
            winapi::um::jobapi2::TerminateJobObject(self.0, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for WinJob {
    fn drop(&mut self) {
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- releasing our own owned handle.
        unsafe {
            winapi::um::handleapi::CloseHandle(self.0);
        }
    }
}

/// Unix equivalent of `WinJob::terminate` above: SIGKILLs the whole process
/// group `pid` leads, not just `pid` itself.
///
/// The spawned process becomes its own session AND process-group leader via
/// `setsid()` at spawn time (`portable-pty`'s `unix.rs::spawn_command`), so
/// its own pid doubles as its pgid — negating it targets the whole group
/// (`killpg` semantics), reaching anything it forked that stayed in that
/// group rather than getting one of its own via job control.
///
/// A normal interactive shell's job control, though, moves ownership of the
/// controlling terminal to whichever job is currently in the foreground —
/// in its OWN, separate process group, distinct from the shell's. That
/// group is `master.process_group_leader()` (`tcgetpgrp` on the pty), and
/// is signaled too, so a foreground dev server / CLI agent the shell
/// launched actually dies along with the shell instead of being silently
/// reparented to init.
///
/// Signals are sent best-effort: `ESRCH` (the group is already gone — an
/// already-dying pane, or one with no foreground job of its own) is an
/// expected race here, not a caller-visible error.
#[cfg(unix)]
fn kill_process_group(pid: u32, master: &Mutex<Box<dyn MasterPty + Send>>) {
    let pgid = pid as libc::pid_t;

    if let Ok(master) = master.lock() {
        if let Some(fg_pgid) = master.process_group_leader() {
            if fg_pgid != pgid {
                // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- raw signal delivery, no memory/pointer manipulation.
                unsafe {
                    libc::kill(-fg_pgid, libc::SIGKILL);
                }
            }
        }
    }

    // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- raw signal delivery, no memory/pointer manipulation.
    unsafe {
        libc::kill(-pgid, libc::SIGKILL);
    }
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

    // Must happen right after spawn, before the child has a chance to fork
    // anything of its own — Windows only adds a process to a job
    // automatically at ITS OWN creation time, so a descendant spawned
    // before this assignment landed would never join it. `None` on failure
    // (see `WinJob::wrap`) degrades `kill()` to a single-pid kill rather
    // than failing the spawn itself.
    #[cfg(windows)]
    let job = child
        .as_raw_handle()
        .and_then(|handle| WinJob::wrap(handle as winapi::shared::ntdef::HANDLE));

    let mut reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;

    // A dedicated writer thread: `write_all` into the pty has no timeout and
    // blocks for as long as the foreground process in this pane doesn't read
    // stdin (e.g. mid-build, or genuinely stuck) — moved off `PtyHandle::
    // write`'s caller (the IPC dispatch thread, for the non-`(async)`
    // `pty_write` command) onto its own thread so a slow/stuck consumer can
    // never freeze the whole window (2026-08-16 perf/leak audit finding).
    //
    // `pty_write` deliberately stays non-`(async)`: marking it `(async)`
    // would let Tauri's async runtime dispatch concurrent invocations onto
    // different threads with no ordering guarantee between them, corrupting
    // keystroke order — `usePtyTerminal.ts` sends one `pty_write` per
    // keystroke via `terminal.onData`, and those are a byte stream, not
    // independent/idempotent calls. Keeping the command synchronous means
    // every `pty_write` still enqueues into the channel below in the exact
    // order IPC delivered it; only the actual (potentially slow) OS write
    // moves off-thread, not the ordering decision.
    //
    // Unbounded, unlike the reader's channel below: write volume is driven by
    // human typing / one-shot paste size, not an unbounded producer like a
    // build log's output, so there's no equivalent backpressure need to
    // bound it here.
    let (writer_tx, writer_rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        let mut writer = writer;
        for data in writer_rx {
            if writer.write_all(&data).and_then(|_| writer.flush()).is_err() {
                break;
            }
        }
    });

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
        writer_tx,
        master: Mutex::new(pair.master),
        child: Mutex::new(child),
        #[cfg(windows)]
        job,
    })
}

impl PtyHandle {
    /// Enqueues onto the dedicated writer thread (see `spawn`'s comment) and
    /// returns immediately — the actual OS write happens asynchronously, off
    /// whatever thread called this (the IPC dispatch thread for a live
    /// `pty_write`). Only fails if that thread has already exited (a prior
    /// write errored, e.g. broken pipe after the child exited).
    pub fn write(&self, data: &[u8]) -> anyhow::Result<()> {
        self.writer_tx
            .send(data.to_vec())
            .map_err(|_| anyhow::anyhow!("pty writer thread has stopped"))
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

    /// Terminates the whole process group/job the spawned shell leads (see
    /// `kill_process_group`/`WinJob` above), not just the shell's own pid —
    /// a foreground child it started (dev server, CLI agent, anything with
    /// its own process group under normal job control) is terminated too,
    /// instead of being silently reparented and left running. Reaps the
    /// direct child afterward so it doesn't sit as a zombie/defunct entry
    /// until the app itself exits.
    pub fn kill(&self) -> anyhow::Result<()> {
        let mut child = self.child.lock().unwrap();

        #[cfg(unix)]
        match child.process_id() {
            Some(pid) => kill_process_group(pid, &self.master),
            // No pid to derive a pgid from (shouldn't happen for a real PTY
            // child) — fall back to portable-pty's own single-pid kill.
            None => child.kill()?,
        }

        #[cfg(windows)]
        match &self.job {
            Some(job) => job.terminate(),
            // Job creation/assignment failed at spawn time — fall back to
            // portable-pty's own single-pid kill.
            None => child.kill()?,
        }

        // The signal above already made the process dead or dying, so this
        // returns near-instantly; it's what actually reaps it (`wait()`
        // reuses the cached exit status if something already reaped it via
        // `try_wait()`, so calling this unconditionally is safe).
        child.wait()?;
        Ok(())
    }

    /// The OS pid of the directly spawned child (the shell, not whatever it
    /// later runs) — `tool_detect`'s production entry point walks the
    /// process tree downward from here. Was `#[cfg(test)]`-only until the
    /// tool-icon feature needed it outside tests too.
    pub fn pid(&self) -> Option<u32> {
        self.child.lock().unwrap().process_id()
    }
}

// Test-only: no other production caller queries child liveness (v0.1 has no
// exit signal, see the IPC contract), so this stays out of the public
// surface rather than sit as speculative API. `pub(crate)` (not private) so
// `pty_commands`'s own tests can prove its overwrite-kills-the-old-handle
// behavior via the real OS process, not just this module's tests.
#[cfg(test)]
impl PtyHandle {
    pub(crate) fn has_exited(&self) -> anyhow::Result<bool> {
        let mut child = self.child.lock().unwrap();
        Ok(child.try_wait()?.is_some())
    }
}

/// Windows' ConPTY, unlike a Unix pty, queries the cursor position via a
/// `ESC[6n` Device Status Report as soon as the pseudoconsole session
/// starts, and holds back all output — including the child's own — until
/// something writes the reply back. A real terminal frontend answers this
/// itself: xterm.js parses `ESC[6n` and fires the reply straight back out
/// through `onData`, which `usePtyTerminal.ts` wires to `pty_write`, so
/// production already handles this. Tests that call `spawn()` directly have
/// no terminal attached, so this answers on their behalf instead —
/// reproducing what xterm.js does, not working around a gap in the app.
/// `pub(crate)` so `shell_integration`'s own real-PTY tests can use it too,
/// not just this module's.
///
/// The handle has to reach the `on_output` closure to write the reply, but
/// `spawn()` only returns it after the closure is already moved in — so this
/// stashes it into a shared slot right after `spawn()` returns. The reader
/// thread's own batching delay (`OUTPUT_BATCH_MAX_DELAY`, 8ms) means the
/// first `on_output` call can't fire before that slot is filled, which
/// happens within microseconds of `spawn()` returning.
#[cfg(test)]
pub(crate) fn spawn_answering_dsr(
    opts: SpawnOptions,
    on_output: impl Fn(&[u8]) + Send + 'static,
) -> Arc<PtyHandle> {
    let handle_slot: Arc<Mutex<Option<Arc<PtyHandle>>>> = Arc::new(Mutex::new(None));
    let handle_slot_clone = handle_slot.clone();

    let handle = spawn(opts, move |bytes| {
        if bytes.windows(4).any(|w| w == b"\x1b[6n") {
            if let Some(handle) = handle_slot_clone.lock().unwrap().as_ref() {
                let _ = handle.write(b"\x1b[1;1R");
            }
        }
        on_output(bytes);
    })
    .expect("spawn should succeed");

    let handle = Arc::new(handle);
    *handle_slot.lock().unwrap() = Some(handle.clone());
    handle
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
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
    fn spawn_sh(script: Option<&str>) -> (Arc<PtyHandle>, Arc<Mutex<Vec<u8>>>) {
        let output: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let output_clone = output.clone();
        let args = script.map_or_else(Vec::new, |s| vec!["-c".to_string(), s.to_string()]);

        let handle = spawn_answering_dsr(
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
        );

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

        let handle = spawn_answering_dsr(
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
        );

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

    // unix-only: relies on `kill -0` as an existence probe and on unix
    // process-group semantics (a non-interactive shell's backgrounded job
    // staying in its parent's group) to set up the scenario — the Windows
    // equivalent (`WinJob`) has no test machine to run against, see the
    // ticket note on that type.
    #[cfg(unix)]
    mod group_kill_tests {
        use super::*;

        /// A PTY child that forks a grandchild staying in its own process
        /// group — a background job under a *non-interactive* `sh -c`,
        /// which has job control off and so never `setpgid`s a child into a
        /// group of its own. This is the exact shape `kill_process_group`
        /// must reach beyond the direct child: `wait` keeps the direct
        /// child (this `sh`) itself alive until killed, matching a real
        /// pane with a running foreground job.
        struct Fixture {
            handle: Arc<PtyHandle>,
            output: Arc<Mutex<Vec<u8>>>,
        }

        impl Fixture {
            fn spawn_with_backgrounded_grandchild() -> Self {
                let (handle, output) =
                    spawn_sh(Some("sleep 30 & echo GRANDCHILD_PID=$!; wait"));
                Self { handle, output }
            }

            fn grandchild_pid(&self) -> u32 {
                let printed = wait_for(
                    || {
                        String::from_utf8_lossy(&self.output.lock().unwrap())
                            .contains("GRANDCHILD_PID=")
                    },
                    Duration::from_secs(5),
                );
                assert!(printed, "expected the script to print the backgrounded sleep's pid");

                let text = String::from_utf8_lossy(&self.output.lock().unwrap()).into_owned();
                text.lines()
                    .find_map(|line| line.trim().strip_prefix("GRANDCHILD_PID="))
                    .and_then(|pid| pid.trim().parse::<u32>().ok())
                    .expect("expected a parseable pid after GRANDCHILD_PID=")
            }
        }

        impl Drop for Fixture {
            fn drop(&mut self) {
                // Best-effort: most tests already kill the handle
                // themselves before dropping it, this only matters if an
                // assertion panics first and would otherwise leak a real
                // `sleep 30` OS process for the rest of its 30s.
                let _ = self.handle.kill();
            }
        }

        fn is_process_alive(pid: u32) -> bool {
            // `kill -0` sends no signal, only checks whether the pid could
            // be signaled — same existence probe `pty_commands.rs`'s own
            // tests use.
            std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
        }

        #[test]
        fn kill_terminates_the_whole_process_group_not_just_the_direct_child() {
            let fixture = Fixture::spawn_with_backgrounded_grandchild();
            let grandchild_pid = fixture.grandchild_pid();

            assert!(
                is_process_alive(grandchild_pid),
                "sanity check: the backgrounded grandchild should be running before the kill"
            );

            fixture.handle.kill().expect("kill should succeed");

            let grandchild_died = wait_for(
                || !is_process_alive(grandchild_pid),
                Duration::from_secs(5),
            );
            assert!(
                grandchild_died,
                "expected killing the pane to also terminate a foreground grandchild that \
                 stayed in the shell's process group, not just the shell itself"
            );

            let shell_reaped = wait_for(
                || fixture.handle.has_exited().unwrap_or(false),
                Duration::from_secs(5),
            );
            assert!(
                shell_reaped,
                "expected the killed shell to have been reaped, not left as a zombie"
            );
        }
    }
}
