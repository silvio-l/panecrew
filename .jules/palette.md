## 2024-08-28 - VS Code Status Bar Item Accessibility
**Learning:** VS Code extension status bar items require explicit `accessibilityInformation` (with a label and ideally a role, like `button`) to be properly announced by screen readers. Just setting the `tooltip` is not enough for accessibility purposes.
**Action:** Always include `accessibilityInformation` when creating `StatusBarItem`s that act as interactive elements in VS Code extensions.

## 2024-08-30 - Multi-step Input Flows Need Focus Resilience
**Learning:** In VS Code extensions, multi-step input flows using `showInputBox` or `showQuickPick` are extremely brittle by default. If a user switches focus to copy text or check a file (a common need when creating snippets or naming things), the input silently aborts and loses all progress.
**Action:** Always add `ignoreFocusOut: true` to input box and quick pick options in multi-step flows to allow users to switch context safely without losing state.
## 2024-09-04 - Input Box Placeholders
**Learning:** In VS Code extensions, using `showInputBox` without a `placeHolder` leaves users without guidance on what format is expected. This can lead to hesitation or incorrect inputs, especially for filenames or names. Adding a `placeHolder` text (e.g. `e.g. index.ts`) is a quick, highly impactful UX win that clarifies intent without cluttering the UI.
**Action:** Always include a `placeHolder` text when calling `showInputBox` to guide the user when options or formats are available.
