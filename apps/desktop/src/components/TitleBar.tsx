import { useTranslation } from "react-i18next";
import { setLanguage, SUPPORTED_LANGUAGES } from "../i18n";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";

// Titelzeile als schwebende Glaskapsel (titleBarStyle Overlay, native
// Traffic-Lights links freigehalten): ein einzelnes abgerundetes Element mit
// Rand zu allen drei Fensterkanten, das ÜBER der Inhaltsfläche liegt statt sie
// wie eine Flow-Leiste nach unten zu schieben. Darin nur noch zwei Dinge —
// mittig der rein visuelle Command-Palette-/Such-Platzhalter mit der App-Marke
// als führendem Glyph, rechts der Settings-Zugang. Kein Icon-Rail, kein
// sichtbarer App-Name (der Fenstertitel bleibt als Metadatum in
// tauri.conf.json, wo ihn macOS für Mission Control und Screenreader liest).
//
// Warum die Marke im Feld und nicht mehr links neben einem Wort: ohne Label
// war sie dort ein Aufkleber ohne Bezug. Im Feld ist sie dasselbe Muster wie
// VS Codes Command Center und Safaris Schild in der Adresszeile — an der
// prominentesten Stelle des Chromes, und sie zeigt auf das, was die App eines
// Tages öffnet.
//
// Material: der Weichzeichner allein trägt hier keine Tiefe — eine nahezu
// monochrome Dunkeloberfläche bleibt verwaschen dieselbe Fläche. Die Kapsel
// liest sich über ihre Kante (hellerer Ton als der Grund, 1px-Lichtkante oben,
// versetzter Schlagschatten). Der backdrop-filter arbeitet, sobald Inhalt
// unter die Kapsel scrollt oder ein Overlay sie unterläuft. (Bis 2026-08-13
// nannte dieser Kommentar den Fokus-Glow der aktiven Pane als sichtbaren
// Beleg — der Glow ist seit 2026-08-05 entfernt, der Satz hatte überlebt.)
//
// data-tauri-drag-region wirkt nur auf dem Element selbst (keine Vererbung an
// Kinder): Dekoratives wird pointer-events-none, damit jeder Mousedown auf
// einem attributierten Hintergrund-Segment landet.
//
// Zoom: die ganze Zeile skaliert per transform GEGEN den Webview-Zoom zurück
// und ist damit auf jeder Stufe physisch identisch. `setZoom` fasst nur den
// Webview-Inhalt an, die nativen Ampeln und die Fensterkanten aber nicht — und
// die Kapsel hat, anders als die frühere randlose Leiste, sichtbare Kanten
// direkt neben beidem. Vorher wurde nur das Ampel-Padding durch den Faktor
// geteilt und der Rest lief weg; jetzt gibt es dafür einen Mechanismus statt
// zweier. Preis: der Chrome-Text wächst beim Zoomen nicht mit. Das ist die
// bewusste Wahl — der Zoom ist für den Inhalt da (Terminal, Dateibaum), und
// eine mitwachsende Leiste hätte die Ampeln bei 2.0 im oberen Drittel einer
// 68px-Kapsel stehen lassen.
// 8px, nicht 7: die Terminal-Pane darunter hält per p-2 denselben Abstand zu
// den übrigen Fensterkanten. Ein Pixel Unterschied liest sich an der rechten
// Kante, wo Kapsel und Pane senkrecht übereinanderstehen, als Fehler.
const CAPSULE_INSET = 8;
const CAPSULE_HEIGHT = 34;

/**
 * Physische Höhe der gesamten Chrome-Zone (Kapsel plus Rand oben und unten).
 * Die Inhaltsfläche hält genau diesen Abstand zur Fensteroberkante frei — die
 * Kapsel schwebt darüber, verdeckt aber nichts.
 */
export const TITLE_BAR_ZONE_HEIGHT = CAPSULE_INSET * 2 + CAPSULE_HEIGHT;

