// Interfejs zakładki Mapa: wyszukiwarka, szybkie akcje, wysuwany panel z trasami i miejscami.
import { getJSON } from "./api.js";
import { escapeHtml, fmtClock, fmtDistance, fmtMinutes } from "./format.js";
import { t } from "./i18n.js";
import { PLACE_ICON, icon } from "./icons.js";
import { clearRoute, clearTransientMarkers, fitPoints, flyTo, locate, showPlaces, showPoint, showRoute, toggleAttractions } from "./map.js";
import { rotateDemoHeading } from "./sensors.js";
import { emit, on, state } from "./state.js";
import { toast } from "./ui.js";

const SHEET_MS = 340; // czas animacji panelu (jak w CSS)
const sheet = () => document.getElementById("map-sheet");
const body = () => document.getElementById("sheet-body");
let current = null; // { route, selected, mode, to }
let closeTimer = null;

// ------------------------------------------------ panel (otwieranie / zamykanie z animacją)

export function openSheet(html) {
  const el = sheet();
  clearTimeout(closeTimer);
  body().innerHTML = html;
  el.classList.remove("collapsed");
  if (el.classList.contains("hidden")) {
    el.classList.add("off");
    el.classList.remove("hidden");
    void el.offsetHeight; // wymuś przeliczenie, żeby animacja wjazdu ruszyła
  }
  el.classList.remove("off");
}

export function closeSheet() {
  const el = sheet();
  el.classList.add("off");
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => el.classList.add("hidden"), SHEET_MS);
  if (!state.nav) clearRoute();
  clearTransientMarkers();
  document.querySelectorAll("#map-chips .chip.place-on").forEach((c) => c.classList.remove("on", "place-on"));
  current = null;
}

/** Ile miejsca zajmuje panel – żeby trasa nie chowała się pod nim. */
const sheetHeight = () => (sheet().classList.contains("hidden") ? 0 : sheet().getBoundingClientRect().height);

