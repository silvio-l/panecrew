import type { Memento } from "./vscodeMemento";

/** Trivial in-memory `Memento` fake for unit-testing modules that accept a
 * `vscode.Memento`-shaped parameter, without the real `vscode` module. */
export function createFakeMemento(): Memento {
  const store = new Map<string, unknown>();
  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- implements Memento's real generic signature
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    update(key: string, value: unknown) {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
      return Promise.resolve();
    },
  };
}
