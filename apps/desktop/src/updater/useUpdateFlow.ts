import { useCallback, useEffect, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, isHomebrewInstall } from "./updateManager";

export type UpdateFlowState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current"; version: string }
  | { phase: "homebrew" }
  | { phase: "available"; update: Update }
  | { phase: "downloading"; update: Update; percent: number | null }
  | { phase: "confirmRestart"; update: Update }
  | { phase: "checkError" }
  | { phase: "installError"; update: Update };

/**
 * Der eine Ablauf für „prüfen → herunterladen & installieren → vor dem
 * Neustart bestätigen lassen → neu starten", geteilt zwischen dem Banner im
 * Hauptfenster und dem manuellen Knopf im Über-Fenster (docs/decisions.md →
 * "Auto-Update via GitHub Releases", Punkt 3). Beide Aufrufer bringen ihre
 * eigene Version von `check()` mit — hier steckt nur der Ablauf, keine
 * Drosselung, kein Homebrew-Kurzschluss vor dem allerersten Check.
 */
export function useUpdateFlow(currentVersion: string | null) {
  const [state, setState] = useState<UpdateFlowState>({ phase: "idle" });
  // downloadAndInstall() bricht bei einem Fehler NICHT sauber ab, wenn diese
  // Komponente inzwischen unmounted wurde (Über-Fenster kann jederzeit
  // schließen) — dieses Ref lässt das `setState` danach verlässlich
  // ausbleiben, ohne die Downloadfunktion selbst abbrechen zu müssen.
  const mounted = useRef(true);
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(async () => {
    setState({ phase: "checking" });
    if (await isHomebrewInstall()) {
      setState({ phase: "homebrew" });
      return;
    }
    const result = await checkForUpdate();
    if (!mounted.current) return;
    switch (result.status) {
      case "current":
        setState({ phase: "current", version: currentVersion ?? "" });
        break;
      case "available":
        setState({ phase: "available", update: result.update });
        break;
      case "failed":
        setState({ phase: "checkError" });
        break;
    }
  }, [currentVersion]);

  const installAndRestart = useCallback((update: Update) => {
    setState({ phase: "downloading", update, percent: null });
    let receivedBytes = 0;
    let totalBytes: number | null = null;
    void update
      .downloadAndInstall((event) => {
        if (!mounted.current) return;
        switch (event.event) {
          case "Started":
            totalBytes = event.data.contentLength ?? null;
            break;
          case "Progress":
            receivedBytes += event.data.chunkLength;
            setState({
              phase: "downloading",
              update,
              percent:
                totalBytes && totalBytes > 0
                  ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
                  : null,
            });
            break;
          case "Finished":
            break;
        }
      })
      .then(() => {
        if (!mounted.current) return;
        setState({ phase: "confirmRestart", update });
      })
      .catch(() => {
        if (!mounted.current) return;
        setState({ phase: "installError", update });
      });
  }, []);

  const confirmRestart = useCallback(() => {
    void relaunch();
  }, []);

  const dismiss = useCallback(() => {
    setState({ phase: "idle" });
  }, []);

  return { state, check, installAndRestart, confirmRestart, dismiss };
}
