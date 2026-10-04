// Backend Claude (Anthropic SDK): pętla narzędzi ze streamingiem, narracje, planer (structured outputs).
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { buildContextBlock } from "./context.js";
import { AgentError } from "./errors.js";
import { NARRATOR_SYSTEM, NOMI_SYSTEM, PLANNER_SYSTEM } from "./prompts.js";
import { TOOLS, TOOL_LABELS, runTool } from "./tools.js";

const MAX_TOOL_ROUNDS = 8;
let client = null;

function getClient() {
  if (!client) {
    try {
      client = new Anthropic({ maxRetries: 2 });
    } catch (err) {
      throw new AgentError(`Brak konfiguracji Claude API: ${err.message}`, 503);
    }
  }
  return client;
}

export const keyConfigured = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);

export const models = () => ({ chat: config.model, narrate: config.model, plan: config.model });

/** Wspólne parametry żądań: model, wysiłek, fallback serwerowy przy odmowie klasyfikatora. */
function baseParams(effort) {
  const params = { model: config.model, output_config: { effort } };
  if (config.fallbacks) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return params;
}

/** Komunikat dla błędów SDK Anthropic; null, gdy błąd nie pochodzi z SDK. */
export function describeError(err, lang = "pl") {
  const pl = lang !== "en";
  if (err instanceof Anthropic.APIUserAbortError) return pl ? "Przerwano." : "Cancelled.";
  if (err instanceof Anthropic.AuthenticationError)
    return pl ? "Nieprawidłowy klucz Claude API – sprawdź ANTHROPIC_API_KEY w pliku .env." : "Invalid Claude API key – check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError)
    return pl ? "Za dużo zapytań do AI – spróbuj za chwilę." : "Too many AI requests – try again shortly.";
  if (err instanceof Anthropic.APIConnectionError) return pl ? "Brak połączenia z serwerem AI." : "Cannot reach the AI service.";
  if (err instanceof Anthropic.APIError) return `${pl ? "Błąd AI" : "AI error"} (${err.status ?? "?"}): ${err.message}`;
  if (/api key|apiKey|credentials|authentication/i.test(String(err?.message)))
    return pl
      ? "Claude API nie jest skonfigurowane – ustaw ANTHROPIC_API_KEY w pliku .env i uruchom serwer ponownie."
      : "Claude API is not configured – set ANTHROPIC_API_KEY in .env and restart.";
  return null;
}

/**
 * Jedna tura streamingu. Przy eager_input_streaming SDK może odrzucić finalMessage(),
 * gdy wejście narzędzia nie jest poprawnym JSON-em – wtedy ponawiamy turę (maks. 2 razy).
 */
async function streamTurn(params, emit, signal) {
  for (let attempt = 0; ; attempt++) {
    const stream = getClient().beta.messages.stream(params, { signal });
    stream.on("text", (delta) => emit("text", { delta }));
    try {
      return await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIError || signal?.aborted || attempt >= 2) throw err;
      console.warn("[nomi] Niepoprawne wejście narzędzia – ponawiam turę:", err.message);
      emit("retry", {});
    }
  }
}

/** Zwraca nowe wiadomości tury (do dopisania do historii) albo null, gdy tura została odrzucona. */
export async function runChat({ history, text, ctx, emit, signal }) {
  const messages = [
    ...history,
    {
      role: "user",
      content: [
        { type: "text", text: buildContextBlock(ctx) },
        { type: "text", text },
      ],
    },
  ];
  const added = () => messages.slice(history.length);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const message = await streamTurn(
      {
        ...baseParams(config.chatEffort),
        max_tokens: 64000,
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: NOMI_SYSTEM }],
        tools: TOOLS,
        messages,
      },
      emit,
      signal,
    );

    if (message.stop_reason === "refusal") {
      emit("text", {
        delta:
          ctx.lang === "en"
            ? "\n\nSorry, I can't help with that. Ask me about Kraków, routes or places to eat."
            : "\n\nPrzepraszam, w tym nie mogę pomóc. Zapytaj mnie o Kraków, trasę albo miejsce na obiad.",
      });
      return null; // tura odrzucona – nie trafia do historii
    }

    messages.push({ role: "assistant", content: message.content });
    if (message.stop_reason === "pause_turn") continue;

    const toolUses = message.content.filter((b) => b.type === "tool_use");
    if (message.stop_reason === "max_tokens" && toolUses.length) {
      throw new AgentError("Odpowiedź została ucięta – spróbuj zadać pytanie prościej.");
    }
    if (!toolUses.length || message.stop_reason !== "tool_use") return added();

    const results = await Promise.all(
      toolUses.map(async (tu) => {
        emit("tool", { id: tu.id, name: tu.name, label: TOOL_LABELS[tu.name]?.[ctx.lang] || tu.name });
        const r = await runTool(tu.name, tu.input, { ctx, emit });
        emit("tool_done", { id: tu.id, name: tu.name, ok: !r.isError });
        return { type: "tool_result", tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
      }),
    );
    messages.push({ role: "user", content: results });
    emit("text_break", {});
  }
  return added();
}

export async function runNarration({ prompt, emit, signal }) {
  const stream = getClient().beta.messages.stream(
    {
      ...baseParams("low"),
      max_tokens: 16000,
      system: [{ type: "text", text: NARRATOR_SYSTEM }],
      messages: [{ role: "user", content: prompt }],
    },
    { signal },
  );
  stream.on("text", (delta) => emit("text", { delta }));
  const msg = await stream.finalMessage();
  return { refused: msg.stop_reason === "refusal" };
}

/** Odpowiedź w formacie JSON zgodnym ze schematem (planer, ekstrakcja danych z oficjalnych stron). */
export async function runJson({ system = PLANNER_SYSTEM, request, schema, signal }) {
  const base = baseParams(config.planEffort);
  const stream = getClient().beta.messages.stream(
    {
      ...base,
      max_tokens: 64000,
      system: [{ type: "text", text: system }],
      output_config: { ...base.output_config, format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: request }],
    },
    { signal },
  );
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new AgentError("Model odmówił odpowiedzi.");
  const textBlock = msg.content.find((b) => b.type === "text");
  if (!textBlock) throw new AgentError("Model nie zwrócił danych.");
  return JSON.parse(textBlock.text);
}
