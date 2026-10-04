// Zakładka NOMI: czat tekstowy i głosowy z agentem AI.
import { postJSON, streamSSE } from "./api.js";
import { buildContext } from "./context.js";
import { MODE_EMOJI, escapeHtml, fmtClock, fmtMinutes, renderMarkdown } from "./format.js";
import { t } from "./i18n.js";
import { showPlaces } from "./map.js";
import { presentRoute, renderPlaceList } from "./mapui.js";
import { emit, newSession, on, sessionId, setPref, state, store } from "./state.js";
import { toast } from "./ui.js";
import {
  flushSpeech,
  isListening,
  isSpeaking,
  listen,
  speak,
  speakStream,
  stopListening,
  stopSpeaking,
  sttSupported,
  unlockSpeech,
} from "./voice.js";

const $ = (id) => document.getElementById(id);
let controller = null;
let history = store.get("chat", []);
let lastWasVoice = false;

export const agentBusy = () => Boolean(controller);

export function initAgent() {
  renderHistory();
  renderSuggestions();

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    if (controller) return controller.abort();
    const text = $("chat-input").value.trim();
    if (!text) return;
    $("chat-input").value = "";
    autoSize();
    send(text);
  });
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("composer").requestSubmit();
    }
  });
  $("chat-input").addEventListener("input", autoSize);
  $("btn-mic").addEventListener("click", toggleMic);
  $("btn-tts").addEventListener("click", () => {
    const voice = !state.settings.voice;
    emit("settings-patch", { voice });
    if (!voice) stopSpeaking();
  });
  on("settings", syncButtons);
  on("listening", (v) => {
    $("btn-mic").classList.toggle("recording", v);
    $("listening").classList.toggle("hidden", !v);
  });
  // Tryb rozmowy: po zakończeniu czytania odpowiedzi słuchamy dalej.
  on("speaking", (v) => {
    if (!v && state.settings.conversation && lastWasVoice && !controller && !isListening() && state.activeTab === "agent") {
      setTimeout(() => !isSpeaking() && !controller && startListening(), 400);
    }
  });
  $("chat").addEventListener("click", onChatClick);
  syncButtons();
}

