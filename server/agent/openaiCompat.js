// Backend dla serwerów zgodnych z API OpenAI (Chat Completions): Sherlock CloudFerro, vLLM, Ollama itp.
// Bez dodatkowych zależności – czyste fetch + Server-Sent Events.
import { config } from "../config.js";
import { buildContextBlock } from "./context.js";
import { AgentError } from "./errors.js";
import { NARRATOR_SYSTEM, NOMI_SYSTEM, PLANNER_SYSTEM } from "./prompts.js";
import { TOOLS, TOOL_LABELS, runTool } from "./tools.js";

const MAX_TOOL_ROUNDS = 8;
const HISTORY_TURNS = 8; // ile ostatnich wymian wysyłać – mniejsze modele (np. Bielik) mają okno 32K

const cfg = () => config.compat;
const isGptOss = (model) => /gpt-oss/i.test(model);

export const keyConfigured = () => Boolean(cfg().apiKey);
export const models = () => ({ chat: cfg().chatModel, narrate: cfg().narrateModel, plan: cfg().planModel });

export class ProviderError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}: ${String(body).slice(0, 300)}`);
    this.status = status;
    this.body = String(body);
  }
}

const OPENAI_TOOLS = TOOLS.map(({ name, description, input_schema }) => ({
  type: "function",
  function: { name, description, parameters: input_schema },
}));

// ------------------------------------------------------------------ HTTP

// Parametry opcjonalne: jeśli serwer odrzuci je błędem 400, ponawiamy bez nich i zapamiętujemy to dla modelu.
const OPTIONAL = {
  tools: /tool/i,
  reasoning_effort: /reasoning/i,
  response_format: /response_format|json_schema|guided|structured/i,
  temperature: /temperature/i,
};
const rejected = new Map(); // model -> Set(parametr)

async function post(body, signal) {
  if (!cfg().apiKey) throw new AgentError("Brak klucza API modelu AI – ustaw LLM_API_KEY w pliku .env.", 503);
  const res = await fetch(`${cfg().baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg().apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new ProviderError(res.status, await res.text().catch(() => ""));
  return res;
}

async function request(body, signal) {
  const skip = rejected.get(body.model) ?? new Set();
  rejected.set(body.model, skip);
  const payload = { ...body };
  const strip = (key) => {
    delete payload[key];
    if (key === "tools") delete payload.tool_choice;
  };
  for (const key of skip) strip(key);

  for (let attempt = 0; ; attempt++) {
    try {
      return await post(payload, signal);
    } catch (err) {
      if (!(err instanceof ProviderError) || err.status !== 400 || attempt >= 3) throw err;
      const present = Object.keys(OPTIONAL).filter((k) => k in payload);
      const culprit = present.find((k) => OPTIONAL[k].test(err.body));
      if (!culprit) throw err;
      console.warn(`[ai] Model ${body.model} nie obsługuje parametru "${culprit}" – ponawiam bez niego.`);
      skip.add(culprit);
      strip(culprit);
    }
  }
}

async function* sseEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch {
        /* niepełna linia – pomijamy */
      }
    }
  }
}

// ------------------------------------------------------------------ ukryte fragmenty tekstu

/**
 * Wycina z tekstu (także dzielonego na kawałki w streamingu) bloki <think>…</think>
 * oraz <tool_call>…</tool_call> – te drugie zachowuje do odczytania jako wywołania narzędzi.
 */
export class HiddenTagFilter {
  constructor(tags = ["think", "tool_call"]) {
    this.tags = tags;
    this.buffer = "";
    this.inside = null;
    this.captured = [];
  }

