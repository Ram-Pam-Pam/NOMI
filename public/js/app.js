// Start aplikacji NOMI.
import { initAgent, refreshAgentTexts, resetChat } from "./agent.js";
import { getJSON } from "./api.js";
import { applyI18n, t } from "./i18n.js";
import { initMap, invalidate, loadAttractions, locate } from "./map.js";
import { initMapUi } from "./mapui.js";
import { initNavigation } from "./navigation.js";
import { initPlanner, refreshPlannerTexts } from "./planner.js";
import { initProximity } from "./proximity.js";
import { compassNeedsPermission, enableCompass, setDemoPosition, startGeolocation } from "./sensors.js";
import { on, saveSettings, state, store } from "./state.js";
import { initTickets } from "./tickets.js";
import { toast } from "./ui.js";
import { stopSpeaking, unlockSpeech } from "./voice.js";

const $ = (id) => document.getElementById(id);

const TABS = ["planner", "map", "agent"];

function showTab(name) {
  if (!TABS.includes(name)) name = "agent";
  state.activeTab = name;
  store.set("tab", name);
  history.replaceState(null, "", `${location.pathname}${location.search}#${name}`);
  for (const v of document.querySelectorAll(".view")) v.classList.toggle("active", v.dataset.view === name);
  for (const b of document.querySelectorAll(".tab")) b.classList.toggle("active", b.dataset.tab === name);
  if (name === "map") setTimeout(invalidate, 30);
}

// ------------------------------------------------ statusy GPS / kompas

function renderGps(s) {
  const pill = $("pill-gps");
  pill.classList.remove("ok", "warn", "err");
  if (state.settings.demo) pill.classList.add("warn");
  else if (s === "ok") pill.classList.add("ok");
  else if (s === "wait") pill.classList.add("warn");
  else if (s === "denied" || s === "error") pill.classList.add("err");
}

function renderCompass(s) {
  const pill = $("pill-compass");
  pill.classList.remove("ok", "warn", "err");
  if (s === "ok") pill.classList.add("ok");
  else if (s === "denied" || s === "unsupported") pill.classList.add("err");
  $("set-compass").textContent = s === "ok" ? t("enabled") : t("enable");
}

async function requestCompass() {
  unlockSpeech();
  const ok = await enableCompass();
  if (!ok) toast(state.compassStatus === "denied" ? t("compassDenied") : t("compassUnsupported"));
}

// ------------------------------------------------ ustawienia

function syncSettingsUi() {
  const s = state.settings;
  $("set-voice").checked = s.voice;
  $("set-conversation").checked = s.conversation;
  $("set-narrate").checked = s.narrate;
  $("set-tickets").checked = s.tickets;
  $("set-demo").checked = s.demo;
  $("set-lang").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.value === s.lang));
  $("demo-panel").classList.toggle("hidden", !s.demo);
}

function initSettings() {
  const dlg = $("settings-modal");
  $("btn-settings").addEventListener("click", async () => {
    syncSettingsUi();
    dlg.showModal();
    try {
      const h = await getJSON("/api/health");
      $("server-status").textContent = [
        h.transit.ready ? t("serverOk", { day: h.transit.day, stops: h.transit.stops }) : t("serverLoading"),
        h.ai.keyConfigured ? `AI (${h.ai.provider}): ${h.ai.model}` : t("aiMissing"),
      ].join(" ");
    } catch {
      $("server-status").textContent = "";
    }
  });
  $("settings-close").addEventListener("click", () => dlg.close());
  const bind = (id, key) => $(id).addEventListener("change", (e) => saveSettings({ [key]: e.target.checked }));
  bind("set-voice", "voice");
  bind("set-conversation", "conversation");
  bind("set-narrate", "narrate");
  bind("set-tickets", "tickets");
  $("set-demo").addEventListener("change", (e) => {
    saveSettings({ demo: e.target.checked });
    if (e.target.checked && !state.position) setDemoPosition(50.0617, 19.9373, { heading: 0 });
    if (!e.target.checked) startGeolocation();
    renderGps(state.gpsStatus);
  });
  $("set-lang").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) saveSettings({ lang: b.dataset.value });
  });
  $("set-compass").addEventListener("click", requestCompass);
  $("set-reset").addEventListener("click", () => {
    resetChat();
    dlg.close();
  });

  on("settings-patch", (patch) => saveSettings(patch));
  let lang = state.settings.lang;
  on("settings", (s) => {
    syncSettingsUi();
    if (!s.voice) stopSpeaking();
    if (s.lang !== lang) {
      lang = s.lang;
      applyI18n();
      loadAttractions();
      refreshAgentTexts();
      refreshPlannerTexts();
    }
  });
}

// ------------------------------------------------ start

function init() {
  // ?demo – tryb demo (pozycja z mapy), np. do prezentacji na komputerze.
  if (new URLSearchParams(location.search).has("demo") && !state.settings.demo) state.settings.demo = true;
  applyI18n();
  initMap();
  initMapUi();
  initNavigation();
  initTickets();
  initAgent();
  initPlanner();
  initProximity();
  initSettings();
  syncSettingsUi();

  for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => showTab(b.dataset.tab));
  on("show-tab", showTab);
  on("invalidate-map", invalidate);
  const hashTab = location.hash.slice(1);
  showTab(TABS.includes(hashTab) ? hashTab : state.activeTab);
  window.addEventListener("hashchange", () => {
    const tab = location.hash.slice(1);
    if (TABS.includes(tab) && tab !== state.activeTab) showTab(tab);
  });

  on("gps-status", renderGps);
  on("compass-status", renderCompass);
  on("gps-error", (err) => {
    if (err.code === err.PERMISSION_DENIED && !state.settings.demo) toast(t("gpsDenied"), { timeout: 8000 });
  });
  $("pill-gps").addEventListener("click", () => {
    if (state.position) {
      showTab("map");
      setTimeout(locate, 60);
    } else startGeolocation();
  });
  $("pill-compass").addEventListener("click", requestCompass);

  if (state.settings.demo) setDemoPosition(50.0617, 19.9373, { heading: 0 });
  else startGeolocation();
  // Android/desktop: kompas startuje od razu; iOS wymaga dotknięcia (pigułka „Kompas”).
  if (!compassNeedsPermission()) enableCompass();
  else document.addEventListener("click", requestCompassOnce, { once: true });
  renderGps(state.gpsStatus);
  renderCompass(state.compassStatus);
}

function requestCompassOnce() {
  if (state.compassStatus !== "ok") requestCompass();
}

init();
