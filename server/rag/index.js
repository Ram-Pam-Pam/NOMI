// Baza wiedzy NOMI (RAG) z oficjalnych źródeł: budowa indeksu i wyszukiwanie hybrydowe.
// Wyszukiwanie = BM25 (słowa kluczowe, nazwy własne) + wektory (znaczenie, pytania po angielsku), łączone metodą RRF.
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { embed, embedModel, embeddingsAvailable } from "./embed.js";
import { clearHtmlCache, discoverUrls, fetchDoc } from "./sources.js";
import { BM25, chunkText, rrf, tokenize } from "./text.js";

const dir = () => path.join(config.dataDir, "rag");
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wektory na dysku jako int8 ze skalą na wektor (4× mniej miejsca, różnica w rankingu pomijalna).
export function quantize(vectors, dim) {
  const n = vectors.length / dim;
  const buf = Buffer.alloc(n * (4 + dim));
  for (let i = 0; i < n; i++) {
    const v = vectors.subarray(i * dim, (i + 1) * dim);
    let max = 0;
    for (const x of v) max = Math.max(max, Math.abs(x));
    const scale = max / 127 || 1;
    const off = i * (4 + dim);
    buf.writeFloatLE(scale, off);
    for (let d = 0; d < dim; d++) buf.writeInt8(Math.round(v[d] / scale), off + 4 + d);
  }
  return buf;
}

export function dequantize(buf, dim) {
  const n = buf.length / (4 + dim);
  const out = new Float32Array(n * dim);
  for (let i = 0; i < n; i++) {
    const off = i * (4 + dim);
    const scale = buf.readFloatLE(off);
    for (let d = 0; d < dim; d++) out[i * dim + d] = buf.readInt8(off + 4 + d) * scale;
  }
  return out;
}

let index = null; // { chunks, vectors, dim, model, builtAt, docs, bm25 }
let loading = null;
let loadedAt = 0;
let building = null;

// ------------------------------------------------------------------ odczyt

/** Wczytuje indeks z dysku (raz; ponownie – gdy force albo gdy wcześniej go nie było, po minucie). */
export async function loadRag({ force = false } = {}) {
  if (force || (!index && loading && Date.now() - loadedAt > 60_000)) loading = null;
  loading ??= (async () => {
    loadedAt = Date.now();
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(dir(), "meta.json"), "utf8"));
      const chunks = JSON.parse(await fsp.readFile(path.join(dir(), "chunks.json"), "utf8"));
      let vectors = null;
      if (meta.dim) vectors = dequantize(await fsp.readFile(path.join(dir(), "vectors.i8")), meta.dim);
      index = { ...meta, chunks, vectors, titles: titleTokens(chunks), bm25: new BM25(chunks.map((c) => `${c.title}\n${c.text}`)) };
    } catch {
      index = null;
    }
    return index;
  })();
  return loading;
}

export function ragStatus() {
  if (!index) return { ready: false, building: Boolean(building) };
  return { ready: true, building: Boolean(building), chunks: index.chunks.length, docs: index.docs, model: index.model, dense: Boolean(index.vectors), builtAt: index.builtAt };
}

// ------------------------------------------------------------------ wyszukiwanie

/**
 * Ranking fragmentów (czysta funkcja – używana też przez npm run rag:eval).
 * mode: hybrid (BM25 + wektory, RRF) | bm25 | dense. Bez wektora zapytania – samo BM25.
 */
// Wagi rankingów w hybrydzie: wektory, BM25, dopasowanie tytułu strony (dobrane na npm run rag:eval).
export const FUSION_WEIGHTS = { dense: 1, bm25: 0.3, title: 1 };

/** Tokeny tytułów stron – do rankingu „pytanie wymienia nazwę obiektu”. */
const titleTokens = (chunks) => chunks.map((c) => new Set(tokenize(c.title)));

