import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as loadProjectModule from "./loadProject";
import { useProjects } from "./useProjects";
import type { Project, TreeNode } from "../types/project";

vi.mock("./loadProject", () => ({
  buildProject: vi.fn(),
  readDirEntries: vi.fn(),
}));

const PATH = "/repo";

function project(tree: TreeNode[]): Project {
  return { path: PATH, name: "repo", tree, treeError: null, gitDecorations: new Map() };
}

describe("useProjects — Refresh und ein bereits aufgeklappter Unterordner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("frägt bereits aufgeklappte Unterordner beim Refresh PARALLEL zur Wurzel neu an, nicht erst danach", async () => {
    // Der gemeldete Flacker-Bug (Explorer zeichnet bei viel-geschriebenem,
    // aufgeklapptem Unterordner sichtbar häufig neu): die alte Implementierung
    // committete `buildProject`s frische Wurzel — bei der JEDER Ordner
    // zunächst `children: undefined` trägt — per eigenem `setProjects` SOFORT,
    // bevor überhaupt einer der vorher aufgeklappten Unterordner neu geladen
    // war. Ein bereits offener Ordner klappte dadurch für einen echten
    // React-Commit sichtbar zu und erst beim nächsten (separaten) Commit pro
    // Ordner wieder auf — bei mehreren aufgeklappten Ebenen entsprechend oft
    // hintereinander. In einem `act()`-gewrappten Test verschluckt React
    // diese Zwischen-Commits (Batching bis zum Verlassen von `act`), reale
    // `invoke()`-IPC-Roundtrips im echten Programm aber nicht — deshalb prüft
    // dieser Test die eigentliche Ursache statt eines Zwischen-Renderings:
    // ob `readDirEntries` für den bereits aufgeklappten Ordner PARALLEL zur
    // Wurzel losgeschickt wird (Promise.all) statt erst nach ihr (sequenzielle
    // `for`-Schleife) — nur Ersteres kann in einem einzigen `setProjects`
    // münden.
    vi.mocked(loadProjectModule.buildProject).mockResolvedValueOnce(
      project([{ name: "sub", isDirectory: true }]),
    );
    vi.mocked(loadProjectModule.readDirEntries).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useProjects());
    await act(async () => {
      await result.current.load(PATH);
    });
    await act(async () => {
      await result.current.loadChildren(PATH, "sub");
    });

    // Die Wurzel bleibt für diesen Refresh absichtlich für immer hängen —
    // wenn `readDirEntries` für "sub" trotzdem aufgerufen wird, kann das nur
    // parallel zur Wurzel passiert sein, nicht erst danach.
    vi.mocked(loadProjectModule.buildProject).mockReturnValueOnce(new Promise(() => undefined));
    const childrenSpy = vi
      .mocked(loadProjectModule.readDirEntries)
      .mockResolvedValueOnce([]);
    // Der Aufruf aus dem `loadChildren`-Setup oben zählt sonst mit und macht
    // die Assertion unten wahr, unabhängig vom tatsächlichen
    // Refresh-Verhalten.
    childrenSpy.mockClear();

    act(() => {
      void result.current.refresh(PATH);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(childrenSpy).toHaveBeenCalledWith(`${PATH}/sub`);
  });

  it("stellt einen bereits aufgeklappten Unterordner nach refresh() wieder her, auch wenn die Wurzel sich geändert hat", async () => {
    vi.mocked(loadProjectModule.buildProject).mockResolvedValueOnce(
      project([{ name: "sub", isDirectory: true }]),
    );
    const subChildren: TreeNode[] = [{ name: "a.txt", isDirectory: false }];
    vi.mocked(loadProjectModule.readDirEntries).mockResolvedValueOnce(subChildren);
    const { result } = renderHook(() => useProjects());
    await act(async () => {
      await result.current.load(PATH);
    });
    await act(async () => {
      await result.current.loadChildren(PATH, "sub");
    });

    vi.mocked(loadProjectModule.buildProject).mockResolvedValueOnce(
      project([{ name: "new-file.txt", isDirectory: false }, { name: "sub", isDirectory: true }]),
    );
    vi.mocked(loadProjectModule.readDirEntries).mockResolvedValueOnce(subChildren);

    await act(async () => {
      await result.current.refresh(PATH);
    });

    const tree = result.current.projects[PATH]?.tree ?? [];
    expect(tree.map((node) => node.name)).toEqual(["new-file.txt", "sub"]);
    expect(tree.find((node) => node.name === "sub")?.children).toEqual(subChildren);
  });
});
