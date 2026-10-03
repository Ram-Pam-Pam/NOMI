const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Odległość w metrach (haversine). */
export function distance(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Azymut z punktu 1 do 2 w stopniach (0 = północ, zgodnie z ruchem wskazówek). */
export function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Różnica kątów target - from w zakresie -180..180 (dodatnia = w prawo). */
export function angleDiff(from, target) {
  return ((target - from + 540) % 360) - 180;
}

const COMPASS = {
  pl: ["północ", "północny wschód", "wschód", "południowy wschód", "południe", "południowy zachód", "zachód", "północny zachód"],
  en: ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"],
};

export function compassName(degrees, lang = "pl") {
  const names = COMPASS[lang] || COMPASS.pl;
  return names[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

/** Opis kierunku względem tego, gdzie patrzy użytkownik. */
export function relativeDirection(heading, targetBearing, lang = "pl") {
  if (heading == null || Number.isNaN(heading)) return null;
  const d = angleDiff(heading, targetBearing);
  const a = Math.abs(d);
  const pl = lang !== "en";
  if (a <= 20) return pl ? "na wprost" : "straight ahead";
  if (a <= 60) return d > 0 ? (pl ? "lekko w prawo" : "slightly to the right") : pl ? "lekko w lewo" : "slightly to the left";
  if (a <= 120) return d > 0 ? (pl ? "po prawej" : "to your right") : pl ? "po lewej" : "to your left";
  if (a <= 160) return d > 0 ? (pl ? "z tyłu po prawej" : "behind you on the right") : pl ? "z tyłu po lewej" : "behind you on the left";
  return pl ? "za tobą" : "behind you";
}

/** Prosty indeks przestrzenny na siatce (komórki ~500 m). */
export class GridIndex {
  constructor(cell = 0.005) {
    this.cell = cell;
    this.cells = new Map();
  }
  key(i, j) {
    return i * 100000 + j;
  }
  add(id, lat, lon) {
    const k = this.key(Math.floor(lat / this.cell), Math.floor(lon / this.cell));
    let arr = this.cells.get(k);
    if (!arr) this.cells.set(k, (arr = []));
    arr.push(id);
  }
  /** Kandydaci w promieniu (wymaga dokładnego filtrowania przez wywołującego). */
  candidates(lat, lon, radiusM) {
    const dLat = radiusM / 111320;
    const dLon = radiusM / (111320 * Math.cos(rad(lat)));
    const i0 = Math.floor((lat - dLat) / this.cell);
    const i1 = Math.floor((lat + dLat) / this.cell);
    const j0 = Math.floor((lon - dLon) / this.cell);
    const j1 = Math.floor((lon + dLon) / this.cell);
    const out = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const arr = this.cells.get(this.key(i, j));
        if (arr) for (const id of arr) out.push(id);
      }
    }
    return out;
  }
}

/** Normalizacja tekstu do wyszukiwania (bez polskich znaków, małe litery). */
export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inBbox(lat, lon, b) {
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}
