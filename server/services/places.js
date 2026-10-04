// Miejsca z OpenStreetMap (Overpass API): restauracje, kawiarnie, biletomaty, toalety itd.
// Publiczny Overpass bywa wolny i przeciążony, dlatego pobieramy raz cały obszar danego typu (siatka ~300 m,
// promień z zapasem), trzymamy go w pamięci 2 h, a filtry (kuchnia, nazwa, dieta, odległość) liczymy lokalnie.
// Kolejne pytania o lokale w okolicy nie czekają na Overpass.
import { config } from "../config.js";
import { bearing, distance } from "../geo.js";

export const PLACE_TYPES = {
  restaurant: '["amenity"="restaurant"]',
  cafe: '["amenity"="cafe"]',
  bar: '["amenity"~"^(bar|pub|biergarten)$"]',
  fast_food: '["amenity"="fast_food"]',
  ice_cream: '["amenity"="ice_cream"]',
  bakery: '["shop"~"^(bakery|pastry|confectionery)$"]',
  pharmacy: '["amenity"="pharmacy"]',
  atm: '["amenity"="atm"]',
  money: '["amenity"~"^(atm|bureau_de_change)$"]',
  tourist_info: '["tourism"="information"]["information"~"^(office|visitor_centre)$"]',
  toilets: '["amenity"="toilets"]',
  ticket_machine: '["vending"="public_transport_tickets"]',
  attraction: '["tourism"~"^(attraction|museum|viewpoint|gallery|artwork)$"]',
  historic: '["historic"~"^(monument|memorial|castle|church|building|city_gate|archaeological_site|ruins)$"]',
  church: '["amenity"="place_of_worship"]',
};
const NAMED = new Set(["restaurant", "cafe", "bar", "fast_food", "ice_cream", "bakery", "attraction", "historic", "church"]);

export const DIETS = ["vegetarian", "vegan", "gluten_free", "halal", "kosher"];

const AREA_TTL = 2 * 3600_000;
const BUCKETS = [700, 1200, 2000, 3300]; // promień pobieranego obszaru (m)
const CELL_LAT = 0.003; // ~330 m
const CELL_LON = 0.0045; // ~320 m na szerokości Krakowa
// Publiczny Overpass potrafi odpowiadać ~20 s – pozwalamy mu skończyć (wynik trafia do pamięci),
// a narzędzia agenta same decydują, ile czekają (limit czasu w tools.js).
const ATTEMPT_TIMEOUT = 30000;
const areas = new Map(); // klucz obszaru → { at, promise }

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
}

async function overpass(query) {
  // Jedno ponowienie przy przeciążeniu (429/5xx).
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(config.overpass, {
      method: "POST",
      headers: { "User-Agent": config.userAgent, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT),
    });
    if (res.ok) return res.json();
    if (attempt >= 1 || ![429, 502, 503, 504].includes(res.status)) throw new Error(`Overpass HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
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
            : null);
  if (!name) return null;
  return {
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
}

/** Wszystkie miejsca danego typu w obszarze (z pamięci albo jedno zapytanie do Overpass). */
function areaPlaces(type, lat, lon, radius) {
  const cLat = Math.round(lat / CELL_LAT) * CELL_LAT;
  const cLon = Math.round(lon / CELL_LON) * CELL_LON;
  const r = BUCKETS.find((b) => b >= radius + 250) || BUCKETS.at(-1);
  const key = `${type}|${cLat.toFixed(4)}|${cLon.toFixed(4)}|${r}`;
  const hit = areas.get(key);
  if (hit && Date.now() - hit.at < AREA_TTL) return hit.promise;

  const q = `[out:json][timeout:15];nwr${PLACE_TYPES[type]}${NAMED.has(type) ? '["name"]' : ""}(around:${r},${cLat.toFixed(5)},${cLon.toFixed(5)});out center tags;`;
  const promise = overpass(q).then((data) => (data.elements || []).map((e) => toPlace(e, type)).filter(Boolean));
  // Równoległe pytania o ten sam obszar czekają na jedno zapytanie; błąd nie zostaje w pamięci.
  areas.set(key, { at: Date.now(), promise });
  promise.catch(() => areas.get(key)?.promise === promise && areas.delete(key));
  if (areas.size > 200) areas.delete(areas.keys().next().value);
  return promise;
}

export async function findPlaces({ type = "restaurant", lat, lon, radius = 600, limit = 8, cuisine, query, diet }) {
  if (!PLACE_TYPES[type]) throw new Error(`Nieznany typ miejsca: ${type}`);
  radius = Math.min(Math.max(Number(radius) || 600, 50), 3000);
  const all = await areaPlaces(type, lat, lon, radius);
  const cuisineRe = cuisine ? new RegExp(escapeRegex(cuisine), "i") : null;
  const nameRe = query ? new RegExp(escapeRegex(query), "i") : null;
  return all
    .filter((p) => !cuisineRe || cuisineRe.test(p.cuisine || ""))
    .filter((p) => !nameRe || nameRe.test(p.name))
    // Dieta wg tagów OSM diet:* (yes = są takie dania, only = wyłącznie).
    .filter((p) => !DIETS.includes(diet) || /^(yes|only)$/.test(p.diets?.[diet] || ""))
    .map((p) => {
      const { diets, ...rest } = p;
      return { ...rest, distance: Math.round(distance(lat, lon, p.lat, p.lon)), bearing: Math.round(bearing(lat, lon, p.lat, p.lon)) };
    })
    .filter((p) => p.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

// Rozgrzewanie okolicy: najczęściej potrzebne rodzaje miejsc pobierane po kolei (bez obciążania Overpass naraz).
const WARM_TYPES = [
  ["restaurant", 600],
  ["attraction", 250],
  ["historic", 250],
  ["cafe", 600],
];
let warmChain = Promise.resolve();

export function warmArea(lat, lon) {
  for (const [type, radius] of WARM_TYPES) {
    warmChain = warmChain.then(() => areaPlaces(type, lat, lon, radius).catch(() => {}));
  }
  return warmChain;
}
