// Trasa planu dnia: prawdziwy routing między kolejnymi punktami (pieszo po ulicach – OSRM,
// dłuższe odcinki tramwajem/autobusem wg rozkładu ZTP) i przeliczony harmonogram.
import { distance } from "../geo.js";
import { serviceDayEpoch } from "../time.js";
import { planRoute } from "./routes.js";

const SAME_PLACE_M = 40; // bliżej – brak przejścia (np. obiad obok poprzedniego punktu)

const round5 = (v) => Math.round(v * 1e5) / 1e5;
const roundGeom = (g) => (g || []).map(([lat, lon]) => [round5(lat), round5(lon)]);
const point = (p) => (p ? { name: p.name || "", lat: round5(p.lat), lon: round5(p.lon), platform: p.platform } : null);

const fmtClock = (ms) =>
  new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" }).format(ms);

/** Epoka dla daty YYYY-MM-DD i godziny HH:MM czasu polskiego. */
function epochAt(date, hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  return serviceDayEpoch(date.replace(/-/g, "")) + ((h * 60 + (m || 0)) * 60_000);
}

/** Wariant trasy w zwartej postaci do zapisania w planie i narysowania na mapie. */
function compactOption(opt) {
  return {
    type: opt.type,
    departure: opt.departure,
    arrival: opt.arrival,
    duration: opt.duration,
    transfers: opt.transfers || 0,
    ticket: opt.ticket,
    legs: opt.legs.map((l) =>
      l.type === "walk"
        ? { type: "walk", duration: l.duration, distance: l.distance || 0, from: point(l.from), to: point(l.to), geometry: roundGeom(l.geometry) }
        : {
            type: "transit",
            mode: l.mode,
            line: l.line,
            headsign: l.headsign,
            from: point(l.from),
            to: point(l.to),
            departure: l.departure,
            arrival: l.arrival,
            duration: l.duration,
            stops: l.stops.length - 1,
            delay: l.delay,
            geometry: roundGeom(l.geometry),
          },
    ),
  };
}

/**
 * Wyznacza trasy między punktami planu i przelicza godziny.
 * legs[i] = przejście DO punktu i (z poprzedniego punktu albo z miejsca startu); null, gdy to to samo miejsce.
 */
export async function routePlan(plan, { start, date, startTime, transport = "mixed", lang = "pl" }) {
  let clock = epochAt(date, startTime) ?? Date.now();
  const stops = [];
  const legs = [];
  let prev = start;

  for (const stop of plan.stops) {
    let leg = null;
    let arrival = clock;
    if (distance(prev.lat, prev.lon, stop.lat, stop.lon) >= SAME_PLACE_M) {
      try {
        const route = await planRoute({
          from: { lat: prev.lat, lon: prev.lon, name: prev.name },
          to: { lat: stop.lat, lon: stop.lon, name: stop.name },
          mode: transport === "walk" ? "walk" : "auto",
          departAt: clock,
          lang,
        });
        const opt = route.options[0];
        leg = compactOption(opt);
        arrival = opt.type === "walk" ? clock + opt.duration * 1000 : opt.arrival;
      } catch (err) {
        console.warn("[plan] routing odcinka nieudany:", err.message);
        arrival = clock + Math.round((distance(prev.lat, prev.lon, stop.lat, stop.lon) * 1.3) / 1.25) * 1000;
      }
    }
    // Godzina z planu AI to „nie wcześniej niż” (np. otwarcie muzeum); prawdziwy dojazd może ją przesunąć.
    const planned = epochAt(date, stop.start_time);
    const startAt = planned && planned > arrival ? planned : arrival;
    const wait = Math.round((startAt - arrival) / 60_000);
    const endAt = startAt + stop.duration_min * 60_000;
    stops.push({ ...stop, start_time: fmtClock(startAt), end_time: fmtClock(endAt), arrive_time: fmtClock(arrival), wait_min: wait >= 5 ? wait : 0 });
    legs.push(leg);
    clock = endAt;
    prev = stop;
  }

  const walkM = legs.flatMap((l) => l?.legs || []).filter((l) => l.type === "walk").reduce((a, l) => a + (l.distance || 0), 0);
  const rides = legs.flatMap((l) => l?.legs || []).filter((l) => l.type === "transit");
  const travelMin = Math.round(legs.reduce((a, l) => a + (l ? l.duration : 0), 0) / 60);
  return {
    ...plan,
    start: point(start),
    // Parametry potrzebne do ponownego przeliczenia tras po edycji planu.
    params: { date, start_time: startTime, transport },
    stops,
    legs,
    stats: {
      start_time: stops[0] ? fmtClock(epochAt(date, startTime) ?? Date.now()) : "",
      end_time: stops.length ? stops[stops.length - 1].end_time : "",
      walk_m: Math.round(walkM),
      rides: rides.length,
      lines: [...new Set(rides.map((r) => r.line))],
      travel_min: travelMin,
      stops: stops.length,
    },
  };
}