export function rankChunks({ query, qvec, chunks, bm25, vectors, dim, titles, mode = "hybrid", allowed = () => true, weights = FUSION_WEIGHTS }) {
  const lexical = mode === "dense" && qvec ? [] : bm25.search(query, 80).filter((r) => allowed(r.i));
  const lexScore = new Map(lexical.map((r) => [r.i, r]));
  const sim = new Map();
  let dense = [];
  if (qvec && vectors && mode !== "bm25") {
    const scores = [];
    for (let i = 0; i < chunks.length; i++) {
      if (!allowed(i)) continue;
      let s = 0;
      for (let d = 0, off = i * dim; d < dim; d++) s += qvec[d] * vectors[off + d];
      scores.push({ i, score: s });
    }
    dense = scores.sort((a, b) => b.score - a.score).slice(0, 80);
    for (const x of dense) sim.set(x.i, x.score);
  }
  // Fragmenty stron, których tytuł prawie w całości pada w pytaniu (np. „Kopiec Krakusa”), w kolejności BM25.
  let titled = [];
  if (mode === "hybrid" && titles) {
    const q = new Set(tokenize(query));
    titled = lexical
      .map((r) => {
        let hit = 0;
        for (const w of titles[r.i]) if (q.has(w)) hit++;
        return { i: r.i, s: titles[r.i].size ? hit / titles[r.i].size : 0 };
      })
      .filter((x) => x.s >= 0.6)
      .sort((a, b) => b.s - a.s);
  }
  const ids = (list) => list.map((x) => x.i);
  let ranked;
  if (mode === "dense" && dense.length) ranked = dense;
  else if (dense.length) ranked = rrf([ids(dense), ids(lexical), ids(titled)], 60, [weights.dense, weights.bm25, weights.title]);
  else if (titled.length) ranked = rrf([ids(lexical), ids(titled)], 60, [weights.bm25, weights.title]);
  else ranked = lexical;
  return ranked.map(({ i, score }) => ({
    i,
    score,
    similarity: sim.get(i) ?? null,
    lexical: lexScore.get(i)?.score ?? 0,
    coverage: lexScore.get(i)?.coverage ?? 0,
  }));
}

/**
 * Najlepsze fragmenty dla zapytania. Zwraca też `similarity` (cosinus, gdy są wektory) i `lexical` (BM25)
 * – do progu trafności przy automatycznym doborze wiedzy.
 */
export async function searchKnowledge(query, { k = 5, maxPerDoc = 2, urls = null, mode = "hybrid" } = {}) {
  if (!index) await loadRag();
  if (!index || !String(query || "").trim()) return [];
  const { chunks, vectors } = index;
  const allowed = urls ? (i) => urls.some((u) => chunks[i].url.startsWith(u)) : () => true;
  let qvec = null;
  if (mode !== "bm25" && vectors && embeddingsAvailable() && index.model === embedModel()) {
    try {
      [qvec] = await embed([query], "query", { model: index.model });
    } catch (err) {
      console.warn("[rag] wektor zapytania niedostępny – tylko słowa kluczowe:", err.message);
    }
  }
  const fused = rankChunks({ ...index, query, qvec, mode, allowed });

  const perDoc = new Map();
  const out = [];
  for (const { i, ...scores } of fused) {
    const c = chunks[i];
    const n = perDoc.get(c.url) || 0;
    if (n >= maxPerDoc) continue;
    perDoc.set(c.url, n + 1);
    out.push({ ...c, ...scores });
    if (out.length >= k) break;
  }
  return out;
}

// ------------------------------------------------------------------ budowa

async function writeAtomic(file, data) {
  await fsp.writeFile(`${file}.tmp`, data);
  await fsp.rename(`${file}.tmp`, file);
}

/**
 * Pobiera oficjalne strony, dzieli na fragmenty i liczy embeddingi (ponownie używa wektorów
 * niezmienionych fragmentów). Gdy pobierze się wyraźnie mniej stron niż poprzednio – nie nadpisuje indeksu.
 */
