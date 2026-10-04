// Nawigacja krok po kroku: pieszo + tramwaje/autobusy, z komunikatami głosowymi.
import { getJSON } from "./api.js";
import { angleDiff, bearing, distance, fmtClock, fmtDistance, fmtMinutes, pointAlong, projectOnLine, stepInstruction } from "./format.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";
import { clearRoute, highlightLeg, setFollow, showRoute } from "./map.js";
import { setDemoPosition } from "./sensors.js";
import { emit, on, state } from "./state.js";
import { showTicketReminder } from "./tickets.js";
import { toast } from "./ui.js";
import { speak, stopSpeaking } from "./voice.js";

let nav = null;
let simTimer = null;
// Ciekawostka po drodze: w trakcie opowieści komunikaty „gdzie skręcić” są wstrzymane (zamiast nich krótka wibracja),
// a po jej zakończeniu NOMI wraca do trasy, czytając bieżącą instrukcję.
let story = null; // { name, suppressed }
const STORY_MIN_GAP_M = 110; // opowieść tylko, gdy do najbliższego manewru jest co najmniej tyle metrów (~80 s marszu)

const $ = (id) => document.getElementById(id);
const leg = () => nav?.option.legs[nav.legIndex];
const lower = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const pt = (arr) => ({ lat: arr[0], lon: arr[1] });

/**
 * Komunikaty głosowe nawigacji – niezależne od czytania odpowiedzi czatu, z osobnym wyłącznikiem.
 * W trakcie ciekawostki zwykłe komunikaty są wstrzymywane; critical (wysiadka, cel) – zawsze.
 */
const say = (text, { critical = false, ...opts } = {}) => {
  if (story && !critical) {
    story.suppressed = true;
    navigator.vibrate?.(60);
    return;
  }
  if (state.settings.navVoice) speak(text, { ...opts, force: true });
};

function syncVoiceButton() {
  const btn = $("nav-repeat");
  btn.classList.toggle("muted", !state.settings.navVoice);
  btn.setAttribute("aria-label", state.settings.navVoice ? t("navVoiceOff") : t("navVoiceOn"));
  btn.title = btn.getAttribute("aria-label");
  btn.innerHTML = icon(state.settings.navVoice ? "volume" : "volumeX");
}

function syncSimButton() {
  const btn = $("demo-sim");
  if (btn) btn.innerHTML = simTimer ? `${icon("stop")}${t("stopSim")}` : `${icon("play")}${t("simulate")}`;
}

// ------------------------------------------------ ciekawostki po drodze

/** Czy teraz jest dobry moment na ciekawostkę: idziemy pieszo, a najbliższy skręt jest daleko. */
export function storyWindow() {
  if (!nav || story) return null;
  const l = leg();
  if (!l || l.type !== "walk" || nav.phase !== "walk") return null;
  const along = nav.walkProgress?.along ?? 0;
  const remaining = nav.walkProgress?.remaining ?? l.distance ?? 0;
  const k = nextStepIndex(l, along);
  const toTurn = k > 0 && l.steps[k].type !== "arrive" ? l.stepAlong[k] - along : remaining;
  const last = nav.legIndex === nav.option.legs.length - 1;
  return { allowed: toTurn >= STORY_MIN_GAP_M && (!last || remaining > 90), toTurn, geometry: l.geometry, along };
}

/** Początek opowieści w trakcie nawigacji – wstrzymuje komunikaty o skrętach. */
export function storyStart(name) {
  if (!nav) return false;
  story = { name, suppressed: false };
  document.body.classList.add("story-active");
  $("nav-story-text").textContent = t("storyOnRoute");
  $("nav-story").classList.remove("hidden");
  return true;
}

/** Koniec opowieści: komunikaty wracają; jeśli coś pominęliśmy – czytamy bieżącą instrukcję. */
export function storyEnd({ silent = false } = {}) {
  if (!story) return;
  const missed = story.suppressed;
  story = null;
  document.body.classList.remove("story-active");
  $("nav-story").classList.add("hidden");
  if (nav) {
    updateBanner();
    if (missed && !silent) say(`${t("storyNextTurn")} ${lower(currentInstruction())}`);
  }
}

