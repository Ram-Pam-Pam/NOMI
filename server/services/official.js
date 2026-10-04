// Oficjalne dane o atrakcjach: godziny otwarcia, ceny, zasady zwiedzania i fakty
// pobierane ze stron instytucji i oficjalnego portalu miasta (krakow.travel).
// Strony są pobierane, czyszczone z HTML, a model AI wyciąga z nich dane WYŁĄCZNIE z ich treści.
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { ATTRACTIONS, attractionById } from "../data/attractions.js";
import { OFFICIAL_SOURCES } from "../data/officialSources.js";

const DIR = path.join(config.dataDir, "official");
const TTL = (Number(process.env.OFFICIAL_TTL_HOURS) || 72) * 3600_000;
const SCHEMA_VERSION = 3; // zmiana schematu lub instrukcji ekstrakcji wymusza ponowne przetworzenie
const records = new Map();
let extractor = null; // ustawiany przez warstwę agenta (unikamy cyklu importów)
let loaded = null;

export function setExtractor(fn) {
  extractor = fn;
}

export const OFFICIAL_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    facts: { type: "array", items: { type: "string" } },
    opening_hours: {
      type: "array",
      items: {
        type: "object",
        properties: { what: { type: "string" }, period: { type: "string" }, days: { type: "string" }, hours: { type: "string" } },
        required: ["what", "period", "days", "hours"],
        additionalProperties: false,
      },
    },
    closed: { type: "array", items: { type: "string" } },
    last_entry: { type: "string" },
    prices: {
      type: "array",
      items: {
        type: "object",
        properties: { ticket: { type: "string" }, price: { type: "string" } },
        required: ["ticket", "price"],
        additionalProperties: false,
      },
    },
    free_entry: { type: "string" },
    booking: { type: "string" },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "facts", "opening_hours", "closed", "last_entry", "prices", "free_entry", "booking", "notes"],
  additionalProperties: false,
};

const EXTRACT_SYSTEM = `Wyodrębniasz informacje praktyczne dla turystów z oficjalnych stron internetowych: strony instytucji zarządzającej obiektem oraz oficjalnego portalu turystycznego Krakowa (krakow.travel).
Zasady:
- Hierarchia źródeł: godziny otwarcia i ceny bierz ze „strony instytucji”; z „portalu miasta” tylko wtedy, gdy strona instytucji ich nie podaje. Opis i fakty – z obu.
- Używaj WYŁĄCZNIE informacji zawartych w podanym tekście. Niczego nie uzupełniaj z własnej wiedzy i niczego nie zgaduj. Brak informacji = puste pole lub pusta lista.
- Godziny otwarcia przepisz jako osobne wpisy: what = czego dokładnie dotyczą według tekstu (np. „Bazylika – zwiedzanie”, „Wieża hejnalica”, „Wzgórze wawelskie – teren”, „Wystawy zamkowe”, „Szklarnie”, „Kasa biletowa”; puste tylko wtedy, gdy tekst mówi o całym obiekcie). Nie uogólniaj: godzin terenu, kasy czy biura nie podpisuj jako godzin zwiedzania wystaw. Gdy strona zawiera godziny kilku oddziałów, weź tylko te dotyczące obiektu z zapytania. period = okres (np. „1 kwietnia – 31 października”, puste, gdy cały rok), days = dni tygodnia, hours = godziny. Nie powtarzaj dni w polu period. Uwzględnij dni zamknięcia i ostatnie wejście, jeśli są podane.
- Ceny przepisz dokładnie z walutą. W polu ticket zawsze podaj rodzaj biletu ORAZ trasę/wystawę/część obiektu, której dotyczy, gdy strona ją wymienia (np. „normalny – trasa Wawel – najcenniejsze”, „ulgowy – wieża hejnalica”). Uwzględnij dni bezpłatnego wstępu.
- summary: 1–2 zdania o obiekcie, facts: 3–6 najciekawszych faktów historycznych z tekstu (krótkie zdania).
- Pomiń informacje o innych obiektach, reklamy, menu strony, wydarzenia jednorazowe.
- Pisz po polsku, zwięźle.`;

// ------------------------------------------------------------------ HTML → tekst

const ENTITIES = {
  nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
  bdquo: "„", rdquo: "”", ldquo: "“", rsquo: "’", lsquo: "‘", euro: "€", middot: "·", deg: "°", times: "×", shy: "",
  oacute: "ó", Oacute: "Ó", ouml: "ö", uuml: "ü", auml: "ä", eacute: "é", bull: "•",
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
}

