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
  // Migawka miejsc z OSM (apteki, bankomaty) – wyszukiwanie bez sieci.
  fs.mkdirSync(path.join(dataDir, "osm"));
  fs.writeFileSync(
    path.join(dataDir, "osm", "services.json"),
    JSON.stringify({
      fetchedAt: Date.now(),
      places: {
        pharmacy: [
          { id: "node/1", name: "Apteka Pod Złotym Tygrysem", type: "pharmacy", lat: 50.0612, lon: 19.9380 },
          { id: "node/2", name: "Apteka Daleka", type: "pharmacy", lat: 50.09, lon: 19.99 },
        ],
        toilets: [],
        money: [
          { id: "node/3", name: "Bankomat PKO", kind: "bankomat", type: "money", lat: 50.0615, lon: 19.9370 },
          { id: "node/4", name: "Kantor", kind: "kantor", type: "money", lat: 50.0616, lon: 19.9371 },
        ],
        ticket_machine: [],
        tourist_info: [],
      },
    }),
  );
  // Mała baza wiedzy (bez wektorów – samo BM25, więc bez wywołań /embeddings).
  fs.mkdirSync(path.join(dataDir, "rag"));
  const kb = [
    ["https://muzeumkrakowa.pl/oddzialy/barbakan", "Barbakan", "Muzeum Krakowa", "Barbakan – wstęp: bilet normalny kosztuje 22 zł, ulgowy 16 zł. Czynne od wtorku do niedzieli."],
    ["https://krakow.travel/17793-krakow-kopiec-kosciuszki", "Kopiec Kościuszki", "krakow.travel – oficjalny portal turystyczny Krakowa", "Kopiec usypano w latach 1820–1823 na wzgórzu Sikornik ku czci Tadeusza Kościuszki."],
    ["https://krakow.travel/6-krakow-smocza-jama", "Smocza Jama", "krakow.travel – oficjalny portal turystyczny Krakowa", "Według legendy w jaskini pod Wawelem mieszkał smok, którego pokonał szewczyk Skuba podstępem z baranem wypchanym siarką."],
  ].map(([url, title, source, text], i) => ({ id: `t-${i}`, url, title, source, text, fetched: "2026-10-04", hash: `h${i}` }));
  fs.writeFileSync(path.join(dataDir, "rag", "chunks.json"), JSON.stringify(kb));
  fs.writeFileSync(path.join(dataDir, "rag", "meta.json"), JSON.stringify({ model: null, dim: 0, docs: 3, count: 3, builtAt: new Date().toISOString() }));
  Object.assign(process.env, {
    NOMI_SKIP_DOTENV: "1",
    NOMI_VERIFY: "off", // włączane w testach weryfikacji
    OVERPASS_URL: "http://127.0.0.1:9/", // bez sieci: rozgrzewanie miejsc od razu dostaje odmowę połączenia
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
  // Gotowa odpowiedź (zdarzenie "answer"); tekst modelu nie jest przesyłany w trakcie pisania.
  const text = () => events.findLast((e) => e.type === "answer")?.data.text ?? "";
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

test("baza wiedzy: fragmenty dołączone do pytania, cytat [K…] → źródło dla aplikacji, podpowiedzi", async () => {
  const { chat, ctx } = await load();
  requests.length = 0;
  replies = [(b, res) => stream(res, [chunk({ content: "Bilet normalny do Barbakanu kosztuje 22 zł [K1]. Poprowadzić cię tam?" }, "stop")])];
  const c = collector();
  await chat({ sessionId: "s-kb", text: "Ile kosztuje wstęp do Barbakanu?", ctx, emit: c.emit, signal: new AbortController().signal });

  const user = requests[0].body.messages.at(-1).content;
  assert.match(user, /<wiedza_z_oficjalnych_zrodel>[\s\S]*\[K1\] Barbakan — Muzeum Krakowa \(pobrano 2026-10-04\)[\s\S]*22 zł/);
  assert.match(user, /Ile kosztuje wstęp do Barbakanu\?$/, "pytanie na końcu wiadomości");
  assert.ok(!/Smocza Jama/.test(user), "nietrafne fragmenty pominięte");
  assert.ok(requests[0].body.tools.some((t) => t.function.name === "search_knowledge"));

  const sources = c.events.find((e) => e.type === "action" && e.data.type === "sources")?.data.sources;
  assert.deepEqual(sources?.map((s) => [s.label, s.url]), [["K1", "https://muzeumkrakowa.pl/oddzialy/barbakan"]]);
  const sugg = c.events.find((e) => e.type === "suggestions")?.data.items;
  assert.deepEqual(sugg?.slice(0, 2), ["Tak", "Nie, dzięki"]);
});

test("baza wiedzy: narzędzie search_knowledge kontynuuje numerację etykiet w sesji", async () => {
  const { chat, ctx } = await load();
  requests.length = 0;
  replies = [
    (b, res) =>
      stream(res, [
        chunk({ tool_calls: [{ index: 0, id: "call_kb", type: "function", function: { name: "search_knowledge", arguments: '{"query": "Smocza Jama legenda smok"}' } }] }, "tool_calls"),
      ]),
    // Odpowiedź cytuje etykietę nadaną przez narzędzie (po etykietach automatycznie dołączonej wiedzy).
    (b, res) => stream(res, [chunk({ content: `Smoka pokonał szewczyk Skuba [${JSON.parse(b.messages.at(-1).content).results[0].label}].` }, "stop")]),
  ];
  const c = collector();
  await chat({ sessionId: "s-kb", text: "A co z tym smokiem?", ctx, emit: c.emit, signal: new AbortController().signal });

  const tool = JSON.parse(requests[1].body.messages.at(-1).content);
  const auto = requests[0].body.messages.at(-1).content.match(/^\[K\d+\]/gm) || [];
  assert.equal(tool.results[0].label, `K${2 + auto.length}`, "numeracja kontynuowana po K1 z poprzedniej tury");
  assert.equal(tool.results[0].title, "Smocza Jama");
  const sources = c.events.find((e) => e.type === "action" && e.data.type === "sources")?.data.sources;
  assert.deepEqual(sources?.map((s) => s.title), ["Smocza Jama"]);
});

// ------------------------------------------------------------------ sprawdzanie odpowiedzi w źródłach

const jsonReply = (obj) => (b, res) =>
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }));

