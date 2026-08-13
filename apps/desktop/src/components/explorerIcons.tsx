import type { FileKind } from "../types/project";

// Die echten Datei-Glyphen des Seti-UI-Icon-Themes — dasselbe Set, aus dem
// das mitgelieferte Seti-Icon-Theme des Referenz-Editors seinen Icon-Font baut.
//
// HERKUNFT UND LIZENZ
// Pfaddaten wörtlich aus jesseweed/seti-ui, Branch `master`, Verzeichnis
// `icons/` (https://github.com/jesseweed/seti-ui). Lizenz: MIT,
// Copyright (c) 2014 Jesse Weed — an der Quelle geprüft
// (https://raw.githubusercontent.com/jesseweed/seti-ui/master/LICENSE.md).
// Die MIT-Bedingung „Copyright- und Lizenzhinweis beilegen" ist mit diesem
// Block plus PaneCrews eigener MIT-Lizenz erfüllt.
//
// WARUM INLINE-JSX UND KEIN FONT/ASSET
// Der Referenz-Editor lädt dieses Set als Icon-Font (ein Zeichen pro Dateityp, Farbe über
// `fontColor`). Hier steht dieselbe Vektorgeometrie direkt als JSX: das Repo
// importiert bisher nirgends eine .svg-Datei und bindet auch keinen eigenen
// Font ein — die Titelzeilen-Marke, die Chrome-Glyphen und diese Datei sind
// alle handinlined. Ein Font wäre ein zusätzlicher Ladepfad für 14 Glyphen.
//
// WARUM currentColor STATT DER FÜLLFARBEN DER QUELLDATEIEN
// Die .svg-Dateien tragen Seti-UIs eigene Fassung der Farbe (#529BBA,
// #F1DD3F …), der Referenz-Editor ignoriert die und färbt den Font stattdessen über die
// `fontColor`-Spalte von `vs-seti-icon-theme.json` (#519aba, #cbcb41 …).
// Genau diese Spalte ist bereits als --pc-icon-* in theme.css hinterlegt,
// Dark- wie Light-Fassung. Die Füllfarben der Quelldateien sind deshalb
// entfernt und die Farbe kommt aus dem Token — sonst hinge das Icon-Set als
// einziges Element der App am Theme-Wechsel vorbei.
//
// ZWEI FARBEN OHNE TOKEN
// `_git` (#41535b dark / #3b4b52 light) und `_default` (#d4d7d6 / #bfc2c1)
// haben in theme.css kein Gegenstück. Beide stehen hier auf --pc-icon-gray
// (#6d8086 / #627379, Seti-eigener Neutralton) statt auf einem neu erfundenen
// Hex — Farbwerte gehören in theme.css, nicht hierher.
//
// VIEWBOX
// Die meisten Quelldateien liegen in einer 32er-Box und sind untereinander
// stimmig. `lock.svg` und `default.svg` stammen aus einer späteren
// Zeichensatz-Generation mit 1200x1000-Box und säßen darin deutlich zu klein;
// ihre viewBox ist deshalb auf ihre Glyphenmitte beschnitten, so dass ihre
// optische Höhe der der 32er-Familie entspricht. Die Pfaddaten selbst bleiben
// dabei unangetastet.

interface SetiGlyph {
  /** Ausschnitt, in dem der Pfad gezeichnet ist — s. Block „VIEWBOX" oben. */
  viewBox: string;
  /** Pfaddaten, wörtlich aus der Quelldatei. */
  d: string;
  /** Token aus theme.css, entspricht Seti-UIs `fontColor` für dieses Glyph. */
  color: string;
  /** Nur gesetzt, wo die Quelldatei selbst eine Füllregel führt. */
  fillRule?: "evenodd";
}

