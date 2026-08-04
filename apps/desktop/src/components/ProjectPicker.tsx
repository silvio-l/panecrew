// Leerzustand vor der ersten Projektwahl: eine zentrierte, sehr zurückhaltende
// Aufforderung in derselben warm-dunklen Grundfläche wie die spätere Pane —
// kein Fremdkörper, keine Illustration. Der Akzent bleibt laut Direction
// Contract dem Fokus vorbehalten, deshalb ist der Button neutral gefüllt und
// trägt den Akzent nur als Fokus-Ring.
export function ProjectPicker({
  onChoose,
  busy,
}: {
  onChoose: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-(length:--pc-chrome-fontSize) font-semibold text-(--pc-foreground)">
          Kein Projekt geöffnet
        </h1>
        <p className="max-w-80 text-(length:--pc-chrome-fontSize) text-(--pc-descriptionForeground)">
          Wähle einen Projektordner — PaneCrew startet darin eine echte Shell.
        </p>
      </div>
      <button
        type="button"
        onClick={onChoose}
        disabled={busy}
        className="flex h-8 items-center gap-2 rounded-md border border-(--pc-pane-border) bg-(--pc-explorer-background) px-3.5 text-(length:--pc-chrome-fontSize) font-medium text-(--pc-foreground) transition-colors hover:bg-(--pc-list-hoverBackground) focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-(--pc-focusBorder) disabled:opacity-50"
      >
        <FolderPlusIcon />
        Projekt wählen
      </button>
    </div>
  );
}

function FolderPlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-(--pc-descriptionForeground)"
    >
      <path d="M1.75 12.75v-9a.5.5 0 0 1 .5-.5h3.4l1.4 1.5h6.2a.5.5 0 0 1 .5.5v7.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5Z" />
      <path d="M8 6.75v4M6 8.75h4" />
    </svg>
  );
}
