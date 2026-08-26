//! macOS-only: attributes memory used by WebKit's own XPC helper processes
//! (`com.apple.WebKit.WebContent`/`.GPU`/`.Networking`) back to PaneCrew.
//!
//! These helpers are children of `launchd` (ppid 1), not of PaneCrew's own
//! process — verified via `ps -eo pid,ppid,pgid,comm` against a live running
//! instance (2026-08-26 incident: this app used ~85GB per macOS's own
//! low-memory dialog; `resource_monitor`'s gauge showed nothing anomalous
//! throughout, because every pid it walks — its own single pid plus each PTY
//! tab's real-parent-pointer process tree — stayed normal the whole time).
//! Neither that single-pid lookup nor `resource_guard`'s tree walk can ever
//! see a `launchd`-reparented process, no matter how much memory it uses.
//!
//! macOS's own Activity Monitor faces the identical attribution problem and
//! solves it with `responsibility_get_pid_responsible_for_pid()` — no public
//! header (absent from the SDK on this machine), but resolvable at runtime
//! via `dlsym(RTLD_DEFAULT, ...)` because it ships inside `libsystem_kernel`,
//! already linked into every process. Same acceptance pattern this codebase
//! already uses for Windows' `NtSuspendProcess`/`NtResumeProcess` in
//! `resource_guard.rs`: undocumented, but stable across a decade-plus of
//! macOS releases and exactly what Activity Monitor itself relies on for
//! this exact attribution — if Apple ever removes it, `resolve()` below
//! simply returns `None` and this feature goes quiet, nothing else breaks.
//!
//! Verified empirically (2026-08-26, `ps` plus a throwaway `dlsym` harness
//! against a running "PaneCrew Nightly" instance): a PaneCrew-spawned WebKit
//! helper resolves to PaneCrew's own pid; a WebKit helper belonging to an
//! unrelated app resolves to that other app's pid, not PaneCrew's — so this
//! does not overcount across multiple WebKit-hosting apps running at once.
//! It also showed a PaneCrew PTY child (a real fork/exec descendant, e.g. a
//! login shell) resolving to PaneCrew's own pid too — so `already_counted`
//! below is load-bearing, not a defensive nicety: without it, every PTY tab
//! would be double-counted on top of `resource_guard`'s own tree walk.

use std::collections::HashSet;
use sysinfo::{Pid, System};

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::OnceLock;

    type ResponsibleFn = unsafe extern "C" fn(libc::pid_t) -> libc::pid_t;

    pub(super) fn resolve() -> Option<ResponsibleFn> {
        static ADDR: OnceLock<Option<usize>> = OnceLock::new();
        let addr = *ADDR.get_or_init(|| {
            // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- resolving a stable-but-undocumented libSystem export by name, same pattern resource_guard.rs already uses for Windows' NtSuspendProcess/NtResumeProcess.
            let sym = unsafe {
                libc::dlsym(
                    libc::RTLD_DEFAULT,
                    c"responsibility_get_pid_responsible_for_pid".as_ptr(),
                )
            };
            if sym.is_null() { None } else { Some(sym as usize) }
        });
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- transmuting a dlsym-resolved address to the known signature of the one symbol we looked up by that exact name above.
        addr.map(|address| unsafe { std::mem::transmute::<usize, ResponsibleFn>(address) })
    }

    pub(super) fn responsible_pid(function: ResponsibleFn, pid: u32) -> libc::pid_t {
        // nosemgrep: rust.lang.security.unsafe-usage.unsafe-usage -- calling the resolved libSystem export with a plain pid_t, no pointers involved.
        unsafe { function(pid as libc::pid_t) }
    }
}

/// Sums the RSS of every currently-running process macOS attributes to
/// `own_pid` via the responsibility mechanism, excluding every pid already
/// in `already_counted` (own pid + every PTY tab's tree from
/// `resource_guard::tick_all`) — see module doc for why that exclusion is
/// load-bearing. Returns `(0, 0)` on any non-macOS platform, or if the
/// symbol above isn't resolvable (e.g. removed in a future macOS release).
pub fn attributed_helper_memory(system: &System, own_pid: Pid, already_counted: &HashSet<Pid>) -> (u64, usize) {
    #[cfg(target_os = "macos")]
    {
        let Some(function) = imp::resolve() else {
            return (0, 0);
        };
        let own = own_pid.as_u32();
        let mut total_bytes = 0u64;
        let mut count = 0usize;
        for (pid, process) in system.processes() {
            if already_counted.contains(pid) {
                continue;
            }
            if imp::responsible_pid(function, pid.as_u32()) as u32 == own {
                total_bytes += process.memory();
                count += 1;
            }
        }
        (total_bytes, count)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (system, own_pid, already_counted);
        (0, 0)
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn own_process_is_responsible_for_itself() {
        let mut system = System::new();
        system.refresh_all();
        let own_pid = sysinfo::get_current_pid().expect("own pid should be resolvable");
        let already_counted = HashSet::new();
        // The test binary itself has no WebKit/XPC helpers, so this only
        // proves the symbol resolves and runs against a real pid without
        // panicking or erroring — the actual cross-process attribution is
        // verified by hand against a live app instance (see module doc),
        // not reproducible headlessly in a unit test.
        let (_bytes, _count) = attributed_helper_memory(&system, own_pid, &already_counted);
    }

    #[test]
    fn already_counted_pids_are_never_added_twice() {
        let mut system = System::new();
        system.refresh_all();
        let own_pid = sysinfo::get_current_pid().expect("own pid should be resolvable");
        let mut already_counted = HashSet::new();
        already_counted.insert(own_pid);
        let (bytes, count) = attributed_helper_memory(&system, own_pid, &already_counted);
        assert_eq!(count, 0, "own pid is excluded via already_counted, so it must not be attributed a second time");
        assert_eq!(bytes, 0);
    }
}
