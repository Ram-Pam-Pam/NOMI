// Zakładka Planer: prosty kreator planu dnia (AI) i plan jako trasa: pieszo / tramwaj / autobus.
import { getJSON, postJSON } from "./api.js";
import { CATEGORY_EMOJI, KIND_EMOJI, MODE_EMOJI, distance, escapeHtml, fmtClock, fmtDistance } from "./format.js";
import { t } from "./i18n.js";
import { attractions, clearPlan, flyTo, focusPlanLeg, planVisible, showPlan } from "./map.js";
import { showNearbyPlaces } from "./mapui.js";
import { emit, on, state, store } from "./state.js";
import { toast } from "./ui.js";

const $ = (id) => document.getElementById(id);

// Jeden przycisk zainteresowań może obejmować kilka tagów atrakcji.
const INTERESTS = [
  { id: "history", emoji: "🏰", tags: ["history", "architecture"] },
  { id: "museums", emoji: "🖼️", tags: ["museums", "art"] },
  { id: "churches", emoji: "⛪", tags: ["churches"] },
  { id: "jewish", emoji: "✡️", tags: ["jewish"] },
  { id: "views", emoji: "🌅", tags: ["views", "nature"] },
  { id: "food", emoji: "🥟", tags: ["food"] },
  { id: "kids", emoji: "🧒", tags: ["kids"] },
  { id: "ww2", emoji: "🕯️", tags: ["ww2"] },
];
const START_POINTS = {
  rynek: { lat: 50.0617, lon: 19.9373, name: "Rynek Główny" },
  dworzec: { lat: 50.0677, lon: 19.9468, name: "Dworzec Główny" },
};
let discoverTag = "all";
let planController = null;
let rerouteTimer = null;
let openStop = null; // uid rozwiniętej karty punktu

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Odmiana liczebników (pl: 1 / 2–4 / 5+).
const FORMS = {
  pl: { places: ["miejsce", "miejsca", "miejsc"], rides: ["przejazd", "przejazdy", "przejazdów"] },
  en: { places: ["place", "places", "places"], rides: ["ride", "rides", "rides"] },
};
function count(n, key) {
  const f = FORMS[state.settings.lang === "en" ? "en" : "pl"][key];
  if (n === 1) return `${n} ${f[0]}`;
  const d = n % 10;
  const dd = n % 100;
  return `${n} ${d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? f[1] : f[2]}`;
}

// ------------------------------------------------ start

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
  $("plan-result").addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button]")) {
      e.preventDefault();
      e.target.click();
    }
  });
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
  if (!$("plan-interests").children.length) ["history", "museums"].forEach((x) => selected.add(x));
  $("plan-interests").innerHTML = INTERESTS.map(
    (i) => `<button type="button" class="chip${selected.has(i.id) ? " on" : ""}" data-value="${i.id}">${i.emoji} ${escapeHtml(t(`i_${i.id}`))}</button>`,
  ).join("");
  $("discover-filter").innerHTML = [{ id: "all", emoji: "✨" }, ...INTERESTS]
    .map((i) => `<button type="button" class="chip${discoverTag === i.id ? " on" : ""}" data-tag="${i.id}">${i.emoji} ${escapeHtml(i.id === "all" ? t("all") : t(`i_${i.id}`))}</button>`)
    .join("");
}

const segValue = (id) => $(id).querySelector("button.on")?.dataset.value;

// ------------------------------------------------ tworzenie planu

async function makePlan() {
  const startSel = $("plan-start-place").value;
  const start =
    startSel === "me" && state.position
      ? { lat: state.position.lat, lon: state.position.lon, name: t("myLocation") }
      : START_POINTS[startSel] || START_POINTS.rynek;
  const interests = [...$("plan-interests").querySelectorAll(".chip.on")].flatMap(
    (c) => INTERESTS.find((i) => i.id === c.dataset.value)?.tags || [],
  );
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
        interests,
        pace: segValue("plan-pace"),
        transport: segValue("plan-transport"),
        notes: $("plan-notes").value,
        start,
      },
      { signal: planController.signal },
    );
    plan.stops = plan.stops.map((s) => ({ ...s, uid: uid(), done: false }));
    openStop = null;
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
  // Plan na mapie aktualizujemy tylko, jeśli użytkownik go tam wyświetlił.
  if (planVisible()) {
    if (plan) showPlan(plan, { fit: false });
    else clearPlan();
  }
}

