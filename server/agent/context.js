// Kontekst czasu rzeczywistego (pozycja, kompas, nawigacja) doklejany do każdej wiadomości użytkownika.
import { config } from "../config.js";
import { attractionById } from "../data/attractions.js";
import { compassName, inBbox } from "../geo.js";
import { attractionsInView, nearbyAttractions } from "../services/attractions.js";
import { describeNow } from "../time.js";

// Preferencje zapamiętywane przez NOMI (narzędzie remember_preference) – przechowuje je przeglądarka.
export const PREF_KEYS = ["diet", "interests", "mobility", "budget", "company", "other"];
const PREF_NAMES = { diet: "dieta", interests: "zainteresowania", mobility: "poruszanie się", budget: "budżet", company: "zwiedza z", other: "inne" };

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
    prefs: Object.fromEntries(
      PREF_KEYS.filter((k) => typeof raw.prefs?.[k] === "string" && raw.prefs[k].trim()).map((k) => [k, raw.prefs[k].trim().slice(0, 120)]),
    ),
    onVehicle: raw.onVehicle && typeof raw.onVehicle === "object"
      ? { line: String(raw.onVehicle.line || "").slice(0, 10), mode: String(raw.onVehicle.mode || "").slice(0, 10) }
      : null,
  };
}

// Najczęstsze słowa – do rozpoznania języka wiadomości (modele chętnie odpowiadają w języku promptu).
const EN_WORDS = new Set("the a an is are was what where when how who why which can could should would do does i you my me it this that there to of in on for with and or please tell about story ticket tickets open opening hours price prices much get see visit eat food near nearby today tomorrow best".split(" "));
const PL_WORDS = new Set("i w z na do nie się jest to co jak gdzie kiedy czy ile który która jakie mi mnie jestem proszę opowiedz o tam tu a ale już można".split(" "));

/** Język wiadomości użytkownika: "pl", "en" albo null (za krótka / niejednoznaczna). */
export function detectLang(text) {
  const s = String(text).toLowerCase();
  if (/[ąćęłńóśźż]/.test(s)) return "pl";
  const words = s.match(/[a-z']+/g) || [];
  let en = 0;
  let pl = 0;
  for (const w of words) {
    if (EN_WORDS.has(w)) en++;
    if (PL_WORDS.has(w)) pl++;
  }
  if (en >= 2 && en > pl) return "en";
  if (pl >= 2 && pl > en) return "pl";
  return null;
}

// Wypowiedzi o sobie, które warto zapamiętać (podpowiedź dla agenta, by wywołał remember_preference).
const PREF_PATTERNS = [
  ["diet", /\b(jestem|jesteśmy)\s+(wegetarian|wegan|weganin|weganką|na diecie)|nie jem (mięsa|ryb|glutenu)|bez glutenu|celiaki|alergi[aęi] na|uczulon|\bi'?m (a )?(vegetarian|vegan)|\bwe'?re (vegetarian|vegan)|gluten[- ]free|allergic to|\bhalal\b|\bkoszern|\bkosher\b/i],
  ["mobility", /na wózku|wózek (inwalidzki|dziecięcy)|z wózkiem|o kulach|nie mogę chodzić po schodach|wheelchair|stroller|pushchair|can'?t (do|climb) stairs/i],
  ["company", /\b(z dziećmi|z dzieckiem|z rodziną|z psem|ze znajomymi|with (my )?(kids|children|family|dog|friends))\b/i],
  ["budget", /(mały|niski|ograniczony) budżet|low budget|on a (tight )?budget/i],
  ["interests", /(interesuje mnie|interesują mnie|pasjonuje mnie|i'?m (really )?interested in|i'?m into)/i],
];

export function preferenceHint(text) {
  return PREF_PATTERNS.find(([, re]) => re.test(String(text)))?.[0] || null;
}

export function hasPosition(ctx) {
  return ctx.lat !== null && ctx.lon !== null;
}

export function buildContextBlock(ctx) {
  const pl = ctx.lang !== "en";
  const L = [];
  L.push(`Czas w Krakowie: ${describeNow("pl")}`);
  L.push(`Język interfejsu: ${pl ? "polski" : "angielski"} (odpowiadaj w języku ostatniej wiadomości użytkownika)`);

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
  const prefs = Object.entries(ctx.prefs || {});
  if (prefs.length) L.push(`Zapamiętane preferencje użytkownika: ${prefs.map(([k, v]) => `${PREF_NAMES[k]}: ${v}`).join("; ")}`);
  // Wskazówki dla tej tury (wyliczone z treści wiadomości).
  // Zawsze, gdy znany – inaczej model ciągnie język poprzednich tur.
  if (ctx.replyLang) {
    L.push(`Język tej odpowiedzi: ${ctx.replyLang === "en" ? "odpowiedz PO ANGIELSKU" : "odpowiedz PO POLSKU"} (jak ostatnia wiadomość użytkownika).`);
  }
  if (ctx.prefHint && !ctx.prefs?.[ctx.prefHint]) {
    L.push(`Użytkownik mówi o sobie coś trwałego (${PREF_NAMES[ctx.prefHint]}) – zapisz to narzędziem remember_preference.`);
  }
  if (ctx.plan.length) L.push(`Plan zwiedzania użytkownika: ${ctx.plan.join(" → ")}`);

  return `<kontekst_aplikacji>\n${L.join("\n")}\n</kontekst_aplikacji>`;
}
