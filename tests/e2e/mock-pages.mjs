// Pagine finte che riproducono la struttura DOM (selettori, streaming, pulsanti)
// di ChatGPT, Claude e Gemini. Servite via page.route() sugli host reali, così
// i content script dell'estensione vengono iniettati come in produzione.

export const RESPONSE_TEXT =
  "La fotosintesi è il processo con cui le piante convertono luce, acqua e anidride carbonica in glucosio e ossigeno. " +
  "Avviene nei cloroplasti grazie alla clorofilla, in due fasi: reazioni luminose e ciclo di Calvin.";

const COMMON_SCRIPT = String.raw`
  const RESPONSE = ${JSON.stringify(RESPONSE_TEXT)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__mock = { busy: false };

  function chunks(text, n) {
    const out = []; const size = Math.ceil(text.length / n);
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  }

  function solidImage(w, h, color) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, w, h);
    return c.toDataURL("image/png");
  }

  async function stream(target, text, opts) {
    await sleep(opts.thinkMs || 0);
    for (const part of chunks(text, opts.chunks || 12)) {
      target.textContent += part;
      await sleep(opts.chunkMs || 90);
    }
  }

  function readComposer() {
    const c = document.querySelector(PROVIDER.composer);
    return (c.value != null && c.tagName === "TEXTAREA" ? c.value : c.innerText).trim();
  }
  function clearComposer() {
    const c = document.querySelector(PROVIDER.composer);
    if (c.tagName === "TEXTAREA") c.value = ""; else c.innerHTML = "<p><br></p>";
  }

  async function submit() {
    if (window.__mock.busy) return;
    const text = readComposer();
    if (!text) return;
    window.__mock.busy = true;
    clearComposer();
    PROVIDER.addUser(text);
    PROVIDER.setStreaming(true);
    const node = PROVIDER.addAssistant();
    await stream(node, text.includes("lungo") ? RESPONSE + " " + RESPONSE : RESPONSE, { thinkMs: 900 });
    if (/immagine|image/i.test(text) && PROVIDER.addImage) await PROVIDER.addImage(node);
    if (/video/i.test(text) && PROVIDER.addVideo) PROVIDER.addVideo(node);
    PROVIDER.setStreaming(false);
    window.__mock.busy = false;
  }

  async function regenerate() {
    if (window.__mock.busy) return;
    window.__mock.busy = true;
    PROVIDER.setStreaming(true);
    const node = PROVIDER.replaceLastAssistant();
    await stream(node, "Versione rigenerata: " + RESPONSE, { thinkMs: 500 });
    PROVIDER.setStreaming(false);
    window.__mock.busy = false;
  }

  // Simula il passaggio SPA a un'altra chat con storico (incluse immagini già generate).
  window.__mock.openOtherChat = () => {
    history.pushState({}, "", PROVIDER.otherChatPath);
    document.querySelector("#thread").innerHTML = "";
    PROVIDER.addUser("Domanda vecchia dello storico");
    const n = PROVIDER.addAssistant();
    n.textContent = "Risposta vecchia dello storico che non deve essere contata come nuova.";
    if (PROVIDER.addImage) PROVIDER.addImage(n, true);
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && e.target.closest(PROVIDER.composer)) {
      e.preventDefault();
      submit();
    }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest(PROVIDER.sendBtn)) submit();
    if (e.target.closest("[data-mock-retry]")) regenerate();
  });

  // Storico già presente al caricamento: non deve essere conteggiato.
  PROVIDER.addUser("Messaggio storico precedente");
  PROVIDER.addAssistant().textContent = "Risposta storica precedente che esiste già al caricamento della pagina.";
`;

