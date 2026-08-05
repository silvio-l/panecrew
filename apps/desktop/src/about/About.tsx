/*
 * Über-Fenster — eigenes, auf Zuruf geöffnetes Tauri-Fenster (about.html), kein
 * Panel im Hauptfenster.
 *
 * Verhältnis zum Splash: gleiche Bauart, eigene Komposition. Übernommen ist
 * dessen Grundmuster — ein transparentes, undekoriertes natives Fenster, in dem
 * die gesamte Silhouette selbst gemalt wird: Schlagschatten als eigene Fläche
 * dahinter, Bühne per clip-path auf die Gehrungsfuge der Marke angeschnitten,
 * 1px-Lichtkante darauf. Der Anschnitt ist damit die echte Fensterkontur und
 * keine Kerbe in einem Rechteck.
 *
 * Anders als der Splash ist das hier trotzdem ein normales App-Fenster: es lädt
 * theme.css und folgt Dark wie Light, statt eine fest dunkle Markenbühne zu
 * sein. Und weil keine native Dekoration da ist, bringt es sein eigenes
 * Schließkreuz mit (zusätzlich zu Escape) — bei einem modalen Fenster ist der
 * sichtbare Ausgang Pflicht, nicht Zierde.
 *
 * Farbe: der Amber-Verlauf gehört laut CLAUDE.md ausschließlich dem Emblem.
 * Zustände der Update-Prüfung tragen deshalb KEINE Ampelfarben (grün/rot wären
 * zudem ANSI-Semantik aus den Terminals) — sie unterscheiden sich über Text
 * und Folgeaktion, nicht über einen Farbcode.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
// Aus der echten LICENSE des Repos statt aus einer Kopie im Code: eine zweite
// Fassung des Lizenztextes wäre genau die Art Duplikat, die still veraltet.
import licenseText from "../../../../LICENSE?raw";
import {
  REPOSITORY_URL,
  RELEASES_URL,
  checkForUpdate,
  type UpdateCheck,
} from "./updateCheck";

// Die LICENSE ist auf 80 Zeichen hart umbrochen. In einer 380px schmalen Box
// zerfiele sie dadurch in Stummelzeilen — hier werden die Umbrüche INNERHALB
// eines Absatzes aufgelöst, Leerzeilen bleiben Absatzgrenzen. Der Wortlaut
// bleibt unangetastet, nur der Flattersatz verschwindet.
const LICENSE_PARAGRAPHS = licenseText
  .trim()
  .split(/\n{2,}/)
  .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " "));

// Die Silhouette. Feste Pixel, weil das Fenster nicht größenveränderlich ist —
// dieselben Maße stehen in about.rs, das dort zusätzlich den Rand für den
// Schlagschatten aufschlägt.
//
// Die Steigung des Anschnitts ist die der Gehrungsfuge im Markenmal (325:405 im
// Emblem, 152:122 beim Splash) — 100:80 trifft sie auf 0,3 % genau. Der Radius
// ist der des Splash, auf diese Fenstergröße heruntergerechnet (26/800 → 14 bei
// 440); 16 rundet das auf einen Wert, der neben echten macOS-Fenstern nicht als
// Kugel liest.
const FRAME_WIDTH = 440;
const FRAME_HEIGHT = 480;
const MITRE_WIDTH = 100;
const MITRE_HEIGHT = 80;
const CORNER_RADIUS = 16;
const SILHOUETTE = [
  `M ${CORNER_RADIUS} 0`,
  `L ${FRAME_WIDTH - MITRE_WIDTH} 0`,
  `L ${FRAME_WIDTH} ${MITRE_HEIGHT}`,
  `L ${FRAME_WIDTH} ${FRAME_HEIGHT - CORNER_RADIUS}`,
  `A ${CORNER_RADIUS} ${CORNER_RADIUS} 0 0 1 ${FRAME_WIDTH - CORNER_RADIUS} ${FRAME_HEIGHT}`,
  `L ${CORNER_RADIUS} ${FRAME_HEIGHT}`,
  `A ${CORNER_RADIUS} ${CORNER_RADIUS} 0 0 1 0 ${FRAME_HEIGHT - CORNER_RADIUS}`,
  `L 0 ${CORNER_RADIUS}`,
  `A ${CORNER_RADIUS} ${CORNER_RADIUS} 0 0 1 ${CORNER_RADIUS} 0`,
  "Z",
].join(" ");
const SILHOUETTE_CLIP = `path("${SILHOUETTE}")`;

type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "done"; result: UpdateCheck };

export function About() {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ phase: "idle" });
  const [licenseOpen, setLicenseOpen] = useState(false);
  const versionRef = useRef<string | null>(null);
  const licenseRef = useRef<HTMLDivElement>(null);

  const runCheck = useCallback(() => {
    const current = versionRef.current;
    if (current === null) return;
    setUpdate({ phase: "checking" });
    void checkForUpdate(current).then((result) => {
      setUpdate({ phase: "done", result });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const current = await getVersion();
      if (cancelled) return;
      versionRef.current = current;
      setVersion(current);
      // Das Fenster startet unsichtbar und deckt sich erst hier selbst auf —
      // erst ab jetzt steht die Silhouette samt Version. Zwei verschachtelte
      // Frames, weil der erste noch VOR dem Malen läuft. Rust hat dafür eine
      // eigene Zeitschranke, falls es nie so weit kommt.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => void invoke("about_visible"));
      });
      // Das Menü kann die Prüfung schon angefordert haben, bevor dieses
      // Fenster überhaupt existierte; Rust hat den Wunsch so lange gehalten.
      if (await invoke<boolean>("about_take_update_request")) runCheck();
    };
    void start().catch((error: unknown) => {
      console.error("PaneCrew: Über-Fenster konnte nicht laden", error);
    });
    return () => {
      cancelled = true;
    };
  }, [runCheck]);

  // Zweiter Weg für denselben Menüpunkt: war das Fenster bereits offen, ist der
  // Mount oben längst vorbei und Rust schickt stattdessen ein Ereignis.
  useEffect(() => {
    const unlisten = listen("about:check-updates", runCheck);
    return () => {
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, [runCheck]);

  // Der Lizenztext klappt unterhalb der Fensterkante auf — ohne das hier wäre
  // die einzige Rückmeldung auf den Klick eine erscheinende Bildlaufleiste.
  useEffect(() => {
    if (licenseOpen) {
      licenseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [licenseOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void getCurrentWindow().close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <div
      className="relative"
      style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT }}
    >
      {/* Schlagschatten als eigene Fläche DAHINTER statt als filter auf der
          Bühne: ein filter-Vorfahre kappt den Backdrop des Weichzeichners in
          der Fußleiste (dieselbe Falle wie im Splash). Schwarz in beiden
          Themes — echte Fensterschatten sind das auf macOS auch. */}
      <svg
        width={FRAME_WIDTH}
        height={FRAME_HEIGHT}
        viewBox={`0 0 ${String(FRAME_WIDTH)} ${String(FRAME_HEIGHT)}`}
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          filter: "blur(26px)",
          transform: "translateY(12px)",
          opacity: 0.45,
        }}
      >
        <path d={SILHOUETTE} fill="#000" />
      </svg>

      <div
        style={{ clipPath: SILHOUETTE_CLIP }}
        className="absolute inset-0 flex flex-col bg-(--pc-app-background) text-(--pc-foreground)"
      >
        <button
          type="button"
          aria-label="Schließen"
          onClick={() => void getCurrentWindow().close()}
          className="absolute left-3 top-3 z-10 flex size-6 items-center justify-center rounded-md text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--pc-focusBorder)"
        >
          <CloseIcon />
        </button>

        <header
          data-tauri-drag-region
          style={{
            backgroundImage:
              "linear-gradient(180deg, var(--pc-explorer-background), var(--pc-app-background))",
          }}
          className="flex shrink-0 flex-col items-center gap-2.5 px-7 pb-7 pt-10"
        >
          <BrandMark />
          <div className="pointer-events-none flex flex-col items-center gap-1">
            <h1 className="text-(length:--pc-chrome-fontSizeDisplay) font-semibold tracking-tight text-(--pc-foreground)">
              PaneCrew
            </h1>
            <p className="text-(length:--pc-chrome-fontSizeSmall) tracking-[0.07em] text-(--pc-descriptionForeground)">
              Version {version ?? "…"}
            </p>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-7 pb-14 pt-5">
          <p className="text-(length:--pc-chrome-fontSize) leading-relaxed text-(--pc-descriptionForeground)">
            Mehrere echte Terminal-Sitzungen nebeneinander statt hintereinander
            — ein Raster aus lebenden Panes, dazu ein Datei-Explorer, der immer
            der gerade fokussierten Pane folgt.
          </p>

          <section className="flex flex-col items-start gap-2.5">
            <button
              type="button"
              onClick={runCheck}
              disabled={update.phase === "checking"}
              aria-busy={update.phase === "checking"}
              className="flex h-8 items-center rounded-md border border-(--pc-pane-border) bg-(--pc-explorer-background) px-3.5 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--pc-focusBorder) disabled:opacity-50"
            >
              Nach Updates suchen
            </button>
            <UpdateStatus state={update} version={version} />
          </section>

          <div className="flex items-center gap-5">
            <QuietButton onClick={() => void openUrl(REPOSITORY_URL)}>
              GitHub-Repository
            </QuietButton>
            <QuietButton
              onClick={() => setLicenseOpen((open) => !open)}
              expanded={licenseOpen}
            >
              Lizenztext
            </QuietButton>
          </div>

          {licenseOpen && (
            <div
              ref={licenseRef}
              className="flex select-text flex-col gap-2.5 rounded-md border border-(--pc-widget-border) bg-(--pc-widget-background) p-3.5 text-(length:--pc-chrome-fontSizeSmall) leading-relaxed text-(--pc-descriptionForeground)"
            >
              {LICENSE_PARAGRAPHS.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          )}
        </div>

        <footer
          style={{ backgroundImage: "var(--pc-glass-faceLight)" }}
          className="absolute inset-x-0 bottom-0 flex h-11 items-center justify-between border-t border-(--pc-glass-border) bg-(--pc-glass-background) px-7 text-(length:--pc-chrome-fontSizeSmall) tracking-[0.07em] text-(--pc-descriptionForeground) backdrop-blur-lg backdrop-saturate-150"
        >
          <span>© 2026 Silvio Lindstedt</span>
          <span>MIT-Lizenz</span>
        </footer>
      </div>

      {/* Lichtkante auf der Silhouette. Der Strich wird mittig gezeichnet, das
          Clipping auf denselben Pfad lässt nur die innere Hälfte stehen — so
          sitzt die Kante bündig statt einen halben Pixel darüber. */}
      <svg
        width={FRAME_WIDTH}
        height={FRAME_HEIGHT}
        viewBox={`0 0 ${String(FRAME_WIDTH)} ${String(FRAME_HEIGHT)}`}
        aria-hidden="true"
        style={{ clipPath: SILHOUETTE_CLIP }}
        className="pointer-events-none absolute inset-0"
      >
        <path
          d={SILHOUETTE}
          fill="none"
          stroke="var(--pc-widget-border)"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

function UpdateStatus({
  state,
  version,
}: {
  state: UpdateState;
  version: string | null;
}) {
  return (
    <p
      role="status"
      // Höhe der einzeiligen Meldung schon im Leerzustand reserviert: sonst
      // rutscht beim ersten Ergebnis alles darunter eine Zeile nach unten.
      className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)"
    >
      {message(state, version)}
    </p>
  );
}

