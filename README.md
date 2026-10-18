# AI Impact Meter

Estensione Chrome (Manifest V3) che **stima in tempo reale** energia, CO₂e e acqua consumate dal tuo uso di AI generativa su **ChatGPT, Gemini e Claude**. Tutto resta sul tuo dispositivo: nessuna richiesta di rete, nessun testo salvato (solo conteggi di caratteri).

> Le stime si basano su proxy osservabili (caratteri di prompt e risposta, immagini e video generati) e su assunzioni configurabili. Non sono misure energetiche reali.

## Funzionalità
- **Tracciamento automatico** dei turni di conversazione: invio con Enter o con il pulsante, modifica di un messaggio, rigenera/riprova, risposte lunghe in streaming e pause di ragionamento.
- **Immagini e video generati** (generazione immagini di ChatGPT, immagini e video Veo di Gemini) con deduplicazione delle anteprime progressive.
- **HUD in pagina** trascinabile: CO₂e della sessione, Eco-Score, indicatore live "generazione in corso" e notifica `+x g` a ogni turno. Si espande con energia, acqua, turni, token ed equivalenze.
- **Badge sull'icona** con i grammi di CO₂e della sessione del tab, colorato in base al livello.
- **Popup** con viste Sessione / Oggi / 7 giorni / Totale, Eco-Score, equivalenze (ricariche smartphone, km in auto, streaming, lampadina LED), ripartizione per assistente e grafico degli ultimi 7 giorni.
- **Impostazioni** con 3 scenari (Conservative, Typical, Aggressive), parametri min/mid/max validati, anteprima live, gestione dati (export JSON/CSV, cancellazione) e metodologia con fonti.
- Tema chiaro/scuro automatico.

## Installazione (Load unpacked)
1. Apri `chrome://extensions`
2. Attiva **Developer mode**
3. Clicca **Load unpacked** e seleziona la cartella del progetto

## Uso
1. Apri [ChatGPT](https://chatgpt.com), [Gemini](https://gemini.google.com) o [Claude](https://claude.ai) e invia un prompt.
2. L'HUD in alto a destra mostra la stima appena la risposta è completa. Trascinalo dove preferisci: la posizione viene ricordata per sito.
3. Apri il popup per lo storico. Il toggle "HUD in pagina" vale per il sito corrente; `×` sull'HUD lo nasconde solo nel tab.

Le conversazioni già presenti quando apri o cambi una chat **non** vengono conteggiate: contano solo le generazioni che avvengono mentre l'estensione è attiva.

## Come funziona la stima
| Attività | Formula |
| --- | --- |
| Testo | ⌈(caratteri prompt + risposta) ÷ caratteri per token⌉ ÷ 1000 × kWh per 1k token |
| Immagini | n. immagini × kWh per immagine |
| Video | secondi (letti dal player, altrimenti default 8 s) × kWh al secondo |
| CO₂e | kWh × g CO₂e/kWh della rete |
| Acqua | Wh × mL/Wh |

Ogni valore ha un range min · mid · max; i numeri mostrati sono il valore mid. Le assunzioni usate sono salvate con ogni attività. I nuovi parametri si applicano alle attività future.

## Sviluppo e test
```bash
npm test            # unit test del modello di stima (node:test)
npm run check       # controllo sintassi di tutti gli script
npm i -D playwright # una volta
npm run test:e2e    # test end-to-end in Chromium reale
npm run package     # crea ai-impact-meter.zip per il Chrome Web Store
```
I test end-to-end caricano l'estensione in Chromium e la esercitano su pagine mock servite sugli host reali (`chatgpt.com`, `claude.ai`, `gemini.google.com`) che riproducono il DOM e lo streaming dei tre siti. Coprono: storico non conteggiato, Enter, click su Invia, Shift+Enter, rigenera (anche senza click intercettato), immagini con anteprime progressive, video, navigazione SPA, badge, totali, export, popup e options. Con `SCREENSHOTS=cartella npm run test:e2e` salva anche gli screenshot dell'interfaccia.

Debug in pagina: esegui `localStorage.setItem("aiim_debug", "1")` nella console del sito e ricarica per vedere i log dettagliati del tracker.

### Struttura
```
manifest.json
service_worker.js            registrazione attività, aggregati, badge, export
estimator/model.js           modello di stima, aggregazione, formattazione (condiviso)
estimator/presets.js         scenari e parametri
content_scripts/common.js    motore di tracciamento condiviso
content_scripts/hud.js       widget in pagina (shadow DOM)
content_scripts/providers/   configurazione DOM di ChatGPT, Claude, Gemini
ui/                          popup e impostazioni
tests/                       unit ed end-to-end
```

## Limiti noti
- **DOM dei siti**: i selettori sono euristici e i siti cambiano spesso. Il motore usa più segnali (invio, streaming, crescita del testo) per resistere ai cambiamenti, ma un redesign può richiedere un aggiornamento dei selettori in `content_scripts/providers/`.
- **Contesto**: la stima conta prompt e risposta del turno, non l'intera cronologia rielaborata dal modello né file allegati.
- **Media**: la risoluzione e la durata sono "unknown" o di default se non leggibili dal DOM.

## Privacy
- Nessuna richiesta di rete; dati solo in `chrome.storage.local`.
- Il testo di prompt e risposte non viene mai salvato: solo lunghezze e conteggi.
- Privacy Policy: https://matteoferrando.github.io/ai_impact_chrome_ext/
