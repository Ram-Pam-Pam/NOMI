// Agent NOMI: wspólna warstwa nad dostawcami AI (Claude albo serwer zgodny z OpenAI, np. Sherlock).
import { config } from "../config.js";
import { ATTRACTIONS } from "../data/attractions.js";
import { withGeometry } from "../services/attractions.js";
import { sourceLabel } from "../rag/sources.js";
import { getOfficial, officialPublic, officialText, setExtractor, withOfficial } from "../services/official.js";
import { routePlan } from "../services/planRouting.js";
import { simplePlan } from "../services/simplePlanner.js";
import * as anthropic from "./anthropic.js";
import { buildContextBlock, detectLang, hasPosition, preferenceHint } from "./context.js";
import { AgentError } from "./errors.js";
import { Citations, autoKnowledge, retrievalQuery, suggestionsFor } from "./knowledge.js";
import * as compat from "./openaiCompat.js";
import { warmPlaces } from "./tools.js";
import { cleanAnswer, needsVerification, verifyAnswer } from "./verify.js";

export { AgentError };

const SESSION_TTL = 3 * 3600_000;
const backend = () => (config.provider === "anthropic" ? anthropic : compat);

// Ekstrakcja danych z oficjalnych stron korzysta z tego samego dostawcy AI.
setExtractor((args) => backend().runJson(args));

export function aiStatus() {
  const b = backend();
  const m = b.models();
  return { provider: config.providerName, model: m.chat, models: m, keyConfigured: b.keyConfigured() };
}

/** Przyjazny komunikat dla błędów AI. */
export function describeError(err, lang = "pl") {
  if (err instanceof AgentError) return err.message;
  return backend().describeError(err, lang) || err?.message || String(err);
}

// ------------------------------------------------------------------ sesje rozmów

const sessions = new Map();

function getSession(id) {
  const now = Date.now();
  for (const [key, s] of sessions) if (now - s.at > SESSION_TTL && !s.busy) sessions.delete(key);
  let s = sessions.get(id);
  if (!s) sessions.set(id, (s = { messages: [], pending: [], busy: false, at: now }));
  s.at = now;
  return s;
}

/** Dopisuje wiadomości na koniec historii; w trakcie trwającej tury – po jej zakończeniu. */
function appendToSession(session, msgs) {
  if (session.busy) session.pending.push(...msgs);
  else session.messages.push(...msgs);
}

export function resetSession(id) {
  sessions.delete(id);
}

// ------------------------------------------------------------------ sprawdzanie odpowiedzi w źródłach

const EVIDENCE_KEEP = 8; // ile dowodów z poprzednich tur pamiętać (pytania uzupełniające, np. „a ulgowy?”)

/**
 * Sprząta odpowiedź i sprawdza ją w dowodach (zdarzenie "verifying" dla aplikacji).
 * Zwraca { status: ok | corrected | unverified | skipped, answer, unsupported }.
 */
async function checkAnswer({ question, answer, evidence, emit, signal, maxLabel }) {
  const cleaned = cleanAnswer(answer, { maxLabel });
  if (!config.verify || !needsVerification(cleaned)) return { status: "skipped", answer: cleaned };
  emit("verifying", {});
  try {
    return await verifyAnswer({ question, answer: cleaned, evidence, signal, maxLabel, effort: config.verifyEffort, runJson: (args) => backend().runJson(args) });
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn("[verify] sprawdzenie nieudane:", describeError(err));
    return { status: "unverified", answer: cleaned };
  }
}

/** W historii tury zostaje sprawdzona wersja odpowiedzi (format OpenAI albo Claude). */
function replaceFinalText(added, text) {
  let last = -1;
  added.forEach((m, i) => m.role === "assistant" && (last = i));
  added.forEach((m, i) => {
    if (m.role !== "assistant") return;
    if (typeof m.content === "string") m.content = i === last ? text : "";
    else if (Array.isArray(m.content)) {
      const rest = m.content.filter((b) => b.type !== "text");
      if (i === last) m.content = [...rest, { type: "text", text }];
      else if (rest.length) m.content = rest;
    }
  });
}

