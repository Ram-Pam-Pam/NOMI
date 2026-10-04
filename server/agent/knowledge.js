// Wiedza z bazy RAG dla agenta: automatyczny dobór fragmentów do pytania, etykiety cytowań [K1], [K2]…
// i podpowiedzi kolejnych pytań po odpowiedzi.
import { normalize } from "../geo.js";
import { loadRag, searchKnowledge } from "../rag/index.js";

// Próg trafności dla automatycznie dołączanej wiedzy (cosinus; dobrany na zestawie npm run rag:eval).
export const MIN_SIMILARITY = 0.33;
// Bez wektorów (brak klucza do embeddingów) – jaka część słów pytania musi wystąpić we fragmencie.
const MIN_COVERAGE = 0.5;
const AUTO_K = 4;
const MAX_CHARS = 1100;

export const KNOWLEDGE_TAG = "wiedza_z_oficjalnych_zrodel";

/** Etykiety cytowań unikalne w obrębie sesji (K1, K2…), żeby starsze odpowiedzi nadal wskazywały właściwe źródła. */
export class Citations {
  constructor(session) {
    this.session = session;
    session.kNext ??= 1;
    this.turn = [];
  }

  label(chunks) {
    return chunks.map((c) => {
      const label = `K${this.session.kNext++}`;
      this.turn.push({ label, title: c.title, url: c.url, source: c.source, fetched: c.fetched });
      return { ...c, label };
    });
  }

  /** Źródła tej tury faktycznie zacytowane w odpowiedzi. */
  cited(text) {
    const used = new Set();
    for (const m of String(text).matchAll(/\[(K\d+(?:\s*[,;]\s*K?\d+)*)\]/g)) {
      for (const n of m[1].matchAll(/\d+/g)) used.add(`K${n[0]}`);
    }
    return this.turn.filter((s) => used.has(s.label));
  }
}

export function formatChunk(c) {
  const text = c.text.length > MAX_CHARS ? `${c.text.slice(0, MAX_CHARS)}…` : c.text;
  return `[${c.label}] ${c.title} — ${c.source} (pobrano ${c.fetched})\n${text}`;
}

export const isRelevant = (c, factor = 1) =>
  c.similarity !== null ? c.similarity >= MIN_SIMILARITY * factor : c.coverage >= MIN_COVERAGE * factor;

/**
 * Zapytanie do bazy wiedzy dla tury rozmowy. Krótkie odpowiedzi („tak”, „a ile kosztuje?”)
 * łączymy z ostatnią wypowiedzią NOMI, żeby wyszukiwanie wiedziało, o czym mowa.
 */
export function retrievalQuery(text, history) {
  const t = String(text).trim();
  if (t.split(/\s+/).length >= 6) return t;
  // Historia w formacie OpenAI (tekst) albo Claude (lista bloków).
  const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join(" ") : "");
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant" && textOf(m.content).trim());
  const tail = lastAssistant ? textOf(lastAssistant.content).slice(-400) : "";
  return tail ? `${tail}\n${t}` : t;
}

/** Blok wiedzy dołączany do wiadomości użytkownika (albo null, gdy nic trafnego). */
export async function autoKnowledge(query, citations) {
  if (!(await loadRag())) return null;
  let found;
  try {
    found = (await searchKnowledge(query, { k: AUTO_K + 2 })).filter(isRelevant).slice(0, AUTO_K);
  } catch (err) {
    console.warn("[rag] wyszukiwanie nieudane:", err.message);
    return null;
  }
  if (!found.length) return null;
  const labeled = citations.label(found);
  return (
    `<${KNOWLEDGE_TAG}>\n` +
    "Fragmenty oficjalnych stron dobrane automatycznie do pytania (mogą go nie dotyczyć – wtedy pomiń). Cytuj etykietą, np. [K1].\n\n" +
    `${labeled.map(formatChunk).join("\n\n")}\n</${KNOWLEDGE_TAG}>`
  );
}

