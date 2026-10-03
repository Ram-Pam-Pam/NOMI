// Kontekst czasu rzeczywistego (pozycja, kompas, nawigacja) doklejany do każdej wiadomości użytkownika.
import { config } from "../config.js";
import { attractionById } from "../data/attractions.js";
import { compassName, inBbox } from "../geo.js";
import { attractionsInView, nearbyAttractions } from "../services/attractions.js";
import { describeNow } from "../time.js";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Normalizuje kontekst przysłany przez przeglądarkę (dane niezaufane). */
export function sanitizeContext(raw = {}) {
  const lat = num(raw.lat);
  const lon = num(raw.lon);
  const valid = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const heading = num(raw.heading);
  return {
    lang: raw.lang === "en" ? "en" : "pl",
    lat: valid ? lat : null,
    lon: valid ? lon : null,
    accuracy: num(raw.accuracy),
    heading: heading !== null ? ((heading % 360) + 360) % 360 : null,
    headingSource: raw.headingSource === "compass" || raw.headingSource === "gps" ? raw.headingSource : null,
    speed: num(raw.speed),
    simulated: Boolean(raw.simulated),
    nav: raw.nav && typeof raw.nav === "object" ? {
      destination: String(raw.nav.destination || "").slice(0, 120),
      mode: String(raw.nav.mode || "").slice(0, 20),
      step: String(raw.nav.step || "").slice(0, 200),
      remainingMin: num(raw.nav.remainingMin),
    } : null,
    recentNarrations: Array.isArray(raw.recentNarrations) ? raw.recentNarrations.slice(-5).map(String) : [],
    plan: Array.isArray(raw.plan) ? raw.plan.slice(0, 12).map((p) => String(p).slice(0, 80)) : [],
    onVehicle: raw.onVehicle && typeof raw.onVehicle === "object"
      ? { line: String(raw.onVehicle.line || "").slice(0, 10), mode: String(raw.onVehicle.mode || "").slice(0, 10) }
      : null,
  };
}

export function hasPosition(ctx) {
  return ctx.lat !== null && ctx.lon !== null;
}

export function buildContextBlock(ctx) {
  const pl = ctx.lang !== "en";
  const L = [];
  L.push(`Czas w Krakowie: ${describeNow("pl")}`);
  L.push(`Język interfejsu użytkownika: ${pl ? "polski" : "angielski (odpowiadaj po angielsku)"}`);

  if (hasPosition(ctx)) {
    L.push(
      `Pozycja GPS: ${ctx.lat.toFixed(5)}, ${ctx.lon.toFixed(5)}` +
        (ctx.accuracy ? ` (dokładność ok. ${Math.round(ctx.accuracy)} m)` : "") +
        (ctx.simulated ? " – pozycja ustawiona ręcznie w trybie demo" : ""),
    );
    if (!inBbox(ctx.lat, ctx.lon, config.bbox)) L.push("Uwaga: użytkownik jest poza Krakowem.");
    if (ctx.heading !== null) {
      L.push(
        `Kierunek patrzenia: ${Math.round(ctx.heading)}° (${compassName(ctx.heading, "pl")}), źródło: ${ctx.headingSource === "gps" ? "kierunek ruchu GPS" : "kompas telefonu"}`,
      );
    } else {
      L.push("Kierunek patrzenia: nieznany (brak kompasu).");
    }
    if (ctx.speed !== null && ctx.speed > 0.5) {
      const kmh = Math.round(ctx.speed * 3.6);
      L.push(`Prędkość: ${kmh} km/h${kmh > 15 ? " (prawdopodobnie jedzie pojazdem)" : ""}`);
    }
    if (ctx.onVehicle?.line) L.push(`Wykryto jazdę pojazdem: ${ctx.onVehicle.mode === "tram" ? "tramwaj" : "autobus"} linii ${ctx.onVehicle.line}.`);

    const near = nearbyAttractions({ lat: ctx.lat, lon: ctx.lon, heading: ctx.heading, radius: 700, limit: 4, lang: "pl" });
    if (near.length) {
      L.push("Najbliższe atrakcje:");
      for (const a of near) L.push(`- ${a.name} [${a.id}]: ${a.distance} m${a.direction ? `, ${a.direction}` : ""}`);
    }
    const view = attractionsInView({ lat: ctx.lat, lon: ctx.lon, heading: ctx.heading, lang: "pl" });
    if (view.length) L.push(`W polu widzenia (przed użytkownikiem): ${view.map((a) => `${a.name} (${a.distance} m)`).join(", ")}`);
  } else {
    L.push("Pozycja GPS: nieznana (brak zgody na lokalizację lub brak sygnału).");
  }

  if (ctx.nav?.destination) {
    L.push(
      `Aktywna nawigacja do: ${ctx.nav.destination} (${ctx.nav.mode || "?"})` +
        (ctx.nav.remainingMin !== null ? `, zostało ok. ${Math.round(ctx.nav.remainingMin)} min` : "") +
        (ctx.nav.step ? `. Bieżący krok: ${ctx.nav.step}` : ""),
    );
  }
  if (ctx.recentNarrations.length) {
    const names = ctx.recentNarrations.map((id) => attractionById.get(id)?.name.pl || id);
    L.push(`NOMI niedawno sam opowiedział o: ${names.join(", ")}`);
  }
  if (ctx.plan.length) L.push(`Plan zwiedzania użytkownika: ${ctx.plan.join(" → ")}`);

  return `<kontekst_aplikacji>\n${L.join("\n")}\n</kontekst_aplikacji>`;
}
