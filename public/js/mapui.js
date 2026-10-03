// Interfejs zakładki Mapa: wyszukiwarka, szybkie akcje, panel z trasami / odjazdami / lokalami.
import { getJSON } from "./api.js";
import { MODE_EMOJI, PLACE_EMOJI, escapeHtml, fmtClock, fmtDistance, fmtMinutes } from "./format.js";
import { t } from "./i18n.js";
import { clearRoute, getMap, locate, showPlaces, showPoint, showRoute, toggleVehicles } from "./map.js";
import { rotateDemoHeading } from "./sensors.js";
import { emit, on, state } from "./state.js";
import { toast } from "./ui.js";

const sheet = () => document.getElementById("map-sheet");
const body = () => document.getElementById("sheet-body");
let current = null; // { route, selected, mode, to }

export function openSheet(html) {
  body().innerHTML = html;
  sheet().classList.remove("hidden", "collapsed");
}

export function closeSheet() {
  sheet().classList.add("hidden");
  if (current && !state.nav) clearRoute();
  current = null;
}

export function initMapUi() {
  document.getElementById("sheet-close").addEventListener("click", closeSheet);
  document.getElementById("sheet-grip").addEventListener("click", () => sheet().classList.toggle("collapsed"));
  document.getElementById("btn-locate").addEventListener("click", locate);
  initSearch();

  document.getElementById("map-chips").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-action]");
    if (!chip) return;
    const a = chip.dataset.action;
    if (a === "vehicles") {
      const visible = toggleVehicles();
      chip.classList.toggle("on", visible);
      toast(visible ? t("vehiclesOn") : t("vehiclesOff"));
    } else if (a === "departures") showDepartures();
    else if (a === "food") showNearbyPlaces("restaurant");
    else if (a === "cafe") showNearbyPlaces("cafe");
    else showNearbyPlaces(a);
  });

  // Tryb demo
  document.getElementById("demo-left").addEventListener("click", () => rotateDemoHeading(-15));
  document.getElementById("demo-right").addEventListener("click", () => rotateDemoHeading(15));
  on("heading", (h) => (document.getElementById("demo-heading").textContent = `${Math.round(h)}°`));

  // Delegacja kliknięć w panelu
  body().addEventListener("click", (e) => {
    const el = e.target.closest("[data-sheet]");
    if (!el) return;
    const act = el.dataset.sheet;
    if (act === "option") selectOption(Number(el.dataset.index));
    if (act === "mode") requestRoute({ to: current.to, mode: el.dataset.mode });
    if (act === "start") {
      emit("nav-start", { route: current.route, index: current.selected });
      closeSheet(); // trasa zostaje na mapie, bo nawigacja jest już aktywna
    }
    if (act === "close") closeSheet();
    if (act === "navigate") requestRoute({ to: { lat: Number(el.dataset.lat), lon: Number(el.dataset.lon), name: el.dataset.name } });
    if (act === "focus") getMap().setView([Number(el.dataset.lat), Number(el.dataset.lon)], 18);
  });

  on("route-request", (r) => requestRoute(r));
}

// ------------------------------------------------ wyszukiwarka

function initSearch() {
  const input = document.getElementById("map-search");
  const list = document.getElementById("map-suggestions");
  let timer = null;
  let results = [];
  let reqId = 0;

  const render = () => {
    list.innerHTML = results
      .map(
        (r, i) => `<li role="option" data-i="${i}"><span>${r.type === "attraction" ? "⭐" : r.type === "stop" ? "🚏" : "📍"}</span>
          <div><div>${escapeHtml(state.settings.lang === "en" && r.nameEn ? r.nameEn : r.name)}</div>${r.address ? `<div class="sub">${escapeHtml(r.address)}</div>` : ""}</div></li>`,
      )
      .join("");
    list.classList.toggle("hidden", !results.length);
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      results = [];
      return render();
    }
    timer = setTimeout(async () => {
      const id = ++reqId;
      try {
        const r = await getJSON("/api/search", { q });
        if (id === reqId) {
          results = r;
          render();
        }
      } catch {
        /* ignoruj */
      }
    }, 350);
  });

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const r = results[Number(li.dataset.i)];
    const name = state.settings.lang === "en" && r.nameEn ? r.nameEn : r.name;
    input.value = name;
    results = [];
    render();
    input.blur();
    showPoint({ ...r, name });
    requestRoute({ to: { lat: r.lat, lon: r.lon, name } });
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && results[0]) list.querySelector("li")?.click();
    if (e.key === "Escape") {
      results = [];
      render();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) list.classList.add("hidden");
  });
}