// Freiraum ab Kapsel-Innenkante bis zum ersten eigenen Inhalt. Die drei
// nativen Knöpfe stehen laut tauri.conf.json bei x=21..80 (Fensterkoordinaten,
// Kapselkante bei 8) und brauchen danach noch Luft.
//
// Bleibt im macOS-Vollbild unverändert stehen, obwohl das System die Ampeln
// dort ausblendet: links davon sitzt nichts mehr (das Kommandofeld ist am
// Fenster zentriert, das Zahnrad rechts angeschlagen), der Wert schiebt also
// nur den unsichtbaren Ziehflächen-Platzhalter. Genau daran hing der gemeldete
// Fehler „im Vollbild klafft links eine Lücke": er hatte den früheren
// Marke-plus-Schriftzug-Block vor sich, den es nicht mehr gibt.
const TRAFFIC_LIGHT_INSET = 84;

export function TitleBar({ zoom }: { zoom: number }) {
  const { t, i18n } = useTranslation();
  const nextLanguage =
    SUPPORTED_LANGUAGES[
      (SUPPORTED_LANGUAGES.indexOf(
        i18n.language as (typeof SUPPORTED_LANGUAGES)[number],
      ) +
        1) %
        SUPPORTED_LANGUAGES.length
    ] ?? SUPPORTED_LANGUAGES[0];
  return (
    <header
      aria-label={t("titleBar.windowTitleBarAria")}
      style={{
        // Breite mal Zoom, dann alles durch Zoom zurückskaliert: ergibt exakt
        // die physische Fensterbreite, unabhängig von der Stufe.
        width: `${100 * zoom}%`,
        height: TITLE_BAR_ZONE_HEIGHT,
        padding: CAPSULE_INSET,
        transform: `scale(${1 / zoom})`,
        transformOrigin: "top left",
      }}
      className="pointer-events-none absolute left-0 top-0 z-20"
    >
      <div
        data-tauri-drag-region
        style={{
          paddingLeft: TRAFFIC_LIGHT_INSET,
          // Lichtabfall von der oberen Kante nach unten — die Platte hat eine
          // beleuchtete Oberseite, nicht nur einen Rand. Als background-image
          // neben der Grundfarbe aus der Klasse, weil background-color keinen
          // Verlauf tragen kann.
          backgroundImage:
            "linear-gradient(180deg, var(--pc-glass-topLight), transparent 62%)",
        }}
        className="pointer-events-auto relative flex h-full items-center rounded-[13px] border border-(--pc-glass-border) bg-(--pc-glass-background) pr-[3px] shadow-[0_1px_4px_var(--pc-glass-shadow),inset_0_1px_0_var(--pc-glass-sheen)] backdrop-blur-lg backdrop-saturate-150"
      >
        {/* Ziehfläche zwischen Ampeln und Feld — als reine Lücke wäre der
            halbe linke Kapselbereich nicht ziehbar. */}
        <div data-tauri-drag-region className="min-w-0 flex-1" />

        {/* Am FENSTER zentriert, nicht am verbleibenden Platz rechts der
            Ampeln: im früheren Drei-Spalten-Flexbau saß die Mitte um die halbe
            Ampel-Einrückung zu weit rechts — neben einem echten VS-Code-Fenster
            sofort als Schiefstand lesbar. Absolut positioniert heißt hier
            zugleich: unabhängig davon, ob links Ampel-Freiraum steht oder im
            Vollbild nicht. Das Feld ist selbst Drag-Region, als reine Deko wäre
            es ein toter Fleck mitten in der Ziehfläche. */}
        <div
          data-tauri-drag-region
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 flex h-[28px] w-90 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-(--pc-titleBar-searchBorder) bg-(--pc-titleBar-searchBackground) px-2 text-(length:--pc-chrome-fontSize) text-(--pc-titleBar-searchForeground)"
        >
          {/* Einziges Glyph im Feld — die frühere Lupe daneben hätte zwei
              Icon-Sprachen nebeneinandergestellt (Marken-Verlauf gegen
              Strich-Icon), und was das Feld tut, sagt die Zeile selbst. */}
          <span className="pointer-events-none absolute left-[7px] flex items-center">
            <AppMark />
          </span>
          <span className="pointer-events-none truncate">
            {t("titleBar.searchPlaceholder")}
          </span>
        </div>

        <ChromeTooltip label={t("titleBar.language")} align="end">
          <button
            type="button"
            aria-label={t("titleBar.language")}
            onClick={() => setLanguage(nextLanguage)}
            className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-(length:--pc-chrome-fontSizeSmall) font-semibold uppercase text-(--pc-descriptionForeground) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
          >
            {i18n.language}
          </button>
        </ChromeTooltip>

        <ChromeTooltip label={t("titleBar.settings")} align="end">
          <button
            type="button"
            aria-label={t("titleBar.settings")}
            className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-(--pc-descriptionForeground) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
          >
            <GearIcon />
          </button>
        </ChromeTooltip>
      </div>
    </header>
  );
}

