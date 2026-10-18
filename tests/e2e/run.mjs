// Test end-to-end: carica l'estensione in Chromium e la esercita su pagine mock
// servite sugli host reali (chatgpt.com, claude.ai, gemini.google.com).
//
//   npm run test:e2e            (richiede playwright: npm i -D playwright)
//   SCREENSHOTS=dir npm run test:e2e   salva screenshot di popup, options e HUD
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MOCKS, RESPONSE_TEXT } from "./mock-pages.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../..");
const SHOTS = process.env.SCREENSHOTS ? path.resolve(process.env.SCREENSHOTS) : null;

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (_e) {
    const root = execSync("npm root -g").toString().trim();
    return import(pathToFileURL(path.join(root, "playwright", "index.mjs")).href);
  }
}

const norm = (t) => t.replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
let passes = 0;
function check(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`  ✔ ${name}`);
  } else {
    failures++;
    console.log(`  ✘ ${name}${detail !== undefined ? `  →  ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  }
}

async function main() {
  const { chromium } = await loadPlaywright();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiim-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });

  const swErrors = [];
  const pageErrors = [];

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
    sw.on("console", (m) => m.type() === "error" && swErrors.push(m.text()));
    const extId = new URL(sw.url()).host;
    console.log(`Estensione caricata: ${extId}`);

    // Chiude la pagina di benvenuto aperta all'installazione.
    await sleep(500);
    for (const p of context.pages()) if (p.url().startsWith("chrome-extension://")) await p.close();

    for (const [name, mock] of Object.entries(MOCKS)) {
      await context.route(new URL(mock.url).origin + "/**", (route) => {
        const req = route.request();
        if (req.resourceType() === "document") return route.fulfill({ status: 200, contentType: "text/html", body: mock.html });
        return route.fulfill({ status: 404, body: "" });
      });
    }

    const activities = async () => (await sw.evaluate(() => chrome.storage.local.get("activities"))).activities || [];
    const resetAll = () => sw.evaluate(() => chrome.storage.local.set({ activities: [], day_stats_by_date: {}, totals: null, session_stats_by_tab: {} }));
    const waitFor = async (fn, timeout = 12000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const list = await activities();
        if (fn(list)) return list;
        await sleep(250);
      }
      return activities();
    };

    for (const [name, mock] of Object.entries(MOCKS)) {
      console.log(`\n▶ ${name}`);
      await resetAll();
      const page = await context.newPage();
      page.on("pageerror", (e) => pageErrors.push(`${name}: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error" && m.text().includes("AI Impact")) pageErrors.push(`${name}: ${m.text()}`);
      });
      await page.goto(mock.url);
      const composer = {
        chatgpt: "#prompt-textarea",
        claude: "div.ProseMirror",
        gemini: ".ql-editor"
      }[name];

      await sleep(2500);
      check("lo storico esistente non viene conteggiato", (await activities()).length === 0, await activities());
      check("HUD montato nella pagina", (await page.locator("#ai-impact-meter-hud").count()) === 1);

      // 1) invio con Enter
      const prompt1 = "Ciao, spiegami la fotosintesi in breve";
      await page.click(composer);
      await page.keyboard.type(prompt1);
      await page.keyboard.press("Enter");
      let list = await waitFor((l) => l.some((a) => a.type === "text_turn"));
      let turn = list.find((a) => a.type === "text_turn");
      check("turno registrato dopo Enter", !!turn);
      if (turn) {
        check("prompt_chars corretto", turn.prompt_chars === prompt1.length, `${turn.prompt_chars} vs ${prompt1.length}`);
        check("response_chars = testo della risposta (senza UI)", turn.response_chars === norm(RESPONSE_TEXT).length, `${turn.response_chars} vs ${norm(RESPONSE_TEXT).length}`);
        check("provider e impatto calcolati", turn.provider === name && turn.impact && turn.impact.co2e_g.mid > 0, turn.provider);
        check("streaming rilevato", turn.meta && turn.meta.saw_streaming === true, turn.meta);
        check("session_id assegnato", typeof turn.session_id === "string" && turn.session_id.length > 8);
      }
      await sleep(2500);
      check("nessun doppio conteggio dopo la fine", (await activities()).filter((a) => a.type === "text_turn").length === 1, (await activities()).length);

      // 2) invio con click sul pulsante
      await page.click(composer);
      await page.keyboard.type("Fammi un esempio lungo");
      await page.click({ chatgpt: "[data-testid='send-button']", claude: "button[aria-label='Send message']", gemini: "button.send-button" }[name]);
      list = await waitFor((l) => l.filter((a) => a.type === "text_turn").length >= 2);
      const turns = list.filter((a) => a.type === "text_turn");
      check("turno registrato dopo click su Invia", turns.length === 2, turns.length);
      if (turns[1]) check("risposta lunga misurata per intero", turns[1].response_chars === norm(RESPONSE_TEXT + " " + RESPONSE_TEXT).length, turns[1].response_chars);

      // 3) Shift+Enter va a capo: nessun invio, nessun turno
      await page.click(composer);
      await page.keyboard.type("riga uno");
      await page.keyboard.press("Shift+Enter");
      await sleep(3000);
      check("Shift+Enter non conta come invio", (await activities()).filter((a) => a.type === "text_turn").length === 2);
      await page.evaluate((sel) => (document.querySelector(sel).innerHTML = "<p><br></p>"), composer);

      // 4) rigenera. Su ChatGPT il pulsante del mock ha un'etichetta non riconoscibile:
      //    il turno deve essere dedotto dallo streaming e la riscrittura sul posto misurata per intero.
      await page.locator("[data-mock-retry]").last().click();
      list = await waitFor((l) => l.filter((a) => a.type === "text_turn").length >= 3);
      const regen = list.filter((a) => a.type === "text_turn")[2];
      check("rigenerazione conteggiata", !!regen && regen.meta && (regen.meta.regenerate === true), regen && regen.meta);
      if (regen) {
        check("rigenerazione: testo nuovo misurato", regen.response_chars === norm("Versione rigenerata: " + RESPONSE_TEXT).length, regen.response_chars);
        check("rigenerazione: prompt ri-elaborato contato", regen.prompt_chars === "Fammi un esempio lungo".length, regen.prompt_chars);
      }

      // 5) immagini generate
      if (name === "chatgpt" || name === "gemini") {
        const before = (await activities()).length;
        await page.click(composer);
        await page.keyboard.type("Genera una immagine di una foresta");
        await page.keyboard.press("Enter");
        list = await waitFor((l) => l.some((a) => a.type === "image_gen") && l.length >= before + 2);
        const imgs = list.filter((a) => a.type === "image_gen");
        const expected = name === "gemini" ? 2 : 1;
        const count = imgs.reduce((s, a) => s + a.meta.count, 0);
        check(`immagini generate rilevate (${expected})`, count === expected, imgs.map((a) => a.meta));
        await sleep(2500);
        const again = (await activities()).filter((a) => a.type === "image_gen").reduce((s, a) => s + a.meta.count, 0);
        check("anteprime progressive non contate due volte", again === expected, again);
      }

      // 6) video (Gemini / Veo): durata non leggibile → default
      if (name === "gemini") {
        await page.click(composer);
        await page.keyboard.type("Crea un video di un tramonto");
        await page.keyboard.press("Enter");
        list = await waitFor((l) => l.some((a) => a.type === "video_gen"), 26000);
        const vid = list.find((a) => a.type === "video_gen");
        check("video generato rilevato", !!vid);
        if (vid) check("durata video di default applicata", vid.impact.video_sec === 8, vid.impact);
      }

      // 7) Navigazione SPA verso una chat storica: niente nuovi conteggi
      const beforeNav = (await activities()).length;
      await page.evaluate(() => window.__mock.openOtherChat());
      await sleep(4000);
      check("cambio chat (SPA) non genera attività fantasma", (await activities()).length === beforeNav, (await activities()).slice(beforeNav));

      // badge sull'icona
      const tabBadge = await sw.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return chrome.action.getBadgeText({ tabId: tab.id });
      });
      check("badge CO₂e impostato sull'icona", /^\d/.test(tabBadge), tabBadge);

      // statistiche aggregate coerenti con le attività
      const agg = await sw.evaluate(() => chrome.storage.local.get(["totals", "day_stats_by_date", "session_stats_by_tab"]));
      const all = await activities();
      const sum = all.reduce((s, a) => s + a.impact.co2e_g.mid, 0);
      check("totali = somma delle attività", agg.totals && Math.abs(agg.totals.co2e_g.mid - sum) < 1e-9, { totals: agg.totals && agg.totals.co2e_g.mid, sum });
      const sess = Object.values(agg.session_stats_by_tab || {})[0];
      check("statistiche di sessione presenti", !!sess && sess.counts.text_turn >= 2);

      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        const box = await page.locator("#ai-impact-meter-hud").boundingBox();
        if (box) {
          await page.screenshot({ path: path.join(SHOTS, `hud-pill-${name}.png`), clip: { x: box.x - 20, y: box.y - 20, width: box.width + 40, height: box.height + 40 } });
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await sleep(500);
          const b2 = await page.locator("#ai-impact-meter-hud").boundingBox();
          await page.screenshot({ path: path.join(SHOTS, `hud-${name}.png`), clip: { x: b2.x - 20, y: b2.y - 20, width: b2.width + 40, height: b2.height + 40 } });
        }
      }
      await page.close();
    }

    // Indicatore di streaming bloccato (es. cambio UI del sito): il tracker deve comunque funzionare.
    console.log("\n▶ robustezza");
    await resetAll();
    {
      const page = await context.newPage();
      await page.addInitScript(() =>
        document.addEventListener("DOMContentLoaded", () => document.body.insertAdjacentHTML("beforeend", '<div class="result-streaming">.</div>'))
      );
      await page.goto(MOCKS.chatgpt.url);
      await sleep(1500);
      await page.click("#prompt-textarea");
      await page.keyboard.type("Prompt con indicatore bloccato");
      await page.keyboard.press("Enter");
      const list = await waitFor((l) => l.some((a) => a.type === "text_turn"));
      const t = list.find((a) => a.type === "text_turn");
      check("indicatore di streaming bloccato: turno comunque registrato", !!t && t.prompt_chars === "Prompt con indicatore bloccato".length, t);
      await page.close();
    }

    console.log("\n▶ service worker e interfaccia");
    const page = await context.newPage();
    await page.goto(MOCKS.chatgpt.url);
    await sleep(800);
    const before = (await activities()).length;
    check("attività presenti per i test di export", before > 0);

    // CSV export ben formato
    const csv = await sw.evaluate(async () => self.AIIM_DEBUG.exportCSV((await chrome.storage.local.get("activities")).activities));
    const lines = csv.split("\n");
    check("export CSV: header + una riga per attività", lines.length === before + 1, lines.length);

    // popup e options renderizzano senza errori
    for (const ui of ["popup", "options"]) {
      const p = await context.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
      await p.setViewportSize(ui === "popup" ? { width: 368, height: 900 } : { width: 1100, height: 900 });
      await p.goto(`chrome-extension://${new URL(sw.url()).host}/ui/${ui}.html`);
      await sleep(1200);
      if (ui === "popup") {
        await p.click("[data-scope='total']");
        await sleep(900);
        const co2 = await p.textContent("#co2");
        check("popup: totale mostrato", co2 && co2 !== "--", co2);
        const bars = await p.locator("#breakdown .bar-row").count();
        const providers = new Set((await activities()).map((a) => a.provider)).size;
        check("popup: ripartizione per assistente", bars === providers, { bars, providers });
      } else {
        const presets = await p.locator(".preset").count();
        check("options: 3 scenari", presets === 3, presets);
        await p.fill("input[data-name='kwh_per_1k_tokens_range.min']", "9");
        await sleep(200);
        check("options: validazione min ≤ mid ≤ max", await p.locator(".err:not(.hidden)").count() === 1);
        await p.fill("input[data-name='kwh_per_1k_tokens_range.min']", "0.0005");
        await p.click(".preset[data-key='aggressive']");
        await p.click("#save");
        await sleep(400);
        const s = await sw.evaluate(() => chrome.storage.local.get("settings"));
        check("options: salvataggio scenario", s.settings.presetKey === "aggressive", s.settings.presetKey);
        check("options: nessuna modifica pendente dopo il salvataggio", !(await p.locator("#savebar.show").count()));
      }
      check(`${ui}: nessun errore JS`, errs.length === 0, errs);
      if (SHOTS) {
        await p.screenshot({ path: path.join(SHOTS, `${ui}.png`), fullPage: true });
        await p.emulateMedia({ colorScheme: "dark" });
        await sleep(300);
        await p.screenshot({ path: path.join(SHOTS, `${ui}-dark.png`), fullPage: ui === "popup" });
      }
      await p.close();
    }

    check("service worker senza errori", swErrors.length === 0, swErrors);
    check("content script senza errori", pageErrors.length === 0, pageErrors);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log(`\n${passes} ok, ${failures} falliti`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