export function initNavigation() {
  on("nav-start", ({ route, index }) => startNavigation(route, index));
  on("position", (pos) => nav && onPosition(pos));
  on("heading", () => nav && updateArrow());
  $("nav-stop").addEventListener("click", () => stopNavigation());
  // Głośnik na banerze: wycisza/włącza komunikaty; po włączeniu od razu czyta bieżącą instrukcję.
  $("nav-repeat").addEventListener("click", () => {
    const on = !state.settings.navVoice;
    emit("settings-patch", { navVoice: on });
    if (on && nav) say(currentInstruction(), { interrupt: true });
    if (!on) stopSpeaking();
  });
  on("settings", () => {
    syncVoiceButton();
    syncSimButton();
  });
  syncVoiceButton();
  syncSimButton();
  $("demo-sim").addEventListener("click", () => (simTimer ? stopSimulation() : startSimulation()));
}

// ------------------------------------------------ start / stop

export function startNavigation(route, index = 0) {
  stopSimulation();
  const option = route.options[index];
  nav = {
    route,
    option,
    to: route.to,
    legIndex: 0,
    announced: new Set(),
    offCount: 0,
    lastReroute: 0,
    phase: null,
    ticketValidUntil: null,
    remindedLegs: new Set(),
  };
  state.nav = nav;
  document.body.classList.add("navigating");
  $("nav-banner").classList.remove("off");
  showRoute(option);
  setFollow(true);
  enterLeg(0, { silent: true });
  say(`${t("navStarted")} ${currentInstruction()}`, { interrupt: true });
  emit("nav-changed", nav);
  setTimeout(() => emit("invalidate-map"), 380);
}

export function stopNavigation({ arrived = false } = {}) {
  if (!nav) return;
  stopSimulation();
  storyEnd({ silent: true });
  if (!arrived) say(t("navEnded"), { critical: true });
  nav = null;
  state.nav = null;
  document.body.classList.remove("navigating");
  $("nav-banner").classList.add("off");
  clearRoute();
  emit("nav-changed", null);
  setTimeout(() => emit("invalidate-map"), 380);
}

/** Skrót stanu nawigacji dla agenta AI. */
export function navSummary() {
  if (!nav) return null;
  return {
    destination: nav.to?.name || "",
    mode: nav.option.type,
    step: currentInstruction(),
    remainingMin: Math.max(0, Math.round((eta() - Date.now()) / 60000)),
  };
}

// ------------------------------------------------ odcinki

function enterLeg(i, { silent = false } = {}) {
  nav.legIndex = i;
  nav.announced = new Set();
  nav.offCount = 0;
  nav.walkProgress = null;
  highlightLeg(i);
  const l = leg();
  if (l.type === "walk") {
    nav.phase = "walk";
    // Pozycje manewrów wzdłuż geometrii (do liczenia odległości do najbliższego skrętu).
    l.stepAlong ??= (l.steps || []).map((s) => projectOnLine(pt(s.location), l.geometry).along);
    if (!silent) say(currentInstruction());
    checkFacing();
  } else {
    nav.phase = "wait";
    l.stopAlong ??= l.stops.map((s) => projectOnLine(s, l.geometry).along);
    if (!silent) say(currentInstruction());
    maybeTicketReminder(i);
  }
  updateBanner();
}

function nextTransitIndex(from) {
  const legs = nav.option.legs;
  for (let i = from; i < legs.length; i++) if (legs[i].type === "transit") return i;
  return -1;
}

/** Czy cel jest za plecami użytkownika – wtedy podpowiadamy, by się odwrócił. */
function checkFacing() {
  const pos = state.position;
  if (!pos || state.heading === null) return;
  const target = walkTarget();
  if (!target || distance(pos, target) < 15) return;
  if (Math.abs(angleDiff(state.heading, bearing(pos, target))) > 120) say(t("turnAround"));
}

// ------------------------------------------------ aktualizacja pozycji