// App-Marke: Geometrie und Verlauf des echten App-Icons ("K3H — Verzahnung,
// Amber") — Chevron, dessen unterer Arm über eine diagonale Gehrungsfuge in
// den Cursor-Block übergeht. Bewusste Kurskorrektur (2026-08-04): die frühere
// monochrome Titelzeilen-Fassung wich absichtlich vom Icon ab (ANSI-Yellow-
// Kollisionsrisiko); auf expliziten Wunsch ersetzt durch 1:1-Farbparität.
//
// ZWEI bewusste Abweichungen vom Master (icons/source/panecrew-mark.svg):
//
// 1. Kein Glow (2026-08-05). Sein `stdDeviation` 30/70 gilt für die 1600er
//    viewBox — bei 16px sind das 0,3px und 0,7px, also Subpixel. Er glüht dort
//    nicht, er legt einen bräunlichen Saum um die Form und verschmiert genau
//    die Gehrungsfuge, die die Marke erkennbar macht (bei 12facher
//    Vergrößerung gegeneinandergehalten). Das ist der in CLAUDE.md vorgesehene
//    Fall: Detail, das bei 1024px trägt, muss für 16px neu gezeichnet werden,
//    statt den Master zu verkleinern. Der Master behält den Glow für die
//    großen Icon-Größen.
//
// 2. Zwei Verlaufsfassungen statt einer (2026-08-05, Nutzerentscheidung). Die
//    Master-Werte sind gegen den dunklen Icon-Grund (#1F243C, siehe
//    generate-icons.sh) abgestimmt; auf der hellen Glaskapsel erreicht der
//    kräftigste gerenderte Pixel 1,78:1 — die Marke liest sich dort als
//    blasses Gespenst. Deshalb hat die Titelzeilen-Marke seit heute eine
//    eigenständig kalibrierte Light-Fassung, umgeschaltet per data-theme über
//    die beiden .pc-mark__*-Regeln in App.css. Die Plattform-Icons und das
//    Favicon brauchen keine: die bringen ihren dunklen Grund selbst mit.
//
//    Die Light-Werte sind keine abgedunkelte Kopie, sondern dieselbe
//    Herleitung wie bei der ANSI-Palette und beim Akzent — in OKLCH gerechnet,
//    auf der neuen Grundfläche neu justiert:
//    - Hue-Trajektorie erhalten, aber auf den chromatischen Kern der Dark-
//      Fassung eingeengt (H 70,2 tief → 75 am Lichtpunkt). Die H 78–83 der
//      Master-Stops stammen aus fast weißen Werten, deren Farbton numerisch
//      kaum bestimmt ist; bei der Helligkeit der Light-Fassung wären sie
//      sichtbar geworden und hätten die Marke nach Ocker gezogen.
//    - Chroma am sRGB-Gamut-Rand. Bei L 0,48–0,65 ist genau das der
//      Unterschied zwischen Gold und Lehm; 93 % davon las sich messbar stumpf.
//    - Lichtrichtung unverändert: der Radial-Mittelpunkt oben rechts bleibt
//      die HELLERE Seite, die Fuge unten links die tiefere. Gekippt hätte die
//      Marke von unten links geleuchtet.
//    Gemessen wird am gerenderten Glyph, nicht an den Stops (bei 16px auf
//    1600er viewBox ist der halbe Arm Alpha-Blend): volle Pixel liegen bei
//    3,3:1 am Lichtpunkt bis 7,1:1 in der Tiefe des Cursor-Blocks.
//
//    Der Block ist bewusst der tiefste Teil. Er ist die kleinere Form und
//    fällt zuerst weg — bleibt er stehen, bleibt die Verzahnung lesbar, und
//    die ist das Erkennungsmerkmal. In der Dark-Fassung trägt er dieselbe
//    Rolle über das andere Ende der Skala (er ist dort der hellste Teil).
//
//    Zur Akzentfarbe (--pc-focusBorder, H 58) hält die Light-Fassung dieselbe
//    Trennung wie die Dark: 12 Grad Farbton und, wichtiger, Material —
//    Verlauf gegen Fläche. Über die Sättigung geht es auf hellem Grund nicht
//    mehr, dort liegen beide am Gamut-Rand.
function AppMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 1600 1600"
      aria-hidden="true"
      className="pointer-events-none"
    >
      <defs>
        <radialGradient
          id="pcMarkChevronDark"
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
        <radialGradient
          id="pcMarkChevronLight"
          gradientUnits="userSpaceOnUse"
          cx="1330"
          cy="780"
          r="900"
        >
          <stop offset="0" stopColor="#BD7F00" />
          <stop offset="0.15" stopColor="#BB7E00" />
          <stop offset="0.35" stopColor="#B57900" />
          <stop offset="0.56" stopColor="#A16900" />
          <stop offset="0.67" stopColor="#9D6600" />
          <stop offset="0.8" stopColor="#905C00" />
          <stop offset="0.88" stopColor="#865400" />
          <stop offset="1" stopColor="#825100" />
        </radialGradient>
        <linearGradient
          id="pcMarkBlockDark"
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
        <linearGradient
          id="pcMarkBlockLight"
          gradientUnits="userSpaceOnUse"
          x1="106"
          y1="0"
          x2="569"
          y2="0"
        >
          <stop offset="0" stopColor="#774F00" />
          <stop offset="0.15" stopColor="#7C5300" />
          <stop offset="0.5" stopColor="#946400" />
          <stop offset="0.82" stopColor="#A26E00" />
          <stop offset="1" stopColor="#A46F00" />
        </linearGradient>
      </defs>
      <path
        className="pc-mark__chevron"
        fill="url(#pcMarkChevronDark)"
        d="M800 115 L1494 810 L819 1485 L555 1485 L749 1218 L1157 810 L632 283 Z"
      />
      <path
        className="pc-mark__block"
        fill="url(#pcMarkBlockDark)"
        d="M106 1208 L569 1208 L368 1485 L106 1485 Z"
      />
    </svg>
  );
}

// Eindeutiges Zahnrad (gezahnter Ring + Nabe, Feather-"settings"-Form) — die
// frühere Kreis-plus-Strahlen-Variante wurde als Sonne/Theme-Toggle gelesen.
//
// strokeWidth wird pro Icon so gewählt, dass die GERENDERTE Strichstärke
// überall 1,1px beträgt (Attributwert x Zielgröße / viewBox-Kante). Roh
// verglichen sahen die Werte einheitlich aus (1,2 fast überall), gerendert
// stach dieses Zahnrad mit 1,19px gegen 1,05px der Explorer-Icons heraus —
// bei 24er viewBox auf 15px braucht 1,1px gerendert den Wert 1,76.
function GearIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.76"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}
