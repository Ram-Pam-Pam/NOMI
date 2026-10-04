// Wyszukiwanie połączeń komunikacją miejską – Connection Scan Algorithm (earliest arrival).
import { MODE_TRAM, NO_DROPOFF, NO_PICKUP, walkSeconds } from "./gtfs.js";

const ACCESS_RADIUS = 900; // maks. dojście do/od przystanku (linia prosta, m)
const TRANSFER_SLACK = 60; // zapas na przesiadkę (s)
const MAX_JOURNEY = 3 * 3600;
const INF = 0x3fffffff;

const ORIGIN = 1;
const VEHICLE = 2;
const FOOT = 3;

/**
 * Najwcześniejszy przyjazd z punktu origin do dest przy starcie o startRel (sekundy względem dnia bazowego).
 * Zwraca surowe odcinki: access → (transit | transfer)* → egress.
 */
export function earliestArrival(tt, origin, dest, startRel) {
  const nStops = tt.stops.id.length;
  const arrival = new Int32Array(nStops).fill(INF);
  const ready = new Int32Array(nStops).fill(INF);
  const kind = new Int8Array(nStops);
  const ref = new Int32Array(nStops); // VEHICLE: połączenie wejścia; FOOT/ORIGIN: czas dojścia (s)
  const exit = new Int32Array(nStops); // VEHICLE: połączenie wyjścia
  const prev = new Int32Array(nStops); // FOOT: przystanek źródłowy
  const tripEnter = new Int32Array(tt.trips.line.length).fill(-1);

  const access = tt.stopsNear(origin.lat, origin.lon, ACCESS_RADIUS);
  const egress = new Map();
  for (const { stop, dist } of tt.stopsNear(dest.lat, dest.lon, ACCESS_RADIUS)) egress.set(stop, walkSeconds(dist));
  if (!access.length || !egress.size) return null;

  for (const { stop, dist } of access) {
    const w = walkSeconds(dist);
    arrival[stop] = startRel + w;
    ready[stop] = startRel + w;
    kind[stop] = ORIGIN;
    ref[stop] = w;
  }

  const { dep: cDep, arr: cArr, trip: cTrip, pos: cPos } = tt.conn;
  const tOff = tt.trips.off;
  const { stop: tsStop, flags: tsFlags } = tt.ts;
  const { off: fpOff, to: fpTo, sec: fpSec } = tt.footpaths;

  let best = INF;
  let bestStop = -1;
  const limit = startRel + MAX_JOURNEY;

  for (let i = tt.lowerBound(startRel), n = cDep.length; i < n; i++) {
    const dep = cDep[i];
    if (dep >= best || dep > limit) break;
    const t = cTrip[i];
    const k = tOff[t] + cPos[i];
    if (tripEnter[t] === -1) {
      if (ready[tsStop[k]] > dep || tsFlags[k] & NO_PICKUP) continue;
      tripEnter[t] = i;
    }
    if (tsFlags[k + 1] & NO_DROPOFF) continue;
    const to = tsStop[k + 1];
    const arr = cArr[i];
    if (arr >= arrival[to]) continue;

    arrival[to] = arr;
    ready[to] = arr + TRANSFER_SLACK;
    kind[to] = VEHICLE;
    ref[to] = tripEnter[t];
    exit[to] = i;
    const eg = egress.get(to);
    if (eg !== undefined && arr + eg < best) {
      best = arr + eg;
      bestStop = to;
    }
    for (let f = fpOff[to], fEnd = fpOff[to + 1]; f < fEnd; f++) {
      const nb = fpTo[f];
      const a2 = arr + fpSec[f];
      if (a2 >= arrival[nb]) continue;
      arrival[nb] = a2;
      ready[nb] = a2 + TRANSFER_SLACK;
      kind[nb] = FOOT;
      prev[nb] = to;
      ref[nb] = fpSec[f];
      const eg2 = egress.get(nb);
      if (eg2 !== undefined && a2 + eg2 < best) {
        best = a2 + eg2;
        bestStop = nb;
      }
    }
  }
  if (bestStop < 0) return null;

  // Odtworzenie trasy po wskaźnikach.
  const legs = [];
  let s = bestStop;
  for (let guard = 0; kind[s] !== ORIGIN && guard < 40; guard++) {
    if (kind[s] === VEHICLE) {
      const e = ref[s];
      const t = cTrip[e];
      legs.unshift({ type: "transit", trip: t, fromPos: cPos[e], toPos: cPos[exit[s]] + 1 });
      s = tsStop[tOff[t] + cPos[e]];
    } else if (kind[s] === FOOT) {
      legs.unshift({ type: "transfer", fromStop: prev[s], toStop: s, sec: ref[s] });
      s = prev[s];
    } else {
      return null;
    }
  }
  if (kind[s] !== ORIGIN) return null;
  legs.unshift({ type: "access", toStop: s, sec: ref[s] });
  legs.push({ type: "egress", fromStop: bestStop, sec: egress.get(bestStop) });
  return { legs, arrival: best, start: startRel };
}

