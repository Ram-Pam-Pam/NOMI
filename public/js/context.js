// Kontekst czasu rzeczywistego wysyłany do agenta przy każdym pytaniu.
import { navSummary } from "./navigation.js";
import { state } from "./state.js";

export function buildContext() {
  const p = state.position;
  return {
    lang: state.settings.lang,
    lat: p?.lat,
    lon: p?.lon,
    accuracy: p?.accuracy,
    heading: state.heading,
    headingSource: state.headingSource === "gps" ? "gps" : state.heading !== null ? "compass" : null,
    speed: p?.speed,
    simulated: Boolean(p?.simulated),
    nav: navSummary(),
    recentNarrations: state.recentNarrations.slice(-5).map((r) => r.id),
    plan: (state.plan?.stops || []).filter((s) => !s.done).map((s) => `${s.start_time || ""} ${s.name}`.trim()),
    prefs: state.prefs,
    onVehicle: state.onVehicle ? { line: state.onVehicle.line, mode: state.onVehicle.mode } : null,
  };
}
