## 2024-08-28 - VS Code Status Bar Item Accessibility
**Learning:** VS Code extension status bar items require explicit `accessibilityInformation` (with a label and ideally a role, like `button`) to be properly announced by screen readers. Just setting the `tooltip` is not enough for accessibility purposes.
**Action:** Always include `accessibilityInformation` when creating `StatusBarItem`s that act as interactive elements in VS Code extensions.

## 2024-08-30 - Multi-step Input Flows Need Focus Resilience
**Learning:** In VS Code extensions, multi-step input flows using `showInputBox` or `showQuickPick` are extremely brittle by default. If a user switches focus to copy text or check a file (a common need when creating snippets or naming things), the input silently aborts and loses all progress.
**Action:** Always add `ignoreFocusOut: true` to input box and quick pick options in multi-step flows to allow users to switch context safely without losing state.

## 2024-09-19 - Placeholders in Input Boxes
**Learning:** In VS Code extensions, it's best practice to include a `placeHolder` when showing an `InputBox` using `vscode.window.showInputBox()`. This gives users a hint on what format the input should be without cluttering the UI.
**Action:** Always include a `placeHolder` text in `showInputBox` calls to guide the user on the expected input format.
