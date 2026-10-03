// Mapa (Leaflet): pozycja + stożek patrzenia, atrakcje, lokale, trasy, plan, pojazdy na żywo.
/* global L */
import { getJSON } from "./api.js";
import { CATEGORY_EMOJI, PLACE_EMOJI, distance, escapeHtml, fmtDistance } from "./format.js";
import { t } from "./i18n.js";
import { setDemoPosition } from "./sensors.js";
import { emit, on, state } from "./state.js";

let map = null;
let userMarker = null;
let accuracyCircle = null;
let follow = true;
let vehiclesTimer = null;
const vehicleMarkers = new Map();
const layers = {};
export let attractions = [];

const KRAKOW = [50.0617, 19.9373];

export function getMap() {
  return map;
}

export function initMap() {
  map = L.map("map", { zoomControl: false, attributionControl: true }).setView(KRAKOW, 15);
  // Kafelki OSM (tryb ciemny przez filtr CSS). Przy większym ruchu użyj własnego dostawcy kafelków.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  for (const name of ["plan", "attractions", "places", "route", "vehicles", "search"]) layers[name] = L.layerGroup().addTo(map);

  map.on("dragstart", () => setFollow(false));
  map.on("click", (e) => {
    if (state.settings.demo) setDemoPosition(e.latlng.lat, e.latlng.lng);
  });
  map.on("moveend", () => {
    if (vehiclesTimer) refreshVehicles();
  });

  // Przyciski w dymkach (delegacja zdarzeń).
  map.getContainer().addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const d = btn.dataset;
    const target = { lat: Number(d.lat), lon: Number(d.lon), name: d.name, attractionId: d.id || undefined };
    if (d.act === "navigate") emit("route-request", { to: target });
    if (d.act === "narrate") emit("narrate-request", d.id);
    if (d.act === "plan") emit("plan-add", { name: d.name, lat: target.lat, lon: target.lon, attraction_id: d.id || "" });
    map.closePopup();
  });

  on("position", updateUser);
  on("heading", updateHeading);
  loadAttractions();
}

export function invalidate() {
  map?.invalidateSize();
}

// ------------------------------------------------ użytkownik

const userIcon = () =>
  L.divIcon({
    className: "",
    html: `<div class="user-marker${state.position?.simulated ? " sim" : ""}"><div class="cone"></div><div class="core"></div></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

function updateUser(pos) {
  const ll = [pos.lat, pos.lon];
  if (!userMarker) {
    accuracyCircle = L.circle(ll, { radius: pos.accuracy || 10, color: "#2563eb", weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
    userMarker = L.marker(ll, { icon: userIcon(), interactive: false, zIndexOffset: 1000, keyboard: false }).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 16));
  } else {
    userMarker.setLatLng(ll);
    accuracyCircle.setLatLng(ll).setRadius(Math.min(pos.accuracy || 10, 300));
    const el = userMarker.getElement()?.querySelector(".user-marker");
    el?.classList.toggle("sim", Boolean(pos.simulated));
  }
  updateHeading(state.heading);
  if (follow) map.panTo(ll, { animate: true, duration: 0.5 });
}

function updateHeading(h) {
  const cone = userMarker?.getElement()?.querySelector(".cone");
  if (!cone) return;
  cone.style.display = h === null || h === undefined ? "none" : "";
  if (h !== null && h !== undefined) cone.style.transform = `rotate(${h}deg)`;
}

export function setFollow(v) {
  follow = v;
  document.getElementById("btn-locate")?.classList.toggle("on", v);
}

export function locate() {
  setFollow(true);
  if (state.position) map.setView([state.position.lat, state.position.lon], Math.max(map.getZoom(), 17));
}

// ------------------------------------------------ atrakcje

const poiIcon = (emoji, cls = "") =>
  L.divIcon({
    className: "",
    html: `<div class="poi-marker ${cls}"><span>${emoji}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 41],
    popupAnchor: [0, -38],
  });

