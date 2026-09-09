## 2024-05-24 - Avoid vscode.workspace.getConfiguration in tight loops
**Learning:** Calling `vscode.workspace.getConfiguration` within a per-file loop (like `TreeDataProvider.getChildren`'s file filter) creates significant performance overhead due to repeated IPC and configuration resolution per item.
**Action:** Always hoist configuration lookups out of loops. In tree providers or filesystem walkers, resolve configurations like `files.exclude` once per directory or workspace folder, and pass the resolved values down to the filtering logic.

## 2023-10-24 - Avoiding String.split("\n") on large CLI outputs
**Learning:** In scenarios where `git status` output is large, using `String.prototype.split("\n")` causes massive array allocations which triggers garbage collection pauses, blocking the main thread.
**Action:** Replace `split("\n")` with an `indexOf("\n")` in a `while` loop to manually extract lines or count items, avoiding allocation of an array of strings.

## 2024-11-20 - Early break in directory tree state propagation
**Learning:** When iteratively propagating status (like git file status) up a directory tree, continuing to traverse ancestors after encountering an already-processed directory results in redundant O(N * D) operations. Processing a parent guarantees its ancestors are also processed.
**Action:** Implement an early break condition (e.g., `if (map.has(parent)) break;`) to skip redundant ancestor traversals, reducing time complexity.
