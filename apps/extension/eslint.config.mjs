import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "out-test", ".vscode-test"] },
  {
    // Extension source: full type-aware strictness.
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    files: ["src/**/*.ts"],
    ignores: ["src/test/**"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Matches the accepted `as Type` convention with a justification
      // comment for the rare hard-coded non-null invariants, same as the
      // repo's earlier desktop-app config.
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    // Integration smoke test: its own tsconfig (tsconfig.test.json), same
    // split the compile scripts use (`compile` vs. `compile-tests`).
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    files: ["src/test/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.mocha },
      parserOptions: {
        project: "./tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    // Root config files: not part of the src project, no type-checking.
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["*.config.{js,ts,mts}", "esbuild.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
