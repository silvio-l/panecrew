import { describe, expect, it } from "vitest";
import { systemCommands } from "./systemCommands";

describe("systemCommands", () => {
  it("enthält init und reload-snippets als Befehle", () => {
    const triggers = systemCommands().map((command) => command.trigger);

    expect(triggers).toContain("init");
    expect(triggers).toContain("reload-snippets");
  });

  it("markiert jeden System-Befehl als kind: \"command\"", () => {
    for (const command of systemCommands()) {
      expect(command.kind).toBe("command");
    }
  });
});
