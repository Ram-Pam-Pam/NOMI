// Fasada komunikacji miejskiej: rozkład (odświeżany codziennie), dane na żywo, odjazdy.
import { localYmd } from "../time.js";
import { MODE_TRAM, NO_PICKUP, loadTimetable } from "./gtfs.js";
import { Realtime } from "./realtime.js";
import { describeJourney, planTransit } from "./router.js";
import { distance } from "../geo.js";

let timetable = null;
let loading = null;
let lastError = null;

export const realtime = new Realtime(() => timetable);

export function getTimetable() {
  return timetable;
}

export function transitStatus() {
  return {
    ready: Boolean(timetable),
    loading: Boolean(loading),
    error: timetable ? null : lastError,
    ...(timetable ? timetable.stats : {}),
  };
}

export async function refreshTimetable({ forceDownload = false } = {}) {
  if (loading) return loading;
  const ymd = localYmd();
  const t0 = Date.now();
  loading = loadTimetable(ymd, { forceDownload })
    .then((tt) => {
      timetable = tt;
      lastError = null;
      console.log(`[gtfs] Rozkład na ${ymd} gotowy w ${Date.now() - t0} ms`, tt.stats);
      return tt;
    })
    .catch((err) => {
      lastError = err.message;
      console.error("[gtfs] Błąd ładowania rozkładu:", err.message);
      return timetable;
    })
    .finally(() => (loading = null));
  return loading;
}

/** Start + automatyczne przebudowanie po zmianie doby i co 12 h (nowe pliki GTFS). */
export function startTimetableService() {
  refreshTimetable();
  setInterval(() => {
    if (!timetable) return refreshTimetable();
    const stale = Date.now() - timetable.builtAt > 12 * 3600_000;
    if (timetable.baseYmd !== localYmd() || stale) refreshTimetable({ forceDownload: stale });
  }, 10 * 60_000).unref();
}

/** Warianty podróży komunikacją miejską (bez geometrii pieszej). */
export async function transitJourneys(from, to, departAt = Date.now(), count = 3) {
  const tt = timetable;
  if (!tt) return { error: "Rozkład jazdy jeszcze się ładuje – spróbuj za chwilę." };
  const delays = await realtime.getDelays().catch(() => new Map());
  const raw = planTransit(tt, from, to, tt.relSeconds(departAt), count + 1);
  const all = raw.map((r) => describeJourney(tt, r, from, to, delays));
  // Odrzuć warianty zdominowane: inny wyjeżdża nie wcześniej, dojeżdża nie później i ma ≤ przesiadek.
  const journeys = all.filter(
    (j) =>
      !all.some(
        (o) =>
          o !== j &&
          o.departure >= j.departure &&
          o.arrival <= j.arrival &&
          o.transfers <= j.transfers &&
          (o.departure > j.departure || o.arrival < j.arrival || o.transfers < j.transfers),
      ),
  );
  return { journeys: journeys.slice(0, count) };
}

/** Najbliższe odjazdy z przystanków w pobliżu punktu lub o podanej nazwie. */
export async function nextDepartures({ lat, lon, stopName, radius = 350, limit = 12, windowMin = 60 }) {
  const tt = timetable;
  if (!tt) return { error: "Rozkład jazdy jeszcze się ładuje." };
  let stops;
  if (stopName) {
    const g = tt.findGroup(stopName);
    if (!g) return { error: `Nie znaleziono przystanku „${stopName}”.` };
    stops = g.stops;
  } else {
    const near = tt.stopsNear(lat, lon, radius);
    if (!near.length) return { error: "Brak przystanków w pobliżu." };
    // Najbliższe 2 nazwy przystanków (zespoły), wszystkie ich słupki.
    const names = [...new Set(near.map((n) => tt.stops.name[n.stop]))].slice(0, 2);
    stops = near.filter((n) => names.includes(tt.stops.name[n.stop])).map((n) => n.stop);
  }
  const delays = await realtime.getDelays().catch(() => new Map());
  const set = new Set(stops);
  const now = tt.relSeconds();
  const { dep: cDep, trip: cTrip, pos: cPos } = tt.conn;
  const out = [];
  const seen = new Set();
  for (let i = tt.lowerBound(now - 900); i < cDep.length && cDep[i] <= now + windowMin * 60; i++) {
    const t = cTrip[i];
    const k = tt.trips.off[t] + cPos[i];
    const s = tt.ts.stop[k];
    if (!set.has(s) || tt.ts.flags[k] & NO_PICKUP) continue;
    const tripKey = `${tt.trips.feed[t]}:${tt.trips.rtId[t]}`;
    const delay = delays.get(tripKey)?.delay ?? null;
    const expected = cDep[i] + Math.max(0, delay ?? 0);
    if (expected < now - 30) continue;
    const dedupe = `${tripKey}:${s}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      line: tt.trips.line[t],
      mode: tt.trips.mode[t] === MODE_TRAM ? "tram" : "bus",
      headsign: tt.trips.headsign[t],
      stop: tt.stops.name[s],
      platform: tt.stops.platform[s] || undefined,
      stopLat: tt.stops.lat[s],
      stopLon: tt.stops.lon[s],
      scheduled: tt.epochOf(cDep[i]),
      expected: tt.epochOf(expected),
      delay,
      minutes: Math.max(0, Math.round((expected - now) / 60)),
      distance: lat != null ? Math.round(distance(lat, lon, tt.stops.lat[s], tt.stops.lon[s])) : undefined,
    });
  }
  out.sort((a, b) => a.expected - b.expected);
  return { stops: [...new Set(stops.map((s) => tt.stops.name[s]))], departures: out.slice(0, limit) };
}

/** Pojazdy w promieniu – do wykrywania, że użytkownik jedzie tramwajem/autobusem. */
export async function vehiclesNear(lat, lon, radius = 80) {
  const list = await realtime.getVehicles();
  return list
    .map((v) => ({ ...v, distance: distance(lat, lon, v.lat, v.lon) }))
    .filter((v) => v.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
}