// ------------------------------------------------ trasy

export async function requestRoute({ to, mode = "auto" }) {
  emit("show-tab", "map");
  if (!state.position) {
    toast(t("noGps"));
    return;
  }
  current = { to, mode, route: null, selected: 0 };
  openSheet(`<h3>🏁 ${escapeHtml(to.name || "")}</h3><div class="empty">${t("routeLoading")}</div>`);
  try {
    const route = await getJSON("/api/route", {
      fromlat: state.position.lat,
      fromlon: state.position.lon,
      tolat: to.lat,
      tolon: to.lon,
      toName: to.name,
      mode,
      lang: state.settings.lang,
    });
    if (current?.to !== to) return; // użytkownik wybrał już inny cel
    presentRoute(route, { mode });
  } catch (err) {
    openSheet(`<h3>🏁 ${escapeHtml(to.name || "")}</h3><div class="empty">${t("noRoute")} ${escapeHtml(err.message)}</div>`);
  }
}

/** Pokazuje gotową trasę (np. policzoną przez agenta). */
export function presentRoute(route, { mode = "auto", switchTab = true } = {}) {
  if (switchTab) emit("show-tab", "map");
  current = { to: route.to, mode, route, selected: route.recommended || 0 };
  selectOption(current.selected);
}

function legsLine(o) {
  return o.legs
    .map((l) =>
      l.type === "walk"
        ? `<span class="leg-badge walk">🚶 ${Math.max(1, Math.round(l.duration / 60))}</span>`
        : `<span class="leg-badge ${l.mode}">${MODE_EMOJI[l.mode]} ${escapeHtml(l.line)}</span>`,
    )
    .join('<span class="sep">›</span>');
}

function delayBadge(delay) {
  if (delay === null || delay === undefined) return "";
  const min = Math.round(delay / 60);
  return min >= 1 ? `<span class="delay">+${min} ${t("minShort")}</span>` : `<span class="ontime">${t("onTime")}</span>`;
}

function legDetail(l) {
  if (l.type === "walk") {
    return `<div class="leg-row"><div class="t">${fmtClock(l.departure)}</div><div>🚶 ${t("walkTo")} <b>${escapeHtml(l.to.name || "")}</b> · ${fmtMinutes(l.duration)}${l.distance ? ` · ${fmtDistance(l.distance)}` : ""}</div></div>`;
  }
  return `<div class="leg-row"><div class="t">${fmtClock(l.departure)}</div><div>
    <span class="leg-badge ${l.mode}">${MODE_EMOJI[l.mode]} ${escapeHtml(l.line)}</span> ${t("direction")} <b>${escapeHtml(l.headsign)}</b> ${delayBadge(l.delay)}<br/>
    <span class="muted">▶ ${escapeHtml(l.from.name)}${l.from.platform ? ` (${escapeHtml(l.from.platform)})` : ""} → ${t("getOff")}: <b>${escapeHtml(l.to.name)}</b> ${fmtClock(l.arrival)} · ${l.stops.length - 1} ${t("stopsCount")}</span>
  </div></div>`;
}