  push(chunk) {
    this.buffer += chunk;
    let out = "";
    for (;;) {
      if (this.inside) {
        const close = `</${this.inside}>`;
        const j = this.buffer.indexOf(close);
        if (j < 0) break;
        this.captured.push({ tag: this.inside, text: this.buffer.slice(0, j) });
        this.buffer = this.buffer.slice(j + close.length);
        this.inside = null;
        continue;
      }
      let first = null;
      for (const tag of this.tags) {
        const i = this.buffer.indexOf(`<${tag}>`);
        if (i >= 0 && (!first || i < first.i)) first = { i, tag };
      }
      if (first) {
        out += this.buffer.slice(0, first.i);
        this.buffer = this.buffer.slice(first.i + first.tag.length + 2);
        this.inside = first.tag;
        continue;
      }
      // Zatrzymaj możliwy początek znacznika na końcu bufora (np. "<thi").
      const lt = this.buffer.lastIndexOf("<");
      if (lt >= 0 && this.tags.some((t) => `<${t}>`.startsWith(this.buffer.slice(lt)))) {
        out += this.buffer.slice(0, lt);
        this.buffer = this.buffer.slice(lt);
      } else {
        out += this.buffer;
        this.buffer = "";
      }
      break;
    }
    return out;
  }

  flush() {
    let out = "";
    if (this.inside) this.captured.push({ tag: this.inside, text: this.buffer });
    else out = this.buffer;
    this.buffer = "";
    this.inside = null;
    return out;
  }
}

/** Wywołanie narzędzia zapisane tekstem: {"name": "...", "arguments": {...}} */
function parseTextToolCall(text) {
  try {
    const obj = JSON.parse(text.trim());
    if (!obj?.name) return null;
    const args = typeof obj.arguments === "string" ? obj.arguments : JSON.stringify(obj.arguments ?? obj.parameters ?? {});
    return { id: null, name: obj.name, arguments: args };
  } catch {
    return null;
  }
}

/** Czyta strumień odpowiedzi: emituje widoczny tekst, składa wywołania narzędzi. */
async function consumeStream(res, emit) {
  const filter = new HiddenTagFilter();
  let text = "";
  let calls = [];
  let finish = null;
  const show = (s) => {
    if (!s) return;
    text += s;
    emit?.("text", { delta: s });
  };
  for await (const chunk of sseEvents(res)) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const d = choice.delta || {};
    if (d.content) show(filter.push(d.content));
    for (const tc of d.tool_calls || []) {
      const i = tc.index ?? calls.length;
      calls[i] ??= { id: null, name: "", arguments: "" };
      if (tc.id) calls[i].id = tc.id;
      if (tc.function?.name) calls[i].name ||= tc.function.name;
      if (tc.function?.arguments) calls[i].arguments += tc.function.arguments;
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  show(filter.flush());
  // Modele bez natywnego parsera narzędzi bywają, że zapisują wywołanie tekstem.
  for (const c of filter.captured) {
    if (c.tag === "tool_call") {
      const parsed = parseTextToolCall(c.text);
      if (parsed) calls.push(parsed);
    }
  }
  calls = calls.filter((c) => c?.name).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));
  return { text: text.trim(), toolCalls: calls, finish };
}

function trimHistory(history) {
  const starts = [];
  history.forEach((m, i) => m.role === "user" && starts.push(i));
  return starts.length <= HISTORY_TURNS ? history : history.slice(starts[starts.length - HISTORY_TURNS]);
}

function withReasoning(model, effort) {
  return isGptOss(model) ? { reasoning_effort: effort } : {};
}

// ------------------------------------------------------------------ rozmowa