function autoSize() {
  const el = $("chat-input");
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

function syncButtons() {
  $("btn-tts").classList.toggle("on", state.settings.voice);
}

function scrollDown() {
  const c = $("chat");
  c.scrollTop = c.scrollHeight;
}

// ------------------------------------------------ wiadomości

function saveHistory() {
  history = history.slice(-40);
  store.set("chat", history);
}

function renderHistory() {
  $("chat").innerHTML = "";
  addNomiStatic(t("welcome"), { save: false });
  for (const m of history) {
    if (m.role === "user") addUser(m.text, { save: false });
    else addNomiStatic(m.text, { save: false, narration: m.narration, sources: m.sources });
  }
  scrollDown();
}

// ------------------------------------------------ przypisy do oficjalnych źródeł

// Etykiety cytowań [K3], [K3, K5], [K3][K5]; model bywa, że wymyśli inną literę ([C2]) – takie też usuwamy.
const CITE_RE = /\s?\[([A-Z]\d+(?:\s*[,;]\s*[A-Z]?\d+)*)\]/g;

/** Odpowiedź z etykietami [K3] → przypisy z linkami do oficjalnych stron (bez źródeł – etykiety znikają). */
function renderAnswer(raw, sources) {
  if (!sources?.length) return renderMarkdown(String(raw).replace(CITE_RE, ""));
  // Kilka fragmentów tej samej strony = jeden przypis.
  const unique = [];
  const index = new Map();
  for (const s of sources) {
    let n = unique.findIndex((u) => u.url === s.url) + 1;
    if (!n) n = unique.push(s);
    index.set(s.label, n);
  }
  const marked = String(raw).replace(CITE_RE, (_, labels) => {
    const nums = [...new Set([...labels.matchAll(/K(\d+)/g)].map((m) => index.get(`K${m[1]}`)).filter(Boolean))];
    return nums.map((n) => `\u0001${n}\u0002`).join("");
  }).replace(/(\u0001\d+\u0002)\1+/g, "$1"); // [K3][K4] z tej samej strony → jeden przypis
  const html = renderMarkdown(marked).replace(/(?:\u0001(\d+)\u0002)/g, (_, n) => {
    const s = unique[n - 1];
    return `<sup class="cite"><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" title="${escapeHtml(s.title)}">${n}</a></sup>`;
  });
  const list = unique
    .map(
      (s) =>
        `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title || s.url)}</a> <span>· ${escapeHtml(s.source)}${s.fetched ? ` · ${escapeHtml(s.fetched)}` : ""}</span></li>`,
    )
    .join("");
  return `${html}<div class="sources"><b>${t("sources")}</b><ol>${list}</ol></div>`;
}

// ------------------------------------------------ podpowiedzi kolejnych pytań

function clearFollowups() {
  $("chat").querySelectorAll(".followups").forEach((el) => el.remove());
}

function renderFollowups(msgEl, items) {
  clearFollowups();
  if (!items?.length) return;
  const box = document.createElement("div");
  box.className = "followups chips small";
  box.innerHTML = items.map((s) => `<button class="chip" type="button" data-followup="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join("");
  msgEl.after(box);
  scrollDown();
}

function renderSuggestions() {
  $("chat-suggest").innerHTML = ["s1", "s2", "s3", "s4", "s5", "s6"]
    .map((k) => `<button class="chip" type="button" data-suggest="${k}">${escapeHtml(t(k))}</button>`)
    .join("");
  $("chat-suggest").onclick = (e) => {
    const b = e.target.closest("[data-suggest]");
    if (b && !controller) send(t(b.dataset.suggest));
  };
}

export function refreshAgentTexts() {
  renderHistory();
  renderSuggestions();
}

function addUser(text, { save = true } = {}) {
  const el = document.createElement("div");
  el.className = "msg user";
  el.textContent = text;
  $("chat").appendChild(el);
  if (save) {
    history.push({ role: "user", text });
    saveHistory();
  }
  scrollDown();
}

function nomiShell({ narration = false, title = "" } = {}) {
  const el = document.createElement("div");
  el.className = `msg nomi${narration ? " narration" : ""}`;
  el.innerHTML = `<div class="who"><span>${narration ? "📍 " : ""}${escapeHtml(title || t("nomi"))}</span>
    <button class="speak" type="button" aria-label="Czytaj"><svg viewBox="0 0 24 24"><path d="M3 10v4h4l5 5V5L7 10H3Zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4Z"/></svg></button></div>
    <div class="tools"></div><div class="body"></div><div class="cards"></div>`;
  $("chat").appendChild(el);
  return el;
}

function addNomiStatic(text, { save = true, narration = false, sources } = {}) {
  const el = nomiShell({ narration });
  el.dataset.raw = text;
  el.querySelector(".body").innerHTML = renderAnswer(text, sources);
  if (save) {
    history.push({ role: "nomi", text, narration });
    saveHistory();
  }
  return el;
}

function onChatClick(e) {
  const follow = e.target.closest("[data-followup]");
  if (follow) {
    if (!controller) send(follow.dataset.followup);
    return;
  }
  const speakBtn = e.target.closest(".speak");
  if (speakBtn) {
    const raw = speakBtn.closest(".msg").dataset.raw || speakBtn.closest(".msg").querySelector(".body").textContent;
    stopSpeaking();
    speak(raw, { force: true });
    return;
  }
  const btn = e.target.closest("[data-card]");
  if (!btn) return;
  const payload = btn.closest(".inline-card")._payload;
  if (btn.dataset.card === "route-show") presentRoute(payload.route);
  if (btn.dataset.card === "route-start") {
    presentRoute(payload.route);
    emit("nav-start", { route: payload.route, index: 0 });
  }
  if (btn.dataset.card === "places-show") {
    emit("show-tab", "map");
    setTimeout(() => {
      showPlaces(payload.places);
      renderPlaceList(payload.places, "restaurant", t("placesShown"));
    }, 60);
  }
}

// ------------------------------------------------ karty akcji agenta

function routeCard(msgEl, route) {
  const o = route.options[0];
  if (!o) return;
  const legs = o.legs
    .map((l) => (l.type === "walk" ? `🚶 ${Math.max(1, Math.round(l.duration / 60))}` : `${MODE_EMOJI[l.mode]} ${escapeHtml(l.line)}`))
    .join(" › ");
  const card = document.createElement("div");
  card.className = "inline-card";
  card._payload = { route };
  card.innerHTML = `<b>🧭 ${t("routeReady")}: ${escapeHtml(route.to.name || "")}</b><br/>
    ${fmtMinutes(o.duration)} · ${fmtClock(o.departure)}–${fmtClock(o.arrival)} · ${legs}
    ${o.ticket ? `<br/><span class="ticket-line">🎟️ ${escapeHtml(o.ticket.label)} – ${o.ticket.price} zł</span>` : ""}
    <div class="actions"><button class="btn small" type="button" data-card="route-show">🗺 ${t("showOnMap")}</button>
    <button class="btn small primary" type="button" data-card="route-start">▶ ${t("startNav")}</button></div>`;
  msgEl.querySelector(".cards").appendChild(card);
  if (state.activeTab === "map") presentRoute(route, { switchTab: false });
}

function placesCard(msgEl, places) {
  const card = document.createElement("div");
  card.className = "inline-card";
  card._payload = { places };
  card.innerHTML = `<b>📍 ${t("placesShown")}</b>: ${places.map((p) => escapeHtml(p.name)).join(", ")}
    <div class="actions"><button class="btn small primary" type="button" data-card="places-show">🗺 ${t("showOnMap")}</button></div>`;
  msgEl.querySelector(".cards").appendChild(card);
}

// ------------------------------------------------ wysyłanie

export async function send(text, { voice = false } = {}) {
  if (controller) return;
  unlockSpeech();
  stopSpeaking();
  lastWasVoice = voice;
  clearFollowups();
  addUser(text);
  const msgEl = nomiShell();
  const bodyEl = msgEl.querySelector(".body");
  const toolsEl = msgEl.querySelector(".tools");
  bodyEl.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  scrollDown();

  controller = new AbortController();
  $("btn-send").classList.add("stop");
  let raw = "";
  let roundStart = 0;
  let failed = false;
  let sources = null;
  let followups = null;
  const render = () => {
    bodyEl.innerHTML = renderAnswer(raw, sources) || '<span class="typing"><i></i><i></i><i></i></span>';
    msgEl.dataset.raw = raw;
    scrollDown();
  };

  try {
    await streamSSE(
      "/api/chat",
      { sessionId: sessionId(), message: text, context: buildContext() },
      (event, data) => {
        switch (event) {
          case "text":
            raw += data.delta;
            render();
            speakStream(data.delta);
            break;
          case "text_break":
            if (raw && !raw.endsWith("\n\n")) raw += "\n\n";
            roundStart = raw.length;
            flushSpeech();
            break;
          case "retry":
            raw = raw.slice(0, roundStart);
            render();
            break;
          case "tool": {
            const chip = document.createElement("span");
            chip.className = "tool-chip running";
            chip.dataset.id = data.id;
            chip.textContent = data.label;
            toolsEl.appendChild(chip);
            break;
          }
          case "tool_done": {
            const chip = toolsEl.querySelector(`[data-id="${CSS.escape(data.id)}"]`);
            chip?.classList.remove("running");
            chip?.classList.add(data.ok ? "done" : "err");
            break;
          }
          case "action":
            if (data.type === "route") routeCard(msgEl, data.route);
            if (data.type === "markers") placesCard(msgEl, data.places);
            if (data.type === "plan_add") emit("plan-add", data.item);
            if (data.type === "sources") sources = data.sources;
            if (data.type === "pref") {
              setPref(data.key, data.value);
              toast(data.value ? `🧠 ${t("prefSaved")}: ${data.value}` : `🧠 ${t("prefForgot")}`);
            }
            break;
          case "suggestions":
            followups = data.items;
            break;
          case "notice":
            toast(data.message);
            break;
          case "error":
            failed = true;
            msgEl.classList.add("error");
            raw += `${raw ? "\n\n" : ""}⚠ ${data.message}`;
            render();
            break;
        }
      },
      { signal: controller.signal },
    );
  } catch (err) {
    if (err.name !== "AbortError") {
      failed = true;
      msgEl.classList.add("error");
      raw += `${raw ? "\n\n" : ""}⚠ ${err.message}`;
    }
  } finally {
    flushSpeech();
    controller = null;
    $("btn-send").classList.remove("stop");
    if (!raw) raw = "…";
    render();
    if (!failed) {
      history.push({ role: "nomi", text: raw, ...(sources ? { sources } : {}) });
      saveHistory();
      renderFollowups(msgEl, followups);
    }
  }
}

// ------------------------------------------------ mikrofon

function startListening() {
  if (!sttSupported) return toast(t("sttUnsupported"));
  unlockSpeech();
  stopSpeaking();
  $("interim").textContent = t("listening");
  listen({
    onInterim: (txt) => ($("interim").textContent = txt || t("listening")),
    onFinal: (txt) => send(txt, { voice: true }),
    onError: (err) => toast(err === "unsupported" ? t("sttUnsupported") : `🎤 ${err}`),
  });
}

function toggleMic() {
  if (isListening()) stopListening();
  else startListening();
}

// ------------------------------------------------ narracje (wywoływane przez proximity.js)

export function narrationMessage(title) {
  const el = nomiShell({ narration: true, title });
  const body = el.querySelector(".body");
  body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  scrollDown();
  let raw = "";
  return {
    append(delta) {
      raw += delta;
      el.dataset.raw = raw;
      body.innerHTML = renderMarkdown(raw);
      scrollDown();
    },
    finish(error) {
      if (error && !raw) raw = `⚠ ${error}`;
      body.innerHTML = renderMarkdown(raw || "…");
      if (raw && !error) {
        history.push({ role: "nomi", text: `**${title}**\n\n${raw}`, narration: true });
        saveHistory();
      }
    },
  };
}

export async function resetChat() {
  controller?.abort();
  try {
    await postJSON("/api/chat/reset", { sessionId: sessionId() });
  } catch {
    /* serwer mógł nie znać sesji */
  }
  newSession();
  history = [];
  saveHistory();
  renderHistory();
}
