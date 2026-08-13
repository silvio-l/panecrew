import type { ReactNode } from "react";
import { AlertDialog } from "radix-ui";
import { CHROME_FOCUS_RING } from "./ChromeTooltip";

// Die eine Rückfrage-Fläche der App. Herausgelöst aus
// `UnsavedChangesDialog.tsx` (dem ersten modalen Fenster der App), als mit dem
// Schließen einer Pane und dem Schließen eines Terminal-Tabs zwei weitere
// Rückfragen dazukamen — dieselbe Form, andere Worte. Die Alternative wäre
// dreimal dasselbe Radix-Gerüst mit dreimal denselben Klassenketten gewesen,
// und damit drei Stellen, an denen die unten begründeten Entscheidungen
// getrennt voneinander verrutschen können.
//
// Diese Komponente trägt AUSSCHLIESSLICH Form: Material, Ordnung der Knöpfe,
// Fokusverhalten, Modalität. Sie kennt keinen Anlass — kein `paneId`, kein
// `fileName`, kein Wissen darüber, was bestätigt wird. Die Worte kommen
// vollständig von außen, i18n also beim Aufrufer (siehe `UnsavedChangesDialog`
// und `App.tsx`), nicht hier: dieselbe Fläche mit einem eingebauten Satz wäre
// keine Primitive mehr.
//
// Die Entscheidungen, unverändert aus der ursprünglichen Rückfrage
// übernommen — sie gelten für jede Rückfrage der App, nicht nur für die erste:
//
// Radix' AlertDialog statt Dialog: die Unterscheidung der beiden ist genau
// unser Fall — eine Rückfrage, die eine Handlung UNTERBRICHT und deren
// zerstörerische Antwort bestätigt werden muss. Praktisch hängt daran die
// Rolle `alertdialog`, der Fokus, der beim Öffnen auf dem ABBRECHEN-Knopf
// landet (Radix' eigene Vorgabe, hier genau die richtige: die Eingabetaste
// eines eiligen Nutzers darf nicht die Arbeit wegwerfen), und dass ein Klick
// auf die Abdunklung NICHT schließt — anders als beim gewöhnlichen Dialog.
//
// Kein window.confirm(): das native Fenster bringt Systemschrift, System-
// beschriftungen („Abbrechen"/„OK") und den Programmnamen mit und stünde als
// einziges Element der App außerhalb ihrer eigenen Formensprache. Es blockiert
// zudem den JS-Thread, während im Hintergrund ein Speichervorgang laufen kann.
//
// Material ist bewusst das bereits vorhandene Widget-Rezept (--pc-widget-*,
// wie das Verzeichnis-Popup) und nicht ein neues: eine schwebende Fläche über
// beliebigem Inhalt, die ihre Kante allein trägt. Nichts an Radix'
// Default-Optik überlebt.
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  /** Ganzer Satz, fertig übersetzt. `ReactNode` statt `string`, weil die
   * Rückfragen ihr jeweiliges Objekt (Dateiname, Projektname) im Satz
   * hervorheben — per `<Trans>` beim Aufrufer, damit die Übersetzung selbst
   * bestimmt, wo im Satz es steht. */
  description: ReactNode;
  /** Beschriftung der zerstörerischen Antwort. Benennt die Folge, nicht den
   * Weg: „Fortfahren"/„OK" verschwiegen genau das, was auf dem Spiel steht. */
  confirmLabel: string;
  cancelLabel: string;
  /** Führt die wartende Handlung aus — NUR das. Das Wegräumen der Rückfrage
   * gehört nicht hierher, siehe `onClose`. */
  onConfirm: () => void;
  /** Räumt die Rückfrage weg. Bewusst EIN Weg für alle vier Arten, sie
   * loszuwerden (Abbrechen, Escape, Bestätigen, Fokusverlust): Radix schickt
   * auch den Klick auf die bestätigende Antwort durch `onOpenChange(false)`.
   * Trüge sie das Aufräumen zusätzlich selbst, liefe es doppelt — und ein
   * „Abbrechen"-Handler, der mehr täte als aufzuräumen, liefe nach jedem
   * Bestätigen gleich mit. */
  onClose: () => void;
}) {
  return (
    // Gerendert wird diese Komponente von ihren Aufrufern nur, solange eine
    // Rückfrage offen ist — `open` ist hier deshalb konstant wahr.
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialog.Portal>
        {/* z-40/z-50 über allem anderen Chrome: Tooltip liegt auf z-20,
            Kontextmenü auf z-30. Ein modales Fenster, das unter einem Tooltip
            verschwindet, wäre eine Kette ohne Ende. */}
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-(--pc-dialog-overlayBackground) animate-[pc-overlay-fade-in_150ms_ease-out]" />
        <AlertDialog.Content
          // Breite in rem, gedeckelt gegen das Fenster: der Satz darin ist
          // zwei Zeilen lang, eine breitere Platte machte daraus eine.
          // 24rem sind rund 65 Zeichen — die Zeilenlänge, bei der ein
          // Fließsatz noch in einem Blick erfasst wird.
          //
          // Kein eigener Fokusring an der Platte (`outline-none`): Radix setzt
          // den Fokus beim Öffnen auf den Abbrechen-Knopf, die Platte selbst
          // ist nie das fokussierte Element. Ein Ring um sie herum wäre ein
          // Signal ohne Bedeutung.
          className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-(--pc-widget-border) bg-(--pc-widget-background) p-5 shadow-lg outline-none animate-[pc-overlay-in_150ms_ease-out]"
        >
          <div className="flex items-start gap-3">
            {/* mt-0.5 zieht die 16px-Glyphe auf die optische Grundlinie der
                Überschrift daneben — dieselbe Korrektur wie in
                SaveErrorNotice. */}
            <span className="mt-0.5 flex shrink-0">
              <WarningIcon />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <AlertDialog.Title className="text-(length:--pc-chrome-fontSizeLarge) font-semibold text-(--pc-foreground)">
                {title}
              </AlertDialog.Title>
              {/* Unpersönlich formuliert, ohne „du"/„Sie": die gesamte übrige
                  Oberfläche spricht den Nutzer nirgends an („Keine Treffer
                  für …", „Datei konnte nicht geöffnet werden"), und eine
                  Anredeform, die genau an einer Stelle auftaucht, ist an
                  dieser Stelle das Auffälligste am Satz. */}
              <AlertDialog.Description className="min-w-0 select-text break-words text-(length:--pc-chrome-fontSize) leading-relaxed text-(--pc-descriptionForeground)">
                {description}
              </AlertDialog.Description>
            </div>
          </div>

          {/* Zerstörerische Antwort links, sichere rechts (macOS-Ordnung, und
              macOS ist die Plattform, auf der diese App entwickelt und zuerst
              ausgeliefert wird). Die sichere trägt zusätzlich die Füllung und
              den Fokus — zwei Signale dafür, was passiert, wenn jemand die
              Rückfrage nur wegdrückt. */}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Action asChild>
              <button
                type="button"
                onClick={onConfirm}
                className={`flex h-7 shrink-0 items-center rounded-md border border-(--pc-widget-border) px-3 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
              >
                {confirmLabel}
              </button>
            </AlertDialog.Action>
            {/* Ohne eigenen onClick: Radix schließt über diesen Knopf von
                selbst, und genau dieses Schließen ist hier die ganze
                Handlung. */}
            <AlertDialog.Cancel asChild>
              <button
                type="button"
                // Gefüllt statt nur gerahmt — und zwar im Ton der aktiven
                // Auswahl aus der Palette, nicht im Fokus-Akzent: der ist laut
                // Direction Contract allein dem Fokus vorbehalten und stünde
                // hier dauerhaft an einem Knopf. Der Auswahl-Ton sagt genau
                // das Richtige, nämlich „das ist die Antwort, auf der du
                // gerade stehst".
                className={`flex h-7 shrink-0 items-center rounded-md border border-(--pc-widget-border) bg-(--pc-list-activeSelectionBackground) px-3 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) ${CHROME_FOCUS_RING}`}
              >
                {cancelLabel}
              </button>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// Dasselbe Warndreieck wie in FileEditor.tsx und ExplorerPanel.tsx, gleiche
// Maße und Strichstärke. Im Chrome steht jede Glyphe bewusst in ihrer eigenen
// Datei (Begründung in TerminalPane.tsx): die Symbole sind je an ihre Größe
// angepasst, eine gemeinsame Icon-Datei würde genau diese Anpassung einebnen.
//
// Es gibt bewusst KEINE Möglichkeit, das Zeichen von außen zu tauschen. Jede
// Rückfrage dieser App unterbricht eine Handlung, die etwas Laufendes oder
// Ungespeichertes beendet — für einen zweiten, harmloseren Anlass gäbe es
// keine Rückfrage, sondern gar keinen Dialog.
//
// Das Rot trägt hier — wie in SaveErrorNotice — allein das Icon und nirgends
// die Schrift: als Grafikobjekt hält --pc-icon-red die geforderten 3:1, als
// 13px-Fließtext auf dem Widget-Grund läge es bei 2,6:1.
function WarningIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="shrink-0 text-(--pc-icon-red)"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.13 2.4a1 1 0 0 1 1.74 0l5.26 9.6a1 1 0 0 1-.87 1.5H2.74a1 1 0 0 1-.87-1.5l5.26-9.6Z" />
      <path d="M8 6.1v3.4" />
      <path d="M8 11.4h.01" />
    </svg>
  );
}
