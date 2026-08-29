## 2023-10-24 - Avoiding String.split("\n") on large CLI outputs
**Learning:** In scenarios where `git status` output is large, using `String.prototype.split("\n")` causes massive array allocations which triggers garbage collection pauses, blocking the main thread.
**Action:** Replace `split("\n")` with an `indexOf("\n")` in a `while` loop to manually extract lines or count items, avoiding allocation of an array of strings.
