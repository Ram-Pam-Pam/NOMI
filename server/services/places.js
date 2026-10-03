// Miejsca z OpenStreetMap (Overpass API): restauracje, kawiarnie, biletomaty, toalety itd.
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
  toilets: '["amenity"="toilets"]',
  ticket_machine: '["vending"="public_transport_tickets"]',
  attraction: '["tourism"~"^(attraction|museum|viewpoint|gallery|artwork)$"]',
  historic: '["historic"~"^(monument|memorial|castle|church|building|city_gate|archaeological_site|ruins)$"]',
  church: '["amenity"="place_of_worship"]',
};

const cache = new Map();
const TTL = 10 * 60_000;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
}

export async function findPlaces({ type = "restaurant", lat, lon, radius = 600, limit = 8, cuisine, query }) {
  const filter = PLACE_TYPES[type];
  if (!filter) throw new Error(`Nieznany typ miejsca: ${type}`);
  radius = Math.min(Math.max(Number(radius) || 600, 50), 3000);
  const key = `${type}|${lat.toFixed(3)}|${lon.toFixed(3)}|${radius}|${cuisine || ""}|${query || ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data.slice(0, limit);

  let extra = "";
  if (cuisine) extra += `["cuisine"~"${escapeRegex(cuisine)}",i]`;
  if (query) extra += `["name"~"${escapeRegex(query)}",i]`;
  const named = ["restaurant", "cafe", "bar", "fast_food", "ice_cream", "bakery", "attraction", "historic", "church"].includes(type)
    ? '["name"]'
    : "";
  const q = `[out:json][timeout:15];nwr${filter}${named}${extra}(around:${radius},${lat},${lon});out center tags 150;`;

  const res = await fetch(config.overpass, {
    method: "POST",
    headers: {
      "User-Agent": config.userAgent,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ data: q }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = await res.json();

  const places = (data.elements || [])
    .map((e) => {
      const pLat = e.lat ?? e.center?.lat;
      const pLon = e.lon ?? e.center?.lon;
      if (pLat == null) return null;
      const t = e.tags || {};
      return {
        id: `${e.type}/${e.id}`,
        name: t.name || (type === "ticket_machine" ? "Biletomat" : type === "toilets" ? "Toaleta" : type === "atm" ? "Bankomat" : null),
        type,
        lat: pLat,
        lon: pLon,
        distance: Math.round(distance(lat, lon, pLat, pLon)),
        bearing: Math.round(bearing(lat, lon, pLat, pLon)),
        cuisine: t.cuisine?.replace(/;/g, ", "),
        openingHours: t.opening_hours,
        address: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") || undefined,
        website: t.website || t["contact:website"],
        phone: t.phone || t["contact:phone"],
        vegetarian: t["diet:vegetarian"],
        vegan: t["diet:vegan"],
        outdoorSeating: t.outdoor_seating,
        wheelchair: t.wheelchair,
        description: t.description || t["description:pl"],
        operator: t.operator,
        fee: t.fee,
      };
    })
    .filter((p) => p && p.name)
    .sort((a, b) => a.distance - b.distance);

  cache.set(key, { at: Date.now(), data: places });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return places.slice(0, limit);
}
