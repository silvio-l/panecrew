## 2024-08-28 - VS Code Status Bar Item Accessibility
**Learning:** VS Code extension status bar items require explicit `accessibilityInformation` (with a label and ideally a role, like `button`) to be properly announced by screen readers. Just setting the `tooltip` is not enough for accessibility purposes.
**Action:** Always include `accessibilityInformation` when creating `StatusBarItem`s that act as interactive elements in VS Code extensions.

## 2024-08-30 - Multi-step Input Flows Need Focus Resilience
**Learning:** In VS Code extensions, multi-step input flows using `showInputBox` or `showQuickPick` are extremely brittle by default. If a user switches focus to copy text or check a file (a common need when creating snippets or naming things), the input silently aborts and loses all progress.
**Action:** Always add `ignoreFocusOut: true` to input box and quick pick options in multi-step flows to allow users to switch context safely without losing state.

## 2024-11-20 - Prevent Silent Failures on Empty QuickPick Lists
**Learning:** In VS Code extensions, launching `vscode.window.showQuickPick` with an empty array or failing silently (e.g. `if (items.length === 0) return;`) results in a poor user experience. Users trigger an action and see nothing happen, leading to confusion about whether the command worked or failed.
**Action:** Always implement early returns with informative messages (`vscode.window.showInformationMessage`) when a QuickPick cannot be populated, explaining *why* it's empty (e.g., "No active panes to restart", "No saved presets to delete"). Additionally, always provide a descriptive `placeHolder` for the QuickPick to guide the user when items *are* present.
