import type { ComponentProps, ReactElement } from "react";
import { Tooltip } from "radix-ui";

// Ein Tooltip-Aussehen für das gesamte Chrome. Vorher stand derselbe
// Root/Trigger/Portal/Content-Block viermal wörtlich in drei Dateien — und war
// dabei schon auseinandergelaufen: die Titelzeilen-Fassung hatte als einzige
// kein z-20 und wäre damit unter dem Explorer-Resize-Griff gelandet.
export function ChromeTooltip({
  label,
  side = "bottom",
  align = "center",
  children,
}: {
  label: string;
  side?: ComponentProps<typeof Tooltip.Content>["side"];
  align?: ComponentProps<typeof Tooltip.Content>["align"];
  children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          align={align}
          sideOffset={4}
          className="z-20 rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) px-2 py-1 text-(length:--pc-chrome-fontSizeSmall) text-(--pc-foreground) shadow-lg"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// Gemeinsamer Fokusring für jedes Chrome-Bedienelement. Der Fokus-Akzent ist
// laut Direction Contract die eine reservierte Farbe der App — dann darf seine
// Darstellung nicht je nach Datei um einen Offset schwanken (vorher: Titelzeile
// und Explorer ohne Offset, Projekt-Picker mit offset-2).
export const CHROME_FOCUS_RING =
  "focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--pc-focusBorder)";

// Dasselbe Popup-Material für jedes Radix-Menü im Chrome (Dropdown- wie
// Kontextmenü — beide Item-Primitive teilen dieselben `data-*`-Zustände,
// die Klassen sind also wörtlich austauschbar). Vorher stand diese Kette
// zweimal wörtlich (TerminalPane.tsx' Kopier-Menü, ExplorerPanel.tsx'
// Kopfzeilen-Menü) und einmal minimal abweichend (kein `gap-2`, kein
// `data-[disabled]`-Zustand) — ein drittes Menü (Explorer-Kontextmenü) hätte
// das ein drittes Mal auseinanderlaufen lassen. `min-w-*` bleibt Sache des
// Aufrufers: die drei Menüs sind unterschiedlich breit, das ist keine
// Abweichung, die es zu vereinheitlichen gilt.
export const CHROME_MENU_CONTENT_CLASS =
  "z-30 rounded-md border border-(--pc-titleBar-border) bg-(--pc-explorer-background) p-1 text-(length:--pc-chrome-fontSize) text-(--pc-foreground) shadow-lg";

export const CHROME_MENU_ITEM_CLASS =
  "flex h-7 cursor-default select-none items-center gap-2 rounded px-2 outline-none data-[highlighted]:bg-(--pc-list-hoverBackground) data-[disabled]:pointer-events-none data-[disabled]:text-(--pc-descriptionForeground) data-[disabled]:opacity-50";

export const CHROME_MENU_SEPARATOR_CLASS = "my-1 h-px bg-(--pc-titleBar-border)";
