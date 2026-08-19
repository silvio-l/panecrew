import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import i18next from "../i18n";
import type { SnippetCandidate, SnippetTriggerInput, SnippetTriggerState } from "./snippetTrigger";
import { filterSnippetCandidates, snippetErase, snippetTrigger } from "./snippetTrigger";

// The `://` popup: System-Befehle (Init, Reload-Snippets — fixed, not
// user-authorable) plus user-/project-defined snippets, filtered by what's
// typed after the trigger.
//
// Structurally the same anchoring as `directoryPopup.ts` (Marker + Decoration
// hung off the same cell grid, rebuilt only when a signature actually
// changes), but two real differences from that popup, both spec'd rather than
// stylistic: Enter accepts here (routed in `completionKeys.ts`, gated on
// `visible()` the same way Tab is there — the 2026-08-05 "Enter always
// submits" product decision doesn't transfer, because `://foo` was never a
// command worth submitting), and selection also works with the mouse, so this
// popup is `pointer-events: auto` where the directory one is deliberately
// `none`.

/** How tall the list gets at most, in cell rows — footer included. */
const MAX_ROWS = 8;

/** What the keyboard/mouse may do with the popup. */
export interface SnippetPopupControls {
  visible: () => boolean;
  /** Moves the selection; takes effect on the next render. */
  move: (delta: number) => void;
  /** Applies the selected entry; false if nothing is selected. */
  accept: () => boolean;
  /** Hides until the next keystroke — the input line stays as typed. */
  dismiss: () => void;
}

export interface SnippetPopup extends SnippetPopupControls {
  /** Re-evaluates; called from the completion render pass. */
  update: (state: SnippetTriggerInput) => void;
  /** The user typed something — a prior `dismiss` no longer applies. */
  resume: () => void;
  /** Forgets everything, including a `dismiss` — for submitted/aborted lines. */
  clear: () => void;
  dispose: () => void;
}