const EMPTY_ANSWER = {
  pl: "Hmm, tym razem nic sensownego mi nie wyszło. Zapytaj proszę jeszcze raz, może trochę inaczej.",
  en: "Hmm, I couldn't come up with a proper answer this time. Could you ask again, maybe a bit differently?",
};

/**
 * Rozmowa z NOMI. Historia sesji jest tylko dopisywana – nowa tura trafia do sesji
 * dopiero po pomyślnym zakończeniu (przerwana tura nie zostawia osieroconych wywołań narzędzi).
 *
 * Najpierw sprawdzenie, potem odpowiedź: tekst modelu NIE jest przesyłany w trakcie pisania – serwer go zbiera,
 * sprawdza w dowodach tej tury i dopiero wtedy wysyła jedną, gotową odpowiedź (zdarzenie "answer").
 * Aplikacja w międzyczasie pokazuje stan (myślę → narzędzia → sprawdzam), więc nic się nie podmienia ani nie urywa.
 */
export async function chat({ sessionId, text, ctx: baseCtx, emit, signal }) {
  const session = getSession(sessionId);
  // Wskazówki tej tury: język odpowiedzi (jak w wiadomości) i wypowiedź o sobie do zapamiętania.
  // Przy niejednoznacznej wiadomości („ok”, „tak”) – język poprzedniej wypowiedzi użytkownika, potem interfejsu.
  const replyLang = detectLang(text) || session.lastLang || baseCtx.lang;
  session.lastLang = replyLang;
  const ctx = { ...baseCtx, replyLang, prefHint: preferenceHint(text) };
  if (session.busy) throw new AgentError("NOMI jeszcze odpowiada na poprzednie pytanie.", 409);
  session.busy = true;
  const citations = new Citations(session);
  const tools = [];
  const evidence = []; // wyniki narzędzi tej tury – dowody do sprawdzenia odpowiedzi
  // Tekst modelu w rundach (przed wywołaniem narzędzia / po nim). Odpowiedzią jest ostatnia runda –
  // wcześniejsze to zwykle „Już sprawdzam…”, które po sprawdzeniu nie mają sensu.
  const rounds = [""];
  const tracked = (event, data) => {
    if (event === "text") return void (rounds[rounds.length - 1] += data.delta);
    if (event === "text_break") return void rounds.push("");
    if (event === "retry") return void (rounds[rounds.length - 1] = "");
    if (event === "tool") tools.push(data.name);
    emit(event, data);
  };
  emit("status", { stage: "thinking" });
  warmPlaces(text, ctx);
  try {
    // Wiedza z oficjalnych źródeł dobrana do pytania – agent dostaje ją od razu, bez wywołania narzędzia.
    const knowledge = await autoKnowledge(retrievalQuery(text, session.messages), citations, { text, ctx });
    const added = await backend().runChat({
      history: session.messages,
      text,
      ctx,
      knowledge,
      emit: tracked,
      signal,
      toolCtx: {
        ctx,
        emit: tracked,
        citations,
        onResult: (name, input, content) => evidence.push(`Wynik narzędzia ${name} ${JSON.stringify(input)}:\n${content}`),
      },
    });
    if (!added) {
      // Tura odrzucona (np. odmowa modelu) – pokazujemy komunikat, ale nic nie zapisujemy w historii.
      emit("answer", { text: rounds.join("\n\n").trim() || EMPTY_ANSWER[ctx.replyLang === "en" ? "en" : "pl"], status: "skipped" });
      return;
    }

    const draft = rounds.at(-1).trim();
    const v = await checkAnswer({
      question: text,
      answer: draft,
      evidence: [buildContextBlock(ctx), knowledge, ...evidence, ...(session.evidence || [])],
      emit,
      signal,
      maxLabel: citations.maxLabel,
    });
    const final = v.answer || EMPTY_ANSWER[ctx.replyLang === "en" ? "en" : "pl"];
    if (final !== draft) replaceFinalText(added, final);
    session.messages.push(...added);
    session.evidence = [...(session.evidence || []), knowledge, ...evidence]
      .filter(Boolean)
      .map((e) => e.slice(0, 4000))
      .slice(-EVIDENCE_KEEP);

    const sources = citations.cited(final, { extraLabels: v.support || [] });
    if (sources.length) emit("action", { type: "sources", sources });
    emit("answer", { text: final, status: v.status, ...(v.unsupported?.length ? { unsupported: v.unsupported } : {}) });
    emit("suggestions", { items: suggestionsFor({ tools, answer: final, lang: ctx.replyLang }) });
  } finally {
    session.busy = false;
    if (session.pending.length) session.messages.push(...session.pending.splice(0));
  }
}

