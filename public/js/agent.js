// Zakładka NOMI: czat tekstowy i głosowy z agentem AI.
// Każda odpowiedź jest sprawdzana przez serwer w oficjalnych źródłach (zdarzenia "verifying" → "verified");
// głos czyta dopiero sprawdzoną wersję, a źródła są wypisane na końcu odpowiedzi.
import { postJSON, streamSSE } from "./api.js";
import { buildContext } from "./context.js";
import { escapeHtml, fmtClock, fmtMinutes, renderMarkdown, stripEmoji } from "./format.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";
import { showPlaces } from "./map.js";
import { presentRoute, renderPlaceList } from "./mapui.js";
import { emit, newSession, on, sessionId, setPref, state, store } from "./state.js";
import { toast } from "./ui.js";
import { isListening, isSpeaking, listen, speak, stopListening, stopSpeaking, sttSupported, unlockSpeech } from "./voice.js";

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
  const on = state.settings.voice;
  const btn = $("btn-tts");
  btn.classList.toggle("on", on);
  btn.innerHTML = icon(on ? "volume" : "volumeX");
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
    else addNomiStatic(m.text, { save: false, narration: m.narration, title: m.title, sources: m.sources, verify: m.verify });
  }
  scrollDown();
}

/** Gotowe pytania tylko na start (potem są podpowiedzi pod odpowiedziami). */
function syncSuggestVisibility() {
  $("chat-suggest").classList.toggle("hidden", history.length > 0);
}

function renderSuggestions() {
  syncSuggestVisibility();
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
  const who = narration
    ? `<span class="kind">${icon("book")}${escapeHtml(t("funFact"))}</span><span>${escapeHtml(title)}</span>`
    : `<span>${escapeHtml(t("nomi"))}</span>`;
  el.innerHTML = `<div class="who"><span class="avatar" aria-hidden="true">N</span>${who}
    <button class="speak" type="button" aria-label="${escapeHtml(t("tellMe"))}">${icon("volume")}</button></div>
    <div class="tools"></div><div class="body"></div><div class="cards"></div><div class="verify-slot"></div>`;
  $("chat").appendChild(el);
  return el;
}

// ------------------------------------------------ przypisy i źródła na końcu odpowiedzi

// Etykiety cytowań [K3], [K3, K5], [K3][K5]; model bywa, że wymyśli inną literę ([C2]) – takie też usuwamy.
const CITE_RE = /\s?[[【]\s*([A-Z]\s*\d+(?:\s*[,;]\s*[A-Z]?\s*\d+)*)\s*[\]】]/g;

/**
 * Odpowiedź z etykietami [K3] → przypisy z linkami; lista źródeł na końcu (także źródła narzędzi bez etykiet:
 * rozkład ZTP, taryfa, strony instytucji). Bez źródeł etykiety po prostu znikają.
 */
function renderAnswer(raw, sources) {
  const text = stripEmoji(raw);
  if (!sources?.length) return renderMarkdown(text.replace(CITE_RE, ""));
  // Kilka fragmentów tej samej strony = jeden przypis.
  const unique = [];
  const index = new Map();
  for (const s of sources) {
    let n = unique.findIndex((u) => u.url === s.url) + 1;
    if (!n) n = unique.push(s);
    if (s.label) index.set(s.label, n);
  }
  const marked = text
    .replace(CITE_RE, (_, labels) => {
      const nums = [...new Set([...labels.matchAll(/K\s*(\d+)/g)].map((m) => index.get(`K${m[1]}`)).filter(Boolean))];
      return nums.map((n) => `\u0001${n}\u0002`).join("");
    })
    .replace(/(\u0001\d+\u0002)\1+/g, "$1"); // [K3][K4] z tej samej strony → jeden przypis
  const html = renderMarkdown(marked).replace(/\u0001(\d+)\u0002/g, (_, n) => {
    const s = unique[n - 1];
    return `<sup class="cite"><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" title="${escapeHtml(s.title)}">${n}</a></sup>`;
  });
  const list = unique
    .map(
      (s) =>
        `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title || s.url)}</a> · ${escapeHtml(s.source)}${s.fetched ? ` · ${escapeHtml(s.fetched)}` : ""}</li>`,
    )
    .join("");
  return `${html}<div class="sources"><div class="sources-h">${t("sources")}</div><ol>${list}</ol></div>`;
}

