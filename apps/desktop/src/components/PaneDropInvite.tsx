// Das Drop-Ziel-HUD: Sucher-Ecken plus eine Plakette, die benennt, was ein
// Loslassen JETZT tut. Drei Quellen benutzen dasselbe Instrument, weil es für
// die Pane derselbe Zustand ist — „hier landet es" —, nur mit anderer
// Wirkung: der Datei-Drop (Finder/Explorer, TerminalPane.tsx), der
// Slot-Tausch zweier Panes (Ticket 20) und das Verschieben eines
// Terminal-Tabs (Ticket 32, beide PaneGrid.tsx).
//
// Amber ist hier Einladung, dieselbe Semantik wie die Sucher-Ecken der leeren
// Slots (App.css, `.pc-hud-corner`-Kommentar) — kein zweiter Fokus-Ort:
// während eines laufenden Zugs gibt es keinen konkurrierenden Zeiger-Zustand.
// Harte Schnitte, kein Easing (HUD-Instrument, s. Design-Kanon zu
// „Bewegung aus Interaktion/Dauer, nie aus Easing"); `aria-hidden`, weil ein
// Zeiger-Zug reine Zeigerführung ist; `pointer-events-none`, weil die Fläche
// weiter dem Inhalt darunter gehört (und ein Ereignis-schluckendes Overlay
// die Trefferprüfung des Zugs selbst stören würde).
//
// Zwei Stufen seit dem Nutzer-Befund zum Tab-Zug ("er muss mir natürlich auch
// anzeigen, wo ich ihn jetzt loslassen könnte"): die Grid-eigenen Züge
// (Slot-Tausch, Tab-Verschieben, PaneGrid.tsx) zeigen das Instrument jetzt
// auf ALLEN gültigen Ziel-Panes, sobald der Zug scharf wird — gedämpfte Ecken
// als Ankündigung (`engaged={false}`, dieselbe 45%-Abschwächung wie die
// Fokus-Hairline unfokussierter Panes) —, und erst die Pane unterm Zeiger
// spricht in voller Sättigung samt Plakette. Der Datei-Drop
// (TerminalPane.tsx) kennt nur die volle Stufe: seine Kandidaten stehen erst
// beim Schweben über einer Pane fest, eine Vorab-Ankündigung gäbe es dort
// nicht zu zeigen.
export function PaneDropInvite({
  glyph,
  label,
  engaged = true,
}: {
  /** Ein Zeichen, das die Richtung der Handlung zeigt (⇣ einfügen, ⇄
   * tauschen, ⇥ verschieben) — bewusst aus derselben Terminalschrift wie der
   * Text daneben. */
  glyph: string;
  /** Fertig übersetzt (dieses Modul bleibt ohne i18n-Import, der Aufrufer hat
   * `t()` ohnehin schon). */
  label: string;
  /** `false` = reine Kandidaten-Ankündigung (gedämpfte Ecken, keine
   * Plakette), `true` = das Ziel unterm Zeiger (volle Fassung). S.
   * Kopfkommentar, Zwei-Stufen-Absatz. */
  engaged?: boolean;
}) {
  const cornerClass = `pc-hud-corner pc-hud-corner--invite ${
    engaged ? "" : "pc-hud-corner--invite-dim"
  }`;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-20">
      {/* 4px nach innen gerückt: direkt auf der Kante würden die Ecken bei
          fokussierter Pane mit deren Amber-Rahmen zu einer verdickten Ecke
          verschmelzen — abgesetzt lesen sie sich als eigenes Instrument über
          dem Inhalt. */}
      <div className="absolute inset-1">
        <span className={`${cornerClass} pc-hud-corner--tl`} />
        <span className={`${cornerClass} pc-hud-corner--tr`} />
        <span className={`${cornerClass} pc-hud-corner--bl`} />
        <span className={`${cornerClass} pc-hud-corner--br`} />
      </div>
      {engaged && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="flex items-center gap-1.5 rounded-(--pc-paneControl-radius) border border-(--pc-pane-activeBorder)/45 bg-(--pc-pane-background)/90 py-1 pl-2 font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.25em] uppercase"
            // Tracking-Ausgleich wie beim Sprachchip der TitleBar:
            // letter-spacing hängt rechts am letzten Glyph, ohne den Abzug
            // stünde das Wort nicht mittig in seiner Plakette.
            style={{ paddingRight: "calc(0.5rem - 0.25em)" }}
          >
            <span className="text-(--pc-pane-activeBorder)">{glyph}</span>
            <span className="text-(--pc-descriptionForeground)">{label}</span>
          </span>
        </div>
      )}
    </div>
  );
}
