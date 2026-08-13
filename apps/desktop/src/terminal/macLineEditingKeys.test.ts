import { describe, expect, it } from "vitest";
import { macLineEditingBytes } from "./macLineEditingKeys";

const key = (init: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }) => ({
  key: init.key,
  ctrlKey: init.ctrlKey ?? false,
  metaKey: init.metaKey ?? true,
  altKey: init.altKey ?? false,
  shiftKey: init.shiftKey ?? false,
});

describe("macLineEditingBytes", () => {
  it("übersetzt Cmd+← in Ctrl+A (Zeilenanfang)", () => {
    expect(macLineEditingBytes(key({ key: "ArrowLeft" }))).toEqual(
      new Uint8Array([0x01]),
    );
  });

  it("übersetzt Cmd+→ in Ctrl+E (Zeilenende)", () => {
    expect(macLineEditingBytes(key({ key: "ArrowRight" }))).toEqual(
      new Uint8Array([0x05]),
    );
  });

  it("übersetzt Cmd+Backspace in Ctrl+U (bis Zeilenanfang löschen)", () => {
    expect(macLineEditingBytes(key({ key: "Backspace" }))).toEqual(
      new Uint8Array([0x15]),
    );
  });

  it("lässt Tasten ohne Cmd unangetastet", () => {
    expect(macLineEditingBytes(key({ key: "ArrowLeft", metaKey: false }))).toBeNull();
    expect(macLineEditingBytes(key({ key: "Backspace", metaKey: false }))).toBeNull();
  });

  it("lässt Cmd+Alt+← unangetastet -- das gehört Option+Cmd, nicht dieser Politik", () => {
    expect(
      macLineEditingBytes(key({ key: "ArrowLeft", altKey: true })),
    ).toBeNull();
  });

  it("lässt Shift+Cmd+← unangetastet -- keine Textauswahl über PTY-Bytes", () => {
    expect(
      macLineEditingBytes(key({ key: "ArrowLeft", shiftKey: true })),
    ).toBeNull();
  });

  it("lässt Ctrl+Cmd+← unangetastet", () => {
    expect(
      macLineEditingBytes(key({ key: "ArrowLeft", ctrlKey: true })),
    ).toBeNull();
  });

  it("lässt andere Tasten mit Cmd unangetastet, z.B. Cmd+C", () => {
    expect(macLineEditingBytes(key({ key: "c" }))).toBeNull();
  });

  it("lässt Option+← (Wortsprung) unangetastet -- eigene, bereits funktionierende Bindung", () => {
    expect(
      macLineEditingBytes(key({ key: "ArrowLeft", metaKey: false, altKey: true })),
    ).toBeNull();
  });
});