// ------------------------------------------------------------------ opowieści o atrakcjach

/** Fakty do opowieści: z oficjalnych źródeł; baza NOMI tylko awaryjnie (gdy strony były niedostępne). */
function factsFor(a) {
  const r = getOfficial(a.id);
  if (r && (r.facts.length || r.summary)) return { facts: [r.summary, ...r.facts].filter(Boolean), source: r.sources.join(", "), official: true };
  return { facts: [a.summary.pl, ...a.facts], source: "baza NOMI (oficjalne strony jeszcze niepobrane)", official: false };
}

function staticNarration(a, geo, lang) {
  const name = a.name[lang] || a.name.pl;
  const dir = geo?.direction ? `${geo.direction[0].toUpperCase()}${geo.direction.slice(1)}${lang === "en" ? ": " : " – "}` : "";
  if (lang === "en") return `${dir}${name}. ${a.summary.en}`;
  const { facts } = factsFor(a);
  return `${dir}${name}. ${facts.slice(0, 3).join(" ")}`;
}

/**
 * Automatyczna opowieść jako para wiadomości w historii rozmowy – dzięki temu agent wie,
 * co użytkownik usłyszał i o co NOMI zapytał (np. „Sprawdzić godziny?” → „chcę”).
 * Dołączamy oficjalne godziny i ceny, żeby agent nie musiał ich zgadywać.
 */
function narrationTurn(a, text) {
  const official = officialText(a.id, { facts: true });
  return [
    {
      role: "user",
      content:
        `<zdarzenie_aplikacji>Użytkownik zbliżył się do atrakcji: ${a.name.pl} [${a.id}]. ` +
        `Aplikacja poprosiła NOMI o krótką opowieść – poniżej to, co użytkownik usłyszał.\n` +
        (official ? `Oficjalne dane: ${official}` : "Brak pobranych oficjalnych danych o godzinach i cenach.") +
        `</zdarzenie_aplikacji>`,
    },
    { role: "assistant", content: text },
  ];
}

// Gotowe początki wypowiedzi – modele potrafią pomylić stronę („Przed tobą, za twoimi plecami…”).
const OPENERS_PL = {
  "na wprost": "Przed tobą",
  "lekko w prawo": "Przed tobą, lekko po prawej",
  "lekko w lewo": "Przed tobą, lekko po lewej",
  "po prawej": "Po twojej prawej",
  "po lewej": "Po twojej lewej",
  "z tyłu po prawej": "Za tobą, po prawej",
  "z tyłu po lewej": "Za tobą, po lewej",
  "za tobą": "Za twoimi plecami",
};

function openerFor(direction, lang) {
  if (!direction) return null;
  if (lang === "en") return direction[0].toUpperCase() + direction.slice(1);
  return OPENERS_PL[direction] || null;
}

/** Usuwa końcowe pytanie z wypowiedzi złożonej z kilku zdań. */
export function dropTrailingQuestion(text) {
  const parts = String(text).trim().split(/(?<=[.!?…])\s+/);
  return parts.length > 1 && parts.at(-1).trim().endsWith("?") ? parts.slice(0, -1).join(" ") : String(text).trim();
}

