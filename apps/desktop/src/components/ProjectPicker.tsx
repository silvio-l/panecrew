// Ein LEERER SLOT im Grid — nicht mehr die frühere Leerdarstellung fürs ganze
// Fenster. Der Unterschied ist nicht bloß Größe: es können vier davon
// gleichzeitig auf dem Bildschirm stehen, und dann darf keiner davon eine
// Überschrift führen (vier <h1> in einem Quad) oder um Aufmerksamkeit rufen.
// Ein leerer Slot ist ein Angebot, keine Ansage.
//
// Die ganze Zelle ist der Knopf. Bei bis zu vier Zielen auf einem Bildschirm
// ist das der Unterschied zwischen "irgendwo ins leere Viertel klicken" und
// "ein 8x30-Rechteck treffen"; nebenbei entfällt der Knopf-im-Knopf, den ein
// zentriertes Bedienelement in einer klickbaren Fläche sonst ergäbe.
//
// HUD-Sprache statt gestrichelter Hairline (2026-08-13, Nutzer-Direktive
// „technoide HUD-Details + ASCII-Deko"): vier Eckwinkel rahmen den Slot wie
// einen Sucher — dieselbe 1px-Grammatik wie die Pane-Rahmen, aber auf einen
// Blick als "hier ist noch nichts, hier kann etwas hin" lesbar. Dazu ein
// Slot-Nummern-Readout in der Terminalschrift (oben links, rein numerisch,
// deshalb keine i18n-Frage) und das Marken-Emblem als ASCII-Zeichnung statt
// des früheren generischen Ordner-Icons. Beim Überfahren wechseln Winkel und
// Emblem in den Amber-Akzent: ein leerer Slot kann nie fokussiert sein, die
// Fokus-Exklusivität des Akzents (Direction Contract) bleibt also unberührt —
// hier ist Amber Einladung, nicht Zustand.
//
// Das ASCII-Mini-Terminal trägt auf jedem leeren Slot für sich eine ambiente
// 3,5s-Choreografie (Nutzer-Korrektur 2026-08-13: "auf jeden einzelnen Slot",
// nicht nur beim leeren Gesamtgrid; danach ausgebaut vom simplen Blink zur
// Sequenz — Lichtlauf um den Rahmen, Chevron-Quittung, Cursor-Puls, s.
// AsciiEmblem-Kommentar unten und den Choreografie-Block in App.css; dort
// auch, warum diese eine Animation auf expliziten Nutzer-Wunsch WEICH
// ease-in-out läuft statt im harten steps-Takt der übrigen HUD-Events).
// Kein Glow, keine kinetische Typografie: das Emblem tippt nicht, kein
// Zeichen ändert sich — es wechseln ausschließlich Farbe/Deckkraft
// stehender Glyphen.
import type { CSSProperties, ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import { useTranslation } from "react-i18next";
import {
  ChromeTooltip,
  CHROME_FOCUS_RING,
  CHROME_MENU_CONTENT_CLASS,
  CHROME_MENU_ITEM_CLASS,
} from "./ChromeTooltip";

// Letztes Pfadsegment als Anzeigename — `\` UND `/`, weil ein `session.json`
// von Windows auch hier ankommen könnte (die Liste ist app-weit und über
// Neustarts persistiert, nicht bloß eine In-Memory-Sitzungsgröße).
function projectDisplayName(path: string): string {
  const segments = path.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

// Everything before the last segment, kept in the path's own separator style
// (a Windows path from a foreign session.json stays readable as one). Display
// only — it disambiguates two projects that share a folder name ("web" under
// different parents). Returns "" when there is no parent to show.
function projectParentPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx <= 0 ? "" : trimmed.slice(0, idx);
}

export function ProjectPicker({
  onChoose,
  busy,
  restoring,
  slotIndex,
  focusModeActive,
  recentProjects,
  onOpenRecent,
  onRemoveRecent,
  dropInvite = null,
  onboardingHint = null,
}: {
  onChoose: () => void;
  busy: boolean;
  /** Dieser Slot ist Teil der gerade wiederhergestellten Sitzung und wartet
   * noch auf sein Projekt (Baum + Git-Deko werden gelesen) — kein leerer
   * Slot im eigentlichen Sinn, nur noch nicht fertig befüllt. Ohne dieses
   * Signal zeigte der Slot bis dahin einen ganz normalen, klickbaren
   * "Projekt wählen"-Knopf: ein Klick währenddessen würde mit der laufenden
   * Wiederherstellung um genau diesen Slot konkurrieren (2026-08-12). */
  restoring?: boolean;
  /** 0-basierter Slot-Index im aktiven Template (PaneGrid reicht den
   * Array-Index durch) — fürs HUD-Readout (dort 1-basiert angezeigt) und als
   * `data-empty-slot`-Messhaken des Tab-Zugs auf leere Slots (Nutzer-Wunsch
   * "wenn ich ein Tab auf einen leeren Slot ziehe, wird dort ein neues Pane
   * erstellt"): `usePaneDrag.ts` trifft leere Zellen über genau dieses
   * Attribut, denn eine `paneId` existiert hier noch nicht. Das Attribut
   * trägt nur der ECHTE leere Slot, nicht der restoring-Zweig — der ist
   * bereits vergeben und damit kein Ziel. */
  slotIndex: number;
  /** Ob IRGENDEINE Pane gerade maximiert ist (Ticket 19) — ein leerer Slot
   * kann selbst nie maximiert sein, muss dann aber genauso wie jede andere
   * unbeteiligte Zelle unsichtbar werden, sonst schiene sein Rahmen hinter
   * der maximierten Pane durch (PaneGrid.tsx behandelt PaneCell und
   * ProjectPicker sonst als zwei unabhängige Zweige). `visibility: hidden`
   * statt `display: none` — dieselbe Begründung wie bei `PaneCell`: der
   * Slot bleibt Teil der Grid-Spurberechnung, kollabiert also nicht. */
  focusModeActive: boolean;
  /** App-weite Liste zuletzt geöffneter Projekte (Ticket 22), zuletzt zuerst
   * — max. 8 Einträge, bereits von `App.tsx`/`sessionState.ts` gekappt. */
  recentProjects: readonly string[];
  /** Klick auf einen Eintrag: öffnet ihn direkt in DIESEM Slot, ohne den
   * Dateiauswahldialog. */
  onOpenRecent: (path: string) => void;
  /** Kontextmenü „Aus Liste entfernen" — löscht nur den Listeneintrag. */
  onRemoveRecent: (path: string) => void;
  /** Das "Tab hierher → neue Pane"-Instrument des Tab-Zugs (`PaneGrid.tsx`
   * reicht ein fertiges `PaneDropInvite` herein, sobald dieser Slot Ziel des
   * laufenden Zugs ist) — hier nur platziert, nicht hergeleitet: was ein Zug
   * ist und wann er läuft, weiß allein das Grid. */
  dropInvite?: ReactNode;
  /** The first-run/restart callout (`onboarding/OnboardingHint.tsx`) for
   * whichever slot `onboarding/onboardingState.ts::onboardingHintSlot`
   * currently points at — same sibling-to-the-button placement as
   * `dropInvite`, App.tsx decides which slot (if any) gets one. */
  onboardingHint?: ReactNode;
}) {
  const { t } = useTranslation();
  const slotNumber = slotIndex + 1;
  const cellStyle: CSSProperties | undefined = focusModeActive
    ? { visibility: "hidden" }
    : undefined;
  if (restoring) {
    return (
      <div className="@container flex min-h-0 min-w-0" style={cellStyle}>
        {/* `pc-slotcard` alongside `pc-slotframe`: every hover/focus state
            selector in App.css roots at `.pc-slotcard` (the button+shelf card
            of the empty branch) — here card and frame are the same element,
            so the corner/readout/cursor hover rules keep matching exactly as
            before the shelf rework. */}
        <div className="pc-slotcard pc-slotframe relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg px-4 py-3 text-center text-(--pc-descriptionForeground)">
          <HudCorners />
          <SlotReadout number={slotNumber} />
          {/* Dasselbe Emblem wie im leeren Slot: der Restore-Zustand ist
              derselbe Ort eine Sekunde früher — ohne das Emblem blitzte beim
              Befüllen erst ein karger, dann der gebaute Slot auf. Kein
              Blink hier: der Slot ist bereits auf ein Projekt festgelegt,
              kein offenes Angebot mehr. */}
          <AsciiEmblem blinking={false} />
          <span className="text-(length:--pc-chrome-fontSize) font-medium">
            {t("common.loading")}
          </span>
        </div>
      </div>
    );
  }

  // The shelf (recent rows + the browse-other entry) exists only when there
  // is at least one recent project. With zero recents the only actionable row
  // would be "browse other" — a duplicate of the big button's own action, so
  // an empty panel with just chrome would be noise, not an offer.
  const hasShelf = !focusModeActive && recentProjects.length > 0;
  return (
    // Container-Query statt Media-Query: entscheidend ist die Breite DIESES
    // Slots, nicht die des Fensters. Derselbe Slot ist im Vierergrid rund
    // 470px breit und in der Viererreihe rund 230px — bei gleichem Fenster.
    // `relative`: Anker für das Drop-Instrument des Tab-Zugs (`dropInvite`,
    // absolut über der ganzen Zelle) — als Geschwister NEBEN dem Knopf statt
    // in ihm, ein `<button>` soll keine Blockelemente enthalten.
    // `pc-empty-slot`: the CSS scope App.css uses to reveal the recent-shelf
    // drawer — hover ANYWHERE in the cell (button included) or focus
    // anywhere within it wakes the shelf, so the slot reads as one interactive
    // zone, not a button plus an unrelated list (see .pc-recent-panel there).
    <div
      className="pc-empty-slot @container relative flex min-h-0 min-w-0 flex-col"
      style={cellStyle}
      data-empty-slot={slotIndex}
    >
      {/* `pc-slotcard`: button + shelf drawer as ONE card. Every hover/focus
          state in App.css (corner amber, readout brighten, boot-lap, idle
          scan pause, the hover fill itself) roots HERE instead of at the
          button — deliberate: pointing at the drawer keeps the whole card
          awake, including the button's hover fill, so the card never splits
          into a lit shelf under a dimmed button (third pass, 2026-08-17,
          user: "Die Recent-Files liegen immer noch außerhalb des Slots").
          The former Tailwind `hover:bg-…`/`hover:text-…` utilities on the
          button moved into App.css for exactly this reason — a `:hover` on
          the button alone would drop the fill the moment the pointer enters
          the drawer. */}
      <div className="pc-slotcard relative flex min-h-0 min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={onChoose}
          disabled={busy}
          aria-busy={busy}
          // Der zugängliche Name ist der Knopftext; das aria-label hält ihn
          // stabil, wenn die Erklärzeile darunter mitrendert (die sonst in den
          // Namen einginge und ihn bei jeder Slot-Breite anders lauten ließe).
          aria-label={t("projectPicker.choose")}
          className={`pc-slotframe relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg px-4 py-3 text-center text-(--pc-descriptionForeground) transition-colors disabled:pointer-events-none disabled:opacity-50 ${CHROME_FOCUS_RING}`}
        >
          <HudCorners />
          <SlotReadout number={slotNumber} />
          <AsciiEmblem blinking />
          <span className="text-(length:--pc-chrome-fontSize) font-medium">
            {t("projectPicker.choose")}
          </span>
          {/* Erst ab 18rem Slot-Breite: in einer Viererreihen-Spalte bliebe von
              dem Satz ein vierzeiliger Block, der den Knopf darüber erschlägt.
              Ein leerer Slot braucht dort ein Ziel und eine Beschriftung, keine
              Prosa. */}
          <span className="hidden max-w-64 text-(length:--pc-chrome-fontSizeSmall) @2xs:block">
            {t("projectPicker.hint")}
          </span>
          {/* Rest-state indicator INSIDE the button (2026-08-17, third pass):
              the caption line pinned to the frame's bottom edge — since it
              lives in the button it shares its frame by construction and can
              never read as a floating block outside the slot. When the drawer
              below wakes, it rises over exactly this zone and brings its own
              copy of the caption as its cap. aria-hidden: the button's
              accessible name is pinned to the aria-label above; the caption
              is visual discoverability, the real rows carry the semantics.
              Same @2xs gate as the drawer itself. */}
          {hasShelf && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-3 bottom-2 hidden items-center gap-2 @2xs:flex"
            >
              <ShelfCaption count={recentProjects.length} />
            </span>
          )}
        </button>
        {/* The recent shelf as a DRAWER inside the slot frame — absolutely
            positioned over the button's bottom edge, zero layout footprint at
            rest (out of flow: no dead band, the button always fills the whole
            cell). Anchored INSIDE rather than below (`top-full`) because the
            quad start state puts two empty slots in the window's bottom row:
            a below-the-cell overlay would fall past the window edge and be
            clipped by body{overflow:hidden}. Inside the frame it is always
            fully visible, needs no cross-cell z-index games, and answers the
            user's actual complaint — the recents now sit IN the slot.
            `rounded-b-lg` matches the button's own rounding so the drawer's
            fill follows the card's corners instead of poking square edges
            into them; the top hairline (`border-t`) marks the shelf edge in
            the same 1px grammar as every other HUD hairline. Reveal
            choreography (opacity/pointer-events, 150ms, reduced-motion-gated
            3px rise) lives in App.css (.pc-recent-panel). The trailing
            <HudCorners bottomOnly /> re-renders the frame's bottom corner
            pair ABOVE the drawer fill, so the viewfinder stays closed while
            the shelf is open. */}
        {hasShelf && (
          <div className="pc-recent-panel absolute inset-x-0 bottom-0 hidden flex-col rounded-b-lg border-t border-(--pc-pane-border) p-1 @2xs:flex">
            <div className="flex flex-none items-center gap-2 px-2 py-1">
              <ShelfCaption count={recentProjects.length} />
            </div>
            <div className="flex max-h-32 flex-none flex-col gap-0.5 overflow-y-auto">
              {recentProjects.map((path, index) => (
                <RecentProjectRow
                  key={path}
                  path={path}
                  index={index}
                  onOpen={() => onOpenRecent(path)}
                  onRemove={() => onRemoveRecent(path)}
                />
              ))}
            </div>
            {/* Hairline divider + the one non-recent entry: same row grammar,
                but a "+" glyph instead of a position index — an addition, not
                a list position. It routes into the same dialog flow as the
                big button (`onChoose`), for the project that is NOT on the
                shelf. */}
            <span
              aria-hidden="true"
              className="mx-2 my-1 h-px flex-none bg-(--pc-pane-border)"
            />
            <BrowseOtherRow onChoose={onChoose} busy={busy} />
            <HudCorners bottomOnly />
          </div>
        )}
      </div>
      {dropInvite}
      {!dropInvite && onboardingHint}
    </div>
  );
}

