// Zakładka NOMI: czat tekstowy i głosowy z agentem AI.
// Najpierw sprawdzenie, potem odpowiedź: serwer sprawdza odpowiedź w oficjalnych źródłach ZANIM ją wyśle
// (w międzyczasie stan: myślę → narzędzia → sprawdzam), po czym przychodzi jedna gotowa odpowiedź ("answer")
// ze źródłami na końcu – bez podmieniania tekstu w trakcie i bez urwanych fragmentów.
import { postJSON, streamSSE } from "./api.js";
import { buildContext } from "./context.js";
import { escapeHtml, fmtClock, fmtMinutes, renderMarkdown, stripEmoji } from "./format.js";
import { t } from "./i18n.js";
import { LOGO, icon } from "./icons.js";
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

// Podstawowe pytania – zawsze pod ręką nad polem wpisywania (jedno dotknięcie = pytanie do NOMI).
const QUICK = [
  ["s1", "eye"],
  ["s5", "book"],
  ["s2", "utensils"],
  ["s3", "tram"],
  ["s4", "ticket"],
  ["s6", "calendar"],
  ["s7", "sun"],
  ["s8", "compass"],
];

/** W trakcie odpowiedzi pasek jest przygaszony (kolejne pytanie – po odpowiedzi). */
function syncSuggestBusy() {
  $("chat-suggest").classList.toggle("busy", Boolean(controller));
}

