// Pobieranie i parsowanie rozkładów GTFS ZTP Kraków do struktur pod algorytm CSA.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { config } from "../config.js";
import { GridIndex, distance, normalize } from "../geo.js";
import { addDays, serviceDayEpoch, weekdayOf } from "../time.js";

export const MODE_BUS = 1;
export const MODE_TRAM = 2;
export const NO_PICKUP = 1;
export const NO_DROPOFF = 2;

export const WALK_SPEED = 1.25; // m/s ≈ 4,5 km/h
export const DETOUR = 1.3; // współczynnik krętości dróg względem linii prostej
export const walkSeconds = (meters) => Math.round((meters * DETOUR) / WALK_SPEED);

const FOOTPATH_RADIUS = 400;
const TOMORROW_HORIZON = 12 * 3600; // kursy jutrzejsze ładujemy do południa

// ---------------------------------------------------------------- pobieranie

export async function ensureFeedFile(feed, { force = false } = {}) {
  const dir = path.join(config.dataDir, "gtfs");
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `GTFS_KRK_${feed}.zip`);
  const stat = await fsp.stat(file).catch(() => null);
  const fresh = stat && Date.now() - stat.mtimeMs < config.gtfsMaxAgeHours * 3600_000;
  if (fresh && !force) return file;

  const url = `${config.gtfsBase}/GTFS_KRK_${feed}.zip`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": config.userAgent } });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const tmp = `${file}.part`;
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    await fsp.rename(tmp, file);
    return file;
  } catch (err) {
    if (stat) {
      console.warn(`[gtfs] Nie udało się odświeżyć ${feed} (${err.message}) – używam kopii z dysku.`);
      return file;
    }
    throw new Error(`Nie udało się pobrać GTFS ${feed}: ${err.message}`);
  }
}

// ---------------------------------------------------------------- zip + csv

function openZip(file) {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip))),
  );
}

function listEntries(zip) {
  return new Promise((resolve, reject) => {
    const entries = new Map();
    zip.on("entry", (e) => {
      entries.set(e.fileName, e);
      zip.readEntry();
    });
    zip.once("end", () => resolve(entries));
    zip.once("error", reject);
    zip.readEntry();
  });
}

function openEntry(zip, entry) {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream))),
  );
}

