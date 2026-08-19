// Extension-based media-kind/MIME lookup for FileEditor.tsx's image/video
// preview mode (Ticket 38) — same shape as ../components/syntaxHighlight.ts's
// languageForPath: a plain extension table, no content sniffing. Kept as its
// own module rather than folded into that one: this drives which IPC command
// usePaneFileEditors.ts calls (explorer_read_media vs. explorer_read_file),
// not tokenization, and fileEditorState.ts (deliberately React/IPC-free)
// needs the resulting MediaKind type without pulling in the tokenizer.

export type MediaKind = "image" | "video";

export interface MediaInfo {
  kind: MediaKind;
  mime: string;
}

const EXTENSION_MEDIA: Record<string, MediaInfo> = {
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  gif: { kind: "image", mime: "image/gif" },
  svg: { kind: "image", mime: "image/svg+xml" },
  webp: { kind: "image", mime: "image/webp" },
  mp4: { kind: "video", mime: "video/mp4" },
  webm: { kind: "video", mime: "video/webm" },
};

/** `null` for any file the preview mode doesn't cover — the caller falls
 * back to the plain text editor (and, from there, to its existing UTF-8
 * rejection for genuinely unsupported binary formats) for anything not in
 * this list. */
export function mediaInfoForPath(path: string): MediaInfo | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  if (!match) return null;
  return EXTENSION_MEDIA[(match[1] ?? "").toLowerCase()] ?? null;
}
