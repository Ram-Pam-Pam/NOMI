// Przetwarzanie tekstu dla bazy wiedzy: podział na fragmenty i wyszukiwanie słów kluczowych (BM25).
import { normalize } from "../geo.js";

/**
 * Dzieli tekst na fragmenty ok. `size` znaków wzdłuż akapitów (z zakładką `overlap`),
 * żeby każdy fragment był samodzielnie zrozumiały, a zdania nie były cięte w połowie.
 */
export function chunkText(text, { size = 900, overlap = 160 } = {}) {
  const paragraphs = [];
  for (const p of String(text).split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
    if (p.length <= size * 1.4) {
      paragraphs.push(p);
      continue;
    }
    // Bardzo długi akapit – tniemy po zdaniach.
    let buf = "";
    for (const s of p.split(/(?<=[.!?…])\s+/)) {
      if (buf && buf.length + s.length > size) {
        paragraphs.push(buf);
        buf = "";
      }
      buf += (buf ? " " : "") + s;
    }
    if (buf) paragraphs.push(buf);
  }

  const chunks = [];
  let cur = [];
  let len = 0;
  for (const p of paragraphs) {
    if (len && len + p.length > size) {
      chunks.push(cur.join("\n"));
      // Zakładka: ostatni akapit (jeśli krótki) przechodzi do następnego fragmentu.
      const last = cur[cur.length - 1];
      cur = last.length <= overlap ? [last] : [];
      len = cur.reduce((a, x) => a + x.length, 0);
    }
    cur.push(p);
    len += p.length;
  }
  if (cur.length) chunks.push(cur.join("\n"));
  return chunks.filter((c) => c.length >= 80);
}

// Najczęstsze słowa bez znaczenia dla wyszukiwania (po normalizacji: bez polskich znaków).
const STOP = new Set(
  (
    "a aby ale albo bo by byc byl byla bylo czy dla do gdzie i ich jak jaki jakie jest jej jego juz kiedy ktora ktore ktory ma mozna na nad nie o od oraz po pod przez przy sa sie sobie ta tak takze te tego ten to tu tym w we z za ze co czym ile jaka jakim moge mozemy prosze " +
    "the a an and or of to in on at for is are was were be by with from as it this that what which who how when where can i you my your do does"
  ).split(" "),
);

/** Lekki stemming polskich odmian: obcięcie do 6 znaków (np. „barbakanu” i „barbakan” → „barbak”). */
const stem = (w) => (w.length > 6 ? w.slice(0, 6) : w);

export function tokenize(text) {
  return normalize(text)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** Klasyczny BM25 (k1 = 1.2, b = 0.75) nad fragmentami. */
export class BM25 {
  constructor(docs, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.tf = [];
    this.len = [];
    this.df = new Map();
    for (const d of docs) {
      const counts = new Map();
      const toks = tokenize(d);
      for (const t of toks) counts.set(t, (counts.get(t) || 0) + 1);
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
      this.tf.push(counts);
      this.len.push(toks.length);
    }
    this.n = docs.length;
    this.avgLen = this.len.reduce((a, x) => a + x, 0) / Math.max(1, this.n);
  }

  /** Wyniki z `coverage` – jaka część słów zapytania wystąpiła we fragmencie (próg trafności bez wektorów). */
  search(query, topN = 30) {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];
    const scores = [];
    for (let i = 0; i < this.n; i++) {
      let s = 0;
      let matched = 0;
      const tf = this.tf[i];
      for (const t of terms) {
        const f = tf.get(t);
        if (!f) continue;
        matched++;
        const df = this.df.get(t);
        const idf = Math.log(1 + (this.n - df + 0.5) / (df + 0.5));
        s += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.len[i]) / this.avgLen));
      }
      if (s > 0) scores.push({ i, score: s, coverage: matched / terms.length });
    }
    return scores.sort((a, b) => b.score - a.score).slice(0, topN);
  }
}

/** Łączenie rankingów metodą Reciprocal Rank Fusion (opcjonalnie z wagami rankingów). */
export function rrf(rankings, k = 60, weights = []) {
  const fused = new Map();
  rankings.forEach((ranking, r) => {
    const w = weights[r] ?? 1;
    ranking.forEach((i, rank) => fused.set(i, (fused.get(i) || 0) + w / (k + rank + 1)));
  });
  return [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([i, score]) => ({ i, score }));
}