/** Zwraca nowe wiadomości tury (format OpenAI) do dopisania do historii sesji. */
export async function runChat({ history, text, ctx, emit, signal }) {
  const model = cfg().chatModel;
  const added = [{ role: "user", content: `${buildContextBlock(ctx)}\n\n${text}` }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await request(
      {
        model,
        messages: [{ role: "system", content: NOMI_SYSTEM }, ...trimHistory(history), ...added],
        tools: OPENAI_TOOLS,
        tool_choice: "auto",
        stream: true,
        max_tokens: 4096,
        ...withReasoning(model, cfg().reasoningEffort),
      },
      signal,
    );
    const { text: answer, toolCalls, finish } = await consumeStream(res, emit);

    if (!toolCalls.length) {
      added.push({ role: "assistant", content: answer });
      return added;
    }
    if (finish === "length") throw new AgentError("Odpowiedź została ucięta – spróbuj zadać pytanie prościej.");

    added.push({
      role: "assistant",
      content: answer,
      tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments || "{}" } })),
    });
    const results = await Promise.all(
      toolCalls.map(async (c) => {
        emit("tool", { id: c.id, name: c.name, label: TOOL_LABELS[c.name]?.[ctx.lang] || c.name });
        let r;
        try {
          r = await runTool(c.name, JSON.parse(c.arguments || "{}"), { ctx, emit });
        } catch {
          r = { isError: true, content: JSON.stringify({ INVALID_JSON: c.arguments }) };
        }
        emit("tool_done", { id: c.id, name: c.name, ok: !r.isError });
        return { role: "tool", tool_call_id: c.id, content: r.content };
      }),
    );
    added.push(...results);
    emit("text_break", {});
  }
  return added;
}

// ------------------------------------------------------------------ opowieści o atrakcjach

export async function runNarration({ prompt, emit, signal }) {
  const model = cfg().narrateModel;
  const res = await request(
    {
      model,
      messages: [
        { role: "system", content: NARRATOR_SYSTEM },
        { role: "user", content: prompt },
      ],
      stream: true,
      max_tokens: 800,
      temperature: 0.7,
      ...withReasoning(model, "low"),
    },
    signal,
  );
  const { text } = await consumeStream(res, emit);
  return { refused: !text };
}

// ------------------------------------------------------------------ planer

function parseJsonLoose(raw) {
  const filter = new HiddenTagFilter(["think"]);
  const text = (filter.push(raw) + filter.flush()).trim();
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{");
    const b = text.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new AgentError("Model zwrócił plan w niepoprawnym formacie.");
  }
}

export async function runPlan({ request: userText, schema, signal }) {
  const model = cfg().planModel;
  const res = await request(
    {
      model,
      messages: [
        { role: "system", content: `${PLANNER_SYSTEM}\n\nOdpowiedz wyłącznie obiektem JSON zgodnym z tym schematem:\n${JSON.stringify(schema)}` },
        { role: "user", content: userText },
      ],
      response_format: { type: "json_schema", json_schema: { name: "plan", schema, strict: true } },
      max_tokens: 8000,
      ...withReasoning(model, cfg().planReasoningEffort),
    },
    signal,
  );
  const data = await res.json();
  return parseJsonLoose(data.choices?.[0]?.message?.content || "");
}

// ------------------------------------------------------------------ błędy

export function describeError(err, lang = "pl") {
  const pl = lang !== "en";
  if (err?.name === "AbortError") return pl ? "Przerwano." : "Cancelled.";
  if (err instanceof ProviderError) {
    if (err.status === 401 || err.status === 403)
      return pl ? "Nieprawidłowy klucz API (LLM_API_KEY) albo brak dostępu do modelu." : "Invalid API key (LLM_API_KEY) or no access to the model.";
    if (err.status === 402) return pl ? "Brak środków na koncie dostawcy AI." : "No credits left at the AI provider.";
    if (err.status === 404) return pl ? "Model niedostępny – sprawdź nazwy modeli (npm run check:llm)." : "Model not available – run npm run check:llm.";
    if (err.status === 429) return pl ? "Za dużo zapytań do AI – spróbuj za chwilę." : "Too many AI requests – try again shortly.";
    if (err.status >= 500) return pl ? "Serwer AI jest chwilowo niedostępny." : "The AI server is temporarily unavailable.";
    return `${pl ? "Błąd AI" : "AI error"}: ${err.message}`;
  }
  if (err instanceof TypeError && /fetch/i.test(err.message)) return pl ? "Brak połączenia z serwerem AI." : "Cannot reach the AI server.";
  return null;
}