export function htmlToText(html) {
  const s = decodeEntities(
    String(html)
      // Stopki zostają – część instytucji podaje w nich godziny otwarcia.
      .replace(/<(script|style|noscript|svg|iframe|template|nav)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/dd|\/dt|\/section|\/article|\/table|\/ul|\/ol)\b[^>]*>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<[^>]+>/g, " "),
  );
  return s
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const RELEVANT =
  /godzin|otwar|czynn|zamkni|poniedzia|wtor|środ|czwart|piąt|sobot|niedziel|codziennie|bilet|cennik|cena|ceny|zł|wstęp|ulgow|normaln|bezpłat|rezerwac|ostatnie wejście|zwiedzan|sezon|styczn|lut|marz|kwiet|maj|czerw|lip|sierp|wrze|paździer|listopad|grud|\d{1,2}[:.]\d{2}/i;

/** Z długich stron zostawia tylko linie o godzinach/cenach/zwiedzaniu (z sąsiedztwem). */
function focusText(text, max) {
  if (text.length <= max) return text;
  const lines = text.split("\n");
  const keep = new Set();
  lines.forEach((l, i) => {
    if (RELEVANT.test(l)) for (let k = Math.max(0, i - 2); k <= Math.min(lines.length - 1, i + 2); k++) keep.add(k);
  });
  let out = "";
  for (let i = 0; i < lines.length && out.length < max; i++) if (keep.has(i)) out += `${lines[i]}\n`;
  return out.slice(0, max);
}

/** Portal krakow.travel: tylko opis obiektu – bez menu i bloku „Polecane miejsca” (inne atrakcje). */
function cleanGuide(text) {
  const end = text.search(/Podziel się|Zaplanuj pobyt|Polecane miejsca/);
  const cut = end > 0 ? text.slice(0, end) : text;
  const start = cut.search(/\nOpis\n/);
  return (start > 0 ? cut.slice(start) : cut).trim();
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": `Mozilla/5.0 (compatible; ${config.userAgent})`, Accept: "text/html" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { url, ok: false, status: res.status };
    let text = htmlToText(await res.text());
    text = url.includes("krakow.travel") ? cleanGuide(text).slice(0, 7000) : focusText(text, 9000);
    return { url, ok: text.length > 150, text };
  } catch (err) {
    return { url, ok: false, error: err.cause?.code || err.message };
  }
}

// ------------------------------------------------------------------ zapis / odczyt

async function save(record) {
  await fsp.mkdir(DIR, { recursive: true });
  await fsp.writeFile(path.join(DIR, `${record.id}.json`), JSON.stringify(record, null, 2));
}

export async function loadOfficial() {
  loaded ??= (async () => {
    try {
      for (const f of await fsp.readdir(DIR)) {
        if (!f.endsWith(".json")) continue;
        const r = JSON.parse(await fsp.readFile(path.join(DIR, f), "utf8"));
        if (r?.id) records.set(r.id, r);
      }
    } catch {
      /* brak katalogu – pierwsze uruchomienie */
    }
  })();
  return loaded;
}

export function getOfficial(id) {
  return records.get(id) || null;
}

export function officialSourcesFor(id) {
  const s = OFFICIAL_SOURCES[id];
  return s ? [...s.pages, ...s.guide] : [];
}

const str = (v) => (typeof v === "string" ? v.trim() : "");
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

function normalize(x) {
  return {
    summary: str(x?.summary),
    facts: strList(x?.facts).slice(0, 8),
    opening_hours: (Array.isArray(x?.opening_hours) ? x.opening_hours : [])
      .map((h) => ({ what: str(h?.what), period: str(h?.period), days: str(h?.days), hours: str(h?.hours) }))
      .filter((h) => h.hours || h.days),
    closed: strList(x?.closed),
    last_entry: str(x?.last_entry),
    prices: (Array.isArray(x?.prices) ? x.prices : []).map((p) => ({ ticket: str(p?.ticket), price: str(p?.price) })).filter((p) => p.price),
    free_entry: str(x?.free_entry),
    booking: str(x?.booking),
    notes: strList(x?.notes).slice(0, 6),
  };
}

// ------------------------------------------------------------------ odświeżanie