/** Parser jednej linii CSV z obsługą cudzysłowów. */
export function parseCsvLine(line) {
  const out = [];
  const n = line.length;
  let i = 0;
  while (i <= n) {
    if (line.charCodeAt(i) === 34) {
      let val = "";
      i++;
      while (i < n) {
        if (line.charCodeAt(i) === 34) {
          if (line.charCodeAt(i + 1) === 34) {
            val += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        const q = line.indexOf('"', i);
        if (q === -1) {
          val += line.slice(i);
          i = n;
          break;
        }
        val += line.slice(i, q);
        i = q;
      }
      out.push(val);
      const comma = line.indexOf(",", i);
      i = comma === -1 ? n + 1 : comma + 1;
    } else {
      const comma = line.indexOf(",", i);
      if (comma === -1) {
        out.push(line.slice(i));
        i = n + 1;
      } else {
        out.push(line.slice(i, comma));
        i = comma + 1;
      }
    }
  }
  return out;
}

/** Iteruje wiersze pliku CSV z archiwum; onRow(rawLine, colIndex) */
async function eachLine(zip, entries, name, onLine) {
  const entry = entries.get(name);
  if (!entry) return null;
  const stream = await openEntry(zip, entry);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let col = null;
  for await (const line of rl) {
    if (!line) continue;
    if (!col) {
      col = {};
      parseCsvLine(line.replace(/^﻿/, "")).forEach((h, idx) => (col[h.trim()] = idx));
      continue;
    }
    onLine(line, col);
  }
  return col;
}

async function readTable(zip, entries, name) {
  const rows = [];
  await eachLine(zip, entries, name, (line, col) => {
    const cells = parseCsvLine(line);
    const row = {};
    for (const [k, idx] of Object.entries(col)) row[k] = cells[idx] ?? "";
    rows.push(row);
  });
  return rows;
}

export function parseTime(t) {
  if (!t) return NaN;
  const a = t.split(":");
  return Number(a[0]) * 3600 + Number(a[1]) * 60 + Number(a[2] || 0);
}

// ---------------------------------------------------------------- budowa rozkładu

function modeFromRouteType(type) {
  const t = Number(type);
  if (t === 0 || (t >= 900 && t < 1000)) return MODE_TRAM;
  return MODE_BUS;
}

class Builder {
  constructor(baseYmd) {
    this.baseYmd = baseYmd;
    const base = serviceDayEpoch(baseYmd);
    this.days = [-1, 0, 1].map((d) => {
      const ymd = addDays(baseYmd, d);
      return { ymd, shift: Math.round((serviceDayEpoch(ymd) - base) / 1000) };
    });
    this.baseEpoch = base;
    this.stopKey = new Map();
    this.stops = { id: [], name: [], code: [], platform: [], lat: [], lon: [], modes: [] };
    this.tripMetas = [];
  }

  serviceMask(calendar, exceptions, sid) {
    let mask = 0;
    this.days.forEach((day, i) => {
      const ex = exceptions.get(sid)?.get(day.ymd);
      let active = false;
      const cal = calendar.get(sid);
      if (cal && day.ymd >= cal.start && day.ymd <= cal.end && cal.week[weekdayOf(day.ymd)] === "1") active = true;
      if (ex === "1") active = true;
      if (ex === "2") active = false;
      if (active) mask |= 1 << i;
    });
    return mask;
  }

  async addFeed(feed, file) {
    const zip = await openZip(file);
    try {
      const entries = await listEntries(zip);

      const calendar = new Map();
      for (const r of await readTable(zip, entries, "calendar.txt")) {
        calendar.set(r.service_id, {
          start: r.start_date,
          end: r.end_date,
          week: [r.monday, r.tuesday, r.wednesday, r.thursday, r.friday, r.saturday, r.sunday],
        });
      }
      const exceptions = new Map();
      for (const r of await readTable(zip, entries, "calendar_dates.txt")) {
        if (!exceptions.has(r.service_id)) exceptions.set(r.service_id, new Map());
        exceptions.get(r.service_id).set(r.date, r.exception_type);
      }

      const routes = new Map();
      for (const r of await readTable(zip, entries, "routes.txt")) {
        routes.set(r.route_id, { name: r.route_short_name || r.route_long_name, mode: modeFromRouteType(r.route_type) });
      }

      const localStop = new Map();
      for (const r of await readTable(zip, entries, "stops.txt")) {
        if (r.location_type && r.location_type !== "0") continue;
        const key = `${feed}:${r.stop_id}`;
        const idx = this.stops.id.length;
        this.stopKey.set(key, idx);
        localStop.set(r.stop_id, idx);
        this.stops.id.push(key);
        this.stops.name.push(r.stop_name);
        this.stops.code.push(r.stop_code || "");
        this.stops.platform.push(r.platform_code || r.stop_desc || "");
        this.stops.lat.push(Number(r.stop_lat));
        this.stops.lon.push(Number(r.stop_lon));
        this.stops.modes.push(0);
      }

      const maskCache = new Map();
      const trips = new Map();
      for (const r of await readTable(zip, entries, "trips.txt")) {
        let mask = maskCache.get(r.service_id);
        if (mask === undefined) maskCache.set(r.service_id, (mask = this.serviceMask(calendar, exceptions, r.service_id)));
        if (!mask) continue;
        const route = routes.get(r.route_id) || { name: r.route_id, mode: MODE_BUS };
        const meta = { feed, tripId: r.trip_id, line: route.name, mode: route.mode, headsign: r.trip_headsign, mask, rows: [] };
        trips.set(r.trip_id, meta);
        this.tripMetas.push(meta);
      }

      await eachLine(zip, entries, "stop_times.txt", (line, col) => {
        // Szybki filtr: trip_id jest w pierwszej kolumnie – pomijamy kursy nieaktywne bez pełnego parsowania.
        let tripId;
        if (col.trip_id === 0 && line.charCodeAt(0) !== 34) tripId = line.slice(0, line.indexOf(","));
        const meta0 = tripId !== undefined ? trips.get(tripId) : undefined;
        if (tripId !== undefined && !meta0) return;
        const c = parseCsvLine(line);
        const meta = meta0 || trips.get(c[col.trip_id]);
        if (!meta) return;
        const stopIdx = localStop.get(c[col.stop_id]);
        if (stopIdx === undefined) return;
        const arr = parseTime(c[col.arrival_time]);
        const dep = parseTime(c[col.departure_time]);
        if (Number.isNaN(arr) && Number.isNaN(dep)) return;
        let flags = 0;
        if (c[col.pickup_type] === "1") flags |= NO_PICKUP;
        if (c[col.drop_off_type] === "1") flags |= NO_DROPOFF;
        meta.rows.push(Number(c[col.stop_sequence]), stopIdx, Number.isNaN(arr) ? dep : arr, Number.isNaN(dep) ? arr : dep, flags);
      });
    } finally {
      zip.close();
    }
  }

  finish() {
    const S = this.stops;
    const nStops = S.id.length;
    const stopLat = Float64Array.from(S.lat);
    const stopLon = Float64Array.from(S.lon);
    const stopModes = Uint8Array.from(S.modes);

    // Instancje kursów (kurs × dzień) i spłaszczone przystanki kursów.
    const trip = { line: [], mode: [], headsign: [], feed: [], rtId: [], off: [], len: [] };
    const tsStop = [];
    const tsArr = [];
    const tsDep = [];
    const tsFlags = [];
    const conns = []; // [dep, arr, trip, pos]
    const instancesByRt = new Map();
    const maxTomorrow = this.days[2].shift + TOMORROW_HORIZON;

    for (const meta of this.tripMetas) {
      const rows = meta.rows;
      const len = rows.length / 5;
      if (len < 2) continue;
      // Sortowanie wg stop_sequence, jeśli wiersze nie przyszły w kolejności.
      let sorted = true;
      for (let k = 1; k < len; k++) if (rows[k * 5] < rows[(k - 1) * 5]) sorted = false;
      let order = [...Array(len).keys()];
      if (!sorted) order.sort((a, b) => rows[a * 5] - rows[b * 5]);

      this.days.forEach((day, d) => {
        if (!(meta.mask & (1 << d))) return;
        const first = rows[order[0] * 5 + 3] + day.shift;
        const last = rows[order[len - 1] * 5 + 2] + day.shift;
        if (last < 0 || first > maxTomorrow) return;
        const t = trip.line.length;
        trip.line.push(meta.line);
        trip.mode.push(meta.mode);
        trip.headsign.push(meta.headsign);
        trip.feed.push(meta.feed);
        trip.rtId.push(meta.tripId);
        trip.off.push(tsStop.length);
        trip.len.push(len);
        const rtKey = `${meta.feed}:${meta.tripId}`;
        if (!instancesByRt.has(rtKey)) instancesByRt.set(rtKey, []);
        instancesByRt.get(rtKey).push(t);
        for (let k = 0; k < len; k++) {
          const o = order[k] * 5;
          tsStop.push(rows[o + 1]);
          tsArr.push(rows[o + 2] + day.shift);
          tsDep.push(rows[o + 3] + day.shift);
          tsFlags.push(rows[o + 4]);
          stopModes[rows[o + 1]] |= meta.mode;
        }
        const off = trip.off[t];
        for (let k = 0; k < len - 1; k++) {
          const dep = tsDep[off + k];
          if (dep < 0) continue;
          conns.push(dep, tsArr[off + k + 1], t, k);
        }
      });
      meta.rows = null;
    }

    // Sortowanie połączeń po czasie odjazdu (klucz zakodowany w Float64).
    const nConn = conns.length / 4;
    const SCALE = 2 ** 23;
    if (nConn >= SCALE) throw new Error("Zbyt wiele połączeń w rozkładzie");
    const keys = new Float64Array(nConn);
    for (let i = 0; i < nConn; i++) keys[i] = conns[i * 4] * SCALE + i;
    keys.sort();
    const cDep = new Int32Array(nConn);
    const cArr = new Int32Array(nConn);
    const cTrip = new Int32Array(nConn);
    const cPos = new Int32Array(nConn);
    for (let j = 0; j < nConn; j++) {
      const i = keys[j] % SCALE;
      cDep[j] = conns[i * 4];
      cArr[j] = conns[i * 4 + 1];
      cTrip[j] = conns[i * 4 + 2];
      cPos[j] = conns[i * 4 + 3];
    }

    // Indeks przestrzenny i przejścia piesze między przystankami.
    const grid = new GridIndex();
    for (let s = 0; s < nStops; s++) grid.add(s, stopLat[s], stopLon[s]);
    const fpOff = new Int32Array(nStops + 1);
    const fpTo = [];
    const fpSec = [];
    for (let s = 0; s < nStops; s++) {
      fpOff[s] = fpTo.length;
      if (!stopModes[s]) continue;
      for (const n of grid.candidates(stopLat[s], stopLon[s], FOOTPATH_RADIUS)) {
        if (n === s || !stopModes[n]) continue;
        const dist = distance(stopLat[s], stopLon[s], stopLat[n], stopLon[n]);
        if (dist > FOOTPATH_RADIUS) continue;
        fpTo.push(n);
        fpSec.push(Math.max(30, walkSeconds(dist)));
      }
    }
    fpOff[nStops] = fpTo.length;

    // Grupy przystanków po nazwie (do wyszukiwania i odjazdów).
    const groups = new Map();
    for (let s = 0; s < nStops; s++) {
      if (!stopModes[s]) continue;
      const key = normalize(S.name[s]);
      if (!groups.has(key)) groups.set(key, { name: S.name[s], stops: [] });
      groups.get(key).stops.push(s);
    }

    return new Timetable({
      baseYmd: this.baseYmd,
      baseEpoch: this.baseEpoch,
      stops: { id: S.id, name: S.name, code: S.code, platform: S.platform, lat: stopLat, lon: stopLon, modes: stopModes },
      stopKey: this.stopKey,
      trips: {
        line: trip.line,
        mode: Uint8Array.from(trip.mode),
        headsign: trip.headsign,
        feed: trip.feed,
        rtId: trip.rtId,
        off: Int32Array.from(trip.off),
        len: Int32Array.from(trip.len),
      },
      ts: { stop: Int32Array.from(tsStop), arr: Int32Array.from(tsArr), dep: Int32Array.from(tsDep), flags: Uint8Array.from(tsFlags) },
      conn: { dep: cDep, arr: cArr, trip: cTrip, pos: cPos },
      footpaths: { off: fpOff, to: Int32Array.from(fpTo), sec: Int32Array.from(fpSec) },
      grid,
      groups,
      instancesByRt,
    });
  }
}

export class Timetable {
  constructor(data) {
    Object.assign(this, data);
    this.builtAt = Date.now();
  }

  get stats() {
    return {
      day: this.baseYmd,
      stops: this.stops.id.length,
      trips: this.trips.line.length,
      connections: this.conn.dep.length,
    };
  }

  /** Sekundy względem początku bazowego dnia służbowego. */
  relSeconds(epochMs = Date.now()) {
    return Math.floor((epochMs - this.baseEpoch) / 1000);
  }

  epochOf(rel) {
    return this.baseEpoch + rel * 1000;
  }

  /** Pierwszy indeks połączenia z odjazdem >= t. */
  lowerBound(t) {
    const a = this.conn.dep;
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (a[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Przystanki w promieniu (posortowane po odległości). */
  stopsNear(lat, lon, radius) {
    const out = [];
    for (const s of this.grid.candidates(lat, lon, radius)) {
      if (!this.stops.modes[s]) continue;
      const d = distance(lat, lon, this.stops.lat[s], this.stops.lon[s]);
      if (d <= radius) out.push({ stop: s, dist: d });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  stopInfo(s) {
    return {
      name: this.stops.name[s],
      platform: this.stops.platform[s] || undefined,
      lat: this.stops.lat[s],
      lon: this.stops.lon[s],
    };
  }

  /** Wyszukiwanie przystanku po nazwie (najpierw dokładne, potem prefiks/fragment). */
  findGroup(query) {
    const q = normalize(query);
    if (!q) return null;
    if (this.groups.has(q)) return this.groups.get(q);
    let best = null;
    for (const [key, g] of this.groups) {
      const score = key.startsWith(q) ? 2 : key.includes(q) ? 1 : 0;
      if (score && (!best || score > best.score || (score === best.score && key.length < best.key.length))) {
        best = { score, key, g };
      }
    }
    return best?.g || null;
  }
}

/** Pobiera (lub bierze z dysku) wszystkie feedy i buduje rozkład na dzień bazowy. */
export async function loadTimetable(baseYmd, { forceDownload = false } = {}) {
  const builder = new Builder(baseYmd);
  for (const feed of config.gtfsFeeds) {
    const file = await ensureFeedFile(feed, { force: forceDownload });
    await builder.addFeed(feed, file);
  }
  return builder.finish();
}