/** Przelicza trasy i harmonogram po zmianie punktów (z opóźnieniem – kilka zmian = jedno zapytanie). */
function reroute() {
  const plan = state.plan;
  if (!plan) return;
  plan.rerouting = true;
  renderPlan();
  clearTimeout(rerouteTimer);
  rerouteTimer = setTimeout(async () => {
    try {
      const routed = await postJSON("/api/plan/route", {
        title: plan.title,
        summary: plan.summary,
        tips: plan.tips,
        source: plan.source,
        stops: plan.stops,
        start: plan.start,
        startTime: plan.params?.start_time || plan.stats?.start_time,
        transport: plan.params?.transport,
        lang: state.settings.lang,
      });
      setPlan({ ...routed, rerouting: false });
    } catch (err) {
      plan.rerouting = false;
      setPlan(plan);
      toast(`${t("error")}: ${err.message}`);
    }
  }, 400);
}

async function addItem(item) {
  const a = item.attraction_id ? attractions.find((x) => x.id === item.attraction_id) : null;
  let plan = state.plan;
  if (!plan) {
    const now = new Date();
    plan = {
      title: t("myPlan"),
      summary: "",
      stops: [],
      tips: [],
      source: "manual",
      start: state.position ? { lat: state.position.lat, lon: state.position.lon, name: t("myLocation") } : START_POINTS.rynek,
      params: { start_time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, transport: "mixed" },
    };
  }
  if (plan.stops.some((s) => s.name === item.name)) return toast(`${t("alreadyInPlan")}: ${item.name}`);
  plan.stops.push({
    uid: uid(),
    name: item.name,
    attraction_id: item.attraction_id || "",
    kind: a?.category === "museum" ? "museum" : a?.category === "church" ? "church" : "sight",
    lat: item.lat,
    lon: item.lon,
    start_time: "",
    duration_min: item.duration_min || a?.visitMin || 30,
    description: item.note || a?.summary || "",
    tip: "",
    done: false,
  });
  state.plan = plan;
  toast(`${t("added")}: ${item.name}`);
  reroute();
}

