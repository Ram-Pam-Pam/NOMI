import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// .env jest opcjonalny – zmienne mogą też przyjść ze środowiska (testy ustawiają NOMI_SKIP_DOTENV).
if (!process.env.NOMI_SKIP_DOTENV) {
  try {
    process.loadEnvFile(path.join(ROOT, ".env"));
  } catch {
    /* brak pliku .env */
  }
}

const env = process.env;

// Dostawca AI: "anthropic" (Claude) albo serwer zgodny z API OpenAI – domyślnie Sherlock (CloudFerro).
const providerName = (env.LLM_PROVIDER || (env.LLM_API_KEY || env.SHERLOCK_API_KEY ? "sherlock" : "anthropic")).toLowerCase();

export const config = {
  port: Number(env.PORT) || 3000,
  host: env.HOST || "0.0.0.0",
  https: env.HTTPS_KEY && env.HTTPS_CERT ? { key: env.HTTPS_KEY, cert: env.HTTPS_CERT } : null,

  // Agent AI
  provider: providerName === "anthropic" ? "anthropic" : "compat",
  providerName,

  // Serwer zgodny z OpenAI (Sherlock / inny): osobne modele do rozmowy, opowieści i planera.
  compat: {
    baseUrl: (env.LLM_BASE_URL || "https://api-sherlock.cloudferro.com/openai/v1").replace(/\/+$/, ""),
    apiKey: env.LLM_API_KEY || env.SHERLOCK_API_KEY || "",
    chatModel: env.NOMI_CHAT_MODEL || "openai/gpt-oss-120b",
    narrateModel: env.NOMI_NARRATE_MODEL || "speakleash/Bielik-11B-v3.0-Instruct",
    planModel: env.NOMI_PLAN_MODEL || "openai/gpt-oss-120b",
    reasoningEffort: env.NOMI_REASONING_EFFORT || "low",
    planReasoningEffort: env.NOMI_PLAN_REASONING_EFFORT || "medium",
  },

  // Sprawdzanie każdej odpowiedzi NOMI w dowodach z oficjalnych źródeł (NOMI_VERIFY=off – wyłączone).
  // Getter: czytane przy każdym wywołaniu (testy przełączają je w locie).
  get verify() {
    return env.NOMI_VERIFY !== "off";
  },
  // Staranność sprawdzania: medium wyłapuje przeniesione fakty (np. data z innego zdarzenia), low – szybsze.
  verifyEffort: env.NOMI_VERIFY_EFFORT || "medium",

  // Baza wiedzy (RAG) z oficjalnych źródeł: model embeddingów (Sherlock) i co ile dni odświeżać.
  rag: {
    embedModel: env.RAG_EMBED_MODEL || "BAAI/bge-multilingual-gemma2",
    ttlDays: Number(env.RAG_TTL_DAYS) || 7,
  },

  // Claude (LLM_PROVIDER=anthropic)
  model: env.NOMI_MODEL || "claude-opus-5-5",
  chatEffort: env.NOMI_EFFORT || "low",
  planEffort: env.NOMI_PLAN_EFFORT || "medium",
  // Serwerowy fallback na inny model przy odmowie klasyfikatora bezpieczeństwa (wyłącz: NOMI_FALLBACKS=off).
  fallbacks: env.NOMI_FALLBACKS !== "off",

  dataDir: env.NOMI_DATA_DIR || path.join(ROOT, "data"),
  publicDir: path.join(ROOT, "public"),
  timezone: "Europe/Warsaw",
  userAgent: env.NOMI_USER_AGENT || "NOMI-Krakow-Guide/1.0 (tourist guide app)",

  // Rozkłady ZTP Kraków (GTFS + GTFS-Realtime)
  gtfsBase: env.GTFS_BASE_URL || "https://gtfs.ztp.krakow.pl",
  gtfsFeeds: ["A", "M", "T"], // A – autobusy MPK, M – autobusy Mobilis, T – tramwaje
  gtfsMaxAgeHours: 12,

  osrmFoot: env.OSRM_FOOT_URL || "https://routing.openstreetmap.de/routed-foot",
  overpass: env.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
  nominatim: env.NOMINATIM_URL || "https://nominatim.openstreetmap.org",

  // Granice obszaru wyszukiwania (Kraków + okolice)
  bbox: { south: 49.95, west: 19.75, north: 50.15, east: 20.25 },
};
