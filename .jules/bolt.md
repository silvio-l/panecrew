## 2024-05-24 - VS Code Extension Tree Performance
**Learning:** Reading configuration via `vscode.workspace.getConfiguration(undefined, uri)` for every file during a directory listing is a severe bottleneck in Explorer rendering (O(N) reads per N files). Similarly, repeated `RegExp` compilation inside deep filtering loops impacts performance.
**Action:** When implementing `vscode.TreeDataProvider` or filtering file arrays, always evaluate configuration settings ONCE per directory/workspace, and cache expensive objects like `RegExp` across file iterations.
