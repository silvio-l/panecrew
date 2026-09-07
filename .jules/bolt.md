## 2024-05-24 - Avoid vscode.workspace.getConfiguration in tight loops
**Learning:** Calling `vscode.workspace.getConfiguration` within a per-file loop (like `TreeDataProvider.getChildren`'s file filter) creates significant performance overhead due to repeated IPC and configuration resolution per item.
**Action:** Always hoist configuration lookups out of loops. In tree providers or filesystem walkers, resolve configurations like `files.exclude` once per directory or workspace folder, and pass the resolved values down to the filtering logic.

## 2023-10-24 - Avoiding String.split("\n") on large CLI outputs
**Learning:** In scenarios where `git status` output is large, using `String.prototype.split("\n")` causes massive array allocations which triggers garbage collection pauses, blocking the main thread.
**Action:** Replace `split("\n")` with an `indexOf("\n")` in a `while` loop to manually extract lines or count items, avoiding allocation of an array of strings.

## 2024-05-24 - Require profiling measurements for micro-optimizations
**Learning:** A micro-optimization that replaced `String.split("\n")` with manual `indexOf` loops for `git status` parsing was rejected because there was no profiling measurement demonstrating actual GC pressure for this extension's typical workload (whole-workspace status polls, not massive kernel-scale diffs). Speculative micro-optimizations that increase complexity over well-understood standard methods are not acceptable.
**Action:** Never apply speculative micro-optimizations (like hand-rolled string parsing instead of standard string methods) without an actual before/after benchmark proving they solve a real bottleneck at the application's scale. Wait for demonstrated need.
