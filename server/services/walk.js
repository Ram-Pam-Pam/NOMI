// Trasy piesze z OSRM (profil "foot" OpenStreetMap). Przy braku usługi – szacunek po linii prostej.
import { config } from "../config.js";
import { distance } from "../geo.js";
import { walkSeconds } from "../transit/gtfs.js";

const cache = new Map();
const CACHE_MAX = 500;

export async function walkRoute(from, to) {
  const key = [from.lat, from.lon, to.lat, to.lon].map((v) => Number(v).toFixed(5)).join(",");
  if (cache.has(key)) return cache.get(key);

  let result;
  try {
    const url =
      `${config.osrmFoot}/route/v1/foot/${from.lon},${from.lat};${to.lon},${to.lat}` +
      `?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, { headers: { "User-Agent": config.userAgent }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) throw new Error(data.code || "brak trasy");
    result = {
      source: "osrm",
      distance: Math.round(route.distance),
      duration: Math.round(route.duration),
      geometry: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
      steps: route.legs[0].steps.map((s) => ({
        type: s.maneuver.type,
        modifier: s.maneuver.modifier,
        exit: s.maneuver.exit,
        name: s.name || "",
        distance: Math.round(s.distance),
        duration: Math.round(s.duration),
        location: [s.maneuver.location[1], s.maneuver.location[0]],
        bearingAfter: s.maneuver.bearing_after,
      })),
    };
  } catch (err) {
    const d = distance(from.lat, from.lon, to.lat, to.lon);
    result = {
      source: "estimate",
      warning: `Routing pieszy niedostępny (${err.message}) – pokazuję linię prostą.`,
      distance: Math.round(d * 1.3),
      duration: walkSeconds(d),
      geometry: [
        [from.lat, from.lon],
        [to.lat, to.lon],
      ],
      steps: [],
    };
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
