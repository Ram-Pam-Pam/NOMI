// Zapytania o atrakcje względem pozycji i kierunku patrzenia użytkownika.
import { ATTRACTIONS, CATEGORY_LABELS } from "../data/attractions.js";
import { angleDiff, bearing, distance, relativeDirection } from "../geo.js";

export function withGeometry(a, lat, lon, heading, lang = "pl") {
  const d = distance(lat, lon, a.lat, a.lon);
  const b = bearing(lat, lon, a.lat, a.lon);
  return {
    id: a.id,
    name: a.name[lang] || a.name.pl,
    category: CATEGORY_LABELS[a.category]?.[lang] || a.category,
    lat: a.lat,
    lon: a.lon,
    distance: Math.round(d),
    walkMinutes: Math.max(1, Math.round((d * 1.3) / 75)),
    bearing: Math.round(b),
    direction: relativeDirection(heading, b, lang),
    summary: a.summary[lang] || a.summary.pl,
  };
}

export function nearbyAttractions({ lat, lon, heading = null, radius = 800, tag, limit = 6, lang = "pl" }) {
  return ATTRACTIONS.filter((a) => !tag || a.tags.includes(tag))
    .map((a) => ({ a, d: distance(lat, lon, a.lat, a.lon) }))
    .filter((x) => x.d <= radius)
    .sort((x, y) => x.d - y.d)
    .slice(0, limit)
    .map(({ a }) => withGeometry(a, lat, lon, heading, lang));
}

/** Atrakcje w stożku widzenia (±fov/2 od kierunku patrzenia). */
export function attractionsInView({ lat, lon, heading, fov = 70, maxDistance = 400, limit = 4, lang = "pl" }) {
  if (heading == null) return [];
  return ATTRACTIONS.map((a) => ({ a, d: distance(lat, lon, a.lat, a.lon), b: bearing(lat, lon, a.lat, a.lon) }))
    .filter((x) => x.d <= maxDistance && (x.d < 25 || Math.abs(angleDiff(heading, x.b)) <= fov / 2))
    .sort((x, y) => x.d - y.d)
    .slice(0, limit)
    .map(({ a }) => withGeometry(a, lat, lon, heading, lang));
}