// ------------------------------------------------ dane z oficjalnych źródeł

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Godziny, ceny i źródła z oficjalnych stron (dane z serwera, nie z modelu AI). */
export function renderOfficial(o, { open = false } = {}) {
  if (!o) return "";
  const hours = (o.opening_hours || [])
    .map((h) => `<li>${h.what ? `<b>${escapeHtml(h.what)}:</b> ` : ""}${escapeHtml([h.period, h.days, h.hours].filter(Boolean).join(" · "))}</li>`)
    .join("");
  const priceItem = (p) => `<li>${escapeHtml(p.ticket)}: <b>${escapeHtml(p.price)}</b></li>`;
  const allPrices = o.prices || [];
  // Najważniejsze bilety od razu, ulgi szczególne (karty miejskie itp.) po rozwinięciu.
  const prices =
    allPrices.slice(0, 5).map(priceItem).join("") +
    (allPrices.length > 5
      ? `<li class="more-li"><details><summary>${t("morePrices")} (${allPrices.length - 5})</summary><ul>${allPrices.slice(5).map(priceItem).join("")}</ul></details></li>`
      : "");
  const extra = [
    o.closed?.length ? `${t("closedLabel")}: ${o.closed.join(", ")}` : "",
    o.last_entry ? `${t("lastEntry")}: ${o.last_entry}` : "",
    o.free_entry ? `${t("freeEntry")}: ${o.free_entry}` : "",
    o.booking || "",
  ].filter(Boolean);
  const src = (o.sources || []).map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(host(u))}</a>`).join(", ");
  return `<details class="official"${open ? " open" : ""}><summary>🏛️ ${t("officialInfo")}</summary>
    ${hours ? `<div class="official-h">${t("hoursLabel")}</div><ul>${hours}</ul>` : `<p class="muted">${t("noOfficialHours")}</p>`}
    ${prices ? `<div class="official-h">${t("pricesLabel")}</div><ul>${prices}</ul>` : ""}
    ${extra.map((x) => `<p>${escapeHtml(x)}</p>`).join("")}
    <p class="official-src">${t("sourceLabel")}: ${src}${o.fetched ? ` · ${t("fetchedLabel")} ${escapeHtml(o.fetched)}` : ""}</p>
  </details>`;
}

// ------------------------------------------------ plan jako trasa

const legMinutes = (l) => Math.max(1, Math.round(l.duration / 60));

/** Odcinek między punktami: ikony środków transportu, czas, dystans pieszo, wolny czas. */
function legHtml(leg, stop, i) {
  const wait = stop.wait_min ? `<span class="wait">⏳ ${escapeHtml(t("freeTime", { n: stop.wait_min }))}</span>` : "";
  if (!leg) {
    return `<li class="it-leg same"><span class="it-line"></span><div class="it-leg-body muted small">${t("onSpot")} ${wait}</div></li>`;
  }
  const parts = leg.legs
    .map((l) =>
      l.type === "walk"
        ? `<span class="leg-badge walk">🚶 ${legMinutes(l)}</span>`
        : `<span class="leg-badge ${l.mode}">${MODE_EMOJI[l.mode]} ${escapeHtml(l.line)}</span>`,
    )
    .join('<span class="sep">›</span>');
  const walkM = leg.legs.filter((l) => l.type === "walk").reduce((a, l) => a + (l.distance || 0), 0);
  const ride = leg.legs.find((l) => l.type === "transit");
  const total = Math.round(leg.duration / 60);
  const detail = ride ? `${total} min · ${escapeHtml(ride.from.name)} ${fmtClock(ride.departure)}` : `${total} min · ${fmtDistance(walkM)}`;
  const longWalk = !ride && total > 30 ? `<span class="warn-txt">⚠ ${t("longWalk")}</span>` : "";
  return `<li class="it-leg" data-plan="leg" data-i="${i}" role="button" tabindex="0" title="${escapeHtml(t("showLegOnMap"))}">
    <span class="it-line ${ride ? ride.mode : "walk"}"></span>
    <div class="it-leg-body"><div class="legs-line">${parts}</div><div class="muted small">${detail} ${wait} ${longWalk}</div></div>
    <span class="it-leg-map" aria-hidden="true">🗺</span>
  </li>`;
}

function stopHtml(s, i, last) {
  const open = openStop === s.uid;
  const meal = s.kind === "meal" || s.kind === "coffee";
  return `<li class="it-stop${s.done ? " done" : ""}${open ? " open" : ""}" data-uid="${s.uid}">
    <div class="it-head" data-plan="toggle" role="button" tabindex="0" aria-expanded="${open}">
      <span class="num">${s.done ? "✓" : i + 1}</span>
      <div class="it-title"><b>${escapeHtml(s.name)}</b>
        <span class="muted small">${escapeHtml([s.start_time, s.end_time].filter(Boolean).join("–"))} · ${s.duration_min} min</span></div>
      <span class="it-emoji" aria-hidden="true">${KIND_EMOJI[s.kind] || "📍"}</span>
      <span class="chev" aria-hidden="true">▾</span>
    </div>
    <div class="collapsible${open ? "" : " closed"}"><div class="collapsible-inner"><div class="it-body">
      ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ""}
      ${s.tip ? `<p class="tip">💡 ${escapeHtml(s.tip)}</p>` : ""}
      ${renderOfficial(s.official)}
      <div class="it-actions">
        <button class="btn small primary" type="button" data-plan="nav">🧭 ${t("navigate")}</button>
        <button class="btn small" type="button" data-plan="onmap">🗺 ${t("mapShort")}</button>
        ${meal ? `<button class="btn small" type="button" data-plan="food">🍽️ ${t("findFood")}</button>` : ""}
        ${s.attraction_id ? `<button class="btn small" type="button" data-plan="narrate">🔊 ${t("tellMe")}</button>` : ""}
        <button class="btn small" type="button" data-plan="done">${s.done ? `↺ ${t("notVisited")}` : `✓ ${t("visited")}`}</button>
      </div>
      <div class="it-edit">
        <button class="icon-btn small" type="button" data-plan="up" aria-label="${t("moveUp")}" title="${t("moveUp")}"${i === 0 ? " disabled" : ""}>↑</button>
        <button class="icon-btn small" type="button" data-plan="down" aria-label="${t("moveDown")}" title="${t("moveDown")}"${i === last ? " disabled" : ""}>↓</button>
        <button class="icon-btn small danger" type="button" data-plan="remove" aria-label="${t("remove")}" title="${t("remove")}">✕</button>
      </div>
    </div></div></div>
  </li>`;
}

function renderPlan() {
  const plan = state.plan;
  const box = $("plan-result");
  const form = $("plan-form");
  if (!plan?.stops?.length) {
    box.innerHTML = "";
    form.classList.remove("hidden");
    return;
  }
  form.classList.add("hidden");
  const st = plan.stats || {};
  const stats = [
    st.start_time && st.end_time ? `🕘 ${st.start_time}–${st.end_time}` : "",
    `📍 ${count(plan.stops.length, "places")}`,
    st.walk_m ? `🚶 ${fmtDistance(st.walk_m)}` : "",
    st.rides ? `🚋 ${count(st.rides, "rides")}` : "",
  ].filter(Boolean);
  const next = plan.stops.find((s) => !s.done);
  const badge =
    plan.source === "ai" ? `<span class="badge ai">✨ ${t("aiPlan")}</span>` : plan.source === "fallback" ? `<span class="badge">${t("simplePlan")}</span>` : "";
  const items = [
    `<li class="it-start"><span class="num start">▶</span><div class="it-title"><b>${t("startLabel")}</b>
      <span class="muted small">${escapeHtml(plan.start?.name || "")}${st.start_time ? ` · ${st.start_time}` : ""}</span></div></li>`,
  ];
  plan.stops.forEach((s, i) => {
    items.push(legHtml(plan.legs?.[i], s, i));
    items.push(stopHtml(s, i, plan.stops.length - 1));
  });

  box.innerHTML = `<div class="card plan-card">
    <div class="plan-head"><div><h3>${escapeHtml(plan.title)}</h3>${plan.summary ? `<p class="muted small">${escapeHtml(plan.summary)}</p>` : ""}</div>${badge}</div>
    <div class="plan-stats">${stats.map((x) => `<span>${escapeHtml(x)}</span>`).join("")}</div>
    <div class="plan-main-actions">
      <button class="btn primary" type="button" data-plan="map">🗺 ${t("routeOnMap")}</button>
      <button class="btn" type="button" data-plan="next"${next ? "" : " disabled"}>🧭 ${next ? t("guideNext") : t("allVisited")}</button>
    </div>
    ${plan.rerouting ? `<p class="rerouting"><span class="spinner dark"></span> ${t("reroutingPlan")}</p>` : ""}
    <ol class="itinerary">${items.join("")}</ol>
    ${plan.tips?.length ? `<details class="plan-tips-box"><summary>💡 ${t("planTips")} (${plan.tips.length})</summary><ul class="plan-tips">${plan.tips.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></details>` : ""}
    <div class="plan-footer">
      <button class="btn small" type="button" data-plan="edit">✎ ${t("editPlan")}</button>
      <button class="btn small" type="button" data-plan="clear">🗑 ${t("deletePlan")}</button>
    </div>
  </div>`;
}

function toggleStop(li) {
  const uidVal = li.dataset.uid;
  const willOpen = openStop !== uidVal;
  // Płynnie: zamknij poprzednio otwartą kartę i otwórz wybraną (bez przerysowania listy).
  $("plan-result").querySelectorAll(".it-stop").forEach((x) => {
    const open = willOpen && x === li;
    x.querySelector(".collapsible").classList.toggle("closed", !open);
    x.querySelector(".it-head").setAttribute("aria-expanded", String(open));
    x.classList.toggle("open", open);
  });
  openStop = willOpen ? uidVal : null;
}

function showOnMap(fn) {
  emit("show-tab", "map");
  setTimeout(fn, 80);
}

function onPlanClick(e) {
  const b = e.target.closest("[data-plan]");
  if (!b || b.disabled) return;
  const act = b.dataset.plan;
  const plan = state.plan;
  if (act === "map") return showOnMap(() => showPlan(plan));
  if (act === "next") {
    const next = plan.stops.find((s) => !s.done);
    if (next) emit("route-request", { to: { lat: next.lat, lon: next.lon, name: next.name } });
    return;
  }
  if (act === "leg") {
    const i = Number(b.dataset.i);
    return showOnMap(() => {
      showPlan(plan, { fit: false });
      focusPlanLeg(plan, i);
    });
  }
  if (act === "edit") {
    $("plan-form").classList.remove("hidden");
    $("plan-form").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (act === "clear") {
    openStop = null;
    setPlan(null);
    clearPlan();
    return;
  }

  const li = b.closest("[data-uid]");
  if (!li) return;
  if (act === "toggle") return toggleStop(li);
  const idx = plan.stops.findIndex((s) => s.uid === li.dataset.uid);
  const stop = plan.stops[idx];
  if (!stop) return;
  if (act === "nav") emit("route-request", { to: { lat: stop.lat, lon: stop.lon, name: stop.name } });
  if (act === "onmap")
    showOnMap(() => {
      showPlan(plan, { fit: false });
      flyTo(stop.lat, stop.lon, 16.5);
    });
  if (act === "food") showNearbyPlaces(stop.kind === "coffee" ? "cafe" : "restaurant", { lat: stop.lat, lon: stop.lon });
  if (act === "narrate") {
    emit("narrate-request", stop.attraction_id);
    emit("show-tab", "agent");
  }
  if (act === "done") {
    stop.done = !stop.done;
    setPlan(plan);
  }
  if (act === "remove") {
    plan.stops.splice(idx, 1);
    if (!plan.stops.length) {
      setPlan(null);
      clearPlan();
      return;
    }
    reroute();
  }
  if (act === "up" || act === "down") {
    const j = act === "up" ? idx - 1 : idx + 1;
    if (j < 0 || j >= plan.stops.length) return;
    [plan.stops[idx], plan.stops[j]] = [plan.stops[j], plan.stops[idx]];
    reroute();
  }
}

// ------------------------------------------------ odkrywaj w pobliżu

function renderDiscover() {
  renderInterestChips();
  const pos = state.position;
  const tags = discoverTag === "all" ? null : INTERESTS.find((i) => i.id === discoverTag)?.tags || [];
  const list = attractions
    .filter((a) => !tags || a.tags.some((x) => tags.includes(x)))
    .map((a) => ({ a, d: pos ? distance(pos, a) : null }))
    .sort((x, y) => (x.d ?? 0) - (y.d ?? 0))
    .slice(0, 25);
  $("discover-list").innerHTML = list
    .map(
      ({ a, d }) => `<div class="item d-item" data-id="${a.id}">
        <div class="emoji">${CATEGORY_EMOJI[a.category] || "📍"}</div>
        <div><h4>${escapeHtml(a.name)}</h4>
          <div class="meta">${escapeHtml(a.categoryLabel || "")} · ${escapeHtml(a.district)}${d !== null ? ` · ${fmtDistance(d)}` : ""}</div>
          <p class="clamp2">${escapeHtml(a.summary)}</p>
          <div class="actions">
            <button class="btn small primary" type="button" data-d="plan">＋ ${t("addToPlan")}</button>
            <button class="btn small" type="button" data-d="nav" aria-label="${t("navigate")}" title="${t("navigate")}">🧭</button>
            <button class="btn small" type="button" data-d="narrate" aria-label="${t("tellMe")}" title="${t("tellMe")}">🔊</button>
            <button class="btn small" type="button" data-d="info">🏛️ ${t("hoursPrices")}</button>
          </div><div class="official-slot"></div></div></div>`,
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
  if (b.dataset.d === "info") showOfficialIn(b.closest("[data-id]").querySelector(".official-slot"), a.id);
}

async function showOfficialIn(slot, id) {
  if (slot.innerHTML) {
    slot.innerHTML = "";
    return;
  }
  slot.innerHTML = '<p class="muted small">…</p>';
  try {
    const res = await getJSON(`/api/official/${encodeURIComponent(id)}`);
    if (res.data) slot.innerHTML = renderOfficial(res.data, { open: true });
    else if (res.sources.length)
      slot.innerHTML = `<p class="muted small">${t("noOfficialYet")} <a href="${escapeHtml(res.sources[0])}" target="_blank" rel="noopener">${escapeHtml(host(res.sources[0]))}</a></p>`;
    else slot.innerHTML = `<p class="muted small">${t("freeAccess")}</p>`;
  } catch (err) {
    slot.innerHTML = `<p class="muted small">${escapeHtml(err.message)}</p>`;
  }
}
