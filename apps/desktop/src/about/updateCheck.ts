// Kein Auto-Updater: Signierung und Verteilungsweg sind für v0.1 nicht
// entschieden, deshalb hier bewusst nur eine Abfrage der öffentlichen
// GitHub-Release-API statt tauri-plugin-updater. Sie beantwortet genau eine
// Frage — gibt es etwas Neueres? Heruntergeladen und installiert wird von Hand.
//
// Solange das Repository privat ist, antwortet GitHub mit 404. Das landet
// planmäßig im Zustand "failed": lieber ein ehrliches „konnte nicht geprüft
// werden" als ein vorgetäuschtes „du bist aktuell".

const REPOSITORY = "silvio-l/panecrew";

export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;

const LATEST_RELEASE_ENDPOINT = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

export type UpdateCheck =
  | { status: "current" }
  | { status: "available"; version: string; url: string }
  | { status: "failed" };

function segments(version: string): number[] {
  // Ein Vorabkennzeichen (1.0.0-beta.1) und Build-Metadaten (+abc) fallen weg:
  // sie ordnen sich nach SemVer VOR der gleichnamigen Endfassung, und ein
  // Release-Tag der App trägt sie nicht.
  const core = version.trim().replace(/^v/i, "").split(/[-+]/)[0] ?? "";
  return core.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isNaN(value) ? 0 : value;
  });
}

/** Segmentweise numerisch, damit 0.10.0 über 0.9.0 steht (nicht darunter). */
export function compareVersions(a: string, b: string): number {
  const left = segments(a);
  const right = segments(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export async function checkForUpdate(
  currentVersion: string,
): Promise<UpdateCheck> {
  try {
    const response = await fetch(LATEST_RELEASE_ENDPOINT, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return { status: "failed" };

    const release = (await response.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
    };
    if (typeof release.tag_name !== "string") return { status: "failed" };

    const version = release.tag_name.replace(/^v/i, "");
    if (compareVersions(version, currentVersion) <= 0) return { status: "current" };

    return {
      status: "available",
      version,
      url: typeof release.html_url === "string" ? release.html_url : RELEASES_URL,
    };
  } catch {
    return { status: "failed" };
  }
}
