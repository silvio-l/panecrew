// Das Ablese-Register der App, als Bauteil. Es war vor dieser Datei dreimal
// von Hand gesetzt — jedes Mal dieselbe Kette aus Terminalschrift, 10px,
// 0.25em Sperrung und der gedimmten Farbe aus `.pc-hud-readout` (App.css).
// Die Baum-Fußzeile (`TreeStatusReadout` in ExplorerPanel.tsx) ist mit dieser
// Datei hierher umgezogen; die Zoom-Anzeige in TitleBar.tsx und das
// Slot-Readout der leeren Panes in ProjectPicker.tsx setzen die Kette noch
// selbst, weil beide sie mit eigener Positionierung verschränken
// (`absolute`, Hover-Anzug am Slot-Rahmen) — sie ziehen beim nächsten
// Anfassen nach, statt dass dieses Bauteil dafür Knöpfe bekommt.
//
// Die Regel dieses Registers, gültig für jeden Aufrufer: sichtbar sind nur
// Ziffern, Trennzeichen und Symbole — nie Prosa. Die Sperrung, die es
// technisch aussehen lässt, macht Wörter schlecht lesbar, und Prosa gehört im
// Chrome ohnehin in die Systemschrift. Der ganze Satz geht deshalb an den
// Screenreader (`srText`) und nur dorthin; das ist keine Notlösung, sondern
// dieselbe Aufteilung, die die Baum-Fußzeile schon vor dieser Datei hatte.
export function HudReadout({
  glyph,
  value,
  srText,
}: {
  /** Ein einzelnes Symbol vor dem Wert, das benennt, was gezählt wird —
   * dieselbe Rolle wie ⇣/✓/❯ anderswo im Chrome. Ohne Symbol (Default) steht
   * der Wert für sich, wenn sein Bezug aus der Umgebung ohnehin eindeutig
   * ist. */
  glyph?: string;
  /** Der abgelesene Wert, fertig formatiert (z. B. `3/4`). */
  value: string;
  /** Der ganze Satz für Screenreader — das Einzige, was hier übersetzt wird. */
  srText: string;
}) {
  return (
    <span className="flex items-center gap-1">
      {glyph !== undefined && (
        // Ohne Sperrung: die gehört zu den Ziffernkolonnen daneben, an einem
        // einzelnen Symbol wäre sie nur ein Loch dahinter.
        <span
          aria-hidden="true"
          className="pc-hud-readout font-(family-name:--pc-terminal-fontFamily) text-[10px]"
        >
          {glyph}
        </span>
      )}
      <span
        aria-hidden="true"
        className="pc-hud-readout font-(family-name:--pc-terminal-fontFamily) text-[10px] tracking-[0.25em]"
        // Tracking-Ausgleich wie beim Sprachchip der TitleBar: letter-spacing
        // hängt rechts am letzten Glyph. Ohne den Abzug stünde jeder Abstand
        // zum nächsten Element um 0.25em zu weit — sichtbar, sobald mehrere
        // Ablesungen in einer Reihe stehen.
        style={{ marginRight: "-0.25em" }}
      >
        {value}
      </span>
      <span className="sr-only">{srText}</span>
    </span>
  );
}
