// Wiedza z bazy RAG dla agenta: automatyczny dobór fragmentów do pytania, etykiety cytowań [K1], [K2]…
// i podpowiedzi kolejnych pytań po odpowiedzi.
import { normalize } from "../geo.js";
import { ATTRACTIONS } from "../data/attractions.js";
import { loadRag, searchKnowledge } from "../rag/index.js";
import { sourceLabel } from "../rag/sources.js";
import { officialPublic, officialText } from "../services/official.js";

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
    this.used = []; // źródła danych z narzędzi (bez etykiet): strony instytucji, ZTP, IMGW, OSM
  }

  /**
   * Źródło danych użytych przez narzędzie. names – nazwy obiektów, których dotyczy: źródło trafi na listę
   * tylko wtedy, gdy odpowiedź któryś z nich wymienia (brak names = źródło całej odpowiedzi, np. taryfa ZTP).
   */
  use({ title, url, source, fetched, names = [] }) {
    if (!url) return;
    const prev = this.used.find((u) => u.url === url);
    // To samo źródło dla kilku obiektów (np. OpenStreetMap dla kilku lokali) – łączymy nazwy.
    if (prev) prev.names = prev.names.length && names.length ? [...prev.names, ...names.filter(Boolean)] : [];
    else this.used.push({ title, url, source, fetched, names: names.filter(Boolean) });
  }

  /** Następny wolny numer etykiety – wyższych nie wydano (do odrzucania wymyślonych [K…]). */
  get maxLabel() {
    return this.session.kNext;
  }

  label(chunks) {
    return chunks.map((c) => {
      const label = `K${this.session.kNext++}`;
      this.turn.push({ label, title: c.title, url: c.url, source: c.source, fetched: c.fetched });
      return { ...c, label };
    });
  }

  /** Źródła odpowiedzi: zacytowane fragmenty tej tury + źródła danych narzędzi, o których odpowiedź mówi. */
  cited(text, { extraLabels = [] } = {}) {
    const used = new Set(extraLabels);
    for (const m of String(text).matchAll(/\[(K\d+(?:\s*[,;]\s*K?\d+)*)\]/g)) {
      for (const n of m[1].matchAll(/\d+/g)) used.add(`K${n[0]}`);
    }
    const labeled = this.turn.filter((s) => used.has(s.label));
    const norm = normalize(text);
    const tools = this.used.filter((u) => !u.names.length || u.names.some((n) => mentions(norm, n))).map(({ names, ...s }) => s);
    const out = [];
    for (const s of [...labeled, ...tools]) if (!out.some((o) => o.url === s.url && !s.label)) out.push(s);
    return out.slice(0, 10);
  }
}

/** Czy tekst (znormalizowany) wspomina nazwę – z tolerancją odmiany („Kościele Mariackim” ~ „Kościół Mariacki”). */
export function mentions(normText, name) {
  const words = normalize(name).split(" ").filter((w) => w.length >= 4);
  if (!words.length) return normText.includes(normalize(name));
  const hits = words.filter((w) => normText.includes(w.slice(0, w.length <= 6 ? 4 : 5))).length;
  return hits >= Math.ceil(words.length * 0.6);
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
/**
 * Oficjalne godziny i ceny atrakcji z bazy NOMI wymienionych w pytaniu (dane strukturalne ze stron instytucji).
 * Dzięki temu „godziny Wawelu” nie są mylone np. z godzinami jednej z wystaw na Wawelu.
 */
function attractionFacts(query, citations) {
  const norm = normalize(query);
  const out = [];
  for (const a of ATTRACTIONS) {
    if (out.length >= 2) break;
    if (![a.name.pl, a.name.en].some((n) => mentions(norm, n))) continue;
    const o = officialPublic(a.id);
    const text = officialText(a.id, { facts: false, sources: false });
    if (!o?.sources?.length || !text) continue;
    const [c] = citations.label([
      { title: `${a.name.pl} – oficjalne godziny i ceny`, url: o.sources[0], source: sourceLabel(o.sources[0]), fetched: o.fetched, text },
    ]);
    out.push(c);
  }
  return out;
}

export async function autoKnowledge(query, citations) {
  const facts = attractionFacts(query, citations);
  let found = [];
  if (await loadRag()) {
    try {
      found = (await searchKnowledge(query, { k: AUTO_K + 2 })).filter(isRelevant).slice(0, AUTO_K);
    } catch (err) {
      console.warn("[rag] wyszukiwanie nieudane:", err.message);
    }
  }
  if (!facts.length && !found.length) return null;
  const labeled = [...facts, ...citations.label(found)];
  return (
    `<${KNOWLEDGE_TAG}>\n` +
    "Fragmenty oficjalnych stron dobrane automatycznie do pytania (mogą go nie dotyczyć – wtedy pomiń). Cytuj etykietą, np. [K1]. " +
    "Pilnuj, którego obiektu dotyczy fragment (np. cały zamek a jedna wystawa).\n\n" +
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
