// Der eine Ort, an dem `tauri-plugin-updater` tatsächlich angefasst wird —
// sowohl der Banner im Hauptfenster (automatischer, gedrosselter Check) als
// auch der manuelle Knopf im Über-Fenster rufen ausschließlich diese
// Funktionen auf, nie die Plugin-API direkt. Ersetzt `updateCheck.ts`
// vollständig (docs/decisions.md → "Auto-Update via GitHub Releases"): dort
// wurde nur die öffentliche GitHub-API abgefragt, weil Signierung und
// Vertriebsweg noch nicht entschieden waren. Beides ist jetzt entschieden,
// deshalb übernimmt der echte Updater die Prüfung UND die Installation.
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

const AUTO_CHECK_STORAGE_KEY = "panecrew.updater.lastAutoCheckAt";
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Aktivierungsgrenze aus Ticket 30, Punkt 7: der automatische Check bleibt
 * aus, bis das reale `panecrew`-Repo öffentlich ist — ein privates Repo
 * liefert auf die Updater-Endpunkte ohnehin nur 404/401, ein `false` hier
 * verhindert aber zusätzlich, dass jeder Start eine Fehlermeldung erzeugt.
 * Der manuelle Weg (Über-Fenster-Knopf, Menüpunkt) bleibt davon unberührt —
 * das ist ein bewusster Nutzer-Klick, kein automatisches Verhalten.
 */
export const AUTO_CHECK_ENABLED = false as boolean;

export async function isHomebrewInstall(): Promise<boolean> {
  try {
    return await invoke<boolean>("updater_is_homebrew_install");
  } catch {
    return false;
  }
}

/** Nur für den automatischen Check im Hauptfenster — der manuelle Weg fragt
 * nie nach Drosselung. */
export function shouldAutoCheck(): boolean {
  if (!AUTO_CHECK_ENABLED) return false;
  const last = Number(localStorage.getItem(AUTO_CHECK_STORAGE_KEY) ?? "0");
  return Date.now() - last >= AUTO_CHECK_INTERVAL_MS;
}

/** Wird VOR dem eigentlichen Check aufgerufen, nicht erst nach einem
 * erfolgreichen Ergebnis — ein Fehlschlag (Netz, Signatur) darf nicht dazu
 * führen, dass es beim nächsten Start sofort erneut versucht wird. */
export function recordAutoCheckAttempt(): void {
  localStorage.setItem(AUTO_CHECK_STORAGE_KEY, String(Date.now()));
}

export type UpdateCheckResult =
  | { status: "current" }
  | { status: "available"; update: Update }
  | { status: "failed" };

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    if (update === null) return { status: "current" };
    return { status: "available", update };
  } catch {
    return { status: "failed" };
  }
}