// Section caption in the slot's own HUD register (10px mono, tracked, dimmed
// like the slot readout) plus a hairline running to the edge — the same 1px
// pane-border grammar as the HUD corners. Rendered twice per slot: at rest as
// the discoverability anchor pinned inside the button's bottom padding, and
// as the cap of the woken drawer (which covers the rest copy exactly, so the
// two are never visible together). The trailing zero-padded count readout
// (same two-digit grammar as SlotReadout and the row indices) says how much
// is on the shelf before it unfolds. Purely numeric, hence no i18n key —
// same reasoning as SlotReadout; decorative for screen readers, which get
// the real rows instead.
function ShelfCaption({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="pc-hud-readout font-(family-name:--pc-terminal-fontFamily) text-[10px] uppercase tracking-[0.25em]">
        {t("projectPicker.recentHeading")}
      </span>
      <span
        aria-hidden="true"
        className="h-px min-w-4 flex-1 bg-(--pc-pane-border)"
      />
      <span
        aria-hidden="true"
        className="pc-hud-readout font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.15em] tabular-nums"
      >
        {String(count).padStart(2, "0")}
      </span>
    </>
  );
}

// The shelf's one non-recent entry (2026-08-17, user request: "plus dann halt
// ein Eintrag für ein anderes Projekt"): opens the same file dialog as the
// big slot button, for a project that is not on the recent list. Same row
// grammar as RecentProjectRow — leading glyph slot, name, "↵" reveal — but a
// "+" where the recents carry their position index: this row adds, it has no
// position. Its own i18n key (`projectPicker.browseOther`) keeps its
// accessible name distinct from the main button's pinned
// `projectPicker.choose` — two buttons sharing one accessible name would
// break every `getByRole("button", { name: … })` query on the slot.
function BrowseOtherRow({
  onChoose,
  busy,
}: {
  onChoose: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={busy}
      aria-label={t("projectPicker.browseOther")}
      className={`pc-recent-row flex min-w-0 shrink-0 items-center gap-2 rounded px-2 py-1 text-left font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) disabled:pointer-events-none disabled:opacity-50 ${CHROME_FOCUS_RING}`}
    >
      <span className="pc-recent-row__index shrink-0 text-[10px] tracking-[0.15em]">
        {"+"}
      </span>
      <span className="truncate">{t("projectPicker.browseOther")}</span>
      <span aria-hidden="true" className="pc-recent-row__go ml-auto shrink-0 pl-1">
        {"↵"}
      </span>
    </button>
  );
}