async function withVerify(fn) {
  process.env.NOMI_VERIFY = "on";
  try {
    await fn();
  } finally {
    process.env.NOMI_VERIFY = "off";
  }
}

test("weryfikacja: niepoparte twierdzenia poprawione w dowodach, poprawiona wersja w historii i w źródłach", () =>
  withVerify(async () => {
    const { chat, ctx } = await load();
    requests.length = 0;
    const corrected = "Bilet normalny do Barbakanu kosztuje 22 zł [K1].";
    replies = [
      (b, res) => stream(res, [chunk({ content: "Bilet do Barbakanu kosztuje 35 zł [K1], a otwarte jest codziennie do 22:00. 🎟️" }, "stop")]),
      jsonReply({ verdict: "corrected", unsupported: ["35 zł", "codziennie do 22:00"], answer: corrected, sources: ["K1"] }),
    ];
    const c = collector();
    await chat({ sessionId: "s-verify", text: "Ile kosztuje wstęp do Barbakanu?", ctx, emit: c.emit, signal: new AbortController().signal });

    assert.equal(requests.length, 2);
    const v = requests[1].body;
    assert.equal(v.response_format.json_schema.name, "verify");
    const prompt = v.messages.at(-1).content;
    assert.match(prompt, /DOWODY:[\s\S]*\[K1\] Barbakan[\s\S]*22 zł/, "fragment oficjalnej strony jako dowód");
    assert.match(prompt, /ODPOWIEDŹ DO SPRAWDZENIA:\n.*35 zł/);
    assert.doesNotMatch(prompt, /🎟/, "emoji usunięte przed sprawdzeniem");

    const types = c.events.map((e) => e.type);
    assert.ok(types.indexOf("verifying") < types.indexOf("answer"));
    assert.ok(!types.includes("text"), "szkic nie trafia do aplikacji – najpierw sprawdzenie, potem odpowiedź");
    assert.ok(types.indexOf("action") < types.indexOf("answer"), "źródła przed odpowiedzią");
    const verified = c.events.find((e) => e.type === "answer").data;
    assert.equal(verified.status, "corrected");
    assert.equal(verified.text, corrected);
    const sources = c.events.find((e) => e.type === "action" && e.data.type === "sources")?.data.sources;
    assert.deepEqual(sources?.map((s) => s.url), ["https://muzeumkrakowa.pl/oddzialy/barbakan"]);

    // Kolejna tura: w historii jest poprawiona odpowiedź, nie szkic.
    replies = [(b, res) => stream(res, [chunk({ content: "Spoko!" }, "stop")])];
    await chat({ sessionId: "s-verify", text: "dzięki", ctx, emit: () => {}, signal: new AbortController().signal });
    const hist = requests.at(-1).body.messages.filter((m) => m.role === "assistant");
    assert.equal(hist.at(-1).content, corrected);
    assert.equal(requests.length, 3, "krótka odpowiedź bez faktów nie jest sprawdzana");
  }));

