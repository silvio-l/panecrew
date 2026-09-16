## 2024-05-24 - Avoid vscode.workspace.getConfiguration in tight loops
**Learning:** Calling `vscode.workspace.getConfiguration` within a per-file loop (like `TreeDataProvider.getChildren`'s file filter) creates significant performance overhead due to repeated IPC and configuration resolution per item.
**Action:** Always hoist configuration lookups out of loops. In tree providers or filesystem walkers, resolve configurations like `files.exclude` once per directory or workspace folder, and pass the resolved values down to the filtering logic.

## 2023-10-24 - Avoiding String.split("\n") on large CLI outputs
**Learning:** In scenarios where `git status` output is large, using `String.prototype.split("\n")` causes massive array allocations which triggers garbage collection pauses, blocking the main thread.
**Action:** Replace `split("\n")` with an `indexOf("\n")` in a `while` loop to manually extract lines or count items, avoiding allocation of an array of strings.

## 2024-05-24 - Early break in ancestor propagation loops
**Learning:** When propagating state or statuses up a directory tree iteratively, iterating all the way up to the root for every file causes redundant O(N*D) work. Since a parent's ancestors are also processed when the parent is first processed, encountering an already-processed parent guarantees all its ancestors are also processed.
**Action:** Implement an early break condition (e.g., `if (map.has(parent)) break;`) to avoid redundant ancestor traversals.