function initSheetGestures() {
  const grip = document.getElementById("sheet-grip");
  let drag = null;
  grip.addEventListener("pointerdown", (e) => {
    drag = { y: e.clientY, dy: 0 };
    sheet().style.transition = "none";
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    sheet().style.transform = `translateY(${drag.dy}px)`;
  });
  const end = () => {
    if (!drag) return;
    const { dy } = drag;
    drag = null;
    sheet().style.transition = "";
    sheet().style.transform = "";
    if (dy > 140) closeSheet();
    else if (dy > 40) sheet().classList.add("collapsed");
    else if (dy < 6) sheet().classList.toggle("collapsed");
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}

// ------------------------------------------------ inicjalizacja

export function initMapUi() {
  document.getElementById("sheet-close").addEventListener("click", closeSheet);
  document.getElementById("btn-locate").addEventListener("click", locate);
  initSheetGestures();
  initSearch();

  document.getElementById("map-chips").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-action]");
    if (!chip) return;
    const a = chip.dataset.action;
    if (a === "attractions") {
      chip.classList.toggle("on", toggleAttractions());
      return;
    }
    document.querySelectorAll("#map-chips .chip.place-on").forEach((c) => c.classList.remove("on", "place-on"));
    chip.classList.add("on", "place-on");
    showNearbyPlaces(a);
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
    if (act === "option") selectOption(Number(el.dataset.index), { compact: true });
    if (act === "expand") expandOptions();
    if (act === "mode") requestRoute({ to: current.to, mode: el.dataset.mode });
    if (act === "start") {
      emit("nav-start", { route: current.route, index: current.selected });
      closeSheet(); // panel zjeżdża w dół, trasa zostaje (nawigacja jest aktywna)
    }
    if (act === "close") closeSheet();
    if (act === "navigate") requestRoute({ to: { lat: Number(el.dataset.lat), lon: Number(el.dataset.lon), name: el.dataset.name } });
    if (act === "focus") flyTo(Number(el.dataset.lat), Number(el.dataset.lon), 17.5);
  });

  on("route-request", (r) => requestRoute(r));
  // Plan dnia pokazany na mapie: zamykamy panel z poprzednią trasą/lokalami (chyba że trwa nawigacja).
  on("plan-shown", () => {
    if (!state.nav && !sheet().classList.contains("hidden")) closeSheet();
  });
  on("attractions-toggled", (onState) => {
    document.querySelector('#map-chips [data-action="attractions"]')?.classList.toggle("on", onState);
  });
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
        (r, i) => `<li role="option" data-i="${i}"><span class="ic">${icon(r.type === "attraction" ? "star" : r.type === "stop" ? "busStop" : "pin")}</span>
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
  openSheet(`<h3>${icon("flag")}${escapeHtml(to.name || "")}</h3><div class="empty"><span class="spinner"></span></div>`);
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
    openSheet(`<h3>${icon("flag")}${escapeHtml(to.name || "")}</h3><div class="empty">${t("noRoute")} ${escapeHtml(err.message)}</div>`);
  }
}

/** Pokazuje gotową trasę (np. policzoną przez agenta): lista wariantów, pierwszy zaznaczony. */
export function presentRoute(route, { mode = "auto", switchTab = true } = {}) {
  if (switchTab) emit("show-tab", "map");
  current = { to: route.to, mode, route, selected: route.recommended || 0 };
  renderRouteSheet();
  selectOption(current.selected, { compact: route.options.length === 1 });
}

function legsLine(o) {
  return o.legs
    .map((l) =>
      l.type === "walk"
        ? `<span class="leg-badge walk">${icon("walk")}${Math.max(1, Math.round(l.duration / 60))}</span>`
        : `<span class="leg-badge ${l.mode}">${icon(l.mode)}${escapeHtml(l.line)}</span>`,
    )
    .join(`<span class="sep">${icon("chevronRight")}</span>`);
}

function delayBadge(delay) {
  if (delay === null || delay === undefined) return "";
  const min = Math.round(delay / 60);
  return min >= 1 ? `<span class="delay">+${min} ${t("minShort")}</span>` : `<span class="ontime">${t("onTime")}</span>`;
}

function legDetail(l) {
  if (l.type === "walk") {
    return `<div class="leg-row"><div class="t">${fmtClock(l.departure)}</div><div><span class="walk-line">${icon("walk")}${t("walkTo")}</span> <b>${escapeHtml(l.to.name || "")}</b> · ${fmtMinutes(l.duration)}${l.distance ? ` · ${fmtDistance(l.distance)}` : ""}</div></div>`;
  }
  return `<div class="leg-row"><div class="t">${fmtClock(l.departure)}</div><div>
    <span class="leg-badge ${l.mode}">${icon(l.mode)}${escapeHtml(l.line)}</span> ${t("direction")} <b>${escapeHtml(l.headsign)}</b> ${delayBadge(l.delay)}<br/>
    <span class="muted">${escapeHtml(l.from.name)}${l.from.platform ? ` (${escapeHtml(l.from.platform)})` : ""} → ${t("getOff")}: <b>${escapeHtml(l.to.name)}</b> ${fmtClock(l.arrival)} · ${l.stops.length - 1} ${t("stopsCount")}</span>
  </div></div>`;
}

function renderRouteSheet() {
  const route = current.route;
  const modes = [
    ["auto", t("best")],
    ["walk", t("walk")],
    ["transit", t("transit")],
  ];
  openSheet(`
    <div class="route-sheet" id="route-sheet">
      <h3>${icon("flag")}${escapeHtml(route.to.name || "")}</h3>
      <div class="segmented">${modes.map(([m, label]) => `<button type="button" data-sheet="mode" data-mode="${m}" class="${current.mode === m ? "on" : ""}">${label}</button>`).join("")}</div>
      ${route.warning ? `<p class="muted small warning-line">${icon("alert")}${escapeHtml(route.warning)}</p>` : ""}
      <div class="opts">
        ${route.options
          .map(
            (opt, idx) => `<div class="opt-wrap" data-index="${idx}"><div class="opt-inner">
              <button type="button" class="route-opt" data-sheet="option" data-index="${idx}">
                <div class="top"><span class="dur">${fmtMinutes(opt.duration)}</span><span class="times">${fmtClock(opt.departure)} – ${fmtClock(opt.arrival)}</span></div>
                <div class="legs-line">${legsLine(opt)}</div>
                ${opt.ticket ? `<div class="ticket-line">${icon("ticket")}${escapeHtml(opt.ticket.label)} – ${opt.ticket.price} zł</div>` : ""}
              </button></div></div>`,
          )
          .join("")}
      </div>
      ${route.options.length > 1 ? `<button type="button" class="link-btn more-opts" data-sheet="expand">${icon("chevronDown")}${t("otherOptions")} (${route.options.length - 1})</button>` : ""}
      <div class="collapsible closed" id="route-details"><div class="collapsible-inner"><div class="leg-detail"></div></div></div>
      <div class="sheet-actions">
        <button class="btn primary block big" type="button" data-sheet="start">${icon("navigation")}${t("startNav")}</button>
      </div>
    </div>`);
}

/** Zaznacza wariant; w trybie compact pozostałe warianty płynnie się zwijają, a szczegóły rozwijają. */
function selectOption(i, { compact = false } = {}) {
  const box = document.getElementById("route-sheet");
  if (!box || !current?.route) return;
  current.selected = i;
  const o = current.route.options[i];
  box.querySelectorAll(".opt-wrap").forEach((w) => w.classList.toggle("is-selected", Number(w.dataset.index) === i));
  box.querySelector(".leg-detail").innerHTML = o.legs.map(legDetail).join("");
  box.classList.toggle("compact", compact);
  document.getElementById("route-details").classList.toggle("closed", !compact);
  showRoute(o, { fit: false });
  // Dopasuj mapę po zakończeniu animacji panelu – wtedy znamy jego docelową wysokość.
  setTimeout(() => fitRoute(o), SHEET_MS + 20);
}

function expandOptions() {
  const box = document.getElementById("route-sheet");
  box?.classList.remove("compact");
  document.getElementById("route-details")?.classList.add("closed");
  setTimeout(() => current?.route && fitRoute(current.route.options[current.selected]), SHEET_MS + 20);
}

function fitRoute(option) {
  const pts = option.legs.flatMap((l) => l.geometry || []);
  if (!pts.length) return;
  fitPoints(pts, { bottom: sheetHeight() + 20, maxZoom: 16.5 });
}

// ------------------------------------------------ miejsca w pobliżu

const NEAR_RADIUS = { restaurant: 500, tourist_info: 2000, toilets: 1200, ticket_machine: 1000, money: 800, pharmacy: 1500 };

export async function showNearbyPlaces(type, center = state.position) {
  emit("show-tab", "map");
  if (!center) return toast(t("noGps"));
  openSheet(`<h3>${icon(PLACE_ICON[type] || "pin")}${t("placesTitle")}</h3><div class="empty"><span class="spinner"></span></div>`);
  try {
    const places = await getJSON("/api/places", { type, lat: center.lat, lon: center.lon, radius: NEAR_RADIUS[type] ?? 600, limit: 25 });
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
        <div class="ico">${icon(PLACE_ICON[p.type || type] || "pin")}</div>
        <div><h4>${escapeHtml(p.name)}</h4>
          <div class="meta">${[p.distance != null ? fmtDistance(p.distance) : null, p.kind, p.cuisine, p.openingHours ? `${t("osmHours")}: ${p.openingHours}` : null].filter(Boolean).map(escapeHtml).join(" · ")}</div>
          ${p.note ? `<p>${escapeHtml(p.note)}</p>` : ""}
          <div class="actions">
            <button class="btn small primary" data-sheet="navigate" data-lat="${p.lat}" data-lon="${p.lon}" data-name="${escapeHtml(p.name)}">${icon("navigation")}${t("navigate")}</button>
            <button class="btn small icon-only" data-sheet="focus" data-lat="${p.lat}" data-lon="${p.lon}" aria-label="${t("showOnMap")}" title="${t("showOnMap")}">${icon("pin")}</button>
            ${p.website ? `<a class="btn small" href="${escapeHtml(p.website)}" target="_blank" rel="noopener">${icon("external")}www</a>` : ""}
          </div></div></div>`,
    )
    .join("");
  openSheet(`<h3>${icon(PLACE_ICON[type] || "pin")}${escapeHtml(title)}</h3><div class="list">${rows || `<div class="empty">${t("noPlaces")}</div>`}</div>`);
}