const FILE_GLYPH: Record<FileKind, SetiGlyph> = {
  // typescript.svg — Icon-Theme-ID: _typescript
  ts: {
    viewBox: "0 0 32 32",
    d: "M15.6 11.8h-3.4V22H9.7V11.8H6.3V10h9.2v1.8zm7.7 7.1c0-.5-.2-.8-.5-1.1-.3-.3-.9-.5-1.7-.8-1.4-.4-2.5-.9-3.3-1.5-.7-.6-1.1-1.3-1.1-2.3 0-1 .4-1.8 1.3-2.4.8-.6 1.9-.9 3.2-.9 1.3 0 2.4.4 3.2 1.1.8.7 1.2 1.6 1.2 2.6h-2.3c0-.6-.2-1-.6-1.4-.4-.3-.9-.5-1.6-.5-.6 0-1.1.1-1.5.4-.4.3-.5.7-.5 1.1 0 .4.2.7.6 1 .4.3 1 .5 2 .8 1.3.4 2.3.9 3 1.5.7.6 1 1.4 1 2.4s-.4 1.9-1.2 2.4c-.8.6-1.9.9-3.2.9-1.3 0-2.5-.3-3.4-1s-1.5-1.6-1.4-2.9h2.4c0 .7.2 1.2.7 1.6.4.3 1.1.5 1.8.5s1.2-.1 1.5-.4c.2-.3.4-.7.4-1.1z",
    color: "var(--pc-icon-blue)",
  },
  // react.svg — Icon-Theme-ID: _react (typescriptreact)
  tsx: {
    viewBox: "0 0 32 32",
    d: "M22 19.4c.1 1.1.2 2.1.2 3.2 0 1.3-.7 2.2-1.7 2.3-.5.1-1.1 0-1.6-.2-1-.5-1.9-1.2-2.9-1.8-.5.4-1 .8-1.6 1.2-.3.2-.7.4-1 .5-1.8.8-3.3-.1-3.4-2.1 0-1 .1-2.1.2-3.2-.6-.2-1.2-.4-1.8-.8-.6-.3-1.1-.7-1.6-1.2-.9-.9-.8-2 .1-2.9.8-.9 1.9-1.3 3-1.7.1 0 .3-.1.4-.1-.1-.7-.2-1.5-.3-2.2 0-.6.1-1.3.2-1.9.3-1.1 1.3-1.6 2.5-1.3 1.2.3 2.1 1 2.9 1.7.2.1.3.3.4.4.8-.6 1.6-1.2 2.5-1.7.6-.4 1.3-.6 2-.4 1 .2 1.6 1.1 1.7 2.4v1.6c0 .5-.2 1-.3 1.6.6.2 1.1.4 1.7.7.8.4 1.6.8 2.1 1.6.5.7.5 1.5 0 2.2-.5.8-1.3 1.2-2.1 1.6-.6.1-1.1.3-1.6.5zm-5.8-.1c.3 0 .8-.1 1.2-.1.3 0 .5-.1.7-.4.5-.8 1-1.6 1.4-2.5.1-.2.1-.5 0-.6-.5-.9-1-1.7-1.5-2.5-.1-.2-.3-.3-.5-.3-.9 0-1.7 0-2.6-.1-.5 0-.9.2-1.2.7-.2.3-.4.6-.6 1-1.1 2-1.1 1.2 0 3.2 1.2 1.9.6 1.5 3.1 1.6zm-5.8-.8c.3-.8.6-1.6.9-2.3v-.4c-.3-.8-.6-1.5-.9-2.3-1 .3-2 .7-2.8 1.3-.9.7-.9 1.6 0 2.3.8.8 1.8 1.1 2.8 1.4zm11.3-5.1c-.4.9-.7 1.7-1 2.5 0 .1-.1.2 0 .2.3.8.6 1.6 1 2.6.9-.5 1.9-.9 2.7-1.4 1.1-.7 1.1-1.7 0-2.4-.8-.7-1.8-1-2.7-1.5zm-10.7-1c.9-.1 1.7-.2 2.5-.4.1 0 .2-.1.2-.1.5-.7 1-1.3 1.6-2-.8-.7-1.6-1.4-2.6-1.8-1.1-.4-1.8 0-2 1.2-.1 1 .1 2 .3 3.1zm10 0c0-.1.1-.3.1-.4.2-1 .4-2.1 0-3.1-.2-.7-.7-1-1.3-.9-1.3.2-2.2 1.1-3.1 1.9.5.7 1 1.3 1.5 1.9l.3.3c.8.1 1.6.2 2.5.3zm-10 7.2c-.2 1.1-.5 2.1-.2 3.2.2 1 .9 1.4 1.9 1.1 1.1-.3 1.9-1.1 2.7-1.8-.5-.7-1-1.3-1.6-2-.1-.1-.2-.2-.3-.2-.8 0-1.6-.1-2.5-.3zm5.6 2.5c.6.8 1.8 1.6 2.6 1.9 1 .3 1.7 0 1.9-1.1.2-1.1 0-2.1-.2-3.2-.9.1-1.8.1-2.6.4-.6.3-.9 1-1.3 1.5-.1.2-.2.3-.4.5zm.6-10.2c-.4-.5-.8-.9-1.2-1.4-.4.5-.7.9-1.2 1.4h2.4zm0 8.2h-2.3c.4.5.8.9 1.2 1.4.3-.5.7-.9 1.1-1.4zm-4.1-1c-.4-.7-.8-1.3-1.2-2.1-.2.6-.4 1.1-.6 1.7.5.2 1.1.3 1.8.4zm7-2.1l-1.2 2.1c.7-.1 1.2-.2 1.8-.3-.1-.6-.3-1.1-.6-1.8zm-8.2-2l1.2-2.1c-.7.1-1.2.2-1.8.3.2.7.3 1.2.6 1.8zm7-2.1c.2.4.4.7.6 1 .2.3.4.6.6 1 .2-.6.4-1.2.6-1.7-.6 0-1.1-.1-1.8-.3z",
    color: "var(--pc-icon-blue)",
  },
  // javascript.svg — Icon-Theme-ID: _javascript
  js: {
    viewBox: "0 0 32 32",
    d: "M11.4 10h2.7v7.6c0 3.4-1.6 4.6-4.3 4.6-.6 0-1.5-.1-2-.3l.3-2.2c.4.2.9.3 1.4.3 1.1 0 1.9-.5 1.9-2.4V10zm5.1 9.2c.7.4 1.9.8 3 .8 1.3 0 1.9-.5 1.9-1.3s-.6-1.2-2-1.7c-2-.7-3.3-1.8-3.3-3.6 0-2.1 1.7-3.6 4.6-3.6 1.4 0 2.4.3 3.1.6l-.6 2.2c-.5-.2-1.3-.6-2.5-.6s-1.8.5-1.8 1.2c0 .8.7 1.1 2.2 1.7 2.1.8 3.1 1.9 3.1 3.6 0 2-1.6 3.7-4.9 3.7-1.4 0-2.7-.4-3.4-.7l.6-2.3z",
    color: "var(--pc-icon-yellow)",
  },
  // json.svg — Icon-Theme-ID: _json
  json: {
    viewBox: "0 0 32 32",
    d: "M7.5 15.1c1.5 0 1.7-.8 1.7-1.5 0-.6-.1-1.1-.1-1.7S9 10.7 9 10.2c0-2.1 1.3-3 3.4-3h.8v1.9h-.4c-1 0-1.3.6-1.3 1.6 0 .4.1.8.1 1.3 0 .4.1.9.1 1.5 0 1.7-.7 2.3-1.9 2.6 1.2.3 1.9.9 1.9 2.6 0 .6-.1 1.1-.1 1.5 0 .4-.1.9-.1 1.2 0 1 .3 1.6 1.3 1.6h.4v1.9h-.8c-2 0-3.3-.8-3.3-3 0-.6 0-1.1.1-1.7.1-.6.1-1.2.1-1.7 0-.6-.2-1.5-1.7-1.5l-.1-1.9zm17 1.7c-1.5 0-1.7.9-1.7 1.5s.1 1.1.1 1.7c.1.6.1 1.2.1 1.7 0 2.2-1.4 3-3.4 3h-.8V23h.4c1 0 1.3-.6 1.3-1.6 0-.4 0-.8-.1-1.2 0-.5-.1-1-.1-1.5 0-1.7.7-2.3 1.9-2.6-1.2-.3-1.9-.9-1.9-2.6 0-.6.1-1.1.1-1.5.1-.5.1-.9.1-1.3 0-1-.4-1.5-1.3-1.6h-.4V7.2h.8c2.1 0 3.4.9 3.4 3 0 .6-.1 1.1-.1 1.7-.1.6-.1 1.2-.1 1.7 0 .7.2 1.5 1.7 1.5v1.7z",
    color: "var(--pc-icon-yellow)",
  },
  // rust.svg — Icon-Theme-ID: _rust
  rs: {
    viewBox: "0 0 32 32",
    d: "M21.7 8.4V9l.1.1h.1c.3-.1.6-.1.9-.2.2-.1.4.1.3.3-.1.3-.1.6-.2.9v.1l.1.1c0 .1.1.1.2.1h.9c.2 0 .3.1.3.3v.2c-.1.3-.3.6-.4.8v.1s.1.1.1.2h.1c.3.1.6.1.9.2.2 0 .3.3.2.5-.2.3-.4.5-.5.7v.2c0 .1.1.1.2.2.3.1.5.2.8.3.2.1.3.3.1.5-.2.2-.4.4-.7.6v.3s.1.1.2.1c.2.1.4.3.7.4.2.1.2.4 0 .5-.3.2-.5.3-.8.5v.1c0 .2 0 .2.1.3.2.2.4.4.6.5.2.2.1.4-.1.5-.3.1-.6.2-.8.3 0 0-.1 0-.1.1-.1.1 0 .2 0 .3.2.2.3.4.5.7.1.1.1.3-.1.4-.1 0-.1 0-.2.1-.3 0-.5.1-.8.1h-.1c0 .1-.1.1-.1.2s0 .1.1.2c.1.2.2.5.3.7.1.1 0 .3-.1.4h-1.2c-.1.1-.1.2-.1.3.1.3.1.5.2.8.1.2-.1.4-.4.4-.3-.1-.6-.1-.9-.2H22l-.1.1s-.1.1 0 .1v.9c0 .2-.1.3-.3.3h-.2c-.3-.1-.5-.2-.8-.4h-.1c-.1 0-.2.1-.2.2 0 .3-.1.5-.1.8 0 .2-.3.3-.5.2-.2-.2-.5-.4-.7-.5h-.1c-.1 0-.2.1-.2.2-.1.3-.2.5-.3.8-.1.2-.2.2-.3.2-.1 0-.1-.1-.1-.1-.2-.2-.4-.4-.6-.7h-.2c-.1 0-.2.1-.2.2-.1.2-.3.5-.4.7-.1.2-.4.2-.5 0-.2-.3-.3-.5-.5-.8h-.2c-.1 0-.1 0-.2.1l-.6.6c-.1.1-.2.1-.4.1-.1 0-.1-.1-.1-.2l-.3-.9s0-.1-.1-.1h-.3c-.2.2-.4.3-.7.5-.4-.2-.7-.3-.7-.5-.1-.3-.1-.6-.1-.9 0 0 0-.1-.1-.1s-.1-.1-.2-.1-.1 0-.2.1c-.2.1-.5.2-.7.3-.2.1-.4 0-.4-.2V23l-.1-.1h-.1c-.3.1-.6.1-.9.2-.2.1-.4-.1-.3-.3.1-.3.1-.6.2-.9v-.1l-.1-.1H8c-.2 0-.3-.1-.3-.3v-.2c.1-.3.3-.6.4-.8v-.1s0-.1-.1-.1c0-.1-.1-.1-.1-.1-.3 0-.6-.1-.9-.1-.2 0-.3-.3-.2-.5.2-.2.4-.5.5-.7v-.1c0-.1 0-.1-.1-.2 0 0-.1-.1-.2-.1-.2-.1-.5-.2-.7-.3-.2-.1-.3-.3-.1-.5.3-.1.5-.4.8-.6v-.2c0-.1 0-.2-.1-.2-.2-.1-.5-.3-.7-.4-.2-.1-.2-.4 0-.5.3-.2.5-.3.8-.5V15l-.1-.1-.6-.6c-.1-.1-.1-.3 0-.4 0 0 .1 0 .1-.1l.9-.3v-.1c.1-.1 0-.2 0-.3-.2-.2-.3-.4-.5-.6-.1-.2 0-.5.2-.5.3-.1.6-.1.9-.2H8c0-.1.1-.1.1-.2s0-.1-.1-.2c-.1-.2-.2-.5-.3-.7-.1-.2 0-.4.2-.4H9s0-.1.1-.1v-.1c-.1-.3-.2-.6-.2-.9-.1-.2.1-.4.3-.3.3 0 .6.1.9.2h.1l.1-.1s.1-.1 0-.1V8c0-.2.1-.3.3-.3h.2c.3.1.6.3.8.4h.1s.1 0 .1-.1c.1 0 .1-.1.1-.1 0-.3.1-.6.1-.9 0-.2.3-.3.5-.2.2.2.5.4.7.5h.1c.1 0 .1 0 .2-.1 0 0 0-.1.1-.2.1-.2.2-.5.3-.7.1-.2.2-.2.4-.2l.1.1c.1.3.4.5.6.8h.1c.1 0 .2-.1.2-.1.1-.2.3-.5.4-.7.2-.2.4-.2.5-.1l.1.1c.2.3.3.5.5.8h.3c.1 0 .1-.1.1-.1.2-.2.4-.4.5-.6.1-.1.3-.1.4 0v.1c.1.3.2.6.3.8l.1.1h.2c.3-.1.6-.3.8-.5.2-.1.5 0 .5.2 0 .3.1.6.1.9 0 0 0 .1.1.1h.1c.1.1.2.1.2 0 .2-.1.5-.2.8-.3.2-.1.4 0 .4.3v.4zm-11.1 2.7h7.6c.3 0 .6 0 .9.1.6.2 1.1.5 1.4.9.3.3.5.7.5 1.2 0 .4-.1.8-.3 1.2-.2.3-.5.6-.8.8-.1.1-.2.2-.3.2.1.1.2.1.3.2.2.2.5.4.6.7.2.3.3.7.3 1 0 .1.1.2.2.3.2.2.5.2.8.2.2 0 .4-.1.5-.2.2-.2.2-.4.3-.6v-.5c0-.1 0-.1.1-.1h.7v-1.3c-.3-.1-.6-.3-.9-.4-.1-.1-.3-.1-.4-.2-.3-.1-.4-.4-.3-.8.2-.5.4-1 .7-1.5v-.1c-.4-.6-.8-1.2-1.4-1.7-1-.9-2.2-1.5-3.6-1.8h-.1c-.3.3-.6.6-1 .9-.2.2-.6.2-.8 0l-.9-.9h-.1c-.4.1-.7.2-1 .3-1.1.4-2 1-2.8 1.8-.1.1-.2.2-.2.3zm11.3 9.2h-3c-.2 0-.3 0-.4-.1-.4-.2-.6-.6-.7-1-.1-.4-.2-.7-.2-1.1 0-.2-.1-.4-.2-.6-.2-.5-.6-.8-1.1-.8h-1.8V18h1.8c.1 0 .1 0 .1.1v2c0 .1 0 .1-.1.1h-6c.2.3.4.5.6.7h.1c.4-.1.8-.2 1.2-.2.3-.1.6.1.7.4.1.4.2.9.3 1.3v.1c.8.3 1.6.6 2.4.6.7.1 1.4 0 2.1-.1.5-.1 1-.3 1.5-.5v-.1c.1-.4.2-.9.3-1.3.1-.3.3-.5.7-.4l1.2.3h.1c0-.2.2-.5.4-.7zm-11.9-7l.3.6c0 .1.1.2 0 .3 0 .2-.2.3-.3.4-.4.2-.8.4-1.2.5 0 0-.1 0-.1.1v.5c0 .7.1 1.4.3 2.2 0 0 0 .1.1.1h2.1v-4.7H10zm4.3 1.4c.1 0 .1 0 0 0h2.3c.2 0 .4 0 .6-.1.1-.1.2-.1.3-.3.1-.2.1-.5-.1-.7-.2-.2-.5-.3-.7-.3h-2.5c.1.5.1.9.1 1.4zm-6-1c0 .3.3.6.6.6s.6-.3.6-.6-.3-.6-.6-.6-.6.3-.6.6zM21 22.1c0-.3-.3-.6-.6-.6s-.6.3-.6.6.3.6.6.6.6-.2.6-.6zm-9.4-.6c-.3 0-.6.3-.6.6s.3.6.6.6.6-.3.6-.6-.3-.6-.6-.6zm5-13.1c0-.3-.2-.6-.6-.6-.3 0-.6.2-.6.6 0 .3.2.6.6.6.3 0 .5-.3.6-.6zm6.5 6c.3 0 .6-.3.6-.6s-.3-.6-.6-.6-.6.3-.6.6.2.6.6.6z",
    color: "var(--pc-icon-gray)",
  },
  // config.svg — Icon-Theme-ID: _config (Endung .toml)
  toml: {
    viewBox: "0 0 32 32",
    d: "M24.5 17.3c-.4-.1-.8-.3-1.1-.4 0-.7-.1-1.3-.1-2 0-.1.1-.1.1-.2.4-.2.7-.3 1.1-.5.4-.2.5-.6.4-1-.3-.7-.6-1.3-.9-2-.2-.4-.6-.6-1-.4-.4.2-.7.3-1.1.5-.1 0-.2 0-.2-.1-.2-.3-.5-.5-.7-.7-.2-.2-.5-.4-.7-.6.2-.4.3-.8.5-1.2.2-.5 0-.9-.5-1.1-.6-.1-1.3-.4-1.9-.6-.5-.2-.9 0-1.1.5-.1.4-.3.8-.4 1.1-.7 0-1.3.1-2 .1-.1 0-.1-.1-.2-.1-.2-.4-.3-.7-.5-1.1-.2-.4-.6-.5-1-.4-.7.3-1.3.6-2 .9-.4.2-.6.6-.4 1 .2.4.3.7.5 1.1 0 .1 0 .2-.1.2-.2.2-.4.3-.5.5-.3.3-.5.6-.8.9-.4-.1-.8-.3-1.1-.4-.5-.2-.9 0-1.1.5-.2.5-.5 1.2-.7 1.8-.2.6-.1.9.5 1.1.4.1.8.3 1.1.4 0 .7.1 1.3.1 2 0 .1-.1.1-.1.2-.4.2-.7.3-1.1.5-.4.2-.5.6-.4 1 .3.7.6 1.3.9 2 .2.4.6.6 1 .4.4-.2.7-.3 1.1-.5.1 0 .2 0 .2.1.2.3.5.5.7.7.2.2.5.4.7.6-.2.4-.3.8-.5 1.2-.2.5 0 .9.5 1.1.6.2 1.2.5 1.9.7.6.2.9.1 1.1-.5.1-.4.3-.8.4-1.1.7 0 1.3-.1 2-.1.1 0 .1.1.2.1.2.4.3.7.5 1.1.2.4.6.5 1 .4.7-.3 1.3-.6 2-.9.4-.2.6-.6.4-1-.2-.4-.3-.7-.5-1.1 0-.1 0-.2.1-.2.3-.2.5-.5.7-.7.2-.2.4-.5.6-.7.4.1.8.3 1.1.4.5.2.9 0 1.1-.5.2-.6.5-1.2.7-1.9.2-.5.1-.9-.5-1.1zm-7 2.1c-1.9.8-4 0-4.9-1.9-.8-1.9 0-4 1.9-4.9 1.9-.8 4 0 4.9 1.9.8 1.9 0 4-1.9 4.9z",
    color: "var(--pc-icon-gray)",
  },
  // markdown.svg — Icon-Theme-ID: _markdown
  md: {
    viewBox: "0 0 32 32",
    d: "M20.7 6.7v9.9h3.8c-2.9 3-5.8 5.9-8.7 8.8-2.7-2.8-5.6-5.8-8.4-8.7h3.5V6.6c1.3.9 4.4 3.1 5 3.1.6 0 3.6-2.2 4.8-3z",
    color: "var(--pc-icon-blue)",
  },
  // css.svg — Icon-Theme-ID: _css
  css: {
    viewBox: "0 0 32 32",
    d: "M10.3 23.3l.8-4H8.6v-2.1h3l.5-2.5H9.5v-2.1h3.1l.8-3.9h2.8l-.8 3.9h2.8l.8-3.9h2.8l-.8 3.9h2.5v2.1h-2.9l-.6 2.5h2.6v2.1h-3l-.8 4H16l.8-4H14l-.8 4h-2.9zm6.9-6.1l.5-2.5h-2.8l-.5 2.5h2.8z",
    color: "var(--pc-icon-blue)",
  },
  // html.svg — Icon-Theme-ID: _html_3
  html: {
    viewBox: "0 0 32 32",
    d: "M8 15l6-5.6V12l-4.5 4 4.5 4v2.6L8 17v-2zm16 2.1l-6 5.6V20l4.6-4-4.6-4V9.3l6 5.6v2.2z",
    color: "var(--pc-icon-orange)",
  },
  // shell.svg — Icon-Theme-ID: _shell
  sh: {
    viewBox: "0 0 32 32",
    d: "M14.42 9.31c-.26.1-.67.3-.91.44-.14.08-.26.17-.38.26-.22.17-.54.49-.71.71-.08.1-.15.2-.22.3-.15.23-.36.64-.43.91-.04.14-.07.29-.09.44-.04.28-.04.74-.01 1.01.02.22.06.43.12.64.07.27.26.69.41.92.07.1.14.2.22.3.17.22.51.52.74.68.15.11.31.23.48.34.23.16.63.36.89.47.25.11.51.23.78.34.26.1.69.23.94.35a.3.3 0 01.08.04c.67.2 1.16.58 1.46 1.11.06.11.2.42.2.7 0 .12.07.48-.05.72-.57 1.16-1.27 1.14-2.35 1.1-.97-.22-1.35-.8-1.64-1.68-.01-.04-.02-.08-.02-.12-.05-.28-.27-.51-.55-.51h-1.61c-.28 0-.5.23-.49.51.02.33.07.65.14.94.06.27.23.7.36.95.1.18.21.35.33.51.18.22.54.49.76.65.14.1.29.2.45.29.24.14.66.31.92.41.08.03.16.05.24.07.27.06.5.28.5.56v.81c0 .28.22.51.5.51h1.11c.28 0 .5-.23.5-.51v-.81c0-.28.22-.54.49-.61.13-.03.24-.07.35-.11.26-.1.67-.28.91-.43.55-.34.93-.77 1.29-1.27.16-.23.39-.62.46-.89.05-.17.08-.35.1-.54.03-.28.03-.74 0-1.02-.02-.19-.05-.37-.1-.54a3.83 3.83 0 00-.42-.92c-.38-.6-.92-1.02-1.46-1.4-.23-.16-.62-.39-.87-.51-.61-.28-1.18-.46-1.8-.71-.26-.1-.68-.26-.89-.44-.16-.13-.45-.4-.6-.64a1.41 1.41 0 01-.17-.62c0-.06-.02-.35.03-.62.02-.12.15-.42.31-.65.03-.04.21-.27.47-.34.1-.03.4-.11.68-.12.17-.01.54-.03.82.03.12.02.42.16.64.33.1.08.34.31.46.56.07.16.19.52.2.8v.01c.02.28.23.51.51.51h1.61c.28 0 .51-.23.48-.51-.02-.25-.06-.5-.12-.74-.07-.27-.24-.7-.35-.95a3.55 3.55 0 00-.23-.43c-.14-.24-.41-.61-.62-.8-.11-.1-.22-.19-.34-.28-.23-.16-.63-.37-.87-.51-.09-.05-.18-.09-.28-.13-.26-.1-.49-.36-.49-.64V7.52c0-.28-.22-.51-.5-.51h-1.11c-.28 0-.5.23-.5.51v1.12c0 .28-.2.44-.45.56-.1.05-.21.08-.31.11z",
    color: "var(--pc-icon-green)",
  },
  // yml.svg — Icon-Theme-ID: _yml
  yaml: {
    viewBox: "0 0 32 32",
    d: "M17.1 19.3c-.5 0-.8.1-1.1.1h-1.8c.4-4.3.7-8.5 1.1-12.8 1.2 0 2.2-.1 3.2 0 .3 0 .7.5.6.8-.3 2.3-.8 4.7-1.2 7-.2 1.6-.5 3.2-.8 4.9zm.4 4c.1 1.1-.8 2.1-2.1 2.2-1.3.1-2.5-.7-2.6-1.8-.1-1.2.8-2.1 2.2-2.2 1.4-.1 2.4.6 2.5 1.8z",
    color: "var(--pc-icon-purple)",
    // Einziges Glyph der Quelle mit eigener Füllregel — wörtlich übernommen.
    fillRule: "evenodd" as const,
  },
  // git.svg — Icon-Theme-ID: _git (#41535b, s. o.)
  git: {
    viewBox: "0 0 32 32",
    d: "M7 16.2v-.3c.1-.5.4-.7.7-1.1l4.8-4.8.2-.2s.1 0 .1.1l1.8 1.8c.1.1.1.2 0 .3-.1.6.1 1.2.6 1.5.2.1.2.2.2.4v4.4c0 .2-.1.3-.2.4-.5.3-.8.9-.6 1.5.2.6.7 1 1.3 1 .6 0 1.1-.4 1.3-.9.2-.6 0-1.2-.5-1.6-.2-.1-.2-.2-.2-.4v-4.5h.1l1.6 1.6c.1.1.1.2.1.2v.6c.1.8.8 1.3 1.6 1.2.8-.1 1.4-.9 1.2-1.7-.1-.7-.9-1.2-1.6-1.1-.1 0-.2 0-.4-.1l-1.7-1.7c-.1-.1-.1-.2-.1-.3.2-.9-.7-1.8-1.6-1.6-.1 0-.3 0-.3-.1-.6-.6-1.2-1.2-1.8-1.7-.1-.1-.1-.2 0-.3.5-.4.9-.9 1.3-1.3.6-.6 1.2-.6 1.8 0l7.6 7.6c.6.6.6 1.2 0 1.8L17 24.2c-.3.3-.6.7-1.1.8h-.2c-.2-.1-.5-.2-.7-.4-.6-.6-1.3-1.2-1.9-1.9l-5.5-5.5c-.1-.3-.5-.6-.6-1z",
    color: "var(--pc-icon-gray)",
  },
  // lock.svg — Icon-Theme-ID: _lock
  lock: {
    viewBox: "178 85 845 845",
    d: "M818.5 463.8v290.9h-437V463.8h73.4v-6.2c0-22-.1-44 .1-66 .1-7.1.6-14.3 1.6-21.4 11.3-80 87.2-136 166.9-123.1C694 258.5 746.2 319.7 746.2 391v72.7c24.4.1 48.4.1 72.3.1zm-145.2-.1c.1-1.6.2-2.6.2-3.5 0-23.7.1-47.3-.1-71 0-4.1-.6-8.3-1.4-12.4-8-38.7-41-62.2-81.3-58.2-35.6 3.6-63.3 35.5-63.3 73.1v72h145.9z",
    color: "var(--pc-icon-green)",
  },
  // default.svg — Icon-Theme-ID: _default (#d4d7d6, s. o.)
  file: {
    viewBox: "220 120 761 761",
    d: "M394.1 537.8h411.7v54.7H394.1v-54.7zm0-130.3H624v54.7H394.1v-54.7zm0-130.3h411.7v54.7H394.1v-54.7zm0 390.9H700v54.7H394.1v-54.7z",
    color: "var(--pc-icon-gray)",
  },
};

