// Mapa (MapLibre GL, tylko 2D): pozycja + promień patrzenia, atrakcje, lokale, trasy, plan dnia.
// Domyślnie bez znaczników – pojawiają się dopiero na żądanie (przycisk, trasa, plan, wyszukiwanie).
/* global maplibregl */
import { getJSON } from "./api.js";
import { CATEGORY_EMOJI, PLACE_EMOJI, distance, escapeHtml, fmtDistance } from "./format.js";
import { t } from "./i18n.js";
import { setDemoPosition } from "./sensors.js";
import { emit, on, state } from "./state.js";

// Wektorowe mapy OpenFreeMap (bez klucza API); przy braku dostępu – rastrowe kafelki OSM.
const STYLES = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
const FALLBACK_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};
const KRAKOW = { lat: 50.0617, lon: 19.9373 };
const EMPTY = { type: "FeatureCollection", features: [] };
const TOP_UI = 130; // wyszukiwarka + przyciski nad mapą

let map = null;
let styleReady = false;
let usedFallback = false;
const pending = [];
const sourceData = {};
const markerGroups = { attractions: [], places: [], search: [], route: [], plan: [] };
let userMarker = null;
let popup = null;
let follow = true;
let attractionsShown = false;
let stopClicksBound = false;
export let attractions = [];

const lngLat = (lat, lon) => [lon, lat];
const whenReady = (fn) => (styleReady ? fn() : pending.push(fn));

export function getMap() {
  return map;
}

