// Embeddingi przez serwer zgodny z API OpenAI (Sherlock CloudFerro: /embeddings).
import { config } from "../config.js";

// Format zapytań zgodny z kartami modeli (dokumenty bez prefiksu).
const TASK = "Given a web search query, retrieve relevant passages that answer the query";
const QUERY_FORMAT = {
  "sdadas/stella-pl-retrieval-8k": (q) => `Instruct: ${TASK}.\nQuery: ${q}`,
  "BAAI/bge-multilingual-gemma2": (q) => `<instruct>${TASK}.\n<query>${q}`,
  "intfloat/e5-mistral-7b-instruct": (q) => `Instruct: ${TASK}\nQuery: ${q}`,
};

export const embedModel = () => config.rag.embedModel;
export const embeddingsAvailable = () => Boolean(config.compat.apiKey) && config.rag.embedModel !== "off";

function normalizeVec(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

async function call(model, input, attempt = 0) {
  const res = await fetch(`${config.compat.baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.compat.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    if (attempt < 2 && [429, 500, 502, 503, 504].includes(res.status)) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return call(model, input, attempt + 1);
    }
    throw new Error(`embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return data.data.sort((a, b) => a.index - b.index).map((d) => normalizeVec(d.embedding));
}

/** Wektory (znormalizowane) dla tekstów; kind = "query" | "doc". */
export async function embed(texts, kind = "doc", { model = embedModel(), batch = 32, onBatch } = {}) {
  const fmt = kind === "query" ? QUERY_FORMAT[model] || ((q) => q) : (d) => d;
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    out.push(...(await call(model, texts.slice(i, i + batch).map(fmt))));
    onBatch?.(Math.min(i + batch, texts.length), texts.length);
  }
  return out;
}
