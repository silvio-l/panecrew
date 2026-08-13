import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vier Dokumente: das Hauptfenster (index.html), das Splash-Fenster
  // (splash.html), das auf Zuruf geöffnete Über-Fenster (about.html) und das
  // ebenso auf Zuruf geöffnete Settings-Fenster (settings.html, Ticket 03).
  // Der Splash lädt bewusst kein React — er soll sofort malen. Wie about.html
  // steht settings.html NICHT in tauri.conf.json's windows-Array — beide
  // Fenster öffnen zur Laufzeit über einen WebviewWindowBuilder
  // (about.rs/settings_window.rs), nicht als vordeklariertes Fenster.
  build: {
    rollupOptions: {
      input: {
        main: new URL("index.html", import.meta.url).pathname,
        splash: new URL("splash.html", import.meta.url).pathname,
        about: new URL("about.html", import.meta.url).pathname,
        settings: new URL("settings.html", import.meta.url).pathname,
      },
      output: {
        // Vendor-Code nach Paket getrennt vom eigenen App-Code (statt eines
        // einzigen >500kB-„main"-Chunks): die eigentliche Größe kommt fast
        // vollständig aus node_modules (xterm.js + Addons, Radix, React),
        // nicht aus dem eigenen Quelltext. Getrennte Chunks ändern sich nicht
        // bei jedem Feature-Commit — der Tauri-Webview lädt zwar von der
        // lokalen Platte, nicht über ein Netz, aber `pnpm tauri dev`s
        // Vite-Server nutzt fürs HMR dieselbe Chunk-Struktur, und ein Vendor-
        // Chunk, der nicht bei jeder App-Änderung neu gehasht/neu geparst
        // werden muss, bleibt auch dort der schlankere Fall. Liste bewusst
        // nach Paketname statt nach Größe geschnitten, damit ein neu
        // hinzukommendes Paket automatisch in "vendor" statt unbenannt in
        // den App-Chunk fällt.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@xterm")) return "vendor-xterm";
          if (id.includes("radix-ui")) return "vendor-radix";
          // `scheduler` extra genannt statt im generischen "vendor" zu
          // landen: react-dom importiert es zur Laufzeit, ein Split über
          // zwei Chunks hinweg ergäbe einen Zirkelbezug zwischen "vendor" und
          // "vendor-react" (von Rollup selbst als Warnung gemeldet). Anker
          // auf den node_modules-Ordnernamen, nicht nur einen Teilstring —
          // sonst matchte das hier z. B. auch @tanstack/react-virtual mit.
          if (/[/\\]node_modules[/\\](react|react-dom|scheduler)[/\\]/.test(id)) {
            return "vendor-react";
          }
          return "vendor";
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