export async function narrate({ attraction: a, ctx, emit, signal, sessionId, onRoute = false }) {
  const lang = ctx.lang;
  const geo = hasPosition(ctx) ? withGeometry(a, ctx.lat, ctx.lon, ctx.heading, lang) : null;
  const opener = openerFor(geo?.direction, lang);
  const { facts, source } = factsFor(a);
  const prompt = [
    buildContextBlock(ctx),
    `Turysta zbliża się do: ${a.name.pl} (${a.name.en}).`,
    geo ? `Odległość: ${geo.distance} m.` : "Odległość nieznana.",
    opener
      ? `Zacznij wypowiedź dokładnie od słów: „${opener}” – to kierunek wyliczony z kompasu, nie zmieniaj go.`
      : "Kierunek względem użytkownika jest nieznany – nie wskazuj strony.",
    `Fakty (źródło: ${source}) – opowiadaj tylko na ich podstawie:\n- ${facts.join("\n- ")}`,
    onRoute
      ? "Użytkownik idzie właśnie do celu z włączoną nawigacją, a ta atrakcja jest po drodze. Opowiedz krótką ciekawostkę: 2–3 zdania, najwyżej 50 słów. NIE zadawaj pytania na końcu i nie mów, dokąd iść – nawigacja wróci zaraz po tobie."
      : "",
    `Język wypowiedzi: ${lang === "en" ? "angielski" : "polski"}.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Tekst opowieści zbieramy – aplikacja dostaje dopiero sprawdzoną wersję (zdarzenie "answer").
  let told = "";
  let fromAI = true;
  const tracked = (event, data) => {
    if (event === "text") return void (told += data.delta || "");
    emit(event, data);
  };
  emit("status", { stage: "story" });
  try {
    const { refused } = await backend().runNarration({ prompt, emit: tracked, signal });
    if (refused && !told) {
      fromAI = false;
      told = staticNarration(a, geo, lang);
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    // Bez AI nadal opowiadamy – z oficjalnych faktów.
    console.warn("[narrate] AI niedostępne, narracja statyczna:", describeError(err));
    if (!told) {
      fromAI = false;
      told = staticNarration(a, geo, lang);
    }
    emit("notice", { message: describeError(err, lang) });
  }

  // Opowieść z modelu sprawdzamy w faktach, na których miała się opierać (opowieść awaryjna to same fakty).
  const draft = told.trim();
  let final = draft;
  let status = "skipped";
  if (draft && fromAI) {
    const official = officialText(a.id, { facts: false });
    const v = await checkAnswer({
      question: `Krótka opowieść o atrakcji: ${a.name.pl}`,
      answer: draft,
      evidence: [
        `Atrakcja: ${a.name.pl} (${a.name.en}).`,
        geo ? `Kontekst z telefonu: odległość ${geo.distance} m${opener ? `; kierunek z kompasu – wypowiedź zaczyna się od słów „${opener}”` : ""}.` : "",
        `Oficjalne fakty (źródło: ${source}):\n- ${facts.join("\n- ")}`,
        official ? `Oficjalne godziny i ceny: ${official}` : "",
      ],
      emit,
      signal,
    });
    final = v.answer || draft;
    status = v.status;
    // Ciekawostka po drodze kończy się bez pytania – nawigacja zaraz wraca (model nie zawsze tego pilnuje).
    if (onRoute) final = dropTrailingQuestion(final);
  }
  // Źródła opowieści: oficjalne strony atrakcji.
  const o = officialPublic(a.id);
  if (o?.sources?.length) {
    emit("action", {
      type: "sources",
      sources: o.sources.map((url) => ({ title: a.name[lang] || a.name.pl, url, source: sourceLabel(url), fetched: o.fetched })),
    });
  }
  emit("answer", { text: final, status });
  if (sessionId && final) appendToSession(getSession(sessionId), narrationTurn(a, final));
}

// ------------------------------------------------------------------ planer zwiedzania

const KINDS = ["sight", "museum", "church", "viewpoint", "walk", "meal", "coffee", "break"];

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    stops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          attraction_id: { type: "string" },
          kind: { type: "string", enum: KINDS },
          lat: { type: "number" },
          lon: { type: "number" },
          start_time: { type: "string" },
          duration_min: { type: "integer" },
          description: { type: "string" },
          tip: { type: "string" },
        },
        required: ["name", "attraction_id", "kind", "lat", "lon", "start_time", "duration_min", "description", "tip"],
        additionalProperties: false,
      },
    },
    tips: { type: "array", items: { type: "string" } },
  },
  required: ["title", "summary", "stops", "tips"],
  additionalProperties: false,
};

function attractionCatalog() {
  return ATTRACTIONS.map((a) => {
    const official = officialText(a.id, { sources: false, maxPrices: 3 });
    const summary = getOfficial(a.id)?.summary;
    return (
      `${a.id} | ${a.name.pl} | ${a.lat.toFixed(5)},${a.lon.toFixed(5)} | ${a.district} | tagi: ${a.tags.join(",")} | ok. ${a.visitMin} min` +
      ` | oficjalnie: ${official || "brak pobranych danych o godzinach i cenach"}` +
      (summary ? ` | opis: ${summary}` : "")
    );
  }).join("\n");
}

/** Modele bez gwarancji schematu potrafią pominąć pola – wyrównujemy i odrzucamy punkty bez współrzędnych. */
function normalizePlan(plan) {
  const str = (v) => (typeof v === "string" ? v : "");
  const stops = (Array.isArray(plan?.stops) ? plan.stops : [])
    .filter((s) => Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lon)) && s?.name)
    .map((s) => ({
      name: str(s.name),
      attraction_id: str(s.attraction_id),
      kind: KINDS.includes(s.kind) ? s.kind : "sight",
      lat: Number(s.lat),
      lon: Number(s.lon),
      start_time: str(s.start_time),
      duration_min: Math.round(Number(s.duration_min) || 30),
      description: str(s.description),
      tip: str(s.tip),
    }));
  if (!stops.length) throw new AgentError("Model nie zwrócił żadnego punktu planu.");
  return {
    title: str(plan.title) || "Plan zwiedzania",
    summary: str(plan.summary),
    stops,
    tips: Array.isArray(plan.tips) ? plan.tips.filter((t) => typeof t === "string") : [],
  };
}

export async function makePlan(prefs, signal) {
  const lang = prefs.lang === "en" ? "en" : "pl";
  // Parametry routingu planu: prawdziwe trasy między punktami i przeliczony harmonogram.
  const routing = { start: prefs.start, date: prefs.date, startTime: prefs.startTime, transport: prefs.transport, lang };
  const weekday = new Intl.DateTimeFormat("pl-PL", { weekday: "long", timeZone: "Europe/Warsaw" }).format(new Date(`${prefs.date}T12:00:00`));
  const request = [
    `Data: ${prefs.date} (${weekday}). Start o ${prefs.startTime}, czas na zwiedzanie: ${prefs.hours} h.`,
    `Start z: ${prefs.start.name} (${prefs.start.lat.toFixed(5)}, ${prefs.start.lon.toFixed(5)}).`,
    `Zainteresowania: ${prefs.interests.length ? prefs.interests.join(", ") : "ogólne zwiedzanie"}.`,
    `Tempo: ${prefs.pace}. Budżet: ${prefs.budget}. Poruszanie się: ${prefs.transport === "walk" ? "tylko pieszo" : "pieszo + tramwaje/autobusy"}.`,
    prefs.notes ? `Uwagi turysty: ${prefs.notes}` : "",
    `Język planu: ${lang === "en" ? "angielski" : "polski"}.`,
    `\nDostępne atrakcje (id | nazwa | współrzędne | dzielnica | tagi | czas zwiedzania | oficjalne godziny i ceny):\n${attractionCatalog()}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const plan = normalizePlan(await backend().runJson({ request, schema: PLAN_SCHEMA, signal }));
    return { ...(await routePlan({ ...plan, stops: plan.stops.map(withOfficial) }, routing)), source: "ai" };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn("[planner] AI niedostępne – plan uproszczony:", describeError(err));
    const plan = simplePlan(prefs);
    return { ...(await routePlan({ ...plan, stops: plan.stops.map(withOfficial) }, routing)), source: "fallback", notice: describeError(err, lang) };
  }
}
