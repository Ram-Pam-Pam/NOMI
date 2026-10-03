// GTFS-Realtime ZTP Kraków: pozycje pojazdów i opóźnienia kursów.
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { config } from "../config.js";

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;

const VEHICLES_TTL = 10_000;
const UPDATES_TTL = 20_000;

async function fetchFeed(name) {
  const res = await fetch(`${config.gtfsBase}/${name}.pb`, {
    headers: { "User-Agent": config.userAgent },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const msg = FeedMessage.decode(new Uint8Array(await res.arrayBuffer()));
  return FeedMessage.toObject(msg, { longs: Number, enums: String, defaults: false });
}

/** Pobiera feedy równolegle; feed z błędem jest pomijany (np. przerwa techniczna MPK). */
async function fetchAll(prefix) {
  const results = await Promise.allSettled(config.gtfsFeeds.map((f) => fetchFeed(`${prefix}_${f}`)));
  return results.map((r, i) => ({ feed: config.gtfsFeeds[i], data: r.status === "fulfilled" ? r.value : null, error: r.reason?.message }));
}

export class Realtime {
  constructor(getTimetable) {
    this.getTimetable = getTimetable;
    this.vehicles = { at: 0, list: [], pending: null };
    this.updates = { at: 0, delays: new Map(), pending: null };
  }

  async getVehicles() {
    if (Date.now() - this.vehicles.at < VEHICLES_TTL) return this.vehicles.list;
    this.vehicles.pending ??= this.#loadVehicles().finally(() => (this.vehicles.pending = null));
    return this.vehicles.pending;
  }

  async #loadVehicles() {
    const tt = this.getTimetable();
    const list = [];
    for (const { feed, data } of await fetchAll("VehiclePositions")) {
      for (const e of data?.entity || []) {
        const v = e.vehicle;
        if (!v?.position) continue;
        const tripKey = v.trip?.tripId ? `${feed}:${v.trip.tripId}` : null;
        const inst = tripKey && tt?.instancesByRt.get(tripKey)?.[0];
        const mode = feed === "T" ? "tram" : "bus";
        list.push({
          id: `${feed}:${v.vehicle?.id || e.id}`,
          mode,
          line: inst !== undefined && inst !== null ? tt.trips.line[inst] : v.trip?.routeId || "?",
          headsign: inst !== undefined && inst !== null ? tt.trips.headsign[inst] : undefined,
          tripKey,
          lat: v.position.latitude,
          lon: v.position.longitude,
          bearing: v.position.bearing ?? null,
          speed: v.position.speed ?? null,
          timestamp: v.timestamp ? v.timestamp * 1000 : null,
        });
      }
    }
    this.vehicles.list = list;
    this.vehicles.at = Date.now();
    return list;
  }

  /** Map tripKey → { delay: sekundy } */
  async getDelays() {
    if (Date.now() - this.updates.at < UPDATES_TTL) return this.updates.delays;
    this.updates.pending ??= this.#loadDelays()
      .catch((err) => {
        console.warn("[realtime] opóźnienia niedostępne:", err.message);
        return this.updates.delays;
      })
      .finally(() => (this.updates.pending = null));
    return this.updates.pending;
  }

  async #loadDelays() {
    const tt = this.getTimetable();
    const delays = new Map();
    for (const { feed, data } of await fetchAll("TripUpdates")) {
      for (const e of data?.entity || []) {
        const tu = e.tripUpdate;
        if (!tu?.trip?.tripId) continue;
        const tripKey = `${feed}:${tu.trip.tripId}`;
        const delay = this.#delayOf(tt, feed, tripKey, tu.stopTimeUpdate || []);
        if (delay !== null) delays.set(tripKey, { delay });
      }
    }
    this.updates.delays = delays;
    this.updates.at = Date.now();
    return delays;
  }

  #delayOf(tt, feed, tripKey, updates) {
    for (const u of updates) {
      const ev = u.departure || u.arrival;
      if (!ev) continue;
      if (typeof ev.delay === "number") return ev.delay;
      // Tramwaje podają tylko czas bezwzględny – liczymy opóźnienie względem rozkładu.
      if (ev.time && tt && u.stopId) {
        const stopIdx = tt.stopKey.get(`${feed}:${u.stopId}`);
        const instances = tt.instancesByRt.get(tripKey);
        if (stopIdx === undefined || !instances) continue;
        let best = null;
        for (const t of instances) {
          const off = tt.trips.off[t];
          for (let k = 0; k < tt.trips.len[t]; k++) {
            if (tt.ts.stop[off + k] !== stopIdx) continue;
            const sched = tt.epochOf(u.departure ? tt.ts.dep[off + k] : tt.ts.arr[off + k]);
            const d = Math.round((ev.time * 1000 - sched) / 1000);
            if (best === null || Math.abs(d) < Math.abs(best)) best = d;
          }
        }
        if (best !== null && Math.abs(best) < 3 * 3600) return best;
      }
    }
    return null;
  }
}