function onPosition(pos) {
  const l = leg();
  if (!l) return;
  if (l.type === "walk") handleWalk(pos, l);
  else handleTransit(pos, l);
  if (nav) updateBanner();
}

function handleWalk(pos, l) {
  const proj = projectOnLine(pos, l.geometry);
  const remaining = Math.max(0, proj.total - proj.along);
  nav.walkProgress = { along: proj.along, remaining };

  // Zejście z trasy → nowa trasa (z odstępem 30 s).
  const tolerance = Math.max(40, (pos.accuracy || 10) * 1.5);
  nav.offCount = proj.dist > tolerance ? nav.offCount + 1 : 0;
  if (nav.offCount >= 3 && Date.now() - nav.lastReroute > 30_000 && !simTimer) {
    reroute();
    return;
  }

  // Zapowiedź najbliższego manewru.
  const k = nextStepIndex(l, proj.along);
  if (k > 0) {
    const toTurn = l.stepAlong[k] - proj.along;
    if (toTurn <= 45 && !nav.announced.has(`step${k}`) && l.steps[k].type !== "arrive") {
      nav.announced.add(`step${k}`);
      say(`${state.settings.lang === "en" ? "In" : "Za"} ${fmtDistance(Math.max(10, toTurn))} ${lower(stepInstruction(l.steps[k]))}`);
    }
  }

  // Bilet: zbliżamy się do przystanku przed jazdą.
  const ti = nextTransitIndex(nav.legIndex + 1);
  if (ti === nav.legIndex + 1) {
    const dep = nav.option.legs[ti];
    const minsToDep = (dep.departure + (dep.delay || 0) * 1000 - Date.now()) / 60000;
    if (remaining < 200 || minsToDep < 6) maybeTicketReminder(ti);
  }

  // Koniec odcinka pieszego.
  const end = l.to;
  if (remaining < 15 || distance(pos, end) < 18) {
    if (nav.legIndex === nav.option.legs.length - 1) arrive();
    else enterLeg(nav.legIndex + 1);
  }
}

function nextStepIndex(l, along) {
  if (!l.stepAlong) return -1;
  for (let i = 1; i < l.stepAlong.length; i++) if (l.stepAlong[i] > along + 8) return i;
  return -1;
}

function handleTransit(pos, l) {
  const proj = projectOnLine(pos, l.geometry);
  const speed = pos.speed ?? 0;
  const departure = l.departure + (l.delay || 0) * 1000;

  if (nav.phase === "wait") {
    const moved = proj.along > 150 && proj.dist < 80;
    if ((speed > 3 && distance(pos, l.from) > 80 && proj.dist < 120) || moved) {
      nav.phase = "ride";
      nav.boardedAt = Date.now();
      state.onVehicle = { line: l.line, mode: l.mode, since: Date.now() };
      emit("on-vehicle", state.onVehicle);
      if (!nav.ticketConfirmed && state.settings.tickets && !nav.announced.has("onboard-ticket")) {
        nav.announced.add("onboard-ticket");
        setTimeout(() => {
          if (nav && nav.phase === "ride" && !nav.ticketConfirmed) {
            showTicketReminder({ mode: l.mode, line: l.line, ticket: nav.option.ticket, onBoard: true, onResult: onTicketAnswer });
          }
        }, 60_000);
      }
    } else if (Date.now() > departure + 10 * 60_000 && !nav.announced.has("missed") && Date.now() - nav.lastReroute > 60_000) {
      nav.announced.add("missed");
      reroute();
    }
    return;
  }

  // Jazda: który przystanek właśnie minęliśmy.
  const passed = l.stopAlong.filter((a) => a <= proj.along + 40).length;
  const lastIdx = l.stops.length - 1;
  const stopsToGo = Math.max(0, lastIdx - Math.max(0, passed - 1));
  nav.stopsToGo = stopsToGo;
  if (stopsToGo === 1 && !nav.announced.has("getoff")) {
    nav.announced.add("getoff");
    say(`${t("nextStopGetOff")}: ${l.to.name}.`, { interrupt: true, critical: true });
    navigator.vibrate?.([200, 100, 200]);
  }
  if (distance(pos, l.to) < 70 && (speed < 2.5 || stopsToGo === 0)) {
    state.onVehicle = null;
    emit("on-vehicle", null);
    if (nav.legIndex === nav.option.legs.length - 1) arrive();
    else enterLeg(nav.legIndex + 1);
  }
}

