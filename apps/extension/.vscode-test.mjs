import { defineConfig } from "@vscode/test-cli";
import path from "node:path";

export default defineConfig({
  files: "out-test/test/**/*.test.js",
  // A real workspace folder so tests can exercise workspace-dependent
  // behavior (the explorer tree, the filesystem watcher) instead of running
  // with no folder open at all.
  launchArgs: [path.resolve(import.meta.dirname, "src/test/fixtures/workspace")],
});
