// Miejsca z OpenStreetMap: restauracje, kawiarnie, apteki, toalety, bankomaty, biletomaty, zabytki…
//
// Publiczne serwery Overpass bywają przeciążone (połączenie potrafi trwać > 10 s, zapytanie – minutę),
// dlatego aplikacja NIE odpytuje ich w chwili kliknięcia. Serwer trzyma na dysku migawkę miejsc dla całego
// Krakowa (data/osm/*.json), pobieraną w tle grupami (usługi, jedzenie, zwiedzanie) z kilku serwerów Overpass
// i odświeżaną co tydzień. Wyszukiwanie (przyciski mapy, narzędzie agenta) filtruje migawkę lokalnie – od razu.
// Dopóki migawki nie ma (pierwsze uruchomienie), działa zapytanie o okolicę z pamięcią 2 h.
import fsp from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import zlib from "node:zlib";
import { config } from "../config.js";
import { bearing, distance } from "../geo.js";

// Rodzaje miejsc: filtr Overpass + ten sam warunek w JS (do podziału wyników zapytań grupowych).
const TYPE_DEFS = {
  restaurant: { q: '["amenity"="restaurant"]', is: (t) => t.amenity === "restaurant" },
  cafe: { q: '["amenity"="cafe"]', is: (t) => t.amenity === "cafe" },
  bar: { q: '["amenity"~"^(bar|pub|biergarten)$"]', is: (t) => /^(bar|pub|biergarten)$/.test(t.amenity || "") },
  fast_food: { q: '["amenity"="fast_food"]', is: (t) => t.amenity === "fast_food" },
  ice_cream: { q: '["amenity"="ice_cream"]', is: (t) => t.amenity === "ice_cream" },
  bakery: { q: '["shop"~"^(bakery|pastry|confectionery)$"]', is: (t) => /^(bakery|pastry|confectionery)$/.test(t.shop || "") },
  pharmacy: { q: '["amenity"="pharmacy"]', is: (t) => t.amenity === "pharmacy" },
  atm: { q: '["amenity"="atm"]', is: (t) => t.amenity === "atm" },
  money: { q: '["amenity"~"^(atm|bureau_de_change)$"]', is: (t) => /^(atm|bureau_de_change)$/.test(t.amenity || "") },
  tourist_info: {
    q: '["tourism"="information"]["information"~"^(office|visitor_centre)$"]',
    is: (t) => t.tourism === "information" && /^(office|visitor_centre)$/.test(t.information || ""),
  },
  toilets: { q: '["amenity"="toilets"]', is: (t) => t.amenity === "toilets" },
  ticket_machine: { q: '["vending"="public_transport_tickets"]', is: (t) => t.vending === "public_transport_tickets" },
  attraction: {
    q: '["tourism"~"^(attraction|museum|viewpoint|gallery|artwork)$"]',
    is: (t) => /^(attraction|museum|viewpoint|gallery|artwork)$/.test(t.tourism || ""),
  },
  historic: {
    q: '["historic"~"^(monument|memorial|castle|church|building|city_gate|archaeological_site|ruins)$"]',
    is: (t) => /^(monument|memorial|castle|church|building|city_gate|archaeological_site|ruins)$/.test(t.historic || ""),
  },
  church: { q: '["amenity"="place_of_worship"]', is: (t) => t.amenity === "place_of_worship" },
};
export const PLACE_TYPES = Object.fromEntries(Object.entries(TYPE_DEFS).map(([k, v]) => [k, v.q]));
const NAMED = new Set(["restaurant", "cafe", "bar", "fast_food", "ice_cream", "bakery", "attraction", "historic", "church"]);

export const DIETS = ["vegetarian", "vegan", "gluten_free", "halal", "kosher"];

// Migawki pobierane grupami – trzy zapytania zamiast kilkunastu. Usługi najpierw (apteki, toalety, bankomaty).
const SNAP_GROUPS = [
  { key: "services", types: ["pharmacy", "toilets", "money", "ticket_machine", "tourist_info"] },
  { key: "food", types: ["restaurant", "cafe", "bar", "fast_food", "ice_cream", "bakery"] },
  { key: "sights", types: ["attraction", "historic", "church"] },
];
const SNAP_TTL = 7 * 86400_000;
const RETRY_FAILED_MS = 10 * 60_000;

