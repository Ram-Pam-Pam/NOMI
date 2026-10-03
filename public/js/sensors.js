// Lokalizacja (GPS) i kierunek patrzenia (kompas) w czasie rzeczywistym.
import { emit, state } from "./state.js";
import { distance } from "./format.js";

let watchId = null;
let lastFix = null;

// ------------------------------------------------ GPS

export function startGeolocation() {
  if (!("geolocation" in navigator)) {
    setGpsStatus("error");
    return;
  }
  if (watchId !== null) return;
  setGpsStatus("wait");
  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 25000,
  });
}

function setGpsStatus(s) {
  state.gpsStatus = s;
  emit("gps-status", s);
}

function onPosition(p) {
  if (state.settings.demo) return;
  const c = p.coords;
  let speed = Number.isFinite(c.speed) ? c.speed : null;
  const fix = { lat: c.latitude, lon: c.longitude, ts: p.timestamp || Date.now() };
  // Część przeglądarek nie podaje prędkości – liczymy z kolejnych odczytów.
  if (speed === null && lastFix) {
    const dt = (fix.ts - lastFix.ts) / 1000;
    if (dt >= 2 && dt < 60) speed = distance(lastFix, fix) / dt;
  }
  lastFix = fix;
  setGpsStatus("ok");
  setPosition({
    ...fix,
    accuracy: c.accuracy,
    speed,
    course: Number.isFinite(c.heading) && (speed ?? 0) > 1 ? c.heading : null,
    simulated: false,
  });
}

function onPositionError(err) {
  setGpsStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
  emit("gps-error", err);
}

export function setPosition(pos) {
  state.position = pos;
  // Bez kompasu: kierunek ruchu z GPS jako przybliżenie kierunku patrzenia.
  if (state.compassStatus !== "ok" && !state.settings.demo && pos.course !== null && pos.course !== undefined) {
    setHeading(pos.course, "gps");
  }
  emit("position", pos);
}

// ------------------------------------------------ kompas

let smoothX = null;
let smoothY = null;
let lastEmit = 0;
let absoluteSeen = false;

const screenAngle = () => (screen.orientation?.angle ?? window.orientation ?? 0) || 0;

/** Kierunek tylnej części telefonu z kątów alpha/beta/gamma (wzór z W3C, uwzględnia pochylenie). */
function headingFromEuler(alpha, beta, gamma) {
  const d = Math.PI / 180;
  const x = (beta || 0) * d;
  const y = (gamma || 0) * d;
  const z = (alpha || 0) * d;
  const cX = Math.cos(x);
  const cY = Math.cos(y);
  const cZ = Math.cos(z);
  const sX = Math.sin(x);
  const sY = Math.sin(y);
  const sZ = Math.sin(z);
  const Vx = -cZ * sY - sZ * sX * cY;
  const Vy = -sZ * sY + cZ * sX * cY;
  let h = Math.atan(Vx / Vy);
  if (Vy < 0) h += Math.PI;
  else if (Vx < 0) h += 2 * Math.PI;
  return (h * 180) / Math.PI;
}

function pushHeading(raw) {
  if (!Number.isFinite(raw)) return;
  const r = (raw * Math.PI) / 180;
  // Wygładzanie wykładnicze na okręgu (bez skoku 359° → 0°).
  if (smoothX === null) {
    smoothX = Math.cos(r);
    smoothY = Math.sin(r);
  } else {
    smoothX = smoothX * 0.75 + Math.cos(r) * 0.25;
    smoothY = smoothY * 0.75 + Math.sin(r) * 0.25;
  }
  const h = ((Math.atan2(smoothY, smoothX) * 180) / Math.PI + 360) % 360;
  const now = performance.now();
  if (now - lastEmit < 80) return;
  lastEmit = now;
  if (state.compassStatus !== "ok") {
    state.compassStatus = "ok";
    emit("compass-status", "ok");
  }
  setHeading(h, "compass");
}

function onAbsolute(e) {
  if (state.settings.demo || e.alpha === null) return;
  absoluteSeen = true;
  const flat = Math.abs(e.beta ?? 0) < 25 && Math.abs(e.gamma ?? 0) < 25;
  const h = flat ? 360 - e.alpha : headingFromEuler(e.alpha, e.beta, e.gamma);
  pushHeading((h + screenAngle() + 360) % 360);
}

function onRelative(e) {
  if (state.settings.demo) return;
  if (typeof e.webkitCompassHeading === "number" && e.webkitCompassHeading >= 0) {
    // iOS: kierunek magnetyczny już skompensowany.
    pushHeading((e.webkitCompassHeading + screenAngle()) % 360);
  } else if (e.absolute && !absoluteSeen && e.alpha !== null) {
    onAbsolute(e);
  }
}

/** Uruchamia kompas. Na iOS wymaga gestu użytkownika (requestPermission). */
export async function enableCompass() {
  if (typeof DeviceOrientationEvent === "undefined") {
    state.compassStatus = "unsupported";
    emit("compass-status", "unsupported");
    return false;
  }
  try {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== "granted") {
        state.compassStatus = "denied";
        emit("compass-status", "denied");
        return false;
      }
    }
  } catch {
    state.compassStatus = "denied";
    emit("compass-status", "denied");
    return false;
  }
  window.addEventListener("deviceorientationabsolute", onAbsolute, true);
  window.addEventListener("deviceorientation", onRelative, true);
  // Jeśli przez 3 s nie przyjdzie żaden odczyt – urządzenie nie ma magnetometru.
  setTimeout(() => {
    if (state.compassStatus !== "ok") {
      state.compassStatus = "unsupported";
      emit("compass-status", "unsupported");
    }
  }, 3000);
  return true;
}

export function compassNeedsPermission() {
  return typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";
}

export function setHeading(h, source) {
  state.heading = ((h % 360) + 360) % 360;
  state.headingSource = source;
  emit("heading", state.heading);
}

// ------------------------------------------------ tryb demo

export function setDemoPosition(lat, lon, extra = {}) {
  setPosition({ lat, lon, accuracy: 5, speed: extra.speed ?? 0, course: null, ts: Date.now(), simulated: true });
  if (Number.isFinite(extra.heading)) setHeading(extra.heading, "demo");
}

export function rotateDemoHeading(delta) {
  setHeading((state.heading ?? 0) + delta, "demo");
}