// Eine Zeile der App-weiten „Zuletzt geöffnet"-Liste (Ticket 22). Eigene
// kleine Komponente statt Inline-JSX in der `map`, weil das Kontextmenü
// (Radix `ContextMenu.Root`) einen eigenen Baum je Zeile braucht — ein
// gemeinsamer Root für alle Zeilen könnte immer nur einen Eintrag zugleich
// öffnen.
// The row speaks the slot's HUD register (2026-08-17): a zero-padded index
// readout in the terminal mono (same grammar as SlotReadout — labeling, not
// invitation, so it brightens only to the description tone on hover), the
// project name in the terminal mono like every pane header, the parent path
// dimmed behind it as the disambiguator for two projects sharing a folder
// name, and a reveal "↵" at the right edge as the open affordance. The "↵"
// carries the dimmed 70% amber prompt tone at most — never a second
// full-strength amber hover surface next to the slot button's own invitation
// (Direction Contract: one accent, sparingly). NOT "❯": that glyph means
// "you are here" everywhere else in the chrome (pane header, explorer), and
// a hover target is exactly not that; "↵" says "enter opens this", which is
// literally true for the focused row. Hover choreography lives in App.css
// (.pc-recent-row*).
//
// The full path moved from the native `title` tooltip into ChromeTooltip —
// the chrome's own tooltip surface, and unlike `title` it also serves
// keyboard focus. `aria-label` pins the accessible name to the bare project
// name: without it, index + parent path would leak into the name (the two
// Ticket-22 tests in App.test.tsx address rows by exactly this name).
// Composition order matters: Tooltip.Trigger(asChild) wraps
// ContextMenu.Trigger(asChild) wraps the button — both Radix primitives
// forward props through, so hover, right-click, and click all land on the
// one <button>.
function RecentProjectRow({
  path,
  index,
  onOpen,
  onRemove,
}: {
  path: string;
  /** 0-based list position — rendered as the same zero-padded two-digit
   * readout the slot number uses, purely visual orientation. */
  index: number;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const name = projectDisplayName(path);
  const parentPath = projectParentPath(path);
  return (
    <ContextMenu.Root>
      <ChromeTooltip label={path} side="bottom" align="start">
        <ContextMenu.Trigger asChild>
          <button
            type="button"
            onClick={onOpen}
            aria-label={name}
            className={`pc-recent-row flex min-w-0 shrink-0 items-center gap-2 rounded px-2 py-1 text-left font-(family-name:--pc-terminal-fontFamily) text-(length:--pc-chrome-fontSizeSmall) text-(--pc-descriptionForeground) transition-colors hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground) data-[state=open]:bg-(--pc-list-hoverBackground) data-[state=open]:text-(--pc-foreground) ${CHROME_FOCUS_RING}`}
          >
            <span className="pc-recent-row__index shrink-0 text-[10px] tracking-[0.15em] tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="truncate">{name}</span>
            {parentPath !== "" && (
              // shrink-[4]: when space runs out, the parent path gives way
              // four times faster than the project name — the name is the
              // answer, the parent only its qualifier.
              <span className="pc-recent-row__dir min-w-0 shrink-[4] truncate text-[10px]">
                {parentPath}
              </span>
            )}
            <span aria-hidden="true" className="pc-recent-row__go ml-auto shrink-0 pl-1">
              {"↵"}
            </span>
          </button>
        </ContextMenu.Trigger>
      </ChromeTooltip>
      <ContextMenu.Portal>
        <ContextMenu.Content className={CHROME_MENU_CONTENT_CLASS}>
          <ContextMenu.Item className={CHROME_MENU_ITEM_CLASS} onSelect={onRemove}>
            {t("projectPicker.removeRecent")}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// Vier Sucher-Ecken, je ein L aus zwei 1px-Kanten. Farb- und Hover-Verhalten
// stehen in App.css (.pc-hud-corner, geschaltet über .pc-slotcard:hover) —
// vier Spans statt eines Verlaufs-Tricks, weil border-color sauber mit den
// 150ms-Hover-Transitions mitzieht, ein background-image nicht.
// `bottomOnly` (2026-08-17): the recent-shelf drawer re-renders just the
// bottom corner pair on top of its own fill — the drawer covers the button's
// bottom corners while open, and without this second pair the viewfinder
// would lose its lower half exactly when the card is awake. Both pairs sit at
// the same coordinates (the drawer's bottom edge IS the button's), so the
// visible frame never doubles or shifts.
function HudCorners({ bottomOnly = false }: { bottomOnly?: boolean }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      {!bottomOnly && <span className="pc-hud-corner pc-hud-corner--tl" />}
      {!bottomOnly && <span className="pc-hud-corner pc-hud-corner--tr" />}
      <span className="pc-hud-corner pc-hud-corner--bl" />
      <span className="pc-hud-corner pc-hud-corner--br" />
    </span>
  );
}

// Slot-Position als HUD-Readout, Terminalschrift, gesperrt gesetzt. Rein
// numerisch und dekorativ (aria-hidden): der zugängliche Name des Knopfs
// bleibt "Projekt wählen", die Nummer ist Orientierung fürs Auge im Grid.
// Farbe/Hover-Anzug in App.css (.pc-hud-readout): gedimmt im Ruhezustand,
// voller Beschreibungston beim Überfahren — derselbe Takt wie Ecken und
// Emblem, ein Slot wacht als Ganzes auf.
function SlotReadout({ number }: { number: number }) {
  return (
    <span
      aria-hidden="true"
      className="pc-hud-readout pointer-events-none absolute left-3 top-2 font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.25em]"
    >
      {String(number).padStart(2, "0")}
    </span>
  );
}

// ASCII-Deko im Sinn der HUD-Direktive: ein Mini-Terminal-Fenster aus
// Box-Drawing-Zeichen, darin Prompt-Chevron und Cursor-Block — der leere
// Slot zeigt als Zeichnung genau das, was er nach dem Klick wird. Bewusst
// KEINE Pixel-Nachbildung der Marke: Blockzeichen-Treppen zerfallen bei
// 10px zu Klumpen (mehrere Anläufe, per Kandidaten-Vergleich verworfen),
// Box-Drawing rendert dagegen gestochen scharf, und die echte Marke bleibt
// ohnehin das SVG in TitleBar.tsx. Zweifarbig: der Rahmen bleibt leise im
// Beschreibungston, Prompt + Cursor tragen gedimmtes Amber; beim Überfahren
// zieht beides an (App.css, .pc-slotcard:hover). Keine Buchstaben, deshalb
// kein i18n-Fall; als reine Zeichnung für Screenreader unsichtbar.
//
// Das Emblem ist in EIGENE Spans zerlegt, weil die 3,5s-Choreografie in
// App.css (Kommentarblock dort: Lichtlauf → Chevron-Quittung → Cursor-Puls)
// jede Stimme einzeln adressieren muss — CSS darf nur Farbe/Deckkraft
// stehender Glyphen wechseln, also braucht jedes unabhängig animierte
// Stück Rahmen sein eigenes Element:
//   - `__prompt-glyph` (Chevron) und `__cursor` (Block) wie gehabt,
//   - der Box-Drawing-Rahmen als zehn `__seg`-Spans, deren Position im
//     Uhrzeigersinn (0 = obere linke Ecke) als `--pc-hud-seg` inline
//     mitgeht — App.css macht daraus den 150ms-Versatz des Lichtlaufs.
// Ohne die `--blinking`-Klasse (restoring-Zweig) sind die Segmente inerte
// Spans und erben schlicht die Rahmenfarbe. `blinking` ist auf jedem echten
// leeren Slot für sich wahr (Nutzer-Korrektur 2026-08-13: "auf jeden
// einzelnen Slot", nicht nur beim Kaltstart mit leerem Gesamtgrid).
function AsciiEmblem({ blinking }: { blinking: boolean }) {
  return (
    <pre
      aria-hidden="true"
      className={`pc-hud-emblem font-(family-name:--pc-terminal-fontFamily) text-[11px] leading-[1.15]${blinking ? " pc-hud-emblem--blinking" : ""}`}
    >
      <Seg index={0}>{"╭───"}</Seg>
      <Seg index={1}>{"───"}</Seg>
      <Seg index={2}>{"───╮"}</Seg>
      {"\n"}
      <Seg index={9}>{"│"}</Seg>
      {" "}
      <span className="pc-hud-emblem__prompt">
        <span className="pc-hud-emblem__prompt-glyph">{"❯"}</span>{" "}
        <span className="pc-hud-emblem__cursor">{"█"}</span>
      </span>
      {"     "}
      <Seg index={3}>{"│"}</Seg>
      {"\n"}
      <Seg index={8}>{"│"}</Seg>
      {"         "}
      <Seg index={4}>{"│"}</Seg>
      {"\n"}
      <Seg index={7}>{"╰───"}</Seg>
      <Seg index={6}>{"───"}</Seg>
      <Seg index={5}>{"───╯"}</Seg>
    </pre>
  );
}

// Ein Rahmensegment des Rundlauf-Scans. Nur ein Span mit Positionsnummer —
// Takt, Fenster und Farben stehen komplett in App.css (@keyframes
// pc-hud-scan), hier steht ausschließlich, WO im Uhrzeigersinn das Segment
// sitzt.
function Seg({ index, children }: { index: number; children: string }) {
  return (
    <span
      className="pc-hud-emblem__seg"
      style={{ "--pc-hud-seg": index } as CSSProperties}
    >
      {children}
    </span>
  );
}
