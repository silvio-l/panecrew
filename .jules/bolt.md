## 2024-05-24 - Avoid vscode.workspace.getConfiguration in tight loops
**Learning:** Calling `vscode.workspace.getConfiguration` within a per-file loop (like `TreeDataProvider.getChildren`'s file filter) creates significant performance overhead due to repeated IPC and configuration resolution per item.
**Action:** Always hoist configuration lookups out of loops. In tree providers or filesystem walkers, resolve configurations like `files.exclude` once per directory or workspace folder, and pass the resolved values down to the filtering logic.

## 2023-10-24 - Avoiding String.split("\n") on large CLI outputs
**Learning:** In scenarios where `git status` output is large, using `String.prototype.split("\n")` causes massive array allocations which triggers garbage collection pauses, blocking the main thread.
**Action:** Replace `split("\n")` with an `indexOf("\n")` in a `while` loop to manually extract lines or count items, avoiding allocation of an array of strings.

## 2024-05-25 - Caching string splits in recursive or tight loops
**Learning:** `String.prototype.split("/")` creates a new array of strings every time it is called. When called inside a recursive search algorithm, or one applied repeatedly in a tight loop across many elements (e.g. comparing workspace directory paths to ignore patterns), this results in excessive array allocation and memory pressure.
**Action:** Memoize the split operation using a `Map` cache keyed by the original string. This trades a very small amount of memory for significant improvements in loop throughput by avoiding the O(N) penalty of repeated allocations on the same string patterns.
