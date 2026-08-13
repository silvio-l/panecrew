// Die Wahl der Grid-Geometrie: ein segmentierter Streifen aus sieben Knöpfen,
// rechtsbündig über dem Raster (dort, wo der Referenz-Editor seine Layout-Aktionen
// führt). Bewusst schmal und gedimmt — der Bildschirm gehört den Terminals,
// und dies ist eine Einstellung, kein Werkzeug, das man ständig braucht.
//
// Jeder Knopf zeigt SEIN Raster als Piktogramm statt eines Namens: sieben
// Wortmarken nebeneinander ("Zwei über eins", "Eins über zwei") wären in
// dieser Höhe unlesbar und beschreiben ohnehin eine Form. Das Piktogramm ist
// dabei kein nachgezeichnetes Icon, sondern dasselbe CSS-Grid wie der
// Arbeitsraum in einer 16px-Fassung — es teilt sich die `.pc-layout--*`-Klasse
// mit ihm (App.css). Ein neues Template bringt seine Ikone damit von selbst
// mit, und die beiden können nicht auseinanderlaufen.
//
// Der Name bleibt trotzdem der zugängliche Name des Knopfes, und bei einem
// blockierten Wechsel tritt die Begründung hinzu.
import { useTranslation } from "react-i18next";
import {
  GRID_TEMPLATES,
  templateSwitchBlockReason,
  type GridState,
  type TemplateId,
} from "../grid/gridState";
import { CHROME_FOCUS_RING, ChromeTooltip } from "./ChromeTooltip";

export function TemplateSwitcher({
  state,
  onSwitchTemplate,
}: {
  state: GridState;
  onSwitchTemplate: (target: TemplateId) => void;
}) {
  const { t } = useTranslation();
  return (
    // `self-end` statt eines eigenen Zeilen-Wrappers: `<main>` ist ein
    // Spalten-Flex, die Querachse ist also die waagerechte — das rückt den
    // Streifen an die rechte Kante und lässt ihn zugleich auf seine
    // Inhaltsbreite schrumpfen, statt die Zeile zu füllen.
    <div
      role="group"
      aria-label={t("templateSwitcher.selectTemplate")}
      className="mb-2 flex shrink-0 items-center gap-px self-end rounded-md border border-(--pc-pane-border) p-px"
    >
      {GRID_TEMPLATES.map((template) => {
        // Beide Zustände — gesperrt und warum — werden bei JEDEM Render neu
        // aus dem Store gerechnet, nie beim Klick gemerkt. Das ist keine
        // Stilfrage: `switchTemplate` gibt bei einer blockierten Anfrage
        // dieselbe State-Referenz zurück, es folgt also kein Re-Render, und
        // ein beim Klick gesetzter Zustand käme nie an. Hier steht die Sperre
        // schon da, bevor jemand sie auslöst.
        const block = templateSwitchBlockReason(state, template.id);
        const label = t(template.labelKey);
        const reason = block
          ? t("templateSwitcher.blockReason", {
              active: block.active,
              targetSlots: block.targetSlots,
              target: t(block.targetLabelKey),
              count: block.targetSlots,
            })
          : null;
        const active = template.id === state.template;
        return (
          // Der Tooltip hängt am Wrapper, nicht am Knopf: ein `disabled`
          // <button> stellt keine Zeigerereignisse zu, ausgerechnet der
          // gesperrte Knopf könnte seine Begründung sonst nie zeigen. Das
          // `disabled:pointer-events-none` unten reicht sie an dieses <span>
          // durch.
          <ChromeTooltip key={template.id} label={reason ?? label}>
            <span className="inline-flex">
              <button
                type="button"
                onClick={() => onSwitchTemplate(template.id)}
                disabled={reason !== null}
                aria-pressed={active}
                aria-label={
                  reason
                    ? t("templateSwitcher.blockedAriaLabel", { label, reason })
                    : label
                }
                // Der aktive Zustand trägt die neutrale Auswahlfüllung des
                // Explorers, NICHT den Akzent: der gehört laut Direction
                // Contract allein dem Fokus der Pane. Ein zweiter Ort in
                // derselben Farbe machte aus "welche Pane ist live" eine
                // Suchaufgabe.
                className={`flex size-6 shrink-0 items-center justify-center rounded transition-colors disabled:pointer-events-none disabled:opacity-40 ${
                  active
                    ? "bg-(--pc-list-activeSelectionBackground) text-(--pc-foreground)"
                    : "text-(--pc-descriptionForeground) hover:bg-(--pc-list-hoverBackground) hover:text-(--pc-foreground)"
                } ${CHROME_FOCUS_RING}`}
              >
                <TemplateGlyph
                  template={template.id}
                  slotCount={template.slotCount}
                />
              </button>
            </span>
          </ChromeTooltip>
        );
      })}
    </div>
  );
}

// Das Raster des Templates als Piktogramm — echte Grid-Zellen in der Geometrie,
// die der Knopf schaltet. Die Zellenzahl kommt aus derselben Tabelle wie die
// Slot-Zahl des Stores, die Anordnung aus derselben Klasse wie der
// Arbeitsraum; nachgezeichnet wird hier nichts.
function TemplateGlyph({
  template,
  slotCount,
}: {
  template: TemplateId;
  slotCount: number;
}) {
  return (
    <span aria-hidden="true" className={`pc-minimap pc-layout--${template}`}>
      {Array.from({ length: slotCount }, (_, index) => (
        <span key={index} />
      ))}
    </span>
  );
}
