// Backend zgodny z OpenAI (Sherlock) na atrapie serwera – bez sieci i bez klucza.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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
  // Oficjalne dane atrakcji z dysku – tymczasowy katalog z jednym rekordem (bez sieci).
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-test-"));
  fs.mkdirSync(path.join(dataDir, "official"));
  fs.writeFileSync(
    path.join(dataDir, "official", "ogrod-botaniczny.json"),
    JSON.stringify({
      id: "ogrod-botaniczny", v: 2, name: "Ogród Botaniczny UJ", fetchedAt: Date.now(), hash: "x",
      sources: ["https://ogrod.uj.edu.pl/zwiedzanie/podstawowe-info", "https://krakow.travel/197-krakow-ogrod-botaniczny"],
      summary: "Najstarszy ogród botaniczny w Polsce.", facts: ["Założony w 1783 roku."],
      opening_hours: [{ what: "Ogród", period: "październik", days: "codziennie", hours: "9:00–17:00" }],
      closed: [], last_entry: "", prices: [{ ticket: "normalny", price: "22 zł" }], free_entry: "", booking: "", notes: [],
    }),
  );
  Object.assign(process.env, {
    NOMI_SKIP_DOTENV: "1",
    LLM_PROVIDER: "sherlock",
    LLM_API_KEY: "test-key",
    LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/openai/v1`,
    NOMI_DATA_DIR: dataDir,
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

test("planer: JSON ze schematem, normalizacja pól, oficjalne dane przy punktach", async () => {
  const { makePlan } = await load();
  const { loadOfficial } = await import("../server/services/official.js");
  await loadOfficial();
  requests.length = 0;
  const plan = {
    title: "Królewski Kraków",
    summary: "Spacer",
    stops: [
      { name: "Wawel", attraction_id: "wawel-zamek", kind: "sight", lat: 50.0541, lon: 19.93545, start_time: "10:00", duration_min: 90, description: "Zamek", tip: "", getting_there: "Spacer" },
      { name: "Ogród Botaniczny UJ", attraction_id: "ogrod-botaniczny", kind: "sight", lat: 50.063, lon: 19.956, start_time: "12:00", duration_min: 60, description: "", tip: "", getting_there: "" },
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
  assert.equal(result.stops.length, 2, "punkt bez współrzędnych odrzucony");
  const ogrod = result.stops.find((x) => x.attraction_id === "ogrod-botaniczny");
  assert.equal(ogrod.official.prices[0].price, "22 zł", "oficjalne ceny dołączone przez serwer");
  assert.ok(ogrod.official.sources[0].startsWith("https://ogrod.uj.edu.pl"));
  assert.match(requests[0].body.messages[1].content, /ogrod-botaniczny .*oficjalnie: godziny: Ogród: październik codziennie 9:00–17:00/);
  assert.equal(result.stops[0].name, "Wawel");
});

test("opowieść trafia do historii – „chcę” odnosi się do pytania NOMI (regresja)", async () => {
  const { narrate, chat, ctx } = await load();
  const { attractionById } = await import("../server/data/attractions.js");
  const { loadOfficial } = await import("../server/services/official.js");
  await loadOfficial();
  const signal = new AbortController().signal;
  requests.length = 0;
  replies = [
    (b, res) => stream(res, [chunk({ content: "Przed tobą Ogród Botaniczny UJ, założony w 1783 roku. Chcesz, żebym sprawdził godziny otwarcia?" }, "stop")]),
    (b, res) => stream(res, [chunk({ content: "Już sprawdzam godziny." }, "stop")]),
  ];
  await narrate({ attraction: attractionById.get("ogrod-botaniczny"), ctx, emit: () => {}, signal, sessionId: "s-narr" });
  await chat({ sessionId: "s-narr", text: "chcę", ctx, emit: () => {}, signal });

  const msgs = requests[1].body.messages; // system, zdarzenie, opowieść, „chcę”
  assert.equal(msgs.length, 4);
  assert.match(msgs[1].content, /<zdarzenie_aplikacji>.*Ogród Botaniczny UJ \[ogrod-botaniczny\]/s);
  assert.match(msgs[1].content, /Oficjalne dane: godziny: Ogród: październik codziennie 9:00–17:00/, "oficjalne godziny w historii");
  assert.match(msgs[1].content, /normalny 22 zł/);
  assert.match(msgs[1].content, /ogrod.uj.edu.pl/, "źródło w historii");
  assert.equal(msgs[2].role, "assistant");
  assert.match(msgs[2].content, /godziny otwarcia\?$/);
  assert.match(msgs[3].content, /chcę$/);
});

test("opowieść zakończona w trakcie odpowiedzi czatu jest dopisywana po niej (historia tylko dopisywana)", async () => {
  const { narrate, chat, ctx } = await load();
  const { attractionById } = await import("../server/data/attractions.js");
  const signal = new AbortController().signal;
  requests.length = 0;
  replies = [
    (b, res) => setTimeout(() => stream(res, [chunk({ content: "Odpowiedź na pytanie 1." }, "stop")]), 150),
    (b, res) => stream(res, [chunk({ content: "Po prawej Barbakan." }, "stop")]),
    (b, res) => stream(res, [chunk({ content: "Odpowiedź 2." }, "stop")]),
  ];
  const first = chat({ sessionId: "s-race", text: "pytanie 1", ctx, emit: () => {}, signal });
  await new Promise((r) => setTimeout(r, 30));
  await narrate({ attraction: attractionById.get("barbakan"), ctx, emit: () => {}, signal, sessionId: "s-race" });
  await first;
  await chat({ sessionId: "s-race", text: "pytanie 2", ctx, emit: () => {}, signal });

  const msgs = requests[2].body.messages.slice(1); // bez promptu systemowego
  const expected = [
    ["user", /pytanie 1$/],
    ["assistant", /^Odpowiedź na pytanie 1\.$/],
    ["user", /^<zdarzenie_aplikacji>.*Barbakan/s],
    ["assistant", /^Po prawej Barbakan\.$/],
    ["user", /pytanie 2$/],
  ];
  assert.equal(msgs.length, expected.length);
  expected.forEach(([role, re], i) => {
    assert.equal(msgs[i].role, role, `wiadomość ${i}`);
    assert.match(msgs[i].content, re, `wiadomość ${i}`);
  });
});
