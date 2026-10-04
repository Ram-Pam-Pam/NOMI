// Wspólny stan aplikacji + prosta szyna zdarzeń.
const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, data) {
  for (const fn of listeners.get(event) || []) {
    try {
      fn(data);
    } catch (err) {
      console.error(`[${event}]`, err);
    }
  }
}

// localStorage bywa niedostępny (tryb prywatny) – zawsze przez try/catch.
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`nomi.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`nomi.${key}`, JSON.stringify(value));
    } catch {
      /* brak pamięci lokalnej */
    }
  },
};

const DEFAULT_SETTINGS = {
  lang: (navigator.language || "pl").toLowerCase().startsWith("pl") ? "pl" : "en",
  voice: true,
  navVoice: true, // komunikaty głosowe nawigacji (niezależnie od czytania odpowiedzi czatu)
  conversation: false,
  narrate: true,
  tickets: true,
  demo: false,
};

export const state = {
  settings: { ...DEFAULT_SETTINGS, ...store.get("settings", {}) },
  position: null, // { lat, lon, accuracy, speed, course, ts, simulated }
  heading: null, // stopnie, 0 = północ
  headingSource: null, // "compass" | "gps" | "demo"
  gpsStatus: "off", // off | wait | ok | denied | error
  compassStatus: "off", // off | ok | denied | unsupported
  nav: null, // stan nawigacji (navigation.js)
  onVehicle: null, // { line, mode, since }
  recentNarrations: store.get("recentNarrations", []),
  plan: store.get("plan", null),
  activeTab: store.get("tab", "agent"),
};

export function saveSettings(patch) {
  Object.assign(state.settings, patch);
  store.set("settings", state.settings);
  emit("settings", state.settings);
}

export function sessionId() {
  let id = store.get("session", null);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    store.set("session", id);
  }
  return id;
}

export function newSession() {
  store.set("session", null);
  return sessionId();
}