export async function refreshOfficial(id, { force = false } = {}) {
  await loadOfficial();
  const src = OFFICIAL_SOURCES[id];
  const a = attractionById.get(id);
  if (!src || !a) return null;
  const urls = [...src.pages, ...src.guide];
  if (!urls.length) return null;
  const prev = records.get(id);
  if (!force && prev && prev.v === SCHEMA_VERSION && Date.now() - prev.fetchedAt < TTL) return prev;

  const pages = await Promise.all(urls.map(fetchPage));
  const ok = pages.filter((p) => p.ok);
  if (!ok.length) {
    console.warn(`[official] ${id}: żadna strona nie odpowiedziała (${pages.map((p) => p.status || p.error).join(", ")})`);
    return prev || null;
  }
  const kind = (u) => (u.includes("krakow.travel") ? "portal miasta – opis i fakty" : "strona instytucji – godziny i ceny");
  const combined = ok.map((p) => `### Źródło (${kind(p.url)}): ${p.url}\n${p.text}`).join("\n\n");
  const hash = crypto.createHash("sha1").update(combined).digest("hex");
  if (prev && prev.hash === hash && prev.v === SCHEMA_VERSION && !force) {
    prev.fetchedAt = Date.now();
    await save(prev);
    return prev;
  }
  if (!extractor) return prev || null;

  const extracted = await extractor({
    system: EXTRACT_SYSTEM,
    request: `Obiekt: ${a.name.pl}\n\n${combined}`,
    schema: OFFICIAL_SCHEMA,
  });
  const record = { id, v: SCHEMA_VERSION, name: a.name.pl, fetchedAt: Date.now(), hash, sources: ok.map((p) => p.url), ...normalize(extracted) };
  records.set(id, record);
  await save(record);
  return record;
}

/** Odświeża wszystkie atrakcje po kolei (z przerwami, by nie obciążać serwerów instytucji). */
export async function refreshAllOfficial({ force = false, onProgress } = {}) {
  await loadOfficial();
  const ids = ATTRACTIONS.map((a) => a.id).filter((id) => officialSourcesFor(id).length);
  for (const id of ids) {
    const before = records.get(id)?.fetchedAt;
    try {
      const r = await refreshOfficial(id, { force });
      onProgress?.(id, r, r?.fetchedAt !== before);
    } catch (err) {
      console.warn(`[official] ${id}:`, err.message);
      onProgress?.(id, null, false, err);
    }
    if (records.get(id)?.fetchedAt !== before) await new Promise((r) => setTimeout(r, 1000));
  }
}

let running = false;
export function startOfficialService({ canExtract }) {
  loadOfficial();
  if (!canExtract) return;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await refreshAllOfficial();
    } finally {
      running = false;
    }
  };
  setTimeout(run, 15_000); // po starcie serwera, w tle
  setInterval(run, 6 * 3600_000).unref();
}

// ------------------------------------------------------------------ formatowanie dla AI

const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Zwięzłe dane oficjalne do kontekstu modeli (planer, opowieści, historia rozmowy). */
export function officialText(id, { facts = false, sources = true, maxPrices = 6 } = {}) {
  const r = getOfficial(id);
  if (!r) return null;
  const parts = [];
  parts.push(
    r.opening_hours.length
      ? `godziny: ${r.opening_hours.map((h) => `${h.what ? `${h.what}: ` : ""}${[h.period, h.days, h.hours].filter(Boolean).join(" ")}`).join("; ")}`
      : "godziny: brak na oficjalnych stronach",
  );
  if (r.closed.length) parts.push(`zamknięte: ${r.closed.join(", ")}`);
  if (r.last_entry) parts.push(`ostatnie wejście: ${r.last_entry}`);
  if (r.prices.length) parts.push(`ceny: ${r.prices.slice(0, maxPrices).map((p) => `${p.ticket} ${p.price}`.trim()).join("; ")}`);
  if (r.free_entry) parts.push(`bezpłatnie: ${r.free_entry}`);
  if (r.booking) parts.push(`rezerwacja: ${r.booking}`);
  if (facts && r.facts.length) parts.push(`fakty: ${r.facts.join(" ")}`);
  if (sources) parts.push(`źródła: ${r.sources.join(", ")} (pobrano ${fmtDate(r.fetchedAt)})`);
  return parts.join(" | ");
}

/** Dane oficjalne dla narzędzi agenta i interfejsu. */
export function officialPublic(id) {
  const r = getOfficial(id);
  if (!r) return null;
  const { hash, ...rest } = r;
  return { ...rest, fetched: fmtDate(r.fetchedAt) };
}

/** Do punktu planu dołącza oficjalne godziny i ceny ze źródłem (z serwera, nie z modelu AI). */
export function withOfficial(stop) {
  const o = stop.attraction_id ? officialPublic(stop.attraction_id) : null;
  if (!o) return { ...stop, official: undefined };
  const { opening_hours, closed, last_entry, prices, free_entry, booking, sources, fetched } = o;
  return { ...stop, official: { opening_hours, closed, last_entry, prices, free_entry, booking, sources, fetched } };
}
