// Zakładka Planer: plan dnia z AI + ręczne dodawanie atrakcji.
import { postJSON } from "./api.js";
import { CATEGORY_EMOJI, KIND_EMOJI, distance, escapeHtml, fmtDistance } from "./format.js";
import { t } from "./i18n.js";
import { attractions, showPlan } from "./map.js";
import { showNearbyPlaces } from "./mapui.js";
import { emit, on, state, store } from "./state.js";
import { toast } from "./ui.js";

const $ = (id) => document.getElementById(id);
const INTERESTS = [
  ["history", "🏰"], ["architecture", "🏛"], ["art", "🎨"], ["museums", "🖼️"], ["churches", "⛪"], ["jewish", "✡️"],
  ["views", "🌅"], ["nature", "🌳"], ["food", "🥟"], ["nightlife", "🍸"], ["kids", "🧒"], ["ww2", "🕯️"],
];
const START_POINTS = {
  rynek: { lat: 50.0617, lon: 19.9373, name: "Rynek Główny" },
  dworzec: { lat: 50.0677, lon: 19.9468, name: "Dworzec Główny" },
};
let discoverTag = "all";
let planController = null;

export function initPlanner() {
  const now = new Date();
  now.setMinutes(now.getMinutes() < 30 ? 30 : 60, 0, 0);
  $("plan-start-time").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  renderInterestChips();

  for (const id of ["plan-hours", "plan-pace", "plan-transport"]) {
    $(id).addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    });
  }
  $("plan-interests").addEventListener("click", (e) => e.target.closest(".chip")?.classList.toggle("on"));
  $("plan-form").addEventListener("submit", (e) => {
    e.preventDefault();
    makePlan();
  });
  $("discover-filter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tag]");
    if (!b) return;
    discoverTag = b.dataset.tag;
    renderDiscover();
  });
  $("plan-result").addEventListener("click", onPlanClick);
  $("discover-list").addEventListener("click", onDiscoverClick);

  on("plan-add", addItem);
  on("attractions", renderDiscover);
  let lastRender = 0;
  on("position", () => {
    if (state.activeTab === "planner" && Date.now() - lastRender > 15000) {
      lastRender = Date.now();
      renderDiscover();
    }
  });
  renderPlan();
}

export function refreshPlannerTexts() {
  renderInterestChips();
  renderDiscover();
  renderPlan();
}

function renderInterestChips() {
  const selected = new Set([...$("plan-interests").querySelectorAll(".chip.on")].map((c) => c.dataset.value));
  $("plan-interests").innerHTML = INTERESTS.map(
    ([id, emoji]) => `<button type="button" class="chip${selected.has(id) ? " on" : ""}" data-value="${id}">${emoji} ${escapeHtml(t(`i_${id}`))}</button>`,
  ).join("");
  $("discover-filter").innerHTML = [["all", "✨"], ...INTERESTS.slice(0, 8)]
    .map(([id, emoji]) => `<button type="button" class="chip${discoverTag === id ? " on" : ""}" data-tag="${id}">${emoji} ${escapeHtml(id === "all" ? t("all") : t(`i_${id}`))}</button>`)
    .join("");
}

const segValue = (id) => $(id).querySelector("button.on")?.dataset.value;

// ------------------------------------------------ plan z AI