/** Kilka kolejnych wariantów połączeń (następne odjazdy). */
export function planTransit(tt, origin, dest, startRel, count = 3) {
  const options = [];
  let t = startRel;
  for (let i = 0; i < count + 3 && options.length < count; i++) {
    const r = earliestArrival(tt, origin, dest, t);
    if (!r) break;
    const transit = r.legs.filter((l) => l.type === "transit");
    if (!transit.length) break;
    const sig = transit.map((l) => `${l.trip}:${l.fromPos}`).join("|");
    if (!options.some((o) => o.sig === sig)) options.push({ ...r, sig });
    if (options.length && r.arrival > options[0].arrival + 3600) break;
    const first = transit[0];
    const firstDep = tt.ts.dep[tt.trips.off[first.trip] + first.fromPos];
    t = Math.max(t + 60, firstDep - r.legs[0].sec + 60);
  }
  return options;
}

/** Zamiana surowego wyniku na opis odcinków (bez geometrii pieszej). */
export function describeJourney(tt, raw, origin, dest, delays) {
  const legs = [];
  const firstTransit = raw.legs.find((l) => l.type === "transit");
  const firstDep = tt.ts.dep[tt.trips.off[firstTransit.trip] + firstTransit.fromPos];
  // Wyjście z zapasem 1 min przed odjazdem (nie wcześniej niż teraz).
  const leaveRel = Math.max(raw.start, firstDep - raw.legs[0].sec - 60);
  let clock = leaveRel;

  for (const leg of raw.legs) {
    if (leg.type === "access" || leg.type === "egress" || leg.type === "transfer") {
      const fromPt = leg.type === "access" ? origin : tt.stopInfo(leg.fromStop);
      const toPt = leg.type === "egress" ? dest : tt.stopInfo(leg.toStop);
      legs.push({
        type: "walk",
        kind: leg.type,
        from: fromPt,
        to: toPt,
        duration: leg.sec,
        departure: tt.epochOf(clock),
        arrival: tt.epochOf(clock + leg.sec),
      });
      clock += leg.sec;
      continue;
    }
    const t = leg.trip;
    const off = tt.trips.off[t];
    const stops = [];
    for (let k = leg.fromPos; k <= leg.toPos; k++) {
      const s = tt.ts.stop[off + k];
      stops.push({ ...tt.stopInfo(s), time: tt.epochOf(k === leg.fromPos ? tt.ts.dep[off + k] : tt.ts.arr[off + k]) });
    }
    const rtKey = `${tt.trips.feed[t]}:${tt.trips.rtId[t]}`;
    const delay = delays?.get(rtKey)?.delay ?? null;
    const dep = tt.ts.dep[off + leg.fromPos];
    const arr = tt.ts.arr[off + leg.toPos];
    legs.push({
      type: "transit",
      mode: tt.trips.mode[t] === MODE_TRAM ? "tram" : "bus",
      line: tt.trips.line[t],
      headsign: tt.trips.headsign[t],
      tripKey: rtKey,
      from: stops[0],
      to: stops[stops.length - 1],
      stops,
      geometry: tt.legGeometry(t, leg.fromPos, leg.toPos),
      departure: tt.epochOf(dep),
      arrival: tt.epochOf(arr),
      duration: arr - dep,
      delay,
    });
    clock = arr;
  }

  // Scal sąsiednie odcinki piesze (np. przesiadka + dojście) oraz kolejne kursy tej samej linii
  // na tym samym przystanku (kurs kończy się i jedzie dalej pod innym numerem) – to nie jest przesiadka.
  const merged = [];
  for (const l of legs) {
    const last = merged[merged.length - 1];
    if (last && last.type === "walk" && l.type === "walk") {
      last.to = l.to;
      last.duration += l.duration;
      last.arrival = l.arrival;
    } else if (last && last.type === "transit" && l.type === "transit" && last.line === l.line && last.mode === l.mode && last.to.name === l.from.name) {
      last.to = l.to;
      last.headsign = l.headsign;
      last.stops = [...last.stops, ...l.stops.slice(1)];
      last.geometry = [...last.geometry, ...l.geometry.slice(1)];
      last.arrival = l.arrival;
      last.duration = Math.round((l.arrival - last.departure) / 1000);
      last.delay = l.delay ?? last.delay;
    } else merged.push(l);
  }

  const transitLegs = merged.filter((l) => l.type === "transit");
  return {
    type: "transit",
    departure: tt.epochOf(leaveRel),
    arrival: tt.epochOf(raw.arrival),
    duration: raw.arrival - leaveRel,
    transfers: transitLegs.length - 1,
    walkSeconds: merged.filter((l) => l.type === "walk").reduce((a, l) => a + l.duration, 0),
    transitSeconds: transitLegs.length
      ? Math.round((transitLegs[transitLegs.length - 1].arrival - transitLegs[0].departure) / 1000)
      : 0,
    legs: merged,
  };
}
