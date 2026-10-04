import { state } from "./state.js";
import { t } from "./i18n.js";

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const angleDiff = (from, to) => ((to - from + 540) % 360) - 180;

/** Rzut punktu na łamaną: { index, dist (od trasy, m), along (m od początku), total (m) } */
export function projectOnLine(p, line) {
  const cosLat = Math.cos(rad(p.lat));
  const toXY = (q) => [(q[1] - p.lon) * cosLat * 111320, (q[0] - p.lat) * 111320];
  let best = { index: 0, dist: Infinity, along: 0 };
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = toXY(line[i]);
    const [bx, by] = toXY(line[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const segLen = Math.sqrt(len2);
    const tt = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const cx = ax + tt * dx;
    const cy = ay + tt * dy;
    const d = Math.hypot(cx, cy);
    if (d < best.dist) best = { index: i, dist: d, along: acc + tt * segLen };
    acc += segLen;
  }
  best.total = acc;
  return best;
}

/** Punkt na łamanej w odległości `along` metrów od początku. */
export function pointAlong(line, along) {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = { lat: line[i][0], lon: line[i][1] };
    const b = { lat: line[i + 1][0], lon: line[i + 1][1] };
    const seg = distance(a, b);
    if (acc + seg >= along) {
      const f = seg ? (along - acc) / seg : 0;
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, bearing: bearing(a, b) };
    }
    acc += seg;
  }
  const last = line[line.length - 1];
  return { lat: last[0], lon: last[1], bearing: null, end: true };
}

export function fmtDistance(m) {
  if (m == null) return "";
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} ${t("m")}`;
  return `${(m / 1000).toFixed(1).replace(".", state.settings.lang === "pl" ? "," : ".")} ${t("km")}`;
}

export function fmtMinutes(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} ${t("minShort")}`;
  return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} ${t("minShort")}` : ""}`.trim();
}

export function fmtClock(ms) {
  return new Intl.DateTimeFormat(state.settings.lang === "en" ? "en-GB" : "pl-PL", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Bezpieczny mini-markdown: **pogrubienie**, *kursywa*, listy, linki http(s), akapity. */
export function renderMarkdown(text) {
  const inline = (s) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let list = null;
  for (const raw of String(text).split("\n")) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*(?:[-•*])\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const type = ul ? "ul" : "ol";
      if (!list || list.type !== type) {
        if (list) out.push(`</${list.type}>`);
        list = { type };
        out.push(`<${type}>`);
      }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    if (list) {
      out.push(`</${list.type}>`);
      list = null;
    }
    if (line.trim()) out.push(`<p>${inline(line.replace(/^#+\s*/, ""))}</p>`);
  }
  if (list) out.push(`</${list.type}>`);
  return out.join("");
}

// ------------------------------------------------ instrukcje nawigacyjne z kroków OSRM

const MOD = {
  pl: {
    uturn: "Zawróć", "sharp right": "Skręć ostro w prawo", right: "Skręć w prawo", "slight right": "Odbij lekko w prawo",
    straight: "Idź prosto", "slight left": "Odbij lekko w lewo", left: "Skręć w lewo", "sharp left": "Skręć ostro w lewo",
  },
  en: {
    uturn: "Make a U-turn", "sharp right": "Turn sharp right", right: "Turn right", "slight right": "Bear right",
    straight: "Go straight", "slight left": "Bear left", left: "Turn left", "sharp left": "Turn sharp left",
  },
};
const COMPASS_PL = ["na północ", "na północny wschód", "na wschód", "na południowy wschód", "na południe", "na południowy zachód", "na zachód", "na północny zachód"];
const COMPASS_EN = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function stepInstruction(step) {
  const pl = state.settings.lang !== "en";
  const mods = MOD[pl ? "pl" : "en"];
  // OSRM podaje nazwę ulicy w mianowniku – po polsku dopisujemy ją po myślniku, bez odmiany.
  const name = step.name ? (pl ? ` – ${step.name}` : ` onto ${step.name}`) : "";
  switch (step.type) {
    case "depart": {
      const dir = Number.isFinite(step.bearingAfter) ? (pl ? COMPASS_PL : COMPASS_EN)[Math.round(step.bearingAfter / 45) % 8] : "";
      return pl ? `Idź ${dir}${name}` : `Head ${dir}${step.name ? ` on ${step.name}` : ""}`;
    }
    case "arrive":
      return pl ? "Jesteś u celu" : "You have arrived";
    case "roundabout":
    case "rotary":
    case "exit roundabout":
    case "exit rotary":
      return pl ? `Na rondzie wybierz ${step.exit ? `${step.exit}. zjazd` : "zjazd"}${name}` : `At the roundabout take ${step.exit ? `exit ${step.exit}` : "the exit"}${name}`;
    default: {
      const m = mods[step.modifier] || (pl ? "Idź dalej" : "Continue");
      return `${m}${name}`;
    }
  }
}

// Emoji z tekstu modelu (interfejs używa ikon SVG, nie emoji).
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;
export const stripEmoji = (s) => String(s ?? "").replace(EMOJI_RE, "").replace(/[ \t]{2,}/g, " ");
