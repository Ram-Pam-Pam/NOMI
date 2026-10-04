// Wydarzenia w Krakowie z oficjalnego portalu miasta krakow.travel (kalendarz wydarzeń).
import { config } from "../config.js";
import { fetchDoc } from "../rag/sources.js";
import { htmlToText } from "./official.js";

const BASE = "https://krakow.travel";
const TTL = 6 * 3600_000;
const CATEGORIES = { 21: "koncert", 30: "festiwal", 35: "wystawa", 36: "inne" };
const MONTHS = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];

let cache = { at: 0, events: [] };
let loading = null;

const pad = (n) => String(n).padStart(2, "0");

/** „piątek, 16 października 2026, 19:30 - poniedziałek, 19 października 2026” → { start, end, time } */
export function parseEventDates(text) {
  const re = new RegExp(`(\\d{1,2})\\s+(${MONTHS.join("|")})\\s+(\\d{4})(?:,\\s*(\\d{1,2}:\\d{2}))?`, "gi");
  const found = [...String(text).matchAll(re)].map((m) => ({
    date: `${m[3]}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}`,
    time: m[4] ? m[4].padStart(5, "0") : null,
  }));
  if (!found.length) return null;
  return { start: found[0].date, end: found[found.length - 1].date, time: found[0].time };
}

function parseList(html) {
  const out = [];
  for (const block of html.split(/<div class="hover-block /).slice(1)) {
    const href = (block.match(/href="(\/\d+-krakow-[^"]+)"/) || [])[1];
    const title = htmlToText((block.match(/<h5 class='title'>([\s\S]*?)<\/h5>/) || [])[1] || "");
    const when = htmlToText((block.match(/<span class='address'>([\s\S]*?)<\/span>/) || [])[1] || "");
    const caption = htmlToText((block.match(/<p class='caption'>([\s\S]*?)<\/p>/) || [])[1] || "").replace(/\.\.\.$/, "…");
    const cat = (block.match(/images\/category\/(\d+)\.svg/) || [])[1];
    const dates = parseEventDates(when);
    if (href && title && dates) out.push({ title, when, ...dates, category: CATEGORIES[cat] || "inne", caption, url: BASE + href });
  }
  return out;
}

async function fetchAll() {
  const events = new Map();
  let prev = "";
  for (let page = 1; page <= 12; page++) {
    const res = await fetch(`${BASE}/wydarzenia?Item_page=${page}`, {
      headers: { "User-Agent": `Mozilla/5.0 (compatible; ${config.userAgent})` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`krakow.travel HTTP ${res.status}`);
    const list = parseList(await res.text());
    const key = list.map((e) => e.url).join(" ");
    if (!list.length || key === prev) break; // za ostatnią stroną portal powtarza listę
    prev = key;
    for (const e of list) events.set(e.url, e);
  }
  return [...events.values()];
}

async function allEvents() {
  if (Date.now() - cache.at < TTL && cache.events.length) return cache.events;
  loading ??= fetchAll()
    .then((events) => (cache = { at: Date.now(), events }))
    .finally(() => (loading = null));
  try {
    await loading;
  } catch (err) {
    if (!cache.events.length) throw err;
    console.warn("[events] odświeżenie nieudane – dane z pamięci:", err.message);
  }
  return cache.events;
}

// Opisy ze stron wydarzeń (miejsce, program, ceny biletów) – pobierane tylko dla zwracanych wydarzeń.
const details = new Map(); // url -> { at, text }

async function eventDetails(url) {
  const hit = details.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.text;
  try {
    const { text } = await fetchDoc(url);
    const clean = text
      .split("\n")
      .filter((l) => !/^(opis|informacje|miejsce|mapa)$/i.test(l.trim()))
      .join(" ")
      .slice(0, 700);
    details.set(url, { at: Date.now(), text: clean });
    return clean;
  } catch {
    return null;
  }
}

/** Wydarzenia trwające w danym przedziale dat (YYYY-MM-DD), opcjonalnie z filtrem słowa lub kategorii. */
export async function findEvents({ from, to, query, category, limit = 8, withDetails = false } = {}) {
  const events = await allEvents();
  const q = String(query || "").toLowerCase();
  const list = events
    .filter((e) => (!to || e.start <= to) && (!from || e.end >= from))
    .filter((e) => !category || e.category === category)
    .filter((e) => !q || `${e.title} ${e.caption}`.toLowerCase().includes(q))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const top = list.slice(0, limit);
  const out = withDetails ? await Promise.all(top.map(async (e) => ({ ...e, details: await eventDetails(e.url) }))) : top;
  return { total: list.length, events: out, fetchedAt: new Date(cache.at).toISOString() };
}
