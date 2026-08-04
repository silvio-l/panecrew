import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src-tauri"] },
  {
    // App-Quellcode: voll typsicher, strikt.
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // JSX-Handler-Shorthand (onClick={() => setX(...)}) ist idiomatisches
      // React, kein verschleiertes void — sonst extrem lautstark.
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      // Widerspricht no-non-null-assertion (erzwingt `!` statt `as Type`) —
      // wir bevorzugen `as Type` mit Begründungskommentar an den seltenen
      // Stellen, an denen wir eine Nicht-Null-Invariante kodieren.
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
    },
  },
  {
    // Root-Config-Dateien (Vite/Vitest): nicht Teil des src-Projekts, kein
    // Type-Checking nötig — nur die Basisregeln.
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["*.config.{js,ts}"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
