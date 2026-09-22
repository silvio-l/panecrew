## 2024-05-24 - Avoid vscode.workspace.getConfiguration in tight loops
**Learning:** Calling `vscode.workspace.getConfiguration` within a per-file loop (like `TreeDataProvider.getChildren`'s file filter) creates significant performance overhead due to repeated IPC and configuration resolution per item.
**Action:** Always hoist configuration lookups out of loops. In tree providers or filesystem walkers, resolve configurations like `files.exclude` once per directory or workspace folder, and pass the resolved values down to the filtering logic.

## 2023-10-24 - Avoiding String.split("\n") on large CLI outputs
**Learning:** In scenarios where `git status` output is large, using `String.prototype.split("\n")` causes massive array allocations which triggers garbage collection pauses, blocking the main thread.
**Action:** Replace `split("\n")` with an `indexOf("\n")` in a `while` loop to manually extract lines or count items, avoiding allocation of an array of strings.

## 2025-01-01 - Avoid String.split() in tight directory filtering loops
**Learning:** Using `String.prototype.split()` repeatedly within tight inner loops (like directory file filtering with multiple glob patterns) causes massive array allocations and performance degradation due to repeatedly splitting the same strings.
**Action:** Pre-split strings (e.g., once per file path) and use memoization to cache the split segments for static values (like glob patterns).
