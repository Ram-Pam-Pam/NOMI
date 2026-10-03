// Planer zapasowy (bez AI): zachłanny wybór najbliższych atrakcji pasujących do zainteresowań.
import { ATTRACTIONS } from "../data/attractions.js";
import { distance } from "../geo.js";

const PACE = { relaxed: 1.3, normal: 1, intense: 0.8 };
const FOOD_AREAS = [
  { lat: 50.0617, lon: 19.9373, pl: "Stare Miasto – okolice Rynku", en: "Old Town – around the Main Square" },
  { lat: 50.0514, lon: 19.9447, pl: "Kazimierz – okolice Placu Nowego", en: "Kazimierz – around Plac Nowy" },
  { lat: 50.0468, lon: 19.9542, pl: "Podgórze – okolice Placu Bohaterów Getta", en: "Podgórze – around Ghetto Heroes Square" },
  { lat: 50.0677, lon: 19.9391, pl: "Kleparz – okolice targu", en: "Kleparz – around the market" },
];

const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min) % 60).padStart(2, "0")}`;

function travel(from, to, transport, lang) {
  const d = distance(from.lat, from.lon, to.lat, to.lon);
  const walkMin = Math.max(2, Math.round((d * 1.3) / 75));
  if (transport !== "walk" && walkMin > 25) {
    const rideMin = Math.round(walkMin / 3) + 10;
    return { minutes: rideMin, text: lang === "en" ? `Tram/bus, about ${rideMin} min (check live route)` : `Tramwaj/autobus, ok. ${rideMin} min (sprawdź trasę na żywo)` };
  }
  return { minutes: walkMin, text: lang === "en" ? `Walk about ${walkMin} min` : `Spacer ok. ${walkMin} min` };
}

export function simplePlan(prefs) {
  const lang = prefs.lang === "en" ? "en" : "pl";
  const pace = PACE[prefs.pace] ?? 1;
  const total = prefs.hours * 60;
  const [h, m] = String(prefs.startTime || "10:00").split(":").map(Number);
  let clock = (h || 10) * 60 + (m || 0);
  const end = clock + total;
  let pos = prefs.start;
  const interests = prefs.interests || [];
  const maxRadius = prefs.transport === "walk" ? 3500 : 9000;

  const pool = ATTRACTIONS.filter((a) => distance(prefs.start.lat, prefs.start.lon, a.lat, a.lon) <= maxRadius);
  const visited = new Set();
  const stops = [];
  let mealDone = false;

  // Posiłek tylko w porach obiadu (12:00–15:30) lub kolacji (18:00–21:00) i po min. 1,5 h zwiedzania.
  const mealWindow = (min) => (min >= 12 * 60 && min <= 15.5 * 60) || (min >= 18 * 60 && min <= 21 * 60);
  const startClock = clock;

  while (clock < end) {
    if (!mealDone && mealWindow(clock) && clock - startClock >= 90) {
      const dinner = clock >= 18 * 60;
      const area = FOOD_AREAS.reduce((best, f) =>
        distance(pos.lat, pos.lon, f.lat, f.lon) < distance(pos.lat, pos.lon, best.lat, best.lon) ? f : best,
      );
      const t = travel(pos, area, prefs.transport, lang);
      const dur = Math.round(60 * pace);
      if (clock + t.minutes + dur > end) break;
      clock += t.minutes;
      stops.push({
        name: lang === "en" ? `${dinner ? "Dinner" : "Lunch"} – ${area.en}` : `${dinner ? "Kolacja" : "Obiad"} – ${area.pl}`,
        attraction_id: "",
        kind: "meal",
        lat: area.lat,
        lon: area.lon,
        start_time: hhmm(clock),
        duration_min: dur,
        description: lang === "en" ? "Time for Polish food: pierogi, żurek or a milk bar." : "Czas na polską kuchnię: pierogi, żurek albo bar mleczny.",
        tip: lang === "en" ? "Tap “Find restaurants” to see places nearby." : "Kliknij „Znajdź lokale”, by zobaczyć restauracje w pobliżu.",
        getting_there: t.text,
      });
      clock += dur;
      pos = area;
      mealDone = true;
      continue;
    }

    let best = null;
    for (const a of pool) {
      if (visited.has(a.id)) continue;
      const matches = interests.length ? a.tags.filter((t) => interests.includes(t)).length : 1;
      if (interests.length && !matches) continue;
      const d = distance(pos.lat, pos.lon, a.lat, a.lon);
      const score = d / (1 + matches) + (a.visitMin > 100 ? 400 : 0);
      if (!best || score < best.score) best = { a, score };
    }
    if (!best) break;
    const a = best.a;
    const t = travel(pos, a, prefs.transport, lang);
    const dur = Math.round(a.visitMin * pace);
    visited.add(a.id);
    if (clock + t.minutes + dur > end) continue;
    clock += t.minutes;
    stops.push({
      name: a.name[lang],
      attraction_id: a.id,
      kind: a.category === "museum" ? "museum" : a.category === "church" ? "church" : a.category === "viewpoint" ? "viewpoint" : "sight",
      lat: a.lat,
      lon: a.lon,
      start_time: hhmm(clock),
      duration_min: dur,
      description: a.summary[lang],
      tip: a.tips || "",
      getting_there: t.text,
    });
    clock += dur;
    pos = a;
  }

  return {
    title: lang === "en" ? "Your Kraków walk" : "Twój spacer po Krakowie",
    summary:
      lang === "en"
        ? `A ${prefs.hours}-hour route with ${stops.length} stops, ordered to minimise walking.`
        : `Trasa na ${prefs.hours} h z ${stops.length} punktami, ułożona tak, by ograniczyć chodzenie.`,
    stops,
    tips:
      lang === "en"
        ? ["Wear comfortable shoes – the Old Town is cobbled.", "Book timed museum tickets in advance in high season."]
        : ["Załóż wygodne buty – na Starym Mieście jest dużo bruku.", "W sezonie rezerwuj z wyprzedzeniem bilety do muzeów na godzinę."],
  };
}