/** Wyszukiwanie na żądanie (narzędzie search_knowledge). */
export async function knowledgeTool(query, citations, { limit = 4, urls } = {}) {
  if (!(await loadRag())) {
    return { error: "Baza wiedzy nie jest jeszcze zbudowana (npm run rag:build). Odpowiedz bez niej i nie zgaduj faktów." };
  }
  const found = await searchKnowledge(query, { k: limit, urls });
  // Na wyraźne żądanie agenta – łagodniejszy próg niż przy automatycznym doborze.
  const relevant = found.filter((c) => isRelevant(c, 0.8));
  if (!relevant.length) return { results: [], note: "Brak trafnych fragmentów w oficjalnych źródłach – powiedz wprost, że nie masz oficjalnej informacji." };
  return {
    results: citations.label(relevant).map((c) => ({ label: c.label, title: c.title, source: c.source, url: c.url, fetched: c.fetched, text: c.text })),
    note: "Cytuj fragmenty ich etykietą, np. [K3]. Pomiń fragmenty, które nie dotyczą pytania.",
  };
}

/** Fragment opisu obiektu o danej nazwie (np. z OpenStreetMap) – tylko gdy tytuł strony pasuje do nazwy. */
export async function snippetFor(name, citations) {
  if (!name || !(await loadRag())) return null;
  const n = normalize(name);
  if (n.length < 4) return null;
  const found = await searchKnowledge(name, { k: 3, mode: "bm25" });
  const hit = found.find((c) => {
    const t = normalize(c.title);
    return t.includes(n) || (t.length >= 6 && n.includes(t));
  });
  if (!hit) return null;
  const [c] = citations.label([hit]);
  return { label: c.label, source: c.source, text: c.text.slice(0, 600) };
}

// ------------------------------------------------------------------ podpowiedzi

const SUGGEST = {
  plan_route: { pl: ["Jaki bilet kupić?", "Odjazdy z najbliższego przystanku"], en: ["Which ticket should I buy?", "Departures from the nearest stop"] },
  find_places: { pl: ["Coś z kuchnią polską", "Kawiarnia w pobliżu"], en: ["Something with Polish food", "A café nearby"] },
  find_attractions: { pl: ["Godziny otwarcia i ceny", "Opowiedz legendę", "Prowadź tam"], en: ["Opening hours and prices", "Tell me a legend", "Take me there"] },
  look_around: { pl: ["Opowiedz więcej", "Prowadź tam"], en: ["Tell me more", "Take me there"] },
  search_knowledge: { pl: ["Opowiedz więcej", "Jak tam dojść?"], en: ["Tell me more", "How do I get there?"] },
  get_events: { pl: ["Co w weekend?", "Jak tam dojechać?"], en: ["What's on this weekend?", "How do I get there?"] },
  get_weather: { pl: ["Atrakcje pod dachem", "Co w pobliżu?"], en: ["Indoor attractions", "What's nearby?"] },
  get_departures: { pl: ["Jaki bilet kupić?"], en: ["Which ticket should I buy?"] },
  get_ticket_info: { pl: ["Gdzie kupię bilet?"], en: ["Where can I buy a ticket?"] },
};
const DEFAULT = { pl: ["Co jest w pobliżu?", "Gdzie zjeść?", "Co dziś się dzieje?"], en: ["What's nearby?", "Where to eat?", "What's on today?"] };
const YES_NO = { pl: ["Tak", "Nie, dzięki"], en: ["Yes", "No, thanks"] };

/** 2–4 krótkie podpowiedzi kolejnego pytania na podstawie użytych narzędzi i końca odpowiedzi. */
export function suggestionsFor({ tools, answer, lang }) {
  const l = lang === "en" ? "en" : "pl";
  const out = [];
  if (/\?\s*$/.test(String(answer).replace(/\[K[\d,;\sK]+\]/g, "").trim())) out.push(...YES_NO[l]);
  for (const name of [...tools].reverse()) out.push(...(SUGGEST[name]?.[l] || []));
  if (!tools.length) out.push(...DEFAULT[l]);
  return [...new Set(out)].slice(0, 4);
}
