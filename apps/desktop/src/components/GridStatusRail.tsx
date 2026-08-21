import { useTranslation } from "react-i18next";
import { activePanes, terminalTabs, type GridState } from "../grid/gridState";
import type { GitRepoSummary } from "../types/gitStatus";
import { GitRepoReadout } from "./GitRepoReadout";
import { HudReadout } from "./HudReadout";

// Die Zeile über dem Raster war bis auf den Template-Switcher an ihrem
// rechten Ende leer. Sie trägt jetzt links, was das Raster als GANZES
// beschreibt — und zwar ausschließlich Dinge, die sonst nirgends stehen:
//
// - Belegte gegen vorhandene Slots. Einzeln ist das ablesbar (ein leerer Slot
//   zeigt seinen Picker), als Verhältnis nicht — und genau das Verhältnis ist
//   die Frage vor einem Template-Wechsel, der 6px weiter rechts stattfindet.
// - Die Gesamtzahl der Terminal-Sitzungen. Jede Pane zeigt ihre eigenen Tabs;
//   wie viele PTYs insgesamt laufen, weiß bisher niemand.
//
// Was hier bewusst NICHT steht:
//
// - Der Name des fokussierten Projekts. Die Kopfzeile der Pane trägt ihn
//   bereits, und zwar dort, wo er hingehört: an der Pane selbst.
// - Der Name des aktiven Templates. Er wäre Prosa in einem Register, das
//   keine Prosa trägt (`HudReadout`), und der Switcher direkt daneben zeigt
//   die aktive Geometrie ohnehin als Bild und benennt sie in seinem
//   Tooltip — das wäre dieselbe Aussage ein drittes Mal.
// - Der Git-Branch der fokussierten Pane. Seit Ticket 02 doch hier: links vom
//   Slot-Zähler, über `GitRepoReadout` (geteilt mit der Explorer-Kopfzeile).
//   Nur EINE Pane, nicht eine Zeile pro belegtem Slot — dieselbe Pane, deren
//   Projekt der Explorer daneben schon zeigt, kein zweites Register für
//   dieselbe Information.
export function GridStatusRail({
  state,
  focusedGitRepo,
}: {
  state: GridState;
  /** Git-Zusammenfassung der FOKUSSIERTEN Pane, `null` ohne Repo — dieselbe
   * Quelle wie `ExplorerPanel`s Kopfzeile (`project.gitRepo`). */
  focusedGitRepo: GitRepoSummary | null;
}) {
  const { t } = useTranslation();
  const panes = activePanes(state);
  const slots = state.slots.length;
  const terminals = panes.reduce(
    (sum, pane) => sum + terminalTabs(pane).length,
    0,
  );

  // Beim ersten Start ist das Raster leer. Ein Readout „0/4" wäre dann das
  // Auffälligste an einem Bildschirm, auf dem der Nutzer gerade ein Projekt
  // wählen soll — und sähe aus wie ein Fehler statt wie eine Zählung. Erst
  // wenn es etwas zu zählen gibt, gibt es auch das Instrument. Dieselbe
  // Zurückhaltung wie bei der Baum-Fußzeile im Explorer.
  if (panes.length === 0) return null;

  return (
    // Seit Ticket 02 steht links ein Branch-Name variabler Länge, deshalb
    // jetzt doch `min-w-0` (die frühere Fassung dieses Kommentars nannte das
    // "verfehlt", solange hier nur zwei kurze Zahlenpaare standen) — ohne
    // `min-w-0` könnte diese Zeile den Flex-Container sprengen, statt selbst
    // zu schrumpfen. Den Switcher rechts betrifft das nicht: `shrink-0` an
    // ihm (`TemplateSwitcher.tsx`) hält ihn auf voller Breite, `overflow-
    // hidden` hier verhindert, dass ein zu langer Branch-Name ihn verdrängt.
    // `mr-auto` schiebt den Switcher ans rechte Ende; die Elternzeile steht
    // auf `justify-end`, damit er auch dort bleibt, wenn diese Zeile `null`
    // liefert (Begründung an der Zeile in App.tsx).
    <div className="mr-auto flex min-w-0 items-center gap-3 overflow-hidden">
      {focusedGitRepo !== null && (
        <>
          <GitRepoReadout summary={focusedGitRepo} />
          {/* --pc-widget-border, nicht --pc-explorer-border: diese Zeile
              steht auf dem Grund von `<main>`, nicht auf dem Explorer-Panel
              — genau der Fall, in dem Letzterer im Light-Theme fast
              verschwindet (siehe TreeRowGuides in ExplorerPanel.tsx). */}
          <span aria-hidden="true" className="h-3 w-px bg-(--pc-widget-border)" />
        </>
      )}
      {/* ❯ = die Eingabeaufforderung, also eine laufende Sitzung — dasselbe
          Zeichen und dieselbe Bedeutung wie im Chrome schon anderswo. ▣ ist
          neu: es gab bisher kein Zeichen für „belegte Rasterfläche", weil es
          bisher nichts gab, das Flächen zählt. Gewählt, weil es die Geometrie
          des Switchers daneben aufnimmt (gefüllte Fläche in einem Rahmen) und
          in derselben geometrischen Familie steht wie ▊ der Marke — kein
          Piktogramm, das etwas anderes darstellt als das Gezählte. */}
      <HudReadout
        glyph="▣"
        value={`${String(panes.length)}/${String(slots)}`}
        srText={t("gridStatus.panes", { active: panes.length, slots })}
      />
      <HudReadout
        glyph="❯"
        value={String(terminals)}
        srText={t("gridStatus.terminals", { count: terminals })}
      />
    </div>
  );
}