export async function buildRag({ log = (m) => console.log(m), maxKrakowPl } = {}) {
  building ??= (async () => {
    await loadRag();
    const t0 = Date.now();
    const urls = await discoverUrls({ maxKrakowPl });
    log(`[rag] stron do pobrania: ${urls.length}`);

    const docs = [];
    let failed = 0;
    let next = 0;
    let done = 0;
    await Promise.all(
      [0, 1, 2].map(async () => {
        while (next < urls.length) {
          const url = urls[next++];
          try {
            const d = await fetchDoc(url);
            if (d.text.length >= 150) docs.push(d);
          } catch {
            failed++;
          }
          if (++done % 50 === 0) log(`[rag] pobrano ${done}/${urls.length}`);
          await sleep(250); // uprzejmie wobec serwerów miasta i instytucji
        }
      }),
    );
    if (index?.docs && docs.length < index.docs * 0.6) {
      throw new Error(`pobrano tylko ${docs.length} stron (poprzednio ${index.docs}) – indeks nie został nadpisany`);
    }

    const fetched = new Date().toISOString().slice(0, 10);
    const chunks = [];
    for (const d of docs.sort((a, b) => a.url.localeCompare(b.url))) {
      chunkText(d.text).forEach((text, j) => {
        chunks.push({ id: `${sha1(d.url).slice(0, 10)}-${j}`, url: d.url, title: d.title, source: d.source, text, fetched, hash: sha1(`${d.title}\n${text}`) });
      });
    }
    log(`[rag] stron: ${docs.length} (błędów: ${failed}), fragmentów: ${chunks.length}`);

    let vectors = null;
    let dim = 0;
    let model = null;
    if (embeddingsAvailable()) {
      model = embedModel();
      const reuse = index?.vectors && index.model === model ? new Map(index.chunks.map((c, i) => [c.hash, i])) : new Map();
      const need = chunks.map((c, i) => (reuse.has(c.hash) ? -1 : i)).filter((i) => i >= 0);
      log(`[rag] embeddingi (${model}): nowych ${need.length}, z poprzedniego indeksu ${chunks.length - need.length}`);
      const fresh = await embed(
        need.map((i) => `${chunks[i].title}\n${chunks[i].text}`),
        "doc",
        { model, onBatch: (n, total) => n % 320 === 0 && log(`[rag] embeddingi ${n}/${total}`) },
      );
      dim = fresh[0]?.length || index?.dim || 0;
      vectors = new Float32Array(chunks.length * dim);
      chunks.forEach((c, i) => {
        const pi = reuse.get(c.hash);
        if (pi !== undefined) vectors.set(index.vectors.subarray(pi * dim, (pi + 1) * dim), i * dim);
      });
      need.forEach((ci, k) => vectors.set(fresh[k], ci * dim));
    } else {
      log("[rag] brak klucza do embeddingów – indeks tylko słów kluczowych (BM25)");
    }

    await fsp.mkdir(dir(), { recursive: true });
    const meta = { model, dim, docs: docs.length, count: chunks.length, builtAt: new Date().toISOString() };
    if (vectors) await writeAtomic(path.join(dir(), "vectors.i8"), quantize(vectors, dim));
    await writeAtomic(path.join(dir(), "chunks.json"), JSON.stringify(chunks));
    await writeAtomic(path.join(dir(), "meta.json"), JSON.stringify(meta, null, 2));
    index = { ...meta, chunks, vectors, titles: titleTokens(chunks), bm25: new BM25(chunks.map((c) => `${c.title}\n${c.text}`)) };
    log(`[rag] gotowe w ${Math.round((Date.now() - t0) / 1000)} s`);
    return { ...ragStatus(), building: false };
  })().finally(() => {
    building = null;
    clearHtmlCache();
  });
  return building;
}

/** Wczytanie przy starcie i odświeżanie w tle co RAG_TTL_DAYS (bez blokowania serwera). */
export function startRagService() {
  loadRag().then((i) => console.log(i ? `[rag] baza wiedzy: ${i.docs} stron, ${i.chunks.length} fragmentów` : "[rag] brak bazy wiedzy – zbuduję ją w tle"));
  const refreshIfStale = async () => {
    // Indeks mógł zostać przebudowany osobnym procesem (npm run rag:build).
    const meta = await fsp.readFile(path.join(dir(), "meta.json"), "utf8").then(JSON.parse, () => null);
    await loadRag({ force: Boolean(meta && meta.builtAt !== index?.builtAt) });
    const age = index ? Date.now() - Date.parse(index.builtAt) : Infinity;
    const modelChanged = index && embeddingsAvailable() && index.model !== embedModel();
    if (age > config.rag.ttlDays * 86400_000 || modelChanged) {
      buildRag().catch((err) => console.warn("[rag] odświeżanie nieudane:", err.message));
    }
  };
  setTimeout(refreshIfStale, 30_000);
  setInterval(refreshIfStale, 24 * 3600_000).unref();
}