function actionButtons(p, { narrate = false, plan = true } = {}) {
  const data = `data-lat="${p.lat}" data-lon="${p.lon}" data-name="${escapeHtml(p.name)}" data-id="${escapeHtml(p.id || "")}"`;
  return `<div class="actions">
    <button class="btn small primary" data-act="navigate" ${data}>🧭 ${t("navigate")}</button>
    ${narrate ? `<button class="btn small" data-act="narrate" ${data}>🔊 ${t("tellMe")}</button>` : ""}
    ${plan ? `<button class="btn small" data-act="plan" ${data}>＋ ${t("addToPlan")}</button>` : ""}
  </div>`;
}

const distanceLine = (p) => (state.position ? ` · ${fmtDistance(distance(state.position, p))}` : "");

export async function loadAttractions() {
  try {
    attractions = await getJSON("/api/attractions", { lang: state.settings.lang });
  } catch (err) {
    console.warn("Nie udało się pobrać atrakcji", err);
    return;
  }
  layers.attractions.clearLayers();
  for (const a of attractions) {
    L.marker([a.lat, a.lon], { icon: poiIcon(CATEGORY_EMOJI[a.category] || "📍"), title: a.name })
      .bindPopup(
        () => `<div class="popup"><h4>${escapeHtml(a.name)}</h4>
          <div class="muted small">${escapeHtml(a.categoryLabel || "")}${distanceLine(a)}</div>
          <p>${escapeHtml(a.summary)}</p>${actionButtons(a, { narrate: true })}</div>`,
      )
      .addTo(layers.attractions);
  }
  emit("attractions", attractions);
}

// ------------------------------------------------ lokale / pinezki

export function showPlaces(places, type = "restaurant", { fit = true } = {}) {
  layers.places.clearLayers();
  const bounds = [];
  for (const p of places) {
    const emoji = PLACE_EMOJI[p.type || type] || "📍";
    const details = [p.cuisine, p.address, p.openingHours ? `${t("open")}: ${p.openingHours}` : null, p.note].filter(Boolean);
    L.marker([p.lat, p.lon], { icon: poiIcon(emoji, "place"), title: p.name })
      .bindPopup(
        () => `<div class="popup"><h4>${escapeHtml(p.name)}</h4>
          <div class="muted small">${details.map(escapeHtml).join(" · ")}${distanceLine(p)}</div>
          ${p.website ? `<p><a href="${escapeHtml(p.website)}" target="_blank" rel="noopener">www</a></p>` : "<p></p>"}
          ${actionButtons(p, { plan: true })}</div>`,
      )
      .addTo(layers.places);
    bounds.push([p.lat, p.lon]);
  }
  if (fit && bounds.length) {
    if (state.position) bounds.push([state.position.lat, state.position.lon]);
    setFollow(false);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 });
  }
}

export function clearPlaces() {
  layers.places.clearLayers();
}

export function showPoint(p) {
  layers.search.clearLayers();
  L.marker([p.lat, p.lon], { icon: poiIcon("📌", "place") })
    .bindPopup(`<div class="popup"><h4>${escapeHtml(p.name)}</h4>${p.address ? `<p class="muted small">${escapeHtml(p.address)}</p>` : ""}${actionButtons(p)}</div>`)
    .addTo(layers.search);
  setFollow(false);
  map.setView([p.lat, p.lon], 17);
}

// ------------------------------------------------ trasa

const LEG_STYLE = {
  walk: () => ({ color: getCss("--walk"), weight: 5, dashArray: "2 9", lineCap: "round", opacity: 0.95 }),
  tram: () => ({ color: getCss("--tram"), weight: 7, opacity: 0.9 }),
  bus: () => ({ color: getCss("--bus"), weight: 7, opacity: 0.9 }),
};

function getCss(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#c2412d";
}

