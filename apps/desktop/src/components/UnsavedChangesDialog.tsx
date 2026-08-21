import { Trans, useTranslation } from "react-i18next";
import { ConfirmDialog } from "./ConfirmDialog";

// Die Rückfrage vor dem Verlassen einer Datei mit ungespeichertem Stand
// (.scratch/explorer-file-io/, Ticket 05). Alle drei Verlassen-Wege — andere
// Datei anklicken, Projekt wechseln, Fläche schließen — laufen über EINEN
// Aufrufer in App.tsx (`guardLeave`) und damit über diese eine Fläche; die
// Komponente selbst weiß nicht, welcher der Wege sie geöffnet hat, und muss es
// auch nicht: der Verlust ist in jedem Fall derselbe.
//
// Seit den Schließen-Rückfragen (Pane, Terminal-Tab) trägt sie ihre Form nicht
// mehr selbst, sondern liegt auf `ConfirmDialog` — dort stehen die
// Entscheidungen (AlertDialog statt Dialog, Fokus auf Abbrechen, kein
// window.confirm(), Knopfordnung, Material). Was hier bleibt, ist genau das,
// was diese Rückfrage von den anderen unterscheidet: ihre Worte.
export function UnsavedChangesDialog({
  fileNames,
  onConfirm,
  onClose,
}: {
  /** File names only, not paths: these are the exact dirty buffers that the
   * confirmed action will discard. */
  fileNames: readonly string[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      title={t("unsavedDialog.title")}
      description={
        <Trans
          i18nKey={
            fileNames.length === 1
              ? "unsavedDialog.description"
              : "unsavedDialog.descriptionMultiple"
          }
          values={{ fileName: fileNames[0], fileNames: fileNames.join(", ") }}
          components={{
            bold: <span className="font-medium text-(--pc-foreground)" />,
          }}
        />
      }
      confirmLabel={t("unsavedDialog.discard")}
      cancelLabel={t("unsavedDialog.cancel")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