function onTicketAnswer(has) {
  if (!nav) return;
  if (has) {
    nav.ticketConfirmed = true;
    const first = nav.option.legs[nextTransitIndex(0)];
    const minutes = Number(String(nav.option.ticket?.id || "").replace("min", "")) || 0;
    if (first && minutes) nav.ticketValidUntil = Math.max(Date.now(), first.departure) + minutes * 60_000;
  }
}

function maybeTicketReminder(legIdx) {
  if (!state.settings.tickets || nav.remindedLegs.has(legIdx)) return;
  const l = nav.option.legs[legIdx];
  nav.remindedLegs.add(legIdx);
  // Przesiadka w czasie ważności biletu czasowego – tylko krótka informacja.
  if (nav.ticketValidUntil && l.arrival <= nav.ticketValidUntil) {
    toast(t("ticketValidUntil"));
    return;
  }
  showTicketReminder({ mode: l.mode, line: l.line, ticket: nav.option.ticket, onResult: onTicketAnswer });
}

function arrive() {
  const name = nav.to?.name || "";
  say(`${t("navArrived")}${name ? `: ${name}` : ""}.`, { interrupt: true, critical: true });
  toast(`${t("navArrived")}${name ? `: ${name}` : ""}`, { icon: "flag" });
  const dest = nav.to;
  stopNavigation({ arrived: true });
  emit("arrived", dest);
}

async function reroute() {
  nav.lastReroute = Date.now();
  nav.offCount = 0;
  toast(t("rerouting"));
  say(t("rerouting"));
  const to = nav.to;
  try {
    const route = await getJSON("/api/route", {
      fromlat: state.position.lat,
      fromlon: state.position.lon,
      tolat: to.lat,
      tolon: to.lon,
      toName: to.name,
      mode: nav.option.type === "walk" ? "walk" : "auto",
      lang: state.settings.lang,
    });
    if (!nav || nav.to !== to || !route.options.length) return;
    nav.route = route;
    nav.option = route.options[0];
    nav.remindedLegs = new Set();
    showRoute(nav.option, { fit: false });
    enterLeg(0);
  } catch (err) {
    toast(`${t("noRoute")} ${err.message}`);
  }
}

// ------------------------------------------------ teksty i baner

function walkTarget() {
  const l = leg();
  if (!l || l.type !== "walk") return l?.from || null;
  const along = nav.walkProgress?.along ?? 0;
  const k = nextStepIndex(l, along);
  if (k > 0) return pt(l.steps[k].location);
  return l.to;
}

function transitText(l) {
  const v = `${t(l.mode)} ${l.line}`;
  const departure = l.departure + (l.delay || 0) * 1000;
  const mins = Math.round((departure - Date.now()) / 60000);
  if (state.settings.lang === "en") {
    return `${t("waitFor")} ${v} ${t("direction")} ${l.headsign} ${t("at")} ${l.from.name}, ${t("departsAt")} ${fmtClock(departure)}${mins >= 0 ? ` (${mins} min)` : ""}.`;
  }
  return `${t("waitFor")}: ${v} ${t("direction")} ${l.headsign}, przystanek ${l.from.name}${l.from.platform ? ` (${l.from.platform})` : ""}. Odjazd ${fmtClock(departure)}${mins >= 0 ? `, za ${mins} min` : ""}.`;
}

