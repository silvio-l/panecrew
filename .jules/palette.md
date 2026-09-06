## 2024-08-28 - VS Code Status Bar Item Accessibility
**Learning:** VS Code extension status bar items require explicit `accessibilityInformation` (with a label and ideally a role, like `button`) to be properly announced by screen readers. Just setting the `tooltip` is not enough for accessibility purposes.
**Action:** Always include `accessibilityInformation` when creating `StatusBarItem`s that act as interactive elements in VS Code extensions.

## 2024-08-30 - Multi-step Input Flows Need Focus Resilience
**Learning:** In VS Code extensions, multi-step input flows using `showInputBox` or `showQuickPick` are extremely brittle by default. If a user switches focus to copy text or check a file (a common need when creating snippets or naming things), the input silently aborts and loses all progress.
**Action:** Always add `ignoreFocusOut: true` to input box and quick pick options in multi-step flows to allow users to switch context safely without losing state.
## 2024-11-20 - Prevent Empty QuickPick Menus in VS Code Extensions
**Learning:** In VS Code extensions, showing a `showQuickPick` with an empty array of items results in an unhelpful, empty menu that provides no context to the user.
**Action:** Always check the length of the items array before calling `showQuickPick`. If the array is empty, implement an early return with an informative message (using `vscode.window.showInformationMessage`) to explain why there are no options available. Also, always include a `placeHolder` text to guide the user on what action to take when options are available.
