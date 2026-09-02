## 2024-05-15 - Prevent multi-step quick picks from closing on focus loss
**Learning:** In VS Code extensions, multi-step configuration flows using `showQuickPick` and `showInputBox` can abruptly close if a user briefly loses focus (e.g., to reference another file or check documentation), losing their progress.
**Action:** Consistently apply `ignoreFocusOut: true` to VS Code input APIs when they are part of a multi-step sequential wizard or critical setup flow.