// Serwery Overpass: własny (OVERPASS_URL / OVERPASS_URLS) albo publiczny + zapasowe.
const MIRRORS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
function endpoints() {
  if (config.overpassUrls?.length) return config.overpassUrls;
  return process.env.OVERPASS_URL ? [config.overpass] : [config.overpass, ...MIRRORS];
}
let preferred = null; // serwer, który ostatnio odpowiedział – próbowany jako pierwszy

const snapshots = new Map(); // grupa → { fetchedAt, places: { typ: [miejsca] } }
let refreshing = false;
const lastErrors = {};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
}

/**
 * POST do Overpass przez node:https – bez 10-sekundowego limitu nawiązania połączenia, który ma fetch
 * (przeciążony Overpass łączy się wolno i fetch zgłaszał wtedy „fetch failed”). Jeden łączny limit czasu.
 */
function postForm(url, form, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = new URLSearchParams(form).toString();
    const lib = u.protocol === "http:" ? http : https;
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(v);
    };
    const req = lib.request(
      u,
      {
        method: "POST",
        headers: {
          "User-Agent": config.userAgent,
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        const stream = res.headers["content-encoding"] === "gzip" ? res.pipe(zlib.createGunzip()) : res;
        stream.on("data", (c) => chunks.push(c));
        stream.on("error", (err) => finish(reject, err));
        stream.on("end", () => {
          if (res.statusCode !== 200) return finish(reject, Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
          try {
            finish(resolve, JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            finish(reject, new Error("niepoprawna odpowiedź"));
          }
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(reject, new Error(`brak odpowiedzi w ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    req.on("error", (err) => finish(reject, err));
    req.end(body);
  });
}

/** Zapytanie do pierwszego odpowiadającego serwera Overpass. strict – odrzuca wyniki ucięte przez limit czasu serwera. */
async function overpass(query, { timeout = 25000, maxServers = Infinity, strict = false } = {}) {
  const list = endpoints();
  const order = preferred && list.includes(preferred) ? [preferred, ...list.filter((u) => u !== preferred)] : list;
  let lastErr = null;
  for (const url of order.slice(0, maxServers)) {
    try {
      const data = await postForm(url, { data: query }, timeout);
      if (strict && /runtime error|timed out|out of memory/i.test(data.remark || "")) throw new Error(`niepełna odpowiedź (${data.remark})`);
      preferred = url;
      return data;
    } catch (err) {
      lastErr = new Error(`${new URL(url).hostname}: ${err.code || err.message}`);
    }
  }
  throw Object.assign(new Error("Mapa OpenStreetMap (Overpass) chwilowo nie odpowiada – spróbuj za minutę."), { status: 503, cause: lastErr });
}

function toPlace(e, type) {
  const pLat = e.lat ?? e.center?.lat;
  const pLon = e.lon ?? e.center?.lon;
  if (pLat == null) return null;
  const t = e.tags || {};
  const name =
    t.name ||
    (type === "ticket_machine"
      ? "Biletomat"
      : type === "toilets"
        ? "Toaleta"
        : type === "atm" || (type === "money" && t.amenity === "atm")
          ? `Bankomat${t.operator ? ` ${t.operator}` : ""}`
          : type === "money"
            ? "Kantor"
            : type === "pharmacy"
              ? "Apteka"
              : null);
  if (!name) return null;
  const p = {
    id: `${e.type}/${e.id}`,
    name,
    kind: t.amenity === "bureau_de_change" ? "kantor" : t.amenity === "atm" ? "bankomat" : undefined,
    type,
    lat: pLat,
    lon: pLon,
    cuisine: t.cuisine?.replace(/;/g, ", "),
    openingHours: t.opening_hours,
    // Sam numer bez ulicy/miejsca („3”) wprowadza w błąd – wtedy brak adresu.
    address: t["addr:street"] || t["addr:place"] ? [t["addr:street"] || t["addr:place"], t["addr:housenumber"]].filter(Boolean).join(" ") : undefined,
    website: t.website || t["contact:website"],
    phone: t.phone || t["contact:phone"],
    vegetarian: t["diet:vegetarian"],
    vegan: t["diet:vegan"],
    diets: Object.fromEntries(DIETS.map((d) => [d, t[`diet:${d}`]]).filter(([, v]) => v)),
    outdoorSeating: t.outdoor_seating,
    wheelchair: t.wheelchair,
    description: t.description || t["description:pl"],
    operator: t.operator,
    fee: t.fee,
  };
  // Bez pustych pól – migawka całego miasta zajmuje wtedy kilka razy mniej miejsca.
  for (const k of Object.keys(p)) if (p[k] === undefined || (typeof p[k] === "object" && !Object.keys(p[k]).length)) delete p[k];
  return p;
}

// ------------------------------------------------------------------ migawki dla całego miasta

const snapDir = () => path.join(config.dataDir, "osm");
const bboxStr = () => `${config.bbox.south},${config.bbox.west},${config.bbox.north},${config.bbox.east}`;

/** Miejsca danego typu z migawki (bankomaty – z grupy money) albo null, gdy migawki jeszcze nie ma. */
function snapshotPlaces(type) {
  if (type === "atm") return snapshotPlaces("money")?.filter((p) => p.kind === "bankomat") ?? null;
  for (const g of SNAP_GROUPS) if (g.types.includes(type)) return snapshots.get(g.key)?.places[type] ?? null;
  return null;
}

async function loadSnapshots() {
  for (const g of SNAP_GROUPS) {
    try {
      const s = JSON.parse(await fsp.readFile(path.join(snapDir(), `${g.key}.json`), "utf8"));
      if (s?.places) snapshots.set(g.key, s);
    } catch {
      /* brak migawki – zostanie pobrana */
    }
  }
}

async function fetchGroup(g) {
  const parts = g.types.map((t) => `nwr${TYPE_DEFS[t].q}${NAMED.has(t) ? '["name"]' : ""}(${bboxStr()});`).join("");
  const data = await overpass(`[out:json][timeout:180];(${parts});out center tags;`, { timeout: 200_000, strict: true });
  const places = Object.fromEntries(g.types.map((t) => [t, []]));
  for (const e of data.elements || []) {
    for (const t of g.types) {
      if (!TYPE_DEFS[t].is(e.tags || {})) continue;
      const p = toPlace(e, t);
      if (p) places[t].push(p);
    }
  }
  const count = Object.values(places).reduce((a, l) => a + l.length, 0);
  const prev = snapshots.get(g.key);
  const prevCount = prev ? Object.values(prev.places).reduce((a, l) => a + l.length, 0) : 0;
  // Wyraźnie mniej wyników niż poprzednio = zapewne niepełna odpowiedź – zostaje stara migawka.
  if (prevCount && count < prevCount * 0.6) throw new Error(`podejrzanie mało miejsc (${count} zamiast ~${prevCount})`);
  const snap = { fetchedAt: Date.now(), places };
  await fsp.mkdir(snapDir(), { recursive: true });
  const file = path.join(snapDir(), `${g.key}.json`);
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(snap));
  await fsp.rename(`${file}.tmp`, file);
  snapshots.set(g.key, snap);
  return count;
}

async function refreshSnapshots() {
  if (refreshing) return;
  refreshing = true;
  let failed = false;
  try {
    for (const g of SNAP_GROUPS) {
      const s = snapshots.get(g.key);
      if (s && Date.now() - s.fetchedAt < SNAP_TTL) continue;
      const t0 = Date.now();
      try {
        const n = await fetchGroup(g);
        delete lastErrors[g.key];
        console.log(`[osm] migawka „${g.key}”: ${n} miejsc (${Math.round((Date.now() - t0) / 1000)} s)`);
      } catch (err) {
        failed = true;
        lastErrors[g.key] = `${err.message}${err.cause ? ` – ${err.cause.message}` : ""}`;
        console.warn(`[osm] migawka „${g.key}” nieudana:`, lastErrors[g.key]);
      }
      await new Promise((r) => setTimeout(r, 3000)); // uprzejmie wobec publicznych serwerów
    }
  } finally {
    refreshing = false;
  }
  if (failed) setTimeout(refreshSnapshots, RETRY_FAILED_MS).unref();
}

/** Start: wczytanie migawek z dysku i pobieranie brakujących/starych w tle. */
export async function startPlacesService() {
  await loadSnapshots();
  setTimeout(refreshSnapshots, 5000).unref();
  setInterval(refreshSnapshots, 24 * 3600_000).unref();
}

export function placesStatus() {
  return {
    refreshing,
    snapshots: Object.fromEntries(
      SNAP_GROUPS.map((g) => {
        const s = snapshots.get(g.key);
        return [g.key, s ? { places: Object.values(s.places).reduce((a, l) => a + l.length, 0), fetchedAt: new Date(s.fetchedAt).toISOString() } : null];
      }),
    ),
    errors: lastErrors,
  };
}

// ------------------------------------------------------------------ zapytanie o okolicę (gdy brak migawki)

const AREA_TTL = 2 * 3600_000;
const BUCKETS = [700, 1200, 2000, 3300]; // promień pobieranego obszaru (m)
const CELL_LAT = 0.003; // ~330 m
const CELL_LON = 0.0045; // ~320 m na szerokości Krakowa
const areas = new Map(); // klucz obszaru → { at, promise }

function areaPlaces(type, lat, lon, radius) {
  const cLat = Math.round(lat / CELL_LAT) * CELL_LAT;
  const cLon = Math.round(lon / CELL_LON) * CELL_LON;
  const r = BUCKETS.find((b) => b >= radius + 250) || BUCKETS.at(-1);
  const key = `${type}|${cLat.toFixed(4)}|${cLon.toFixed(4)}|${r}`;
  const hit = areas.get(key);
  if (hit && Date.now() - hit.at < AREA_TTL) return hit.promise;

  const q = `[out:json][timeout:25];nwr${PLACE_TYPES[type]}${NAMED.has(type) ? '["name"]' : ""}(around:${r},${cLat.toFixed(5)},${cLon.toFixed(5)});out center tags;`;
  const promise = overpass(q, { timeout: 30000, maxServers: 2 }).then((data) => (data.elements || []).map((e) => toPlace(e, type)).filter(Boolean));
  // Równoległe pytania o ten sam obszar czekają na jedno zapytanie; błąd nie zostaje w pamięci.
  areas.set(key, { at: Date.now(), promise });
  promise.catch(() => areas.get(key)?.promise === promise && areas.delete(key));
  if (areas.size > 200) areas.delete(areas.keys().next().value);
  return promise;
}

export async function findPlaces({ type = "restaurant", lat, lon, radius = 600, limit = 8, cuisine, query, diet }) {
  if (!PLACE_TYPES[type]) throw new Error(`Nieznany typ miejsca: ${type}`);
  radius = Math.min(Math.max(Number(radius) || 600, 50), 3000);
  const all = snapshotPlaces(type) ?? (await areaPlaces(type, lat, lon, radius));
  const cuisineRe = cuisine ? new RegExp(escapeRegex(cuisine), "i") : null;
  const nameRe = query ? new RegExp(escapeRegex(query), "i") : null;
  const out = [];
  for (const p of all) {
    // Szybkie odrzucenie po prostokącie (migawka całego miasta ma tysiące pozycji).
    if (Math.abs(p.lat - lat) > radius / 110000 || Math.abs(p.lon - lon) > radius / 70000) continue;
    if (cuisineRe && !cuisineRe.test(p.cuisine || "")) continue;
    if (nameRe && !nameRe.test(p.name)) continue;
    // Dieta wg tagów OSM diet:* (yes = są takie dania, only = wyłącznie).
    if (DIETS.includes(diet) && !/^(yes|only)$/.test(p.diets?.[diet] || "")) continue;
    const d = Math.round(distance(lat, lon, p.lat, p.lon));
    if (d > radius) continue;
    const { diets, ...rest } = p;
    out.push({ ...rest, type, distance: d, bearing: Math.round(bearing(lat, lon, p.lat, p.lon)) });
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

// Rozgrzewanie okolicy (gdy migawki jeszcze nie ma): najczęściej potrzebne rodzaje miejsc, po kolei.
const WARM_TYPES = [
  ["restaurant", 600],
  ["attraction", 250],
  ["historic", 250],
  ["cafe", 600],
];
let warmChain = Promise.resolve();

export function warmArea(lat, lon) {
  for (const [type, radius] of WARM_TYPES) {
    if (snapshotPlaces(type)) continue;
    warmChain = warmChain.then(() => areaPlaces(type, lat, lon, radius).catch(() => {}));
  }
  return warmChain;
}
