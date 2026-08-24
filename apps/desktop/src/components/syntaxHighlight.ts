// Rudimentäres, extensionbasiertes Syntax-Highlighting für FileEditor.tsx
// (Ticket 39). Reine Funktionen, kein React/DOM-Import — derselbe Schnitt wie
// `explorer/fileEditorState.ts`. Bewusst kein LSP/keine echte Grammatik: ein
// zeilenbasierter Scanner pro Sprache, der nur vier Token-Arten unterscheidet
// (`plain`/`comment`/`string`/`keyword`) — das deckt sich mit der Empfehlung
// aus `docs/agents/editor-theming-research.md` Abschnitt 6 ("4–6 Regeln
// reichen für 'sieht nach Code aus'"), nicht mit vollständiger
// TextMate-Grammatik-Treue.
//
// Warum genau diese vier Farben (s. `TOKEN_CLASS` in FileEditor.tsx) und
// keine anderen `--pc-icon-*`-Töne: gegen `--pc-pane-background` gemessen
// (Python/`colorsys`-Rechnung, WCAG-Relativluminanz) bestehen von den
// existierenden Icon-Tokens nur wenige als Fließtext in BEIDEN Themes
// gleichzeitig — `--pc-icon-red`/`-purple`/`-blue`/`-yellow` fallen je in
// mindestens einem Theme unter 4,5:1 (dieselbe Einschränkung, die
// `theme.css`s Kommentar über `--pc-gitDecoration-*` für die Icon-Palette
// bereits dokumentiert). `--pc-gitDecoration-modifiedResourceForeground`
// (Orange) und `-untrackedResourceForeground` (Grün) sind dagegen genau für
// diese Rolle — Icon-Farbe als Fließtext — bereits mit eigenen,
// kontrastgeprüften Werten hinterlegt (6,24:1/8,73:1 dunkel,
// 6,24:1/6,25:1 hell) und `--pc-descriptionForeground` trägt im Chrome
// bereits an mehreren Stellen Fließtext (z. B. `LoadErrorNotice`). Alle vier
// sind damit EXISTIERENDE, für Fließtext bereits geprüfte Tokens — keine
// neuen, unabhängigen Farbwerte, wie vom Ticket gefordert.

export type TokenKind = "plain" | "comment" | "string" | "keyword";

export interface Token {
  text: string;
  kind: TokenKind;
}

export type LanguageId = "ts" | "js" | "rust" | "json" | "markdown" | "css";

const EXTENSION_LANGUAGE: Record<string, LanguageId> = {
  ts: "ts",
  tsx: "ts",
  js: "js",
  jsx: "js",
  rs: "rust",
  json: "json",
  md: "markdown",
  css: "css",
};

/** `null` für jede nicht erkannte/fehlende Extension — `tokenizeLines`
 * behandelt das identisch zu einer erkannten Sprache ohne Regeln (ein
 * einziger plain-Token pro Zeile), damit FileEditor.tsx EINEN Renderpfad
 * für erkannte wie unbekannte Dateitypen nutzen kann (Zeilennummern bleiben
 * so für jede Datei gleich verdrahtet). */
export function languageForPath(path: string): LanguageId | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  if (!match) return null;
  return EXTENSION_LANGUAGE[(match[1] ?? "").toLowerCase()] ?? null;
}

interface LanguageConfig {
  lineComment: string | null;
  blockComment: { start: string; end: string } | null;
  stringDelimiters: readonly string[];
  keywords: ReadonlySet<string>;
}

const JS_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "class", "extends", "implements", "interface", "type", "import",
  "export", "from", "default", "new", "this", "super", "async", "await",
  "try", "catch", "finally", "throw", "switch", "case", "break", "continue",
  "typeof", "instanceof", "in", "of", "void", "yield", "static", "public",
  "private", "protected", "readonly", "enum", "namespace", "declare", "as",
  "is", "keyof", "null", "undefined", "true", "false", "delete", "get",
  "set", "abstract", "satisfies",
]);

const RUST_KEYWORDS = new Set([
  "fn", "let", "mut", "pub", "struct", "enum", "impl", "trait", "use", "mod",
  "crate", "self", "Self", "super", "match", "if", "else", "for", "while",
  "loop", "return", "break", "continue", "async", "await", "move", "ref",
  "dyn", "where", "const", "static", "unsafe", "extern", "type", "as", "in",
  "true", "false",
]);

const JSON_KEYWORDS = new Set(["true", "false", "null"]);

const LANGUAGE_CONFIG: Record<Exclude<LanguageId, "markdown">, LanguageConfig> = {
  ts: {
    lineComment: "//",
    blockComment: { start: "/*", end: "*/" },
    stringDelimiters: ['"', "'", "`"],
    keywords: JS_KEYWORDS,
  },
  js: {
    lineComment: "//",
    blockComment: { start: "/*", end: "*/" },
    stringDelimiters: ['"', "'", "`"],
    keywords: JS_KEYWORDS,
  },
  rust: {
    lineComment: "//",
    blockComment: { start: "/*", end: "*/" },
    stringDelimiters: ['"', "'"],
    keywords: RUST_KEYWORDS,
  },
  json: {
    lineComment: null,
    blockComment: null,
    stringDelimiters: ['"'],
    keywords: JSON_KEYWORDS,
  },
  css: {
    lineComment: null,
    blockComment: { start: "/*", end: "*/" },
    stringDelimiters: ['"', "'"],
    keywords: new Set(),
  },
};

