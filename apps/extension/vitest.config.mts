import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The integration smoke test lives here too but needs a real VS Code
    // extension host (`@vscode/test-electron`, run via `npm run
    // test:integration`), not vitest's plain Node environment — it imports
    // `vscode`, which only resolves inside that host.
    // brandlint-ok: literal npm package name of a direct devDependency
    exclude: ["src/test/**", "node_modules/**"],
  },
});