function message(state: UpdateState, version: string | null) {
  if (state.phase === "idle") return null;
  if (state.phase === "checking") return "Wird geprüft …";

  const result = state.result;
  switch (result.status) {
    case "current":
      return `PaneCrew ${version ?? ""} ist aktuell.`;
    case "available":
      return (
        <>
          <span className="text-(--pc-foreground)">
            Version {result.version} ist verfügbar.
          </span>
          <QuietButton onClick={() => void openUrl(result.url)}>
            Release öffnen
          </QuietButton>
        </>
      );
    case "failed":
      return (
        <>
          Konnte nicht geprüft werden.
          <QuietButton onClick={() => void openUrl(RELEASES_URL)}>
            Auf GitHub nachsehen
          </QuietButton>
        </>
      );
  }
}

// Zurückhaltender als der Prüf-Knopf daneben: das Fenster hat genau eine
// Handlung, die einen Rahmen verdient, alles Weitere sind Verweise.
function QuietButton({
  onClick,
  expanded,
  children,
}: {
  onClick: () => void;
  expanded?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="rounded-sm text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground) underline decoration-current/35 underline-offset-3 transition-colors hover:text-(--pc-foreground) focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-(--pc-focusBorder)"
    >
      {children}
    </button>
  );
}

// Der einzige sichtbare Ausgang neben Escape: ohne native Dekoration gibt es
// keine Ampeln. strokeWidth so gewählt, dass die gerendete Strichstärke die
// 1,1px des übrigen Chromes trifft (Attributwert x Zielgröße / viewBox-Kante).
function CloseIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 2 L10 10 M10 2 L2 10" />
    </svg>
  );
}

