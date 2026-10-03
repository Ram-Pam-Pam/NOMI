// Backend zgodny z OpenAI (Sherlock) na atrapie serwera – bez sieci i bez klucza.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

const requests = [];
let server;
let replies = []; // kolejka odpowiedzi: funkcja (body, res) => void

const chunk = (delta, finish = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });

function stream(res, chunks) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      requests.push({ headers: req.headers, body: parsed });
      const reply = replies.shift();
      if (!reply) {
        res.writeHead(500);
        return res.end("brak przygotowanej odpowiedzi");
      }
      reply(parsed, res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  Object.assign(process.env, {
    NOMI_SKIP_DOTENV: "1",
    LLM_PROVIDER: "sherlock",
    LLM_API_KEY: "test-key",
    LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/openai/v1`,
    NOMI_CHAT_MODEL: "openai/gpt-oss-120b",
    NOMI_NARRATE_MODEL: "speakleash/Bielik-11B-v3.0-Instruct",
    NOMI_PLAN_MODEL: "openai/gpt-oss-20b", // inny model niż czat – odrzucenie parametru jest pamiętane per model
  });
});

after(() => server.close());

async function load() {
  const nomi = await import("../server/agent/nomi.js");
  const { sanitizeContext } = await import("../server/agent/context.js");
  return { ...nomi, ctx: sanitizeContext({ lang: "pl", lat: 50.0617, lon: 19.9373, heading: 90 }) };
}

function collector() {
  const events = [];
  const emit = (type, data) => events.push({ type, data });
  const text = () => events.filter((e) => e.type === "text").map((e) => e.data.delta).join("");
  return { events, emit, text };
}

test("rozmowa: natywne narzędzia w streamingu, <think> ukryty, odrzucony parametr pomijany", async () => {
  const { chat, ctx } = await load();
  requests.length = 0;
  replies = [
    // Serwer nie zna reasoning_effort → 400; klient ma ponowić bez tego parametru.
    (body, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Unsupported parameter: reasoning_effort" } }));
    },
    (body, res) =>
      stream(res, [
        chunk({ role: "assistant", content: "" }),
        chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_ticket_info", arguments: "" } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"ride_' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'minutes": 20}' } }] }, "tool_calls"),
      ]),
    (body, res) =>
      stream(res, [chunk({ content: "<thi" }), chunk({ content: "nk>liczę…</think>Kup bilet " }), chunk({ content: "30-minutowy za 6 zł." }, "stop")]),
  ];
  const c = collector();
  await chat({ sessionId: "c1", text: "Jaki bilet kupić?", ctx, emit: c.emit, signal: new AbortController().signal });

  assert.equal(requests.length, 3);
  assert.equal(requests[0].body.reasoning_effort, "low");
  assert.equal(requests[1].body.reasoning_effort, undefined, "ponowienie bez odrzuconego parametru");
  assert.equal(requests[1].headers.authorization, "Bearer test-key");
  assert.equal(requests[1].body.tools[0].type, "function");
  assert.ok(requests[1].body.tools.every((t) => t.function.parameters && !("eager_input_streaming" in t)));
  assert.match(requests[1].body.messages[1].content, /<kontekst_aplikacji>/);

  const toolMsg = requests[2].body.messages.at(-1);
  assert.equal(toolMsg.role, "tool");
  assert.equal(toolMsg.tool_call_id, "call_1");
  assert.equal(JSON.parse(toolMsg.content).recommendation.price, 6);
  assert.equal(requests[2].body.messages.at(-2).tool_calls[0].function.arguments, '{"ride_minutes": 20}');

  assert.equal(c.text(), "Kup bilet 30-minutowy za 6 zł.");
  assert.ok(c.events.some((e) => e.type === "tool_done" && e.data.ok));
});

test("rozmowa: wywołanie narzędzia zapisane tekstem <tool_call> i ciągłość historii", async () => {
  const { chat, ctx } = await load();
  requests.length = 0;
  replies = [
    (body, res) =>
      stream(res, [
        chunk({ content: '<tool_call>{"name": "get_ticket_info", "arguments": {"ride_minutes": 50}}' }),
        chunk({ content: "</tool_call>" }, "stop"),
      ]),
    (body, res) => stream(res, [chunk({ content: "Bilet 60-minutowy kosztuje 8 zł." }, "stop")]),
  ];
  const c = collector();
  await chat({ sessionId: "c1", text: "A na dłuższą jazdę?", ctx, emit: c.emit, signal: new AbortController().signal });

  // Historia z pierwszego testu jest wysyłana dalej (ta sama sesja).
  const first = requests[0].body.messages;
  assert.equal(first.filter((m) => m.role === "user").length, 2);
  assert.ok(!("reasoning_effort" in requests[0].body), "zapamiętane odrzucenie parametru");
  const toolMsg = requests[1].body.messages.at(-1);
  assert.equal(toolMsg.role, "tool");
  assert.equal(JSON.parse(toolMsg.content).recommendation.price, 8);
  assert.equal(c.text(), "Bilet 60-minutowy kosztuje 8 zł.");
  assert.ok(!c.text().includes("tool_call"));
});

test("opowieść: model narratora (Bielik) w streamingu", async () => {
  const { narrate, ctx } = await load();
  const { attractionById } = await import("../server/data/attractions.js");
  requests.length = 0;
  replies = [(body, res) => stream(res, [chunk({ content: "Po twojej lewej " }), chunk({ content: "stoi Barbakan." }, "stop")])];
  const c = collector();
  await narrate({ attraction: attractionById.get("barbakan"), ctx, emit: c.emit, signal: new AbortController().signal });
  assert.equal(requests[0].body.model, "speakleash/Bielik-11B-v3.0-Instruct");
  assert.equal(requests[0].body.temperature, 0.7);
  assert.ok(!("reasoning_effort" in requests[0].body));
  assert.equal(c.text(), "Po twojej lewej stoi Barbakan.");
});

test("planer: JSON ze schematem, normalizacja pól", async () => {
  const { makePlan } = await load();
  requests.length = 0;
  const plan = {
    title: "Królewski Kraków",
    summary: "Spacer",
    stops: [
      { name: "Wawel", attraction_id: "wawel-zamek", kind: "sight", lat: 50.0541, lon: 19.93545, start_time: "10:00", duration_min: 90, description: "Zamek", tip: "", getting_there: "Spacer" },
      { name: "Bez współrzędnych", kind: "sight" },
    ],
    tips: ["Wygodne buty"],
  };
  replies = [(body, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }))];
  const result = await makePlan({
    lang: "pl", date: "2026-10-04", startTime: "10:00", hours: 4, interests: ["history"], pace: "normal", budget: "medium", transport: "mixed", notes: "",
    start: { lat: 50.0617, lon: 19.9373, name: "Rynek" },
  });
  assert.equal(requests[0].body.response_format.type, "json_schema");
  assert.equal(requests[0].body.reasoning_effort, "medium");
  assert.equal(result.source, "ai");
  assert.equal(result.stops.length, 1, "punkt bez współrzędnych odrzucony");
  assert.equal(result.stops[0].name, "Wawel");
});
