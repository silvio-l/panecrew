// Minimal shape of `vscode.Memento` (workspaceState/globalState), factored
// out so pure-logic modules can accept it as a parameter and be unit-tested
// with a plain in-memory fake, without importing the real `vscode` module
// (only resolvable inside an actual extension host, not under vitest).
export interface Memento {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors vscode.Memento's real generic signature
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}
