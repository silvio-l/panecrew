## 2024-05-24 - Avoid vscode.workspace.getConfiguration in tight loops
**Learning:** Calling `vscode.workspace.getConfiguration` within a per-file loop (like `TreeDataProvider.getChildren`'s file filter) creates significant performance overhead due to repeated IPC and configuration resolution per item.
**Action:** Always hoist configuration lookups out of loops. In tree providers or filesystem walkers, resolve configurations like `files.exclude` once per directory or workspace folder, and pass the resolved values down to the filtering logic.

## 2023-10-24 - Avoiding String.split("\n") on large CLI outputs
**Learning:** In scenarios where `git status` output is large, using `String.prototype.split("\n")` causes massive array allocations which triggers garbage collection pauses, blocking the main thread.
**Action:** Replace `split("\n")` with an `indexOf("\n")` in a `while` loop to manually extract lines or count items, avoiding allocation of an array of strings.

## 2024-09-04 - Rejected Git status string parsing micro-optimization
**Learning:** Replaced `String.prototype.split("\n")` and `.split(" -> ")` with `indexOf` and `slice` in `parsePorcelain` to avoid intermediate array allocations. The PR was rejected because speculative micro-optimizations that trade readable one-liners for hand-rolled parsing loops are not accepted without actual profiling measurements proving a GC pressure problem on realistic repository sizes for the extension's specific use case (whole-workspace status polls).
**Action:** Do not submit speculative parser optimizations without before/after benchmarks on representative data, prioritizing code readability (minimalism guidance) unless a proven bottleneck exists.