function selectOption(i) {
  const route = current.route;
  current.selected = i;
  const o = route.options[i];
  showRoute(o);
  const modes = [
    ["auto", t("best")],
    ["walk", t("walk")],
    ["transit", t("transit")],
  ];
  openSheet(`
    <h3>🏁 ${escapeHtml(route.to.name || "")}</h3>
    <div class="segmented">${modes.map(([m, label]) => `<button type="button" data-sheet="mode" data-mode="${m}" class="${current.mode === m ? "on" : ""}">${label}</button>`).join("")}</div>
    ${route.warning ? `<p class="muted small">⚠ ${escapeHtml(route.warning)}</p>` : ""}
    ${route.options
      .map(
        (opt, idx) => `<button type="button" class="route-opt ${idx === i ? "selected" : ""}" data-sheet="option" data-index="${idx}">
          <div class="top"><span class="dur">${fmtMinutes(opt.duration)}</span><span class="times">${fmtClock(opt.departure)} – ${fmtClock(opt.arrival)}</span></div>
          <div class="legs-line">${legsLine(opt)}</div>
          ${opt.ticket ? `<div class="ticket-line">🎟️ ${escapeHtml(opt.ticket.label)} – ${opt.ticket.price} zł</div>` : ""}
        </button>`,
      )
      .join("")}
    <div class="leg-detail">${o.legs.map(legDetail).join("")}</div>
    <div class="sheet-actions">
      <button class="btn primary block" type="button" data-sheet="start">▶ ${t("startNav")}</button>
    </div>`);
}

// ------------------------------------------------ odjazdy

export async function showDepartures() {
  if (!state.position) return toast(t("noGps"));
  openSheet(`<h3>🚏 ${t("departuresTitle")}</h3><div class="empty">…</div>`);
  try {
    const res = await getJSON("/api/departures", { lat: state.position.lat, lon: state.position.lon });
    if (res.error) throw new Error(res.error);
    const rows = res.departures
      .map(
        (d) => `<div class="dep-row"><span class="leg-badge ${d.mode}">${MODE_EMOJI[d.mode]} ${escapeHtml(d.line)}</span>
          <div><b>${escapeHtml(d.headsign)}</b><div class="muted small">${escapeHtml(d.stop)}${d.platform ? ` (${escapeHtml(d.platform)})` : ""} · ${fmtClock(d.scheduled)} ${delayBadge(d.delay)}</div></div>
          <div class="dep-min">${d.minutes <= 0 ? t("now") : `${d.minutes} ${t("minShort")}`}</div></div>`,
      )
      .join("");
    openSheet(`<h3>🚏 ${escapeHtml(res.stops.join(", "))}</h3>${rows || `<div class="empty">${t("noDepartures")}</div>`}`);
  } catch (err) {
    openSheet(`<h3>🚏 ${t("departuresTitle")}</h3><div class="empty">${escapeHtml(err.message)}</div>`);
  }
}

// ------------------------------------------------ lokale w pobliżu

export async function showNearbyPlaces(type, center = state.position) {
  emit("show-tab", "map");
  if (!center) return toast(t("noGps"));
  openSheet(`<h3>${PLACE_EMOJI[type] || "📍"} ${t("placesTitle")}</h3><div class="empty">…</div>`);
  try {
    const radius = ["toilets", "ticket_machine", "atm", "pharmacy"].includes(type) ? 1200 : 500;
    const places = await getJSON("/api/places", { type, lat: center.lat, lon: center.lon, radius, limit: 25 });
    showPlaces(places, type);
    renderPlaceList(places, type);
  } catch (err) {
    openSheet(`<h3>${t("placesTitle")}</h3><div class="empty">${escapeHtml(err.message)}</div>`);
  }
}

export function renderPlaceList(places, type = "restaurant", title = t("placesTitle")) {
  const rows = places
    .map(
      (p) => `<div class="item">
        <div class="emoji">${PLACE_EMOJI[p.type || type] || "📍"}</div>
        <div><h4>${escapeHtml(p.name)}</h4>
          <div class="meta">${[p.distance != null ? fmtDistance(p.distance) : null, p.cuisine, p.openingHours].filter(Boolean).map(escapeHtml).join(" · ")}</div>
          ${p.note ? `<p>${escapeHtml(p.note)}</p>` : ""}
          <div class="actions">
            <button class="btn small primary" data-sheet="navigate" data-lat="${p.lat}" data-lon="${p.lon}" data-name="${escapeHtml(p.name)}">🧭 ${t("navigate")}</button>
            <button class="btn small" data-sheet="focus" data-lat="${p.lat}" data-lon="${p.lon}">📍</button>
          </div></div></div>`,
    )
    .join("");
  openSheet(`<h3>${PLACE_EMOJI[type] || "📍"} ${escapeHtml(title)}</h3><div class="list">${rows || `<div class="empty">${t("noPlaces")}</div>`}</div>`);
}