function renderSuggestions() {
  $("chat-suggest").innerHTML = QUICK.map(
    ([k, ic]) => `<button class="chip" type="button" data-suggest="${k}">${icon(ic)}${escapeHtml(t(k))}</button>`,
  ).join("");
  $("chat-suggest").onclick = (e) => {
    const b = e.target.closest("[data-suggest]");
    if (b && !controller) send(t(b.dataset.suggest));
  };
  syncSuggestBusy();
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
  el.innerHTML = `<div class="who"><span class="avatar" aria-hidden="true">${LOGO}</span>${who}
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

/** Wynik sprawdzenia w źródłach pod gotową odpowiedzią. */
function verifyHtml(status) {
  if (status === "ok") return `<div class="verify ok">${icon("shieldCheck")}${escapeHtml(t("verifiedOk"))}</div>`;
  if (status === "corrected") return `<div class="verify corrected">${icon("shieldCheck")}${escapeHtml(t("verifiedFixed"))}</div>`;
  if (status === "unverified") return `<div class="verify unverified">${icon("alert")}${escapeHtml(t("verifiedNone"))}</div>`;
  return "";
}

function setVerify(msgEl, status) {
  msgEl.querySelector(".verify-slot").innerHTML = verifyHtml(status);
}

/** Stan oczekiwania na odpowiedź: kropki + co NOMI teraz robi (myśli, sprawdza w źródłach…). */
function pendingHtml(text) {
  return `<div class="pending"><span class="typing"><i></i><i></i><i></i></span><span class="pending-text">${escapeHtml(text)}</span></div>`;
}

function setPending(bodyEl, text) {
  const el = bodyEl.querySelector(".pending-text");
  if (el) el.textContent = text;
  else bodyEl.innerHTML = pendingHtml(text);
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Pokazuje gotową odpowiedź płynnie (szybkie odsłanianie, ok. 0,8 s niezależnie od długości).
 * W trakcie bez przypisów i niedokończonych etykiet; na końcu pełny render ze źródłami.
 */
function reveal(bodyEl, text, finalHtml, onStep) {
  if (reducedMotion() || document.hidden || text.length < 40) {
    bodyEl.innerHTML = finalHtml;
    onStep?.();
    return;
  }
  const step = Math.max(6, Math.ceil(text.length / 48));
  let n = 0;
  const tick = () => {
    n = Math.min(text.length, n + step);
    if (n >= text.length) {
      bodyEl.innerHTML = finalHtml;
      onStep?.();
      return;
    }
    const cut = text.lastIndexOf(" ", n) > 0 ? text.slice(0, text.lastIndexOf(" ", n)) : text.slice(0, n);
    bodyEl.innerHTML = renderAnswer(cut.replace(/\[[^\]]*$/, ""), null);
    onStep?.();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
  const msgEl = nomiShell();
  const bodyEl = msgEl.querySelector(".body");
  const toolsEl = msgEl.querySelector(".tools");
  bodyEl.innerHTML = pendingHtml(t("thinking"));
  scrollDown();

  controller = new AbortController();
  setSendButton(true);
  syncSuggestBusy();
  let raw = ""; // gotowa (sprawdzona) odpowiedź – serwer wysyła ją w całości
  let answered = false;
  let failed = false;
  let sources = null;
  let followups = null;
  let verify = null; // ok | corrected | unverified
  const render = () => {
    bodyEl.innerHTML = renderAnswer(raw, sources);
    msgEl.dataset.raw = raw;
    scrollDown();
  };

  try {
    await streamSSE(
      "/api/chat",
      { sessionId: sessionId(), message: text, context: buildContext() },
      (event, data) => {
        switch (event) {
          case "status":
            setPending(bodyEl, t("thinking"));
            break;
          case "tool": {
            const chip = document.createElement("span");
            chip.className = "tool-chip running";
            chip.dataset.id = data.id;
            chip.innerHTML = `<span class="spinner"></span>${escapeHtml(data.label)}`;
            toolsEl.appendChild(chip);
            setPending(bodyEl, `${data.label}…`);
            scrollDown();
            break;
          }
          case "tool_done": {
            const chip = toolsEl.querySelector(`[data-id="${CSS.escape(data.id)}"]`);
            if (chip) {
              chip.className = `tool-chip ${data.ok ? "done" : "err"}`;
              chip.querySelector(".spinner")?.replaceWith(document.createRange().createContextualFragment(icon(data.ok ? "check" : "alert")));
            }
            setPending(bodyEl, t("thinking"));
            break;
          }
          case "verifying":
            setPending(bodyEl, t("verifying"));
            break;
          case "answer":
            // Jedna, gotowa odpowiedź (już sprawdzona) – głos rusza od razu, tekst odsłania się płynnie.
            answered = true;
            raw = data.text || "";
            verify = data.status === "skipped" ? null : data.status;
            msgEl.dataset.raw = raw;
            if (raw.trim()) speak(stripEmoji(raw));
            reveal(bodyEl, raw, renderAnswer(raw, sources), scrollDown);
            setVerify(msgEl, verify);
            break;
          case "text":
            // Zgodność wstecz (serwer bez zdarzenia "answer").
            raw += data.delta;
            render();
            break;
          case "action":
            if (data.type === "route") routeCard(msgEl, data.route);
            if (data.type === "markers") placesCard(msgEl, data.places);
            if (data.type === "plan_add") emit("plan-add", data.item);
            if (data.type === "sources") sources = data.sources;
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
            raw = data.message;
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
      raw = err.message;
      render();
    }
  } finally {
    controller = null;
    setSendButton(false);
    syncSuggestBusy();
    if (!answered && !failed) {
      // Przerwane przez użytkownika albo brak odpowiedzi – bez wiszących kropek.
      raw = raw || "…";
      render();
    }
    if (!failed && raw.trim() && raw !== "…") {
      if (!answered) speak(stripEmoji(raw));
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

/** Wiadomość z opowieścią o atrakcji: najpierw stan („przygotowuję, sprawdzam”), potem gotowa wersja ze źródłami. */
export function narrationMessage(title) {
  const el = nomiShell({ narration: true, title });
  const body = el.querySelector(".body");
  body.innerHTML = pendingHtml(t("preparingStory"));
  scrollDown();
  let raw = "";
  let sources = null;
  let verify = null;
  return {
    pending(text) {
      setPending(body, text);
    },
    /** Gotowa, sprawdzona opowieść. */
    show(text, status) {
      raw = text || "";
      verify = status === "skipped" ? null : status;
      el.dataset.raw = raw;
      reveal(body, raw, renderAnswer(raw || "…", sources), scrollDown);
      setVerify(el, verify);
    },
    append(delta) {
      // Zgodność wstecz (serwer bez zdarzenia "answer").
      raw += delta;
      el.dataset.raw = raw;
      body.innerHTML = renderAnswer(raw, sources);
    },
    setSources(list) {
      sources = list;
    },
    text: () => raw,
    finish(error) {
      if (error && !raw) {
        raw = error;
        body.innerHTML = renderAnswer(raw, null);
      }
      if (!raw) body.innerHTML = renderAnswer("…", null);
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
}