interface LineState {
  inBlockComment: boolean;
}

const INITIAL_LINE_STATE: LineState = { inBlockComment: false };

function isWordStart(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36;
}

function isWordChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return isWordStart(ch) || (code >= 48 && code <= 57);
}

function tokenizeCodeLine(
  line: string,
  config: LanguageConfig | null,
  state: LineState,
): { tokens: Token[]; nextState: LineState } {
  if (!config) {
    return {
      tokens: line.length > 0 ? [{ text: line, kind: "plain" }] : [],
      nextState: state,
    };
  }

  const tokens: Token[] = [];
  let plainStart = 0;
  let i = 0;
  let inBlockComment = state.inBlockComment;

  const pushPlain = (end: number) => {
    if (end > plainStart) tokens.push({ text: line.slice(plainStart, end), kind: "plain" });
  };

  if (inBlockComment && config.blockComment) {
    const blockComment = config.blockComment;
    const endIdx = line.indexOf(blockComment.end);
    if (endIdx === -1) {
      if (line.length > 0) tokens.push({ text: line, kind: "comment" });
      return { tokens, nextState: { inBlockComment: true } };
    }
    const closeEnd = endIdx + blockComment.end.length;
    tokens.push({ text: line.slice(0, closeEnd), kind: "comment" });
    i = closeEnd;
    plainStart = closeEnd;
    inBlockComment = false;
  }

  while (i < line.length) {
    const ch = line[i] ?? "";

    if (config.lineComment && line.startsWith(config.lineComment, i)) {
      pushPlain(i);
      tokens.push({ text: line.slice(i), kind: "comment" });
      plainStart = line.length;
      break;
    }

    if (config.blockComment && line.startsWith(config.blockComment.start, i)) {
      pushPlain(i);
      const searchFrom = i + config.blockComment.start.length;
      const endIdx = line.indexOf(config.blockComment.end, searchFrom);
      if (endIdx === -1) {
        tokens.push({ text: line.slice(i), kind: "comment" });
        plainStart = line.length;
        inBlockComment = true;
        break;
      }
      const closeEnd = endIdx + config.blockComment.end.length;
      tokens.push({ text: line.slice(i, closeEnd), kind: "comment" });
      i = closeEnd;
      plainStart = closeEnd;
      continue;
    }

    if (config.stringDelimiters.includes(ch)) {
      pushPlain(i);
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      const end = Math.min(j, line.length);
      tokens.push({ text: line.slice(i, end), kind: "string" });
      i = end;
      plainStart = end;
      continue;
    }

    if (isWordStart(ch)) {
      let j = i + 1;
      while (j < line.length && isWordChar(line[j] ?? "")) j++;
      const word = line.slice(i, j);
      if (config.keywords.has(word)) {
        pushPlain(i);
        tokens.push({ text: word, kind: "keyword" });
        plainStart = j;
      }
      i = j;
      continue;
    }

    i++;
  }

  pushPlain(line.length);

  return { tokens, nextState: { inBlockComment } };
}

function tokenizeMarkdownLine(line: string): { tokens: Token[]; nextState: LineState } {
  if (/^#{1,6}\s/.test(line)) {
    return {
      tokens: line.length > 0 ? [{ text: line, kind: "keyword" }] : [],
      nextState: INITIAL_LINE_STATE,
    };
  }

  const tokens: Token[] = [];
  let plainStart = 0;
  let i = 0;
  while (i < line.length) {
    if (line[i] === "`") {
      const end = line.indexOf("`", i + 1);
      if (end === -1) break;
      if (i > plainStart) tokens.push({ text: line.slice(plainStart, i), kind: "plain" });
      tokens.push({ text: line.slice(i, end + 1), kind: "string" });
      i = end + 1;
      plainStart = i;
      continue;
    }
    i++;
  }
  if (plainStart < line.length) tokens.push({ text: line.slice(plainStart), kind: "plain" });

  return { tokens, nextState: INITIAL_LINE_STATE };
}

/** Tokenisiert die gesamte Datei auf einmal (ein Aufruf pro Tastendruck, s.
 * Kopfkommentar `FileEditor.tsx`s `EditorBuffer` zur Kostenbegründung: reines
 * Scannen ohne DOM-Arbeit bleibt für reale Repo-Dateien im niedrigen
 * Millisekundenbereich — teuer wäre nur, JEDE Zeile davon auch zu rendern,
 * weshalb `FileEditor.tsx` nur das sichtbare Fenster in Elemente umsetzt). */
export function tokenizeLines(text: string, language: LanguageId | null): Token[][] {
  const lines = text.split("\n");
  const config = language && language !== "markdown" ? LANGUAGE_CONFIG[language] : null;
  let state = INITIAL_LINE_STATE;
  const result: Token[][] = [];
  for (const line of lines) {
    const { tokens, nextState } =
      language === "markdown" ? tokenizeMarkdownLine(line) : tokenizeCodeLine(line, config, state);
    result.push(tokens);
    state = nextState;
  }
  return result;
}