async function makePlan() {
  const startSel = $("plan-start-place").value;
  const start =
    startSel === "me" && state.position
      ? { lat: state.position.lat, lon: state.position.lon, name: t("myLocation") }
      : START_POINTS[startSel] || START_POINTS.rynek;
  const btn = $("plan-submit");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${escapeHtml(t("planning"))}`;
  planController?.abort();
  planController = new AbortController();
  try {
    const plan = await postJSON(
      "/api/plan",
      {
        lang: state.settings.lang,
        startTime: $("plan-start-time").value,
        hours: Number(segValue("plan-hours")),
        interests: [...$("plan-interests").querySelectorAll(".chip.on")].map((c) => c.dataset.value),
        pace: segValue("plan-pace"),
        transport: segValue("plan-transport"),
        notes: $("plan-notes").value,
        start,
      },
      { signal: planController.signal },
    );
    plan.stops = plan.stops.map((s, i) => ({ ...s, uid: `${Date.now()}-${i}`, done: false }));
    setPlan(plan);
    if (plan.notice) toast(plan.notice, { timeout: 7000 });
    $("plan-result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    if (err.name !== "AbortError") toast(`${t("error")}: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>${escapeHtml(t("makePlan"))}</span>`;
  }
}

function setPlan(plan) {
  state.plan = plan;
  store.set("plan", plan);
  renderPlan();
}

function addItem(item) {
  const a = item.attraction_id ? attractions.find((x) => x.id === item.attraction_id) : null;
  const plan = state.plan || { title: t("myPlan"), summary: "", stops: [], tips: [], source: "manual" };
  if (plan.stops.some((s) => s.name === item.name)) return;
  plan.stops.push({
    uid: `${Date.now()}`,
    name: item.name,
    attraction_id: item.attraction_id || "",
    kind: a?.category === "museum" ? "museum" : a?.category === "church" ? "church" : "sight",
    lat: item.lat,
    lon: item.lon,
    start_time: "",
    duration_min: item.duration_min || a?.visitMin || 30,
    description: item.note || a?.summary || "",
    tip: a?.tips || "",
    getting_there: "",
    done: false,
  });
  setPlan(plan);
  toast(`${t("added")}: ${item.name}`);
}

function renderPlan() {
  const plan = state.plan;
  const box = $("plan-result");
  if (!plan?.stops?.length) {
    box.innerHTML = "";
    return;
  }
  const stops = plan.stops
    .map((s, i) => {
      const move = s.getting_there ? `<div class="tl-move">${escapeHtml(s.getting_there)}</div>` : "";
      return `${i > 0 || s.getting_there ? `<div class="tl-stop"><div></div>${move}</div>` : ""}
      <div class="tl-stop" data-uid="${s.uid}">
        <div class="tl-time">${escapeHtml(s.start_time || "•")}</div>
        <div class="tl-card${s.done ? " done" : ""}">
          <h4>${KIND_EMOJI[s.kind] || "📍"} ${escapeHtml(s.name)} <span class="dur">${s.duration_min ? `${s.duration_min} min` : ""}</span></h4>
          ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ""}
          ${s.tip ? `<p class="tip">💡 ${escapeHtml(s.tip)}</p>` : ""}
          <div class="actions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            <button class="btn small primary" type="button" data-plan="nav">🧭 ${t("navigate")}</button>
            ${s.kind === "meal" || s.kind === "coffee" ? `<button class="btn small" type="button" data-plan="food">🍽️ ${t("findFood")}</button>` : ""}
            ${s.attraction_id ? `<button class="btn small" type="button" data-plan="narrate">🔊 ${t("tellMe")}</button>` : ""}
            <button class="btn small" type="button" data-plan="done">✓ ${t("visited")}</button>
            <button class="btn small" type="button" data-plan="remove" aria-label="${t("remove")}">✕</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
  box.innerHTML = `<div class="card" style="margin-top:12px">
    <div class="plan-head"><div><h3>${escapeHtml(plan.title)}</h3><p class="muted small" style="margin:0">${escapeHtml(plan.summary || "")}</p></div>
      <span class="badge ${plan.source === "ai" ? "ai" : ""}">${plan.source === "ai" ? "✨ " + t("aiPlan") : t("simplePlan")}</span></div>
    <div class="timeline">${stops}</div>
    ${plan.tips?.length ? `<h4 style="margin:14px 0 4px">${t("planTips")}</h4><ul class="plan-tips">${plan.tips.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
    <div class="plan-actions">
      <button class="btn small primary" type="button" data-plan="map">🗺 ${t("showPlan")}</button>
      <button class="btn small" type="button" data-plan="clear">${t("clearPlan")}</button>
    </div></div>`;
}

function onPlanClick(e) {
  const b = e.target.closest("[data-plan]");
  if (!b) return;
  const act = b.dataset.plan;
  const plan = state.plan;
  if (act === "map") {
    emit("show-tab", "map");
    setTimeout(() => showPlan(plan.stops), 80);
    return;
  }
  if (act === "clear") {
    setPlan(null);
    showPlan([]);
    return;
  }
  const uid = b.closest("[data-uid]")?.dataset.uid;
  const stop = plan.stops.find((s) => s.uid === uid);
  if (!stop) return;
  if (act === "nav") emit("route-request", { to: { lat: stop.lat, lon: stop.lon, name: stop.name } });
  if (act === "food") showNearbyPlaces(stop.kind === "coffee" ? "cafe" : "restaurant", { lat: stop.lat, lon: stop.lon });
  if (act === "narrate") emit("narrate-request", stop.attraction_id);
  if (act === "done") {
    stop.done = !stop.done;
    setPlan(plan);
  }
  if (act === "remove") {
    plan.stops = plan.stops.filter((s) => s !== stop);
    setPlan(plan.stops.length ? plan : null);
  }
}

// ------------------------------------------------ odkrywaj

function renderDiscover() {
  renderInterestChips();
  const pos = state.position;
  const list = attractions
    .filter((a) => discoverTag === "all" || a.tags.includes(discoverTag))
    .map((a) => ({ a, d: pos ? distance(pos, a) : null }))
    .sort((x, y) => (x.d ?? 0) - (y.d ?? 0) || 0)
    .slice(0, 25);
  $("discover-list").innerHTML = list
    .map(
      ({ a, d }) => `<div class="item" data-id="${a.id}">
        <div class="emoji">${CATEGORY_EMOJI[a.category] || "📍"}</div>
        <div><h4>${escapeHtml(a.name)}</h4>
          <div class="meta">${escapeHtml(a.categoryLabel || "")} · ${escapeHtml(a.district)}${d !== null ? ` · ${fmtDistance(d)}` : ""} · ~${a.visitMin} min</div>
          <p>${escapeHtml(a.summary)}</p>
          <div class="actions">
            <button class="btn small primary" type="button" data-d="nav">🧭 ${t("navigate")}</button>
            <button class="btn small" type="button" data-d="narrate">🔊 ${t("tellMe")}</button>
            <button class="btn small" type="button" data-d="plan">＋ ${t("addToPlan")}</button>
          </div></div></div>`,
    )
    .join("");
}

function onDiscoverClick(e) {
  const b = e.target.closest("[data-d]");
  if (!b) return;
  const a = attractions.find((x) => x.id === b.closest("[data-id]").dataset.id);
  if (!a) return;
  if (b.dataset.d === "nav") emit("route-request", { to: { lat: a.lat, lon: a.lon, name: a.name } });
  if (b.dataset.d === "narrate") {
    emit("narrate-request", a.id);
    emit("show-tab", "agent");
  }
  if (b.dataset.d === "plan") addItem({ name: a.name, lat: a.lat, lon: a.lon, attraction_id: a.id });
}
