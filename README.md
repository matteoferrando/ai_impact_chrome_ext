# AI Impact Meter (MVP)

Estensione Chrome (Manifest V3) che **stima** l’impatto ambientale dell’uso di AI generativa su ChatGPT, Gemini e Claude. Le stime sono basate su proxy osservabili (caratteri, immagini/video rilevati nel DOM), **non** su misure energetiche reali.

## Installazione
Il modo più semplice è installarla dal [Chrome Web Store](https://chromewebstore.google.com/detail/ai-impact-meter/cilgpiakddglcifgfkcaaobncoheheej).

Per provare il codice di questo repository (Load unpacked):
1. Apri `chrome://extensions`
2. Attiva **Developer mode**
3. Clicca **Load unpacked**
4. Seleziona la cartella: `ai_impact_chrome_ext`

## Come testare (ChatGPT / Gemini / Claude)
1. Vai su:
   - ChatGPT: `https://chat.openai.com` o `https://chatgpt.com`
   - Gemini: `https://gemini.google.com`
   - Claude: `https://claude.ai`
2. Invia un prompt.
3. Attendi il completamento della risposta (stabilizzazione DOM ~1200ms).
4. Apri il popup dell’estensione per vedere “Questa sessione” e “Oggi”.

## HUD overlay in-page
- Il widget appare in basso a destra.
- Pulsanti:
  - `≡` mostra dettagli
  - `⚙` apre Options
  - `×` chiude solo per il tab corrente
- Il toggle “HUD ON/OFF” nel popup persiste per dominio.

## Cambiare parametri
1. Apri **Options** dal popup.
2. Seleziona scenario (conservative / typical / aggressive).
3. Modifica i valori numerici (min/mid/max).
4. Salva.

## Eco-Score ed equivalenze
- **Equivalenze (stima)**: ricariche smartphone, metri in auto, minuti streaming (basati su CO2e/kWh MID).
- **Eco-Score (0–100)**: indice relativo rispetto a target configurabili per sessione e giorno.
- **Badge**: Light / Work / Creative / Heavy in base a CO2e MID e presenza di immagini/video.
- Tutti i valori sono **assunzioni configurabili** in Options.

## Export dati
- **Export JSON** e **Export CSV** dal popup.
- I dati sono salvati localmente in `chrome.storage.local`.

## Known limitations
- **Brittleness DOM**: i selettori sono euristici e le UI possono cambiare.
- **Stime**: i fattori sono assunzioni configurabili, non misure reali.
- **Media metadata**: risoluzioni/durate sono “unknown” se non leggibili.

## Privacy
- **Nessuna rete**: nessun dato inviato all’esterno.
- Tutti i dati sono in locale (`chrome.storage.local`).
- Privacy Policy (GitHub Pages): `https://matteoferrando.github.io/ai_impact_chrome_ext/`

## TODO (futuro)
- Token reali via API per utenti che lo desiderano.
- Heuristics DOM per nuovi layout e aggiornamenti UI.
- Miglior supporto a rigenerazioni/edits e thread multipli.

## Autore
AI Impact Meter è un progetto di [Matteo Ferrando](https://matteoferrando.com), nato dalle ricerche per il libro «AI: L'Impronta Fantasma». Le stesse ipotesi di calcolo sono nel [calcolatore](https://matteoferrando.com/impronta-ai/) sul sito.

## Licenza
Rilasciato con licenza [MIT](LICENSE).
