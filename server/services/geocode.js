// Wyszukiwanie miejsc: atrakcje z bazy → przystanki → Nominatim (OSM) ograniczony do Krakowa.
import { config } from "../config.js";
import { ATTRACTIONS } from "../data/attractions.js";
import { normalize } from "../geo.js";
import { getTimetable } from "../transit/index.js";

const cache = new Map();
let lastNominatim = 0;

async function nominatim(query, limit) {
  const key = `${query}|${limit}`;
  if (cache.has(key)) return cache.get(key);
  // Polityka Nominatim: maks. 1 zapytanie/s.
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const b = config.bbox;
  const url =
    `${config.nominatim}/search?format=jsonv2&limit=${limit}&accept-language=pl` +
    `&viewbox=${b.west},${b.north},${b.east},${b.south}&bounded=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": config.userAgent }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  const out = data.map((d) => ({
    type: "place",
    name: d.name || d.display_name.split(",")[0],
    address: d.display_name.split(",").slice(0, 3).join(","),
    lat: Number(d.lat),
    lon: Number(d.lon),
  }));
  cache.set(key, out);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return out;
}

export function matchAttractions(query, limit = 3) {
  const q = normalize(query);
  if (!q) return [];
  const words = q.split(" ").filter((w) => w.length > 2);
  return ATTRACTIONS.map((a) => {
    const hay = normalize(`${a.name.pl} ${a.name.en} ${a.id.replace(/-/g, " ")}`);
    let score = hay.includes(q) ? 10 : 0;
    for (const w of words) if (hay.includes(w)) score += 2;
    return { a, score };
  })
    .filter((x) => x.score >= Math.max(2, words.length * 2 - 1) || x.score >= 10)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map(({ a }) => ({ type: "attraction", id: a.id, name: a.name.pl, nameEn: a.name.en, lat: a.lat, lon: a.lon }));
}

export async function searchPlaces(query, { limit = 6 } = {}) {
  const results = [...matchAttractions(query, 3)];

  const tt = getTimetable();
  if (tt) {
    const g = tt.findGroup(query);
    if (g) {
      const lat = g.stops.reduce((s, i) => s + tt.stops.lat[i], 0) / g.stops.length;
      const lon = g.stops.reduce((s, i) => s + tt.stops.lon[i], 0) / g.stops.length;
      results.push({ type: "stop", name: g.name, address: "przystanek MPK", lat, lon });
    }
  }

  if (results.length < limit) {
    try {
      for (const p of await nominatim(query, limit)) {
        if (!results.some((r) => Math.abs(r.lat - p.lat) < 0.0005 && Math.abs(r.lon - p.lon) < 0.0005)) results.push(p);
      }
    } catch (err) {
      console.warn("[geocode]", err.message);
    }
  }
  return results.slice(0, limit);
}

/** Pojedynczy najlepszy wynik – do nawigacji. */
export async function resolvePlace(query) {
  const [first] = await searchPlaces(query, { limit: 1 });
  return first || null;
}