function page(title, body, providerScript) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:sans-serif;margin:0;padding:20px 20px 120px;background:#fafafa} .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
  [contenteditable]{border:1px solid #ccc;min-height:40px;padding:8px;background:#fff} img{display:block}
  .composer{position:fixed;left:20px;right:20px;bottom:20px;display:flex;gap:8px} .composer>*:first-child{flex:1}</style></head>
  <body>${body}<script>${providerScript}\n${COMMON_SCRIPT}</script></body></html>`;
}

export const MOCKS = {
  chatgpt: {
    url: "https://chatgpt.com/",
    html: page(
      "ChatGPT",
      `<main><div id="thread"></div>
        <form class="composer" onsubmit="return false"><div id="prompt-textarea" class="ProseMirror" contenteditable="true"><p><br></p></div>
        <button type="button" id="composer-submit-button" data-testid="send-button" aria-label="Send prompt">↑</button></form></main>`,
      String.raw`
      let turn = 0;
      const PROVIDER = {
        composer: "#prompt-textarea",
        sendBtn: "[data-testid='send-button']",
        otherChatPath: "/c/altra-chat",
        addUser(text) {
          const a = document.createElement("article");
          a.dataset.testid = "conversation-turn-" + (++turn); a.dataset.turn = "user";
          a.innerHTML = '<h5 class="sr-only">You said:</h5><div data-message-author-role="user"><div class="whitespace-pre-wrap"></div></div>';
          a.querySelector(".whitespace-pre-wrap").textContent = text;
          document.querySelector("#thread").appendChild(a);
        },
        addAssistant() {
          const a = document.createElement("article");
          a.dataset.testid = "conversation-turn-" + (++turn); a.dataset.turn = "assistant";
          a.innerHTML = '<h6 class="sr-only">ChatGPT said:</h6><div data-message-author-role="assistant"><div class="markdown"></div></div><button aria-label="Copy">Copy</button><button aria-label="Altre azioni" data-mock-retry>⋯</button>';
          document.querySelector("#thread").appendChild(a);
          return a.querySelector(".markdown");
        },
        replaceLastAssistant() {
          const m = [...document.querySelectorAll(".markdown")].pop(); m.textContent = ""; return m;
        },
        async addImage(node, instant) {
          // Anteprima progressiva: lo stesso contenitore cambia src più volte.
          const id = "image-" + Math.random().toString(16).slice(2);
          const box = document.createElement("div"); box.id = id;
          const img = document.createElement("img"); img.alt = "Generated image"; img.width = 512; img.height = 512;
          box.appendChild(img); node.closest("article").appendChild(box);
          for (const col of instant ? ["#2a7"] : ["#ddd", "#999", "#2a7"]) {
            img.src = solidImage(512, 512, col) + "#" + col;
            if (!instant) await sleep(400);
          }
        },
        setStreaming(on) {
          const form = document.querySelector("form");
          const btn = form.querySelector("button");
          if (on) { btn.dataset.testid = "stop-button"; btn.setAttribute("aria-label", "Stop streaming"); }
          else { btn.dataset.testid = "send-button"; btn.setAttribute("aria-label", "Send prompt"); }
        }
      };`
    )
  },

  claude: {
    url: "https://claude.ai/new",
    html: page(
      "Claude",
      `<main><div id="thread"></div>
        <fieldset class="composer"><div class="ProseMirror" contenteditable="true"><p><br></p></div>
        <button type="button" aria-label="Send message">Send</button></fieldset></main>`,
      String.raw`
      const PROVIDER = {
        composer: "div.ProseMirror[contenteditable='true']",
        sendBtn: "button[aria-label='Send message']",
        otherChatPath: "/chat/altra-chat",
        addUser(text) {
          const d = document.createElement("div"); d.dataset.testid = "user-message"; d.textContent = text;
          document.querySelector("#thread").appendChild(d);
        },
        addAssistant() {
          const d = document.createElement("div"); d.setAttribute("data-is-streaming", "false");
          d.innerHTML = '<div class="font-claude-response"></div><button data-testid="action-bar-retry" aria-label="Retry" data-mock-retry>Retry</button>';
          document.querySelector("#thread").appendChild(d);
          return d.querySelector(".font-claude-response");
        },
        replaceLastAssistant() {
          // Claude sostituisce il messaggio con uno nuovo
          const last = [...document.querySelectorAll("[data-is-streaming]")].pop(); last.remove();
          return this.addAssistant();
        },
        setStreaming(on) {
          this.__on = on;
          if (!on) document.querySelectorAll("[data-is-streaming]").forEach((n) => n.setAttribute("data-is-streaming", "false"));
        }
      };
      // Claude crea il nodo dell'assistente insieme allo streaming: imposta lo stato dopo l'aggiunta.
      const _add = PROVIDER.addAssistant.bind(PROVIDER);
      PROVIDER.addAssistant = function () { const n = _add(); if (this.__on) n.parentElement.setAttribute("data-is-streaming", "true"); return n; };
      `
    )
  },

  gemini: {
    url: "https://gemini.google.com/app",
    html: page(
      "Gemini",
      `<main><div id="chat-history"><div id="thread"></div></div>
        <div class="composer"><rich-textarea><div class="ql-editor" contenteditable="true" role="textbox"><p><br></p></div></rich-textarea>
        <button class="send-button" aria-label="Invia messaggio">➤</button></div></main>`,
      String.raw`
      const PROVIDER = {
        composer: ".ql-editor",
        sendBtn: "button.send-button",
        otherChatPath: "/app/altra-chat",
        addUser(text) {
          const q = document.createElement("user-query");
          q.innerHTML = '<user-query-content><div class="query-text"></div></user-query-content>';
          q.querySelector(".query-text").textContent = text;
          document.querySelector("#thread").appendChild(q);
        },
        addAssistant() {
          const r = document.createElement("model-response");
          r.innerHTML = '<message-content><div class="markdown"></div></message-content><button aria-label="Rigenera" data-mock-retry>↻</button>';
          document.querySelector("#thread").appendChild(r);
          return r.querySelector(".markdown");
        },
        replaceLastAssistant() {
          const m = [...document.querySelectorAll("model-response .markdown")].pop(); m.textContent = ""; return m;
        },
        async addImage(node, instant) {
          const g = document.createElement("generated-image");
          for (let i = 0; i < 2; i++) {
            const img = document.createElement("img"); img.width = 400; img.height = 400;
            img.src = solidImage(400, 400, i ? "#36c" : "#c63") + "#gen" + i + Math.random();
            g.appendChild(img);
          }
          node.closest("model-response").appendChild(g);
        },
        addVideo(node) {
          const v = document.createElement("video"); v.width = 480; v.height = 270;
          v.src = "https://gemini.google.com/mock/veo-" + Math.random().toString(16).slice(2) + ".mp4";
          node.closest("model-response").appendChild(v);
        },
        setStreaming(on) {
          const b = document.querySelector(".send-button");
          b.classList.toggle("stop", on);
          b.setAttribute("aria-label", on ? "Interrompi risposta" : "Invia messaggio");
        }
      };`
    )
  }
};