export function initMap() {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  map = new maplibregl.Map({
    container: "map",
    style: dark ? STYLES.dark : STYLES.light,
    center: lngLat(KRAKOW.lat, KRAKOW.lon),
    zoom: 14.5,
    // Tylko 2D: bez pochylania i obracania mapy.
    pitch: 0,
    maxPitch: 0,
    bearing: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: { compact: true },
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();

  map.on("style.load", () => {
    styleReady = true;
    addOverlays();
    pending.splice(0).forEach((fn) => fn());
  });
  map.on("error", (e) => {
    // Styl wektorowy niedostępny → kafelki rastrowe OSM.
    if (!styleReady && !usedFallback) {
      usedFallback = true;
      console.warn("[mapa] styl wektorowy niedostępny, przełączam na OSM:", e.error?.message);
      map.setStyle(FALLBACK_STYLE);
    }
  });
  // Styl odwołuje się do kilku ikon spoza swojego zestawu – podstawiamy pusty obrazek zamiast ostrzeżeń.
  map.on("styleimagemissing", (e) => {
    if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
  map.on("dragstart", () => setFollow(false));
  map.on("click", (e) => {
    if (state.settings.demo) setDemoPosition(e.lngLat.lat, e.lngLat.lng);
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
    popup?.remove();
  });

  on("position", updateUser);
  on("heading", updateHeading);
  loadAttractions();
}

export function invalidate() {
  map?.resize();
}

function getCss(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function setData(id, data) {
  sourceData[id] = data;
  map?.getSource(id)?.setData(data);
}

/** Warstwy aplikacji nad mapą (po każdym załadowaniu stylu). */
function addOverlays() {
  // Mapa ma być płaska – usuwamy warstwy 3D (wyciągnięte budynki) ze stylu.
  for (const layer of map.getStyle().layers) if (layer.type === "fill-extrusion") map.removeLayer(layer.id);
  for (const id of ["nomi-accuracy", "nomi-fov", "nomi-plan", "nomi-plan-stops", "nomi-route", "nomi-route-stops"]) {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: sourceData[id] || EMPTY });
  }
  map.addLayer({ id: "nomi-accuracy", type: "fill", source: "nomi-accuracy", paint: { "fill-color": "#2563eb", "fill-opacity": 0.07 } });
  map.addLayer({ id: "nomi-fov-fill", type: "fill", source: "nomi-fov", paint: { "fill-color": "#2563eb", "fill-opacity": 0.1 } });
  map.addLayer({
    id: "nomi-fov-line",
    type: "line",
    source: "nomi-fov",
    paint: { "line-color": "#2563eb", "line-opacity": 0.6, "line-width": 1.5, "line-dasharray": [3, 3] },
  });
  addRouteLayers("plan");
  addRouteLayers("route");
  if (!stopClicksBound) {
    stopClicksBound = true; // zdarzenia warstw przeżywają zmianę stylu – rejestrujemy raz
    map.on("click", "plan-stops", stopPopup);
    map.on("click", "route-stops", stopPopup);
  }
}

// Każdy środek transportu: inny kolor ORAZ inny wzór linii (czytelne także bez rozróżniania kolorów).
function addRouteLayers(prefix) {
  const c = { walk: getCss("--walk", "#c2412d"), tram: getCss("--tram", "#2563eb"), bus: getCss("--bus", "#0f766e") };
  const source = `nomi-${prefix}`;
  const round = { "line-cap": "round", "line-join": "round" };
  map.addLayer({
    id: `${prefix}-casing`,
    type: "line",
    source,
    layout: round,
    paint: { "line-color": "#ffffff", "line-width": ["match", ["get", "mode"], "walk", 9, 11], "line-opacity": 0.95 },
  });
  // pieszo: kropki – obrazek kropki powtarzany wzdłuż linii (kreski o zerowej długości renderują się błędnie)
  if (!map.hasImage("nomi-walk-dot")) map.addImage("nomi-walk-dot", dotImage(c.walk), { pixelRatio: 2 });
  map.addLayer({
    id: `${prefix}-walk`,
    type: "symbol",
    source,
    filter: ["==", ["get", "mode"], "walk"],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 9,
      "icon-image": "nomi-walk-dot",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
  // tramwaj: linia ciągła
  map.addLayer({ id: `${prefix}-tram`, type: "line", source, filter: ["==", ["get", "mode"], "tram"], layout: round, paint: { "line-color": c.tram, "line-width": 6 } });
  // autobus: linia przerywana
  map.addLayer({
    id: `${prefix}-bus`,
    type: "line",
    source,
    filter: ["==", ["get", "mode"], "bus"],
    layout: { "line-join": "round" },
    paint: { "line-color": c.bus, "line-width": 6, "line-dasharray": [2, 1.2] },
  });
  map.addLayer({
    id: `${prefix}-stops`,
    type: "circle",
    source: `${source}-stops`,
    paint: {
      "circle-radius": 4,
      "circle-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-stroke-color": ["match", ["get", "mode"], "tram", c.tram, c.bus],
    },
  });
}

/** Kropka trasy pieszej (12×12 px przy pixelRatio 2) jako dane obrazu dla map.addImage. */
function dotImage(color) {
  const size = 12;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function stopPopup(e) {
  const f = e.features?.[0];
  if (f) openPopup(e.lngLat.lat, e.lngLat.lng, `<div class="popup"><h4>${escapeHtml(f.properties.name)}</h4></div>`, 8);
}

/** Przyciemnienie odcinków: active = indeks odcinka wyróżnionego; mode „progress” – przebyte przygaszone. */
function setLegOpacity(prefix, active, mode = "progress") {
  whenReady(() => {
    const expr =
      active === null || active === undefined
        ? 1
        : mode === "focus"
          ? ["case", ["==", ["get", "leg"], active], 1, 0.25]
          : ["case", ["<", ["get", "leg"], active], 0.3, 1];
    for (const s of ["casing", "tram", "bus"]) map.setPaintProperty(`${prefix}-${s}`, "line-opacity", expr === 1 && s === "casing" ? 0.95 : expr);
    map.setPaintProperty(`${prefix}-walk`, "icon-opacity", expr); // kropki to warstwa symboli
    map.setPaintProperty(`${prefix}-stops`, "circle-opacity", expr);
    map.setPaintProperty(`${prefix}-stops`, "circle-stroke-opacity", expr);
  });
}

// ------------------------------------------------ znaczniki i dymki

function addMarker(group, el, lat, lon, { anchor = "center", popupHtml, popupOffset = 12, title } = {}) {
  if (title) el.title = title;
  if (popupHtml) {
    el.style.cursor = "pointer";
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openPopup(lat, lon, typeof popupHtml === "function" ? popupHtml() : popupHtml, popupOffset);
    });
  }
  const m = new maplibregl.Marker({ element: el, anchor }).setLngLat(lngLat(lat, lon)).addTo(map);
  markerGroups[group].push(m);
  return m;
}

function clearMarkers(group) {
  for (const m of markerGroups[group]) m.remove();
  markerGroups[group] = [];
}

function openPopup(lat, lon, html, offset = 12) {
  popup?.remove();
  popup = new maplibregl.Popup({ offset, maxWidth: "290px", closeButton: true }).setLngLat(lngLat(lat, lon)).setHTML(html).addTo(map);
}

function el(html, className = "") {
  const div = document.createElement("div");
  div.className = className;
  div.innerHTML = html;
  return div;
}

const poiEl = (emoji, cls = "") => el(`<div class="poi-marker ${cls}"><span>${emoji}</span></div>`, "poi-wrap");

function actionButtons(p, { narrate = false, plan = true } = {}) {
  const data = `data-lat="${p.lat}" data-lon="${p.lon}" data-name="${escapeHtml(p.name)}" data-id="${escapeHtml(p.id || "")}"`;
  return `<div class="actions">
    <button class="btn small primary" data-act="navigate" ${data}>🧭 ${t("navigate")}</button>
    ${narrate ? `<button class="btn small" data-act="narrate" ${data}>🔊 ${t("tellMe")}</button>` : ""}
    ${plan ? `<button class="btn small" data-act="plan" ${data}>＋ ${t("addToPlan")}</button>` : ""}
  </div>`;
}

const distanceLine = (p) => (state.position ? ` · ${fmtDistance(distance(state.position, p))}` : "");

// ------------------------------------------------ widok mapy

export function setFollow(v) {
  follow = v;
  document.getElementById("btn-locate")?.classList.toggle("on", v);
}

export function locate() {
  setFollow(true);
  if (state.position) map.easeTo({ center: lngLat(state.position.lat, state.position.lon), zoom: Math.max(map.getZoom(), 16), duration: 600 });
}

export function flyTo(lat, lon, zoom = 16.5) {
  setFollow(false);
  map.easeTo({ center: lngLat(lat, lon), zoom, duration: 600 });
}

/** Dopasowuje widok do punktów [[lat, lon], …]; padding może uwzględniać panel dolny. */
export function fitPoints(points, { top = TOP_UI, bottom = 60, left = 40, right = 40, maxZoom = 16 } = {}) {
  if (!points?.length) return;
  const bounds = new maplibregl.LngLatBounds(lngLat(...points[0]), lngLat(...points[0]));
  for (const [lat, lon] of points) bounds.extend(lngLat(lat, lon));
  setFollow(false);
  map.fitBounds(bounds, { padding: { top, bottom, left, right }, maxZoom, duration: 600 });
}

// ------------------------------------------------ użytkownik

// Pole widzenia – te same wartości, których serwer używa do „co jest przede mną”.
export const FOV_DEG = 70;
export const FOV_RANGE_M = 250;
let headingFrame = 0;

// Wiązka (jak w Mapach Google): klin ±30° wychodzący z kropki, zanikający z odległością.
const BEAM_SVG = `<svg class="beam" viewBox="-70 -70 140 140" aria-hidden="true">
  <defs><radialGradient id="nomi-beam" cx="0" cy="0" r="66" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#2563eb" stop-opacity=".65"/><stop offset=".55" stop-color="#2563eb" stop-opacity=".3"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/>
  </radialGradient></defs>
  <path d="M0 0 L-33 -57.2 A66 66 0 0 1 33 -57.2 Z" fill="url(#nomi-beam)"/></svg>`;

function circlePolygon(lat, lon, radius, steps = 48) {
  const kLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + (radius * Math.sin(a)) / kLon, lat + (radius * Math.cos(a)) / 110540]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

/** Wycinek koła (pole widzenia) w metrach wokół pozycji. */
function sectorPolygon(lat, lon, heading, radius, fov) {
  const kLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const ring = [[lon, lat]];
  for (let i = 0; i <= 16; i++) {
    const b = ((heading - fov / 2 + (fov * i) / 16) * Math.PI) / 180;
    ring.push([lon + (radius * Math.sin(b)) / kLon, lat + (radius * Math.cos(b)) / 110540]);
  }
  ring.push([lon, lat]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

function updateUser(pos) {
  const first = !userMarker;
  if (first) {
    const node = el(`${BEAM_SVG}<div class="core"></div>`, "user-marker");
    userMarker = new maplibregl.Marker({ element: node, anchor: "center" }).setLngLat(lngLat(pos.lat, pos.lon)).addTo(map);
  } else {
    userMarker.setLngLat(lngLat(pos.lat, pos.lon));
  }
  userMarker.getElement().classList.toggle("sim", Boolean(pos.simulated));
  setData("nomi-accuracy", circlePolygon(pos.lat, pos.lon, Math.min(pos.accuracy || 10, 300)));
  updateHeading();
  if (first) map.jumpTo({ center: lngLat(pos.lat, pos.lon), zoom: Math.max(map.getZoom(), 15.5) });
  else if (follow) map.easeTo({ center: lngLat(pos.lat, pos.lon), duration: 500 });
}

function updateHeading() {
  if (headingFrame) return;
  headingFrame = requestAnimationFrame(() => {
    headingFrame = 0;
    const heading = state.heading;
    const known = heading !== null && heading !== undefined && Boolean(state.position);
    const beam = userMarker?.getElement().querySelector(".beam");
    if (beam) {
      beam.style.display = known ? "" : "none";
      if (known) beam.style.transform = `rotate(${heading}deg)`;
    }
    setData("nomi-fov", known ? sectorPolygon(state.position.lat, state.position.lon, heading, FOV_RANGE_M, FOV_DEG) : EMPTY);
  });
}

// ------------------------------------------------ atrakcje (na żądanie)

export async function loadAttractions() {
  try {
    attractions = await getJSON("/api/attractions", { lang: state.settings.lang });
  } catch (err) {
    console.warn("Nie udało się pobrać atrakcji", err);
    return;
  }
  if (attractionsShown) renderAttractions();
  emit("attractions", attractions);
}

function renderAttractions() {
  clearMarkers("attractions");
  for (const a of attractions) {
    addMarker("attractions", poiEl(CATEGORY_EMOJI[a.category] || "📍", "attr"), a.lat, a.lon, {
      anchor: "bottom",
      title: a.name,
      popupOffset: 40,
      popupHtml: () => `<div class="popup"><h4>${escapeHtml(a.name)}</h4>
        <div class="muted small">${escapeHtml(a.categoryLabel || "")}${distanceLine(a)}</div>
        <p>${escapeHtml(a.summary)}</p>${actionButtons(a, { narrate: true })}</div>`,
    });
  }
}

export function attractionsVisible() {
  return attractionsShown;
}

/** Pokazuje/ukrywa znaczniki atrakcji; zwraca nowy stan. */
export function toggleAttractions(force) {
  attractionsShown = force ?? !attractionsShown;
  if (attractionsShown) {
    renderAttractions();
    if (state.position) flyTo(state.position.lat, state.position.lon, Math.min(map.getZoom(), 14.5));
    else fitPoints(attractions.map((a) => [a.lat, a.lon]), { maxZoom: 14.5 });
  } else {
    clearMarkers("attractions");
  }
  return attractionsShown;
}

// ------------------------------------------------ lokale / pinezki

export function showPlaces(places, type = "restaurant", { fit = true } = {}) {
  clearMarkers("places");
  for (const p of places) {
    const details = [p.cuisine, p.address, p.openingHours ? `${t("osmHours")}: ${p.openingHours}` : null, p.note].filter(Boolean);
    addMarker("places", poiEl(PLACE_EMOJI[p.type || type] || "📍", "place"), p.lat, p.lon, {
      anchor: "bottom",
      title: p.name,
      popupOffset: 40,
      popupHtml: () => `<div class="popup"><h4>${escapeHtml(p.name)}</h4>
        <div class="muted small">${details.map(escapeHtml).join(" · ")}${distanceLine(p)}</div>
        ${p.website ? `<p><a href="${escapeHtml(p.website)}" target="_blank" rel="noopener">www</a></p>` : "<p></p>"}
        ${actionButtons(p, { plan: true })}</div>`,
    });
  }
  if (fit && places.length) {
    const pts = places.map((p) => [p.lat, p.lon]);
    if (state.position) pts.push([state.position.lat, state.position.lon]);
    fitPoints(pts, { maxZoom: 16.5 });
  }
}

export function showPoint(p) {
  clearMarkers("search");
  addMarker("search", poiEl("📌", "place"), p.lat, p.lon, {
    anchor: "bottom",
    popupOffset: 40,
    popupHtml: `<div class="popup"><h4>${escapeHtml(p.name)}</h4>${p.address ? `<p class="muted small">${escapeHtml(p.address)}</p>` : ""}${actionButtons(p)}</div>`,
  });
  flyTo(p.lat, p.lon, 16);
}

/** Usuwa tymczasowe znaczniki (lokale, pinezka wyszukiwania). */
export function clearTransientMarkers() {
  clearMarkers("places");
  clearMarkers("search");
  popup?.remove();
}

// ------------------------------------------------ trasy (nawigacja i plan)

const modeOf = (leg) => (leg.type === "walk" ? "walk" : leg.mode);

/** Linie i przystanki pośrednie odcinków jako GeoJSON; legIndex(i) – numer odcinka do przygaszania. */
function routeGeoJson(legs, legIndex) {
  const lines = [];
  const stops = [];
  legs.forEach((leg, i) => {
    if (!leg || (leg.geometry || []).length < 2) return;
    const props = { mode: modeOf(leg), leg: legIndex(i) };
    lines.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: leg.geometry.map(([lat, lon]) => [lon, lat]) } });
    if (leg.type === "transit" && Array.isArray(leg.stops)) {
      for (const s of leg.stops.slice(1, -1)) {
        stops.push({ type: "Feature", properties: { ...props, name: s.name }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } });
      }
    }
  });
  return { lines: { type: "FeatureCollection", features: lines }, stops: { type: "FeatureCollection", features: stops } };
}

/** Znaczniki przejazdów: wsiadanie (z ikoną), wysiadanie, numer linii w połowie odcinka. */
function addTransitMarkers(group, leg) {
  const mode = leg.mode;
  const geom = leg.geometry || [];
  if (geom.length) {
    const [lat, lon] = geom[Math.floor(geom.length / 2)];
    addMarker(group, el(`${mode === "tram" ? "🚋" : "🚌"} ${escapeHtml(leg.line)}`, `line-badge ${mode}`), lat, lon);
  }
  addMarker(group, el(mode === "tram" ? "🚋" : "🚌", `route-stop ${mode} board`), leg.from.lat, leg.from.lon, {
    title: `▶ ${leg.from.name}${leg.from.platform ? ` (${leg.from.platform})` : ""} · ${leg.line} → ${leg.headsign}`,
  });
  addMarker(group, el("", `route-stop ${mode} alight`), leg.to.lat, leg.to.lon, { title: `■ ${leg.to.name}` });
}

function showLegend(modes) {
  const box = document.getElementById("route-legend");
  if (!box) return;
  const label = (m) => {
    const s = t(m);
    return s[0].toUpperCase() + s.slice(1);
  };
  box.innerHTML = ["walk", "tram", "bus"]
    .filter((m) => modes.has(m))
    .map((m) => `<span class="legend-item"><i class="legend-line ${m}"></i>${escapeHtml(label(m))}</span>`)
    .join("");
  box.classList.toggle("hidden", !modes.size);
}

let routeModes = new Set();
let planShown = false;

export const planVisible = () => planShown;
let planModes = new Set();
const refreshLegend = () => showLegend(new Set([...routeModes, ...planModes]));

export function showRoute(option, { fit = true } = {}) {
  clearMarkers("route");
  routeModes = new Set();
  if (!option) {
    clearRoute();
    return;
  }
  const { lines, stops } = routeGeoJson(option.legs, (i) => i);
  setData("nomi-route", lines);
  setData("nomi-route-stops", stops);
  setLegOpacity("route", null);
  for (const leg of option.legs) {
    if ((leg.geometry || []).length >= 2) routeModes.add(modeOf(leg));
    if (leg.type === "transit") addTransitMarkers("route", leg);
  }
  const first = option.legs[0];
  const last = option.legs[option.legs.length - 1];
  if (first?.from) addMarker("route", el("", "route-stop walk start"), first.from.lat, first.from.lon);
  if (last?.to) addMarker("route", poiEl("🏁", "place"), last.to.lat, last.to.lon, { anchor: "bottom" });
  refreshLegend();
  map.getContainer().classList.add("route-active"); // przygaś atrakcje, by nie zasłaniały trasy
  if (fit) fitPoints(option.legs.flatMap((l) => l.geometry || []));
}

/** Nawigacja: przebyte odcinki przygaszone, bieżący wyróżniony. */
export function highlightLeg(index) {
  setLegOpacity("route", index, "progress");
}

export function clearRoute() {
  clearMarkers("route");
  setData("nomi-route", EMPTY);
  setData("nomi-route-stops", EMPTY);
  routeModes = new Set();
  refreshLegend();
  map?.getContainer().classList.remove("route-active");
}

// ------------------------------------------------ plan dnia

/**
 * Plan na mapie: ponumerowane punkty i wyznaczone trasy między nimi (pieszo / tramwaj / autobus).
 * plan.legs[i] – przejście do punktu i; starsze plany bez tras – linia przerywana między punktami.
 */
export function showPlan(plan, { fit = true } = {}) {
  clearPlan();
  const stops = plan?.stops || [];
  if (!stops.length) return;
  planShown = true;
  const legs = plan.legs || [];
  const sub = []; // odcinki składowe z numerem przejścia planu
  legs.forEach((leg, i) => (leg?.legs || []).forEach((l) => sub.push({ ...l, planLeg: i })));
  if (sub.length) {
    const { lines, stops: stopPts } = routeGeoJson(sub, (k) => sub[k].planLeg);
    setData("nomi-plan", lines);
    setData("nomi-plan-stops", stopPts);
    planModes = new Set(sub.filter((l) => (l.geometry || []).length >= 2).map(modeOf));
    for (const l of sub) if (l.type === "transit") addTransitMarkers("plan", l);
  } else {
    // Plan bez wyznaczonych tras (zapisany wcześniej): łączymy punkty kropkowaną linią.
    const pts = [plan.start, ...stops].filter(Boolean).map((p) => [p.lat, p.lon]);
    setData("nomi-plan", { type: "FeatureCollection", features: [{ type: "Feature", properties: { mode: "walk", leg: 0 }, geometry: { type: "LineString", coordinates: pts.map(([a, b]) => [b, a]) } }] });
    planModes = new Set(["walk"]);
  }
  setLegOpacity("plan", null);
  if (plan.start) addMarker("plan", el("", "route-stop walk start"), plan.start.lat, plan.start.lon, { title: plan.start.name });
  stops.forEach((s, i) => {
    addMarker("plan", poiEl(String(i + 1), `plan${s.done ? " done" : ""}`), s.lat, s.lon, {
      anchor: "bottom",
      title: s.name,
      popupOffset: 40,
      popupHtml: () => `<div class="popup"><h4>${i + 1}. ${escapeHtml(s.name)}</h4><p class="muted small">${escapeHtml(
        [s.start_time, s.end_time].filter(Boolean).join("–"),
      )}</p>${actionButtons({ ...s, id: s.attraction_id }, { plan: false, narrate: Boolean(s.attraction_id) })}</div>`,
    });
  });
  refreshLegend();
  if (fit) fitPoints([...(plan.start ? [[plan.start.lat, plan.start.lon]] : []), ...stops.map((s) => [s.lat, s.lon]), ...sub.flatMap((l) => l.geometry || [])]);
}

/** Wyróżnia przejście do punktu i (pozostałe odcinki przygaszone) i pokazuje je w całości. */
export function focusPlanLeg(plan, i) {
  const leg = plan?.legs?.[i];
  setLegOpacity("plan", i, "focus");
  const from = i === 0 ? plan.start : plan.stops[i - 1];
  const to = plan.stops[i];
  const pts = [...(leg?.legs || []).flatMap((l) => l.geometry || []), ...[from, to].filter(Boolean).map((p) => [p.lat, p.lon])];
  fitPoints(pts, { maxZoom: 16.5 });
}

export function clearPlan() {
  planShown = false;
  clearMarkers("plan");
  setData("nomi-plan", EMPTY);
  setData("nomi-plan-stops", EMPTY);
  planModes = new Set();
  refreshLegend();
}