test("weryfikacja: awaria weryfikatora → odpowiedź oznaczona jako niesprawdzona (bez blokowania rozmowy)", () =>
  withVerify(async () => {
    const { chat, ctx } = await load();
    requests.length = 0;
    replies = [(b, res) => stream(res, [chunk({ content: "Kopiec Kościuszki usypano w latach 1820–1823 na wzgórzu Sikornik [K1]." }, "stop")])];
    const c = collector();
    await chat({ sessionId: "s-verify-fail", text: "Kiedy usypano Kopiec Kościuszki?", ctx, emit: c.emit, signal: new AbortController().signal });
    assert.equal(c.events.find((e) => e.type === "answer").data.status, "unverified");
    assert.match(c.text(), /1820–1823/);
  }));

test("weryfikacja opowieści: fakty atrakcji jako dowody, źródła – oficjalne strony", () =>
  withVerify(async () => {
    const { narrate, ctx } = await load();
    const { attractionById } = await import("../server/data/attractions.js");
    const { loadOfficial } = await import("../server/services/official.js");
    await loadOfficial();
    requests.length = 0;
    const story = "Przed tobą Ogród Botaniczny UJ – najstarszy w Polsce, założony w 1783 roku. Zajrzysz?";
    replies = [(b, res) => stream(res, [chunk({ content: story }, "stop")]), jsonReply({ verdict: "ok", unsupported: [], answer: story })];
    const c = collector();
    await narrate({ attraction: attractionById.get("ogrod-botaniczny"), ctx, emit: c.emit, signal: new AbortController().signal, sessionId: "s-story", onRoute: true });
    assert.match(requests[0].body.messages.at(-1).content, /NIE zadawaj pytania na końcu/, "ciekawostka po drodze – bez pytania");
    assert.match(requests[1].body.messages.at(-1).content, /Założony w 1783 roku/);
    assert.equal(c.events.find((e) => e.type === "answer").data.status, "ok");
    const sources = c.events.find((e) => e.type === "action" && e.data.type === "sources").data.sources;
    assert.ok(sources.some((s) => s.url.startsWith("https://ogrod.uj.edu.pl")));
  }));

test("weryfikacja: źródła z dowodów wskazanych przez weryfikator, gdy model nie zacytował etykiet", () =>
  withVerify(async () => {
    const { chat, ctx } = await load();
    requests.length = 0;
    const answer = "Kopiec usypano w latach 1820–1823 na wzgórzu Sikornik, ku czci Tadeusza Kościuszki.";
    replies = [
      (b, res) => stream(res, [chunk({ content: answer }, "stop")]),
      (b, res) => {
        // Etykieta fragmentu o Kopcu w bloku wiedzy tej tury.
        const label = (b.messages.at(-1).content.match(/\[(K\d+)\] Kopiec Kościuszki/) || [])[1];
        jsonReply({ verdict: "ok", unsupported: [], answer, sources: [label] })(b, res);
      },
    ];
    const c = collector();
    await chat({ sessionId: "s-support", text: "Kiedy usypano Kopiec Kościuszki na Sikorniku?", ctx, emit: c.emit, signal: new AbortController().signal });
    const sources = c.events.find((e) => e.type === "action" && e.data.type === "sources")?.data.sources;
    assert.deepEqual(sources?.map((s) => s.url), ["https://krakow.travel/17793-krakow-kopiec-kosciuszki"]);
  }));