export function attachSnippetPopup(
  terminal: Terminal,
  {
    write,
    listCandidates,
    runCommand,
    font,
  }: {
    /** Writes text into the PTY (the same path a real keystroke takes). */
    write: (text: string) => void;
    listCandidates: () => readonly SnippetCandidate[];
    /** Invoked instead of a text write for a `"command"`-kind candidate. */
    runCommand: (trigger: string) => void;
    font: { fontFamily: string; fontSize: number };
  },
): SnippetPopup {
  let matches: SnippetCandidate[] = [];
  let span: SnippetTriggerState | null = null;
  /** Identity of the current match set: the trigger span plus its filter text. */
  let key = "";
  // Same "until the next keypress, not until the text changes" binding as
  // `directoryPopup.ts`'s `dismissed` — see that file's comment for why text
  // isn't the right signal (the shell's echo of an accepted entry lags).
  let dismissed = false;
  let selected = 0;
  let windowStart = 0;

  let marker: IMarker | null = null;
  let decoration: IDecoration | null = null;
  let node: HTMLElement | null = null;
  let nodeSignature = "";
  let detachItemListeners: (() => void) | null = null;

  const detach = () => {
    decoration?.dispose();
    marker?.dispose();
    decoration = null;
    marker = null;
  };

  const hide = () => {
    matches = [];
    span = null;
    detach();
  };

  const acceptSelected = (): boolean => {
    const candidate = matches[selected];
    if (!span || !candidate) return false;
    // Erase over the same write path as a real keystroke: the shell echoes
    // back whatever this produces, the same way an accepted `cd` segment
    // does.
    write(snippetErase(span));
    if (candidate.kind === "snippet") {
      // terminal.paste(), not write(): same reasoning as usePtyTerminal.ts's
      // pasteInto() — a body is static text to insert, not keystrokes to
      // replay, and a body containing "\n" (any multi-line snippet) would
      // otherwise submit the shell's current line early instead of staying
      // on it. xterm wraps this in DECSET-2004 bracketed-paste escapes when
      // the shell has requested that mode, so embedded newlines land as
      // literal text in the line editor instead of Enter keystrokes.
      if (candidate.body) terminal.paste(candidate.body);
    } else {
      runCommand(candidate.trigger);
    }
    // Terminal, unlike the directory popup's progressive segments: one
    // accept fully replaces the typed `://…` text, so there is no "next
    // level" to keep the list open for.
    hide();
    return true;
  };

  const buildNode = (shown: number, hidden: number): HTMLElement => {
    detachItemListeners?.();
    const list = document.createElement("div");
    list.className = "pc-snippetpopup";
    // Cell typography, same reason as `directoryPopup.ts`: the Decoration
    // container doesn't carry it on its own.
    list.style.fontFamily = font.fontFamily;
    list.style.fontSize = `${font.fontSize}px`;

    const cleanups: (() => void)[] = [];
    for (let index = windowStart; index < windowStart + shown; index += 1) {
      const candidate = matches[index];
      if (!candidate) break;
      const item = document.createElement("div");
      item.className =
        index === selected
          ? "pc-snippetpopup__item pc-snippetpopup__item--selected"
          : "pc-snippetpopup__item";
      const trigger = document.createElement("span");
      trigger.className = "pc-snippetpopup__trigger";
      trigger.textContent = candidate.trigger;
      const description = document.createElement("span");
      description.className = "pc-snippetpopup__description";
      description.textContent = candidate.description;
      item.append(trigger, description);

      // mousedown, not click: the gesture this replaces is exactly the one
      // that would otherwise start xterm's own text selection.
      // preventDefault keeps that from happening and keeps DOM focus off the
      // item; stopPropagation keeps the same mousedown from also reaching
      // the pane's selection-drag tracker (`usePtyTerminal.ts`).
      const capturedIndex = index;
      const onMouseDown = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        selected = capturedIndex;
        acceptSelected();
      };
      item.addEventListener("mousedown", onMouseDown);
      cleanups.push(() => item.removeEventListener("mousedown", onMouseDown));
      list.append(item);
    }
    detachItemListeners = () => {
      for (const cleanup of cleanups) cleanup();
    };

    const footer = document.createElement("div");
    footer.className = "pc-snippetpopup__footer";
    const hint = document.createElement("span");
    hint.className = "pc-snippetpopup__hint";
    const kbd = document.createElement("kbd");
    kbd.textContent = "Enter";
    hint.append(kbd, i18next.t("snippetPopup.enterHint"));
    footer.append(hint);
    if (hidden > 0) {
      const more = document.createElement("span");
      more.className = "pc-snippetpopup__count";
      more.textContent = `+${hidden}`;
      footer.append(more);
    }
    list.append(footer);
    return list;
  };

  const draw = (column: number) => {
    const buffer = terminal.buffer.active;
    const below = terminal.rows - buffer.cursorY - 1;
    const above = buffer.cursorY;
    const downwards = below >= Math.min(matches.length, MAX_ROWS) || below >= above;
    const capacity = Math.max(1, Math.min(MAX_ROWS, downwards ? below : above));
    const shown = Math.min(matches.length, Math.max(1, capacity - 1));
    const hidden = matches.length - shown;

    if (selected < windowStart) windowStart = selected;
    if (selected >= windowStart + shown) windowStart = selected - shown + 1;
    windowStart = Math.max(0, Math.min(windowStart, matches.length - shown));

    const signature = `${matches
      .map((c) => `${c.trigger}\x01${c.description}`)
      .join("\n")}\x00${selected}\x00${windowStart}\x00${shown}\x00${hidden}`;
    if (!node || signature !== nodeSignature) {
      node = buildNode(shown, hidden);
      nodeSignature = signature;
    }
    const list = node;

    detach();
    const nextMarker = terminal.registerMarker(0);
    const nextDecoration = terminal.registerDecoration({
      marker: nextMarker,
      x: column,
      width: 1,
      layer: "top",
    });
    if (!nextDecoration) {
      nextMarker.dispose();
      return;
    }
    marker = nextMarker;
    decoration = nextDecoration;
    nextDecoration.onRender((element) => {
      element.style.overflow = "visible";
      element.style.pointerEvents = "none";
      list.style.top = downwards ? "100%" : "auto";
      list.style.bottom = downwards ? "auto" : "100%";
      if (element.firstChild !== list) element.replaceChildren(list);
    });
  };

  return {
    update: (state) => {
      const next = snippetTrigger(state);
      if (!next || dismissed) {
        hide();
        return;
      }
      span = next;

      const nextKey = `${next.start}\x00${next.filter}`;
      if (nextKey !== key) {
        key = nextKey;
        selected = 0;
        windowStart = 0;
      }

      const filtered = filterSnippetCandidates(listCandidates(), next.filter);
      if (filtered.length === 0) {
        hide();
        span = null;
        return;
      }
      matches = filtered;
      selected = Math.min(selected, matches.length - 1);

      // Left-aligned to the trigger itself ("://…"), not the cursor: the
      // list sits under the word it will replace.
      draw(next.start);
    },

    visible: () => matches.length > 0,

    move: (delta) => {
      if (matches.length === 0) return;
      selected = Math.max(0, Math.min(matches.length - 1, selected + delta));
    },

    accept: acceptSelected,

    dismiss: () => {
      dismissed = true;
      hide();
    },

    resume: () => {
      dismissed = false;
    },

    clear: () => {
      dismissed = false;
      key = "";
      selected = 0;
      windowStart = 0;
      hide();
    },

    dispose: () => {
      detach();
      detachItemListeners?.();
      detachItemListeners = null;
      node = null;
    },
  };
}
