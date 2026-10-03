import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import express from "express";
import { config } from "./config.js";
import { AgentError, aiStatus, chat, describeError, makePlan, narrate, resetSession } from "./agent/nomi.js";
import { sanitizeContext } from "./agent/context.js";
import { ATTRACTIONS, CATEGORY_LABELS, attractionById } from "./data/attractions.js";
import { TICKETS } from "./data/tickets.js";
import { nearbyAttractions } from "./services/attractions.js";
import { searchPlaces } from "./services/geocode.js";
import { PLACE_TYPES, findPlaces } from "./services/places.js";
import { planRoute } from "./services/routes.js";
import { localYmd } from "./time.js";
import { nextDepartures, realtime, startTimetableService, transitStatus, vehiclesNear } from "./transit/index.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(express.static(config.publicDir, { maxAge: 0 }));

const num = (v) => (v === undefined || v === "" || v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const lang = (v) => (v === "en" ? "en" : "pl");

function requirePoint(q, prefix = "") {
  const lat = num(q[`${prefix}lat`]);
  const lon = num(q[`${prefix}lon`]);
  if (lat === null || lon === null) throw Object.assign(new Error("Brak współrzędnych lat/lon"), { status: 400 });
  return { lat, lon };
}

/** Strumień Server-Sent Events + przerwanie pracy, gdy klient się rozłączy. */
function openSse(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  const emit = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  return { emit, signal: controller.signal };
}

// ------------------------------------------------------------------ status

app.get("/api/health", (req, res) => {
  res.json({ ok: true, ai: aiStatus(), transit: transitStatus(), time: new Date().toISOString() });
});

// ------------------------------------------------------------------ atrakcje i miejsca

app.get("/api/attractions", (req, res) => {
  const l = lang(req.query.lang);
  res.json(
    ATTRACTIONS.map((a) => ({
      id: a.id,
      name: a.name[l],
      lat: a.lat,
      lon: a.lon,
      category: a.category,
      categoryLabel: CATEGORY_LABELS[a.category]?.[l],
      tags: a.tags,
      radius: a.radius,
      visitMin: a.visitMin,
      district: a.district,
      summary: a.summary[l],
      tips: a.tips,
    })),
  );
});

app.get("/api/nearby", (req, res) => {
  const { lat, lon } = requirePoint(req.query);
  res.json(
    nearbyAttractions({ lat, lon, heading: num(req.query.heading), radius: num(req.query.radius) ?? 800, limit: 10, lang: lang(req.query.lang) }),
  );
});

app.get("/api/places", async (req, res) => {
  const { lat, lon } = requirePoint(req.query);
  const type = String(req.query.type || "restaurant");
  if (!PLACE_TYPES[type]) return res.status(400).json({ error: `Nieznany typ: ${type}` });
  res.json(
    await findPlaces({
      type,
      lat,
      lon,
      radius: num(req.query.radius) ?? 600,
      limit: Math.min(num(req.query.limit) ?? 20, 40),
      cuisine: req.query.cuisine ? String(req.query.cuisine) : undefined,
    }),
  );
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json([]);
  res.json(await searchPlaces(q, { limit: 7 }));
});

app.get("/api/tickets", (req, res) => res.json(TICKETS));

// ------------------------------------------------------------------ trasy i komunikacja

app.get("/api/route", async (req, res) => {
  const from = { ...requirePoint(req.query, "from"), name: req.query.fromName ? String(req.query.fromName) : undefined };
  const to = { ...requirePoint(req.query, "to"), name: req.query.toName ? String(req.query.toName) : undefined };
  const mode = ["walk", "transit", "auto"].includes(req.query.mode) ? req.query.mode : "auto";
  const departAt = num(req.query.departAt) ?? Date.now();
  res.json(await planRoute({ from, to, mode, departAt, lang: lang(req.query.lang) }));
});

app.get("/api/departures", async (req, res) => {
  res.json(
    await nextDepartures({
      lat: num(req.query.lat),
      lon: num(req.query.lon),
      stopName: req.query.stop ? String(req.query.stop) : undefined,
      limit: 20,
    }),
  );
});

app.get("/api/vehicles", async (req, res) => {
  if (req.query.lat && req.query.lon) {
    const { lat, lon } = requirePoint(req.query);
    return res.json(await vehiclesNear(lat, lon, Math.min(num(req.query.radius) ?? 80, 2000)));
  }
  const [s, w, n, e] = String(req.query.bbox || "").split(",").map(Number);
  const list = await realtime.getVehicles();
  res.json([s, w, n, e].every(Number.isFinite) ? list.filter((v) => v.lat >= s && v.lat <= n && v.lon >= w && v.lon <= e) : list);
});

// ------------------------------------------------------------------ agent AI

app.post("/api/chat", async (req, res) => {
  const text = String(req.body?.message || "").trim().slice(0, 2000);
  const sessionId = String(req.body?.sessionId || "").slice(0, 80);
  if (!text || !sessionId) return res.status(400).json({ error: "Brak wiadomości lub sessionId" });
  const ctx = sanitizeContext(req.body?.context);
  const { emit, signal } = openSse(req, res);
  try {
    await chat({ sessionId, text, ctx, emit, signal });
    emit("done", {});
  } catch (err) {
    if (!signal.aborted) {
      console.warn("[chat]", err.message);
      emit("error", { message: describeError(err, ctx.lang), status: err.status });
    }
  }
  res.end();
});

app.post("/api/chat/reset", (req, res) => {
  resetSession(String(req.body?.sessionId || ""));
  res.json({ ok: true });
});

app.post("/api/narrate", async (req, res) => {
  const attraction = attractionById.get(String(req.body?.attractionId || ""));
  if (!attraction) return res.status(404).json({ error: "Nieznana atrakcja" });
  const ctx = sanitizeContext(req.body?.context);
  const { emit, signal } = openSse(req, res);
  try {
    await narrate({ attraction, ctx, emit, signal });
    emit("done", {});
  } catch (err) {
    if (!signal.aborted) emit("error", { message: describeError(err, ctx.lang) });
  }
  res.end();
});

app.post("/api/plan", async (req, res) => {
  const b = req.body || {};
  const start = b.start && num(b.start.lat) !== null && num(b.start.lon) !== null
    ? { lat: num(b.start.lat), lon: num(b.start.lon), name: String(b.start.name || "Start").slice(0, 80) }
    : { lat: 50.0617, lon: 19.9373, name: "Rynek Główny" };
  const prefs = {
    lang: lang(b.lang),
    date: localYmd().replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
    startTime: /^\d{1,2}:\d{2}$/.test(b.startTime) ? b.startTime : "10:00",
    hours: Math.min(Math.max(num(b.hours) ?? 4, 1), 12),
    interests: Array.isArray(b.interests) ? b.interests.map(String).slice(0, 12) : [],
    pace: ["relaxed", "normal", "intense"].includes(b.pace) ? b.pace : "normal",
    budget: ["low", "medium", "high"].includes(b.budget) ? b.budget : "medium",
    transport: b.transport === "walk" ? "walk" : "mixed",
    notes: String(b.notes || "").slice(0, 500),
    start,
  };
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  try {
    res.json(await makePlan(prefs, controller.signal));
  } catch (err) {
    if (!controller.signal.aborted) res.status(500).json({ error: describeError(err, prefs.lang) });
  }
});

// ------------------------------------------------------------------ błędy

app.use("/api", (req, res) => res.status(404).json({ error: "Nie znaleziono" }));
app.use((err, req, res, _next) => {
  const status = err.status || (err instanceof AgentError ? err.status : 500);
  if (status >= 500) console.error("[api]", err);
  if (!res.headersSent) res.status(status).json({ error: err.message || "Błąd serwera" });
});

// ------------------------------------------------------------------ start

startTimetableService();

const server = config.https
  ? https.createServer({ key: fs.readFileSync(config.https.key), cert: fs.readFileSync(config.https.cert) }, app)
  : http.createServer(app);

server.listen(config.port, config.host, () => {
  const proto = config.https ? "https" : "http";
  console.log(`\n  NOMI – przewodnik AI po Krakowie`);
  console.log(`  ➜ ${proto}://localhost:${config.port}`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === "IPv4" && !a.internal) console.log(`  ➜ ${proto}://${a.address}:${config.port}  (sieć lokalna)`);
  }
  const ai = aiStatus();
  const keyVar = ai.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "LLM_API_KEY";
  console.log(`  AI: ${ai.provider} – rozmowa: ${ai.models.chat}, opowieści: ${ai.models.narrate}, planer: ${ai.models.plan}`);
  if (!ai.keyConfigured) console.log(`  ⚠ brak ${keyVar} w .env – czat AI wyłączony, reszta aplikacji działa`);
  if (!config.https) console.log("  GPS i kompas na telefonie wymagają HTTPS – zobacz README (sekcja „Telefon”).\n");
});
