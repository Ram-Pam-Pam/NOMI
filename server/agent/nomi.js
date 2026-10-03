// Agent NOMI: wspólna warstwa nad dostawcami AI (Claude albo serwer zgodny z OpenAI, np. Sherlock).
import { config } from "../config.js";
import { ATTRACTIONS } from "../data/attractions.js";
import { withGeometry } from "../services/attractions.js";
import { simplePlan } from "../services/simplePlanner.js";
import * as anthropic from "./anthropic.js";
import { buildContextBlock, hasPosition } from "./context.js";
import { AgentError } from "./errors.js";
import * as compat from "./openaiCompat.js";

export { AgentError };

const SESSION_TTL = 3 * 3600_000;
const backend = () => (config.provider === "anthropic" ? anthropic : compat);

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
  if (!s) sessions.set(id, (s = { messages: [], busy: false, at: now }));
  s.at = now;
  return s;
}

export function resetSession(id) {
  sessions.delete(id);
}

/**
 * Rozmowa z NOMI. Historia sesji jest tylko dopisywana – nowa tura trafia do sesji
 * dopiero po pomyślnym zakończeniu (przerwana tura nie zostawia osieroconych wywołań narzędzi).
 */
export async function chat({ sessionId, text, ctx, emit, signal }) {
  const session = getSession(sessionId);
  if (session.busy) throw new AgentError("NOMI jeszcze odpowiada na poprzednie pytanie.", 409);
  session.busy = true;
  try {
    const added = await backend().runChat({ history: session.messages, text, ctx, emit, signal });
    if (added) session.messages.push(...added);
  } finally {
    session.busy = false;
  }
}

// ------------------------------------------------------------------ opowieści o atrakcjach

function staticNarration(a, geo, lang) {
  const name = a.name[lang] || a.name.pl;
  const dir = geo?.direction ? `${geo.direction[0].toUpperCase()}${geo.direction.slice(1)}${lang === "en" ? ": " : " – "}` : "";
  const facts = lang === "en" ? "" : ` ${a.facts.slice(0, 2).join(" ")}`;
  return `${dir}${name}. ${a.summary[lang] || a.summary.pl}${facts}`;
}

export async function narrate({ attraction: a, ctx, emit, signal }) {
  const lang = ctx.lang;
  const geo = hasPosition(ctx) ? withGeometry(a, ctx.lat, ctx.lon, ctx.heading, lang) : null;
  const prompt = [
    buildContextBlock(ctx),
    `Turysta zbliża się do: ${a.name.pl} (${a.name.en}).`,
    geo ? `Odległość: ${geo.distance} m. Kierunek względem użytkownika: ${geo.direction || "nieznany"}.` : "Odległość nieznana.",
    `Fakty:\n- ${a.facts.join("\n- ")}`,
    a.tips ? `Praktyczna wskazówka: ${a.tips}` : "",
    `Język wypowiedzi: ${lang === "en" ? "angielski" : "polski"}.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let spoke = false;
  const tracked = (event, data) => {
    if (event === "text" && data.delta) spoke = true;
    emit(event, data);
  };
  try {
    const { refused } = await backend().runNarration({ prompt, emit: tracked, signal });
    if (refused && !spoke) emit("text", { delta: staticNarration(a, geo, lang) });
  } catch (err) {
    if (signal?.aborted) throw err;
    // Bez AI nadal opowiadamy – z bazy faktów.
    console.warn("[narrate] AI niedostępne, narracja statyczna:", describeError(err));
    if (!spoke) emit("text", { delta: staticNarration(a, geo, lang) });
    emit("notice", { message: describeError(err, lang) });
  }
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
          getting_there: { type: "string" },
        },
        required: ["name", "attraction_id", "kind", "lat", "lon", "start_time", "duration_min", "description", "tip", "getting_there"],
        additionalProperties: false,
      },
    },
    tips: { type: "array", items: { type: "string" } },
  },
  required: ["title", "summary", "stops", "tips"],
  additionalProperties: false,
};

function attractionCatalog() {
  return ATTRACTIONS.map(
    (a) =>
      `${a.id} | ${a.name.pl} | ${a.lat.toFixed(5)},${a.lon.toFixed(5)} | ${a.district} | tagi: ${a.tags.join(",")} | ok. ${a.visitMin} min${a.tips ? ` | ${a.tips}` : ""}`,
  ).join("\n");
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
      getting_there: str(s.getting_there),
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
  const request = [
    `Data: ${prefs.date}. Start o ${prefs.startTime}, czas na zwiedzanie: ${prefs.hours} h.`,
    `Start z: ${prefs.start.name} (${prefs.start.lat.toFixed(5)}, ${prefs.start.lon.toFixed(5)}).`,
    `Zainteresowania: ${prefs.interests.length ? prefs.interests.join(", ") : "ogólne zwiedzanie"}.`,
    `Tempo: ${prefs.pace}. Budżet: ${prefs.budget}. Poruszanie się: ${prefs.transport === "walk" ? "tylko pieszo" : "pieszo + tramwaje/autobusy"}.`,
    prefs.notes ? `Uwagi turysty: ${prefs.notes}` : "",
    `Język planu: ${lang === "en" ? "angielski" : "polski"}.`,
    `\nDostępne atrakcje (id | nazwa | współrzędne | dzielnica | tagi | czas zwiedzania | uwagi):\n${attractionCatalog()}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const plan = await backend().runPlan({ request, schema: PLAN_SCHEMA, signal });
    return { ...normalizePlan(plan), source: "ai" };
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn("[planner] AI niedostępne – plan uproszczony:", describeError(err));
    return { ...simplePlan(prefs), source: "fallback", notice: describeError(err, lang) };
  }
}