test("odpowiedź bez dziur: tekst przed narzędziem („Już sprawdzam…”) nie trafia do gotowej odpowiedzi", async () => {
  const { chat, ctx } = await load();
  requests.length = 0;
  replies = [
    (b, res) =>
      stream(res, [
        chunk({ content: "Już sprawdzam bilety…" }),
        chunk({ tool_calls: [{ index: 0, id: "call_t", type: "function", function: { name: "get_ticket_info", arguments: '{"ride_minutes": 15}' } }] }, "tool_calls"),
      ]),
    (b, res) => stream(res, [chunk({ content: "Na 15 minut wystarczy bilet 20-minutowy za 4 zł." }, "stop")]),
  ];
  const c = collector();
  await chat({ sessionId: "s-holes", text: "Jaki bilet na 15 minut?", ctx, emit: c.emit, signal: new AbortController().signal });
  assert.equal(c.text(), "Na 15 minut wystarczy bilet 20-minutowy za 4 zł.");
  assert.equal(c.events.filter((e) => e.type === "answer").length, 1, "dokładnie jedna odpowiedź");
  assert.equal(c.events[0].type, "status", "aplikacja od razu dostaje stan „myślę”");
});

test("„Co jest przede mną?” – oficjalne informacje o atrakcji w polu widzenia dołączone do pytania", async () => {
  const { chat } = await load();
  const { sanitizeContext } = await import("../server/agent/context.js");
  const { attractionById } = await import("../server/data/attractions.js");
  const { loadOfficial } = await import("../server/services/official.js");
  await loadOfficial();
  const g = attractionById.get("ogrod-botaniczny");
  const ctx = sanitizeContext({ lang: "pl", lat: g.lat, lon: g.lon, heading: 0 });
  requests.length = 0;
  replies = [(b, res) => stream(res, [chunk({ content: "Przed tobą Ogród Botaniczny UJ – najstarszy w Polsce [K1]." }, "stop")])];
  const c = collector();
  await chat({ sessionId: "s-view", text: "Co jest przede mną?", ctx, emit: c.emit, signal: new AbortController().signal });
  assert.match(requests[0].body.messages.at(-1).content, /Ogród Botaniczny UJ – oficjalne informacje[\s\S]*Najstarszy ogród botaniczny w Polsce/);
  const sources = c.events.find((e) => e.type === "action" && e.data.type === "sources")?.data.sources;
  assert.ok(sources?.some((s) => s.url.startsWith("https://ogrod.uj.edu.pl")));
});


test("miejsca z migawki OSM na dysku – bez zapytań do Overpass, bankomaty wydzielone z grupy money", async () => {
  const { startPlacesService, findPlaces, placesStatus } = await import("../server/services/places.js");
  await startPlacesService();
  const ph = await findPlaces({ type: "pharmacy", lat: 50.0617, lon: 19.9373, radius: 600 });
  assert.deepEqual(ph.map((p) => p.name), ["Apteka Pod Złotym Tygrysem"], "daleka apteka poza promieniem");
  assert.ok(ph[0].distance > 0 && ph[0].distance < 100);
  const atm = await findPlaces({ type: "atm", lat: 50.0617, lon: 19.9373, radius: 600 });
  assert.deepEqual(atm.map((p) => p.name), ["Bankomat PKO"]);
  assert.equal(atm[0].type, "atm");
  assert.equal(placesStatus().snapshots.services.places, 4);
});
