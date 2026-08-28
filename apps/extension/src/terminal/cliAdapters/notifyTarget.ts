// The redirect target for the OSC 9 attention-notify `printf`s the other
// adapters in this directory write into each CLI tool's own hook/config
// file. `/dev/tty` is POSIX-only -- confirmed via live testing on a real
// Windows machine (2026-08-28, no WSL involved) that it fails one of two
// ways depending on how the hook host ends up invoking the command:
//   - plain `cmd.exe /c "... > /dev/tty ..."` (no MSYS shell involved): a
//     non-MSYS `printf.exe` on PATH treats `/dev/tty` as a literal Windows
//     path and silently writes the escape sequence into a throwaway file
//     `C:\dev\tty` instead of erroring -- the `|| true` fallback never even
//     triggers, since nothing failed from the shell's point of view.
//   - a real MSYS/Git-Bash `sh -c "... > /dev/tty ..."`: fails outright with
//     "No such device or address" -- MSYS *does* recognize `/dev/tty` as a
//     special device, but there's no controlling tty in the non-interactive
//     subprocess context a hook runs in, even though the parent terminal is
//     a real, interactive one.
// Either way the notification never reaches the terminal. `CONOUT$` (the
// Win32 console-output device name) was confirmed working in both
// invocation styles above -- it doesn't require a controlling tty the way
// `/dev/tty` does, just an attached console, which a hook subprocess of an
// interactive terminal session has.
export const NOTIFY_REDIRECT_TARGET = process.platform === "win32" ? "CONOUT$" : "/dev/tty";
