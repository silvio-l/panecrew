## 2024-05-24 - Avoid vscode.workspace.getConfiguration in tight loops
**Learning:** Calling `vscode.workspace.getConfiguration` within a per-file loop (like `TreeDataProvider.getChildren`'s file filter) creates significant performance overhead due to repeated IPC and configuration resolution per item.
**Action:** Always hoist configuration lookups out of loops. In tree providers or filesystem walkers, resolve configurations like `files.exclude` once per directory or workspace folder, and pass the resolved values down to the filtering logic.

## 2023-10-24 - Avoiding String.split("\n") on large CLI outputs
**Learning:** In scenarios where `git status` output is large, using `String.prototype.split("\n")` causes massive array allocations which triggers garbage collection pauses, blocking the main thread.
**Action:** Replace `split("\n")` with an `indexOf("\n")` in a `while` loop to manually extract lines or count items, avoiding allocation of an array of strings.

## 2024-09-24 - Memoizing string splits in tight filter loops
**Learning:** Calling `String.prototype.split("/")` repeatedly within a tight inner loop, such as iterating over directory contents against multiple exclusion patterns, causes unnecessary array allocations and performance degradation.
**Action:** Pre-split strings and use memoization (`Map`) to cache the split segments when dealing with repetitive string splitting in hot paths like file filtering.