/** Stan sprawdzenia w źródłach pod odpowiedzią. */
function verifyHtml(status) {
  if (status === "checking") return `<div class="verify checking"><span class="spinner"></span>${escapeHtml(t("verifying"))}</div>`;
  if (status === "ok") return `<div class="verify ok">${icon("shieldCheck")}${escapeHtml(t("verifiedOk"))}</div>`;
  if (status === "corrected") return `<div class="verify corrected">${icon("shieldCheck")}${escapeHtml(t("verifiedFixed"))}</div>`;
  if (status === "unverified") return `<div class="verify unverified">${icon("alert")}${escapeHtml(t("verifiedNone"))}</div>`;
  return "";
}

function setVerify(msgEl, status) {
  msgEl.classList.toggle("checking", status === "checking");
  msgEl.querySelector(".verify-slot").innerHTML = verifyHtml(status);
}

function addNomiStatic(text, { save = true, narration = false, title = "", sources, verify } = {}) {
  const el = nomiShell({ narration, title });
  el.dataset.raw = text;
  el.querySelector(".body").innerHTML = renderAnswer(text, sources);
  if (verify) setVerify(el, verify);
  if (save) {
    history.push({ role: "nomi", text, narration });
    saveHistory();
  }
  return el;
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

function onChatClick(e) {
  const follow = e.target.closest("[data-followup]");
  if (follow) {
    if (!controller) send(follow.dataset.followup);
    return;
  }
  const speakBtn = e.target.closest(".speak");
  if (speakBtn) {
    const msg = speakBtn.closest(".msg");
    stopSpeaking();
    speak(msg.dataset.raw || msg.querySelector(".body").textContent, { force: true });
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
    .map((l) =>
      l.type === "walk"
        ? `<span class="leg-badge walk">${icon("walk")}${Math.max(1, Math.round(l.duration / 60))}</span>`
        : `<span class="leg-badge ${l.mode}">${icon(l.mode)}${escapeHtml(l.line)}</span>`,
    )
    .join(`<span class="sep">${icon("chevronRight")}</span>`);
  const card = document.createElement("div");
  card.className = "inline-card";
  card._payload = { route };
  card.innerHTML = `<div class="head">${icon("route")}${t("routeReady")}: ${escapeHtml(route.to.name || "")}</div>
    <div class="sub">${fmtMinutes(o.duration)} · ${fmtClock(o.departure)}–${fmtClock(o.arrival)}</div>
    <div class="legs-line">${legs}</div>
    ${o.ticket ? `<div class="ticket-line">${icon("ticket")}${escapeHtml(o.ticket.label)} – ${o.ticket.price} zł</div>` : ""}
    <div class="actions"><button class="btn small" type="button" data-card="route-show">${icon("map")}${t("showOnMap")}</button>
    <button class="btn small primary" type="button" data-card="route-start">${icon("navigation")}${t("startNav")}</button></div>`;
  msgEl.querySelector(".cards").appendChild(card);
  if (state.activeTab === "map") presentRoute(route, { switchTab: false });
}

function placesCard(msgEl, places) {
  const card = document.createElement("div");
  card.className = "inline-card";
  card._payload = { places };
  card.innerHTML = `<div class="head">${icon("pin")}${t("placesShown")}</div>
    <div class="sub">${places.map((p) => escapeHtml(p.name)).join(", ")}</div>
    <div class="actions"><button class="btn small primary" type="button" data-card="places-show">${icon("map")}${t("showOnMap")}</button></div>`;
  msgEl.querySelector(".cards").appendChild(card);
}

// ------------------------------------------------ wysyłanie

function setSendButton(busy) {
  const btn = $("btn-send");
  btn.classList.toggle("stop", busy);
  btn.innerHTML = icon(busy ? "stop" : "send");
}

export async function send(text, { voice = false } = {}) {
  if (controller) return;
  unlockSpeech();
  stopSpeaking();
  lastWasVoice = voice;
  clearFollowups();
  addUser(text);
  syncSuggestVisibility();
  const msgEl = nomiShell();
  const bodyEl = msgEl.querySelector(".body");
  const toolsEl = msgEl.querySelector(".tools");
  bodyEl.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  scrollDown();

  controller = new AbortController();
  setSendButton(true);
  let raw = "";
  let roundStart = 0;
  let failed = false;
  let sources = null;
  let followups = null;
  let verify = null; // checking | ok | corrected | unverified
  let spoken = false;
  const render = () => {
    bodyEl.innerHTML = renderAnswer(raw, sources) || '<span class="typing"><i></i><i></i><i></i></span>';
    msgEl.dataset.raw = raw;
    scrollDown();
  };
  // Czytamy dopiero sprawdzoną odpowiedź (bez etykiet i adresów – czyści je voice.js).
  const speakFinal = () => {
    if (spoken || !raw.trim()) return;
    spoken = true;
    speak(stripEmoji(raw));
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
            break;
          case "text_break":
            if (raw && !raw.endsWith("\n\n")) raw += "\n\n";
            roundStart = raw.length;
            break;
          case "retry":
            raw = raw.slice(0, roundStart);
            render();
            break;
          case "tool": {
            const chip = document.createElement("span");
            chip.className = "tool-chip running";
            chip.dataset.id = data.id;
            chip.innerHTML = `<span class="spinner"></span>${escapeHtml(data.label)}`;
            toolsEl.appendChild(chip);
            break;
          }
          case "tool_done": {
            const chip = toolsEl.querySelector(`[data-id="${CSS.escape(data.id)}"]`);
            if (chip) {
              chip.className = `tool-chip ${data.ok ? "done" : "err"}`;
              chip.querySelector(".spinner")?.replaceWith(document.createRange().createContextualFragment(icon(data.ok ? "check" : "alert")));
            }
            break;
          }
          case "verifying":
            verify = "checking";
            setVerify(msgEl, verify);
            break;
          case "verified":
            if (data.text) raw = data.text;
            verify = data.status === "skipped" ? null : data.status;
            setVerify(msgEl, verify);
            render();
            speakFinal();
            break;
          case "action":
            if (data.type === "route") routeCard(msgEl, data.route);
            if (data.type === "markers") placesCard(msgEl, data.places);
            if (data.type === "plan_add") emit("plan-add", data.item);
            if (data.type === "sources") {
              sources = data.sources;
              render();
            }
            if (data.type === "pref") {
              setPref(data.key, data.value);
              toast(data.value ? `${t("prefSaved")}: ${data.value}` : t("prefForgot"), { icon: "check" });
            }
            break;
          case "suggestions":
            followups = data.items;
            break;
          case "notice":
            toast(data.message, { icon: "info" });
            break;
          case "error":
            failed = true;
            msgEl.classList.add("error");
            raw += `${raw ? "\n\n" : ""}${data.message}`;
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
      raw += `${raw ? "\n\n" : ""}${err.message}`;
    }
  } finally {
    controller = null;
    setSendButton(false);
    if (!raw) raw = "…";
    if (verify === "checking") {
      verify = failed ? null : "unverified";
      setVerify(msgEl, verify);
    }
    render();
    if (!failed) {
      speakFinal();
      history.push({ role: "nomi", text: raw, ...(sources ? { sources } : {}), ...(verify ? { verify } : {}) });
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
    onError: (err) => toast(err === "unsupported" ? t("sttUnsupported") : String(err), { icon: "mic" }),
  });
}

function toggleMic() {
  if (isListening()) stopListening();
  else startListening();
}

// ------------------------------------------------ opowieści (wywoływane przez proximity.js)

/** Wiadomość z opowieścią o atrakcji: szkic → (sprawdzenie) → wersja ostateczna ze źródłami. */
export function narrationMessage(title) {
  const el = nomiShell({ narration: true, title });
  const body = el.querySelector(".body");
  body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  scrollDown();
  let raw = "";
  let sources = null;
  let verify = null;
  const render = () => {
    el.dataset.raw = raw;
    body.innerHTML = renderAnswer(raw || "…", sources);
    scrollDown();
  };
  return {
    append(delta) {
      raw += delta;
      render();
    },
    replace(text) {
      raw = text;
      render();
    },
    setSources(list) {
      sources = list;
      render();
    },
    setVerify(status) {
      verify = status === "skipped" ? null : status;
      setVerify(el, verify);
    },
    text: () => raw,
    finish(error) {
      if (error && !raw) raw = error;
      if (verify === "checking") this.setVerify("unverified");
      render();
      if (raw && !error) {
        history.push({ role: "nomi", text: raw, narration: true, title, ...(sources ? { sources } : {}), ...(verify ? { verify } : {}) });
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
  syncSuggestVisibility();
}