export function currentInstruction() {
  const l = leg();
  if (!l) return "";
  if (l.type === "walk") {
    const along = nav.walkProgress?.along ?? 0;
    const k = nextStepIndex(l, along);
    const next = nav.option.legs[nav.legIndex + 1];
    if (k > 0 && l.steps[k].type !== "arrive") {
      const d = l.stepAlong[k] - along;
      return `${state.settings.lang === "en" ? "In" : "Za"} ${fmtDistance(Math.max(10, d))} ${lower(stepInstruction(l.steps[k]))}`;
    }
    if (l.steps?.length && along < 10) return stepInstruction(l.steps[0]);
    const target = next?.type === "transit" ? next.from.name : l.to.name || nav.to?.name || "";
    return `${t("walkTo")}: ${target} (${fmtDistance(nav.walkProgress?.remaining ?? l.distance)})`;
  }
  if (nav.phase === "wait") return transitText(l);
  const left = nav.stopsToGo ?? l.stops.length - 1;
  return `${t("getOffAt")}: ${l.to.name} · ${left} ${t("stopsCount")}`;
}

/** Szacowany przyjazd: po ostatnim pojeździe wg rozkładu (+opóźnienie), pieszo wg pozostałego dystansu. */
function eta() {
  const legs = nav.option.legs;
  let lastTransit = -1;
  for (let i = nav.legIndex; i < legs.length; i++) if (legs[i].type === "transit") lastTransit = i;
  if (lastTransit >= 0) {
    const tl = legs[lastTransit];
    const walkAfter = legs.slice(lastTransit + 1).reduce((s, l) => s + l.duration * 1000, 0);
    return tl.arrival + (tl.delay || 0) * 1000 + walkAfter;
  }
  const l = leg();
  const remaining = nav.walkProgress?.remaining ?? l?.distance ?? 0;
  return Date.now() + (remaining / 1.3) * 1000;
}

function updateBanner() {
  if (!nav) return;
  const l = leg();
  $("nav-instruction").textContent = currentInstruction();
  const etaMs = eta();
  const parts = [nav.to?.name || "", `${t("arrive")} ${fmtClock(etaMs)}`, `${fmtMinutes((etaMs - Date.now()) / 1000)} ${t("remaining")}`].filter(Boolean);
  if (l.type === "transit" && l.delay) parts.splice(1, 0, `+${Math.round(l.delay / 60)} min`);
  $("nav-meta").textContent = parts.join(" · ");
  $("nav-arrow").classList.toggle("vehicle", l.type === "transit" && nav.phase === "ride");
  updateArrow();
}

/** Strzałka wskazuje cel względem kierunku, w którym patrzy użytkownik. */
function updateArrow() {
  const pos = state.position;
  const svg = $("nav-arrow").querySelector("svg");
  const target = walkTarget();
  if (!pos || !target) return;
  const b = bearing(pos, target);
  const rot = state.heading === null ? b : angleDiff(state.heading, b);
  svg.style.transform = `rotate(${rot}deg)`;
}

// ------------------------------------------------ symulacja trasy (tryb demo)

function startSimulation() {
  if (!nav) {
    toast(state.settings.lang === "en" ? "Start navigation first." : "Najpierw uruchom nawigację.");
    return;
  }
  const FACTOR = 6;
  let legIdx = nav.legIndex;
  let along = 0;
  let waitTicks = 0;
  simTimer = setInterval(() => {
    if (!nav) return stopSimulation();
    const l = nav.option.legs[legIdx];
    if (!l) return stopSimulation();
    if (l.type === "transit" && waitTicks < 3) {
      waitTicks++;
      const p = l.geometry[0];
      setDemoPosition(p[0], p[1], { speed: 0 });
      return;
    }
    const speed = l.type === "walk" ? 1.4 : 8;
    along += speed * FACTOR;
    const p = pointAlong(l.geometry, along);
    setDemoPosition(p.lat, p.lon, { speed: l.type === "walk" ? 1.4 : speed, heading: p.bearing ?? undefined });
    if (p.end) {
      if (l.type === "transit") setDemoPosition(p.lat, p.lon, { speed: 0 });
      legIdx++;
      along = 0;
      waitTicks = 0;
    }
  }, 1000);
  syncSimButton();
}

function stopSimulation() {
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
  syncSimButton();
}
