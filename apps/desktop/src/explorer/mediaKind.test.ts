import { describe, expect, it } from "vitest";
import { mediaInfoForPath } from "./mediaKind";

describe("mediaInfoForPath", () => {
  it("erkennt gängige Bild-Extensions", () => {
    expect(mediaInfoForPath("logo.png")).toEqual({ kind: "image", mime: "image/png" });
    expect(mediaInfoForPath("photo.JPG")).toEqual({ kind: "image", mime: "image/jpeg" });
    expect(mediaInfoForPath("photo.jpeg")).toEqual({ kind: "image", mime: "image/jpeg" });
    expect(mediaInfoForPath("anim.gif")).toEqual({ kind: "image", mime: "image/gif" });
    expect(mediaInfoForPath("icon.svg")).toEqual({ kind: "image", mime: "image/svg+xml" });
    expect(mediaInfoForPath("photo.webp")).toEqual({ kind: "image", mime: "image/webp" });
  });

  it("erkennt gängige Video-Extensions", () => {
    expect(mediaInfoForPath("clip.mp4")).toEqual({ kind: "video", mime: "video/mp4" });
    expect(mediaInfoForPath("clip.WEBM")).toEqual({ kind: "video", mime: "video/webm" });
  });

  it("liefert null für Text-/unbekannte Extensions und für Pfade ohne Extension", () => {
    expect(mediaInfoForPath("main.rs")).toBeNull();
    expect(mediaInfoForPath("README.md")).toBeNull();
    expect(mediaInfoForPath("noextension")).toBeNull();
  });
});