// GRÖSSE
// 16px, gemeinsam für Datei- und Ordner-Glyph, damit die beiden nie
// auseinanderlaufen. Drei Gründe für genau diesen Wert:
//  1. Die Zeile ist über --pc-list-rowHeight auf 1.375rem = 22px festgenagelt;
//     16px lassen darin 3px Luft nach oben und unten, das umgebende
//     `flex items-center` zentriert sie sauber. 18px ließen nur noch 2px und
//     säßen neben dem 10px-Chevron derselben Zeile sichtbar gequetscht.
//  2. Dieselbe Kombination fährt der Referenz-Editor selbst: 16px-Icons in 22px-Zeilen.
//  3. Die 32er-viewBox der Quelle trifft bei 16px exakt Faktor 0,5 — jede
//     Pfadkoordinate landet auf einer halben Einheit statt auf der krummen
//     0,4375 von vorher, was den Glyphen bei kleinen Größen sichtbar hilft.
// Die Kopfzeilen-Glyphen in ExplorerPanel.tsx bleiben bewusst bei 14px: das
// sind Bedienelemente in eigenen 24px-Knöpfen, keine Baum-Inhalte.
const GLYPH_SIZE = 16;

export function FileIcon({ kind = "file" }: { kind?: FileKind }) {
  const glyph = FILE_GLYPH[kind];
  return (
    <svg
      width={GLYPH_SIZE}
      height={GLYPH_SIZE}
      viewBox={glyph.viewBox}
      aria-hidden="true"
      className="shrink-0"
      fill={glyph.color}
    >
      <path d={glyph.d} fillRule={glyph.fillRule} />
    </svg>
  );
}