// Die Marke in Anzeigegröße, 1:1 aus icons/source/panecrew-mark.svg — hier
// samt Streulicht. Die Titelleisten-Fassung in TitleBar.tsx lässt es bewusst
// weg, weil dessen stdDeviation bei 16px im Subpixelbereich landet und die
// Gehrungsfuge verschmiert; bei 72px sind daraus 1,4 bzw. 3,2 px echtes Glühen.
function BrandMark() {
  return (
    <svg width="72" height="72" viewBox="0 0 1600 1600" aria-hidden="true">
      <defs>
        <radialGradient
          id="pcMarkChevron"
          gradientUnits="userSpaceOnUse"
          cx="1330"
          cy="780"
          r="900"
        >
          <stop offset="0" stopColor="#FEF2DE" />
          <stop offset="0.15" stopColor="#FEF0D8" />
          <stop offset="0.35" stopColor="#FFE9C8" />
          <stop offset="0.56" stopColor="#FFD394" />
          <stop offset="0.67" stopColor="#FFCE8C" />
          <stop offset="0.8" stopColor="#FEBE63" />
          <stop offset="0.88" stopColor="#FDB14B" />
          <stop offset="1" stopColor="#FCAD43" />
        </radialGradient>
        <linearGradient
          id="pcMarkBlock"
          gradientUnits="userSpaceOnUse"
          x1="106"
          y1="0"
          x2="569"
          y2="0"
        >
          <stop offset="0" stopColor="#FBB84E" />
          <stop offset="0.15" stopColor="#FEBE64" />
          <stop offset="0.5" stopColor="#FEE0B6" />
          <stop offset="0.82" stopColor="#FFF2DE" />
          <stop offset="1" stopColor="#FFF5E2" />
        </linearGradient>
        <mask
          id="pcMarkGapMask"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="1600"
          height="1600"
        >
          <rect width="1600" height="1600" fill="#ffffff" />
          <polygon points="569,1208 749,1218 555,1485 368,1485" fill="#000000" />
        </mask>
        <filter
          id="pcMarkGlow"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="30" result="b1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="70" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
          </feMerge>
        </filter>
      </defs>
      <g mask="url(#pcMarkGapMask)">
        <g filter="url(#pcMarkGlow)" opacity="0.5" fill="#FFA929">
          <path d="M800 115 L1494 810 L819 1485 L555 1485 L749 1218 L1157 810 L632 283 Z" />
          <path d="M106 1208 L569 1208 L368 1485 L106 1485 Z" />
        </g>
      </g>
      <path
        fill="url(#pcMarkChevron)"
        d="M800 115 L1494 810 L819 1485 L555 1485 L749 1218 L1157 810 L632 283 Z"
      />
      <path fill="url(#pcMarkBlock)" d="M106 1208 L569 1208 L368 1485 L106 1485 Z" />
    </svg>
  );
}
