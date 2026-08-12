// Node 22+ definiert ein eigenes globales `localStorage`/`sessionStorage`
// (nutzbar nur mit `--localstorage-file`, sonst funktionslos). In Vitests
// jsdom-Umgebung landet dieser Node-eigene Getter VOR jsdoms echtem, weil
// `populateGlobal` Schlüssel überspringt, die bereits `in global` existieren
// und nicht in der eigenen Kopierliste stehen — `window.localStorage` griffe
// sonst ins Leere. Hier wird der Getter auf jsdoms echte Implementierung
// umgebogen, bevor irgendein anderes Modul (insbesondere `../i18n`) darauf
// zugreift; deshalb muss dieser Import in `setup.ts` vor allen anderen stehen.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => dom.window.localStorage,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get: () => dom.window.sessionStorage,
  });
}