export function showRoute(option, { fit = true } = {}) {
  layers.route.clearLayers();
  if (!option) return;
  const all = [];
  for (const leg of option.legs) {
    const geom = leg.geometry || [];
    if (geom.length < 2) continue;
    const style = leg.type === "walk" ? LEG_STYLE.walk() : LEG_STYLE[leg.mode]();
    if (leg.type !== "walk") L.polyline(geom, { color: "#fff", weight: 11, opacity: 0.8 }).addTo(layers.route);
    L.polyline(geom, style).addTo(layers.route);
    all.push(...geom);
    if (leg.type === "transit") {
      for (const [i, s] of [leg.from, leg.to].entries()) {
        L.marker([s.lat, s.lon], {
          icon: L.divIcon({ className: "", html: `<div class="stop-marker ${leg.mode}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }),
        })
          .bindTooltip(`${i === 0 ? "▶" : "■"} ${escapeHtml(s.name)}${s.platform ? ` (${s.platform})` : ""}`, { direction: "top" })
          .addTo(layers.route);
      }
    }
  }
  const last = option.legs[option.legs.length - 1];
  if (last?.to) L.marker([last.to.lat, last.to.lon], { icon: poiIcon("🏁", "place") }).addTo(layers.route);
  if (fit && all.length) {
    setFollow(false);
    map.fitBounds(all, { padding: [50, 50], maxZoom: 17 });
  }
}

export function clearRoute() {
  layers.route.clearLayers();
}

// ------------------------------------------------ plan dnia

export function showPlan(stops, { fit = true } = {}) {
  layers.plan.clearLayers();
  if (!stops?.length) return;
  const pts = stops.map((s) => [s.lat, s.lon]);
  L.polyline(pts, { color: getCss("--tram"), weight: 3, dashArray: "6 8", opacity: 0.7 }).addTo(layers.plan);
  stops.forEach((s, i) => {
    L.marker([s.lat, s.lon], { icon: poiIcon(String(i + 1), "plan"), title: s.name, zIndexOffset: 500 })
      .bindPopup(`<div class="popup"><h4>${i + 1}. ${escapeHtml(s.name)}</h4><p class="muted small">${escapeHtml(s.start_time || "")}</p>${actionButtons({ ...s, id: s.attraction_id }, { plan: false, narrate: Boolean(s.attraction_id) })}</div>`)
      .addTo(layers.plan);
  });
  if (fit) {
    setFollow(false);
    map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 });
  }
}

// ------------------------------------------------ pojazdy na żywo (GTFS-RT)

export function vehiclesVisible() {
  return Boolean(vehiclesTimer);
}

export function toggleVehicles(force) {
  const on = force ?? !vehiclesTimer;
  if (on && !vehiclesTimer) {
    refreshVehicles();
    vehiclesTimer = setInterval(() => {
      if (state.activeTab === "map") refreshVehicles();
    }, 15000);
  } else if (!on && vehiclesTimer) {
    clearInterval(vehiclesTimer);
    vehiclesTimer = null;
    layers.vehicles.clearLayers();
    vehicleMarkers.clear();
  }
  return on;
}

async function refreshVehicles() {
  if (map.getZoom() < 13) {
    layers.vehicles.clearLayers();
    vehicleMarkers.clear();
    return;
  }
  const b = map.getBounds();
  let list;
  try {
    list = await getJSON("/api/vehicles", { bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => v.toFixed(5)).join(",") });
  } catch {
    return;
  }
  const seen = new Set();
  for (const v of list) {
    seen.add(v.id);
    const existing = vehicleMarkers.get(v.id);
    if (existing) {
      existing.setLatLng([v.lat, v.lon]);
      continue;
    }
    const m = L.marker([v.lat, v.lon], {
      icon: L.divIcon({ className: "", html: `<div class="veh-marker ${v.mode}">${escapeHtml(v.line)}</div>`, iconSize: [30, 20], iconAnchor: [15, 10] }),
      zIndexOffset: 200,
    })
      .bindTooltip(`${v.mode === "tram" ? "🚋" : "🚌"} ${escapeHtml(v.line)}${v.headsign ? ` → ${escapeHtml(v.headsign)}` : ""}`, { direction: "top" })
      .addTo(layers.vehicles);
    vehicleMarkers.set(v.id, m);
  }
  for (const [id, m] of vehicleMarkers) {
    if (!seen.has(id)) {
      layers.vehicles.removeLayer(m);
      vehicleMarkers.delete(id);
    }
  }
}