// folder.svg aus derselben Quelle. Zwei Eigenheiten, beide bewusst:
//
// 1. Seti kennt nur EINEN Ordner — das Seti-Theme des Referenz-Editors zeigt an Ordnern
//    überhaupt kein Icon, dort trägt allein das Chevron den Zustand. PaneCrew
//    zeigt eines, also unterscheidet weiterhin die Deckkraft offen von zu,
//    genau wie vor der Umstellung auf die echten Glyphen.
// 2. Das Original füllt seine 32er-Box randlos (0,6 bis 31,2 breit), während
//    die Datei-Glyphen daneben nur rund zwei Drittel davon belegen — nebenein-
//    ander gestellt erschlüge der Ordner sie. Der Pfad ist deshalb um seine
//    eigene Mitte auf 0,62 skaliert; das bringt ihn auf ~19 Einheiten Breite
//    und damit in dieselbe optische Familie wie config/git/rust. Skaliert wird
//    per Transform, die Pfaddaten bleiben wörtlich.
const FOLDER_PATH =
  "M28.8 6.9H16.1V5.7c0-1.4-1.1-2.5-2.5-2.5H.6v25.6h30.6V9.4c.1-1.4-1-2.5-2.4-2.5z";

export function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={GLYPH_SIZE}
      height={GLYPH_SIZE}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0"
      fill="var(--pc-icon-folder)"
      fillOpacity={open ? 0.95 : 0.8}
    >
      <g transform="translate(15.9 16) scale(.62) translate(-15.9 -16)">
        <path d={FOLDER_PATH} />
      </g>
    </svg>
  );
}
