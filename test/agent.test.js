// Test pętli agenta na atrapie Claude API (bez sieci i bez klucza).
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

const requests = [];
let server;

function sse(res, events) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
}

function messageEvents(content, stopReason) {
  const events = [
    {
      type: "message_start",
      message: { id: `msg_${requests.length}`, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
    },
  ];
  content.forEach((block, index) => {
    if (block.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    } else {
      events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
  events.push({ type: "message_stop" });
  return events;
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      requests.push({ headers: req.headers, body: parsed });
      const last = parsed.messages[parsed.messages.length - 1];
      const hasToolResult = Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
      if (!hasToolResult) {
        sse(res, messageEvents([{ type: "text", text: "Sprawdzam cennik." }, { type: "tool_use", id: "toolu_1", name: "get_ticket_info", input: { ride_minutes: 20 } }], "tool_use"));
      } else {
        sse(res, messageEvents([{ type: "text", text: "Kup bilet 30-minutowy za 6 zł zaraz po wejściu." }], "end_turn"));
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.NOMI_SKIP_DOTENV = "1";
  process.env.NOMI_VERIFY = "off"; // sprawdzanie odpowiedzi testowane osobno (compat.test.js)
  process.env.OVERPASS_URL = "http://127.0.0.1:9/"; // bez sieci w testach
  process.env.LLM_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("agent: narzędzie → wynik → odpowiedź, historia tylko dopisywana", async () => {
  const { chat } = await import("../server/agent/nomi.js");
  const { sanitizeContext } = await import("../server/agent/context.js");
  const events = [];
  const emit = (type, data) => events.push({ type, data });
  const ctx = sanitizeContext({ lang: "pl", lat: 50.0617, lon: 19.9373, heading: 90, accuracy: 8 });

  await chat({ sessionId: "t1", text: "Jaki bilet kupić?", ctx, emit, signal: new AbortController().signal });

  // Dwa wywołania API: z narzędziem i po wyniku narzędzia.
  assert.equal(requests.length, 2);
  const [first, second] = requests;
  assert.equal(first.body.model, "claude-opus-5-5");
  assert.equal(first.body.fallbacks, "default");
  assert.match(first.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(first.body.output_config.effort, "low");
  assert.deepEqual(first.body.cache_control, { type: "ephemeral" });
  assert.ok(first.body.tools.every((t) => t.eager_input_streaming === true));
  assert.match(first.body.messages[0].content[0].text, /<kontekst_aplikacji>/);
  assert.match(first.body.messages[0].content[0].text, /Kierunek patrzenia: 90°/);

  const toolResult = second.body.messages.at(-1).content[0];
  assert.equal(toolResult.type, "tool_result");
  assert.equal(toolResult.tool_use_id, "toolu_1");
  const result = JSON.parse(toolResult.content);
  assert.equal(result.recommendation.price, 6);

  // Tekst modelu nie idzie do aplikacji w trakcie – przychodzi jedna gotowa odpowiedź.
  assert.ok(!events.some((e) => e.type === "text"));
  const text = events.find((e) => e.type === "answer")?.data.text || "";
  assert.match(text, /30-minutowy/);
  assert.ok(events.some((e) => e.type === "tool" && e.data.name === "get_ticket_info"));
  assert.ok(events.some((e) => e.type === "tool_done" && e.data.ok));

  // Druga tura w tej samej sesji zaczyna się od pełnej, niezmienionej historii.
  requests.length = 0;
  await chat({ sessionId: "t1", text: "Dzięki!", ctx, emit, signal: new AbortController().signal });
  const history = requests[0].body.messages;
  assert.equal(history.length, 5); // user, assistant(tool_use), user(tool_result), assistant, user
  assert.equal(history[1].content[1].type, "tool_use");
});
