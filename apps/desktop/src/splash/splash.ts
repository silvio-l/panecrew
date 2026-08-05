import { invoke } from "@tauri-apps/api/core";

const video = document.getElementById("splash-video") as HTMLVideoElement;

let handedOff = false;
const handOff = (): void => {
  if (handedOff) return;
  handedOff = true;
  void invoke("splash_finished");
};

video.addEventListener("ended", handOff);

// Der Splash ist bewusst nicht überspringbar: bliebe `ended` aus (Decode-Fehler,
// blockiertes Autoplay), erschiene das Hauptfenster nie. Beide Auffanglinien
// sind großzügig hinter der Videolänge (2,54 s) angesetzt.
video.addEventListener("error", handOff);
window.setTimeout(handOff, 6000);

// Das Fenster startet unsichtbar: ein frisch erzeugtes WKWebView malt vor dem
// ersten Dokument-Frame kurz weiß, und genau dieser Blitz wäre das Erste, was
// der Nutzer von PaneCrew sieht. Aufgedeckt wird deshalb erst, wenn der erste
// Videoframe dekodiert ist — die Zeitschranke fängt ab, dass macOS die
// Medien-Pipeline eines unsichtbaren Fensters drosselt.
let shown = false;
const show = (): void => {
  if (shown) return;
  shown = true;
  void invoke("splash_visible")
    .then(() => video.play())
    // Erst ab dem tatsächlichen Wiedergabestart, damit das Einblenden des
    // Kolophons an der Animation hängt und nicht am Dokumentladen.
    .then(() => document.body.classList.add("playing"))
    .catch(handOff);
};

video.addEventListener("loadeddata", show, { once: true });
window.setTimeout(show, 400);
