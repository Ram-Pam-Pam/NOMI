// Sprawdza konfigurację serwera AI zgodnego z OpenAI (np. Sherlock CloudFerro):
// dostępne modele, wywoływanie narzędzi, streaming i JSON. Użycie: npm run check:llm [-- --all]
import { config } from "../server/config.js";

const { baseUrl, apiKey, chatModel, narrateModel, planModel } = config.compat;
const testAll = process.argv.includes("--all");
const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
const ok = (s) => `\x1b[32m✔ ${s}\x1b[0m`;
const bad = (s) => `\x1b[31m✘ ${s}\x1b[0m`;
const warn = (s) => `\x1b[33m! ${s}\x1b[0m`;

if (!apiKey) {
  console.error(bad("Brak LLM_API_KEY w pliku .env (klucz z panelu Sherlock: sherlock.cloudferro.com)."));
  process.exit(1);
}
console.log(`Serwer: ${baseUrl}\n`);

async function chat(body) {
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) return { error: `HTTP ${res.status}: ${text.slice(0, 200)}`, ms: Date.now() - t0 };
  return { data: JSON.parse(text), ms: Date.now() - t0 };
}

// 1) Lista modeli
let available = [];
try {
  const res = await fetch(`${baseUrl}/models`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  available = (await res.json()).data.map((m) => m.id);
  console.log(`Dostępne modele (${available.length}):\n  ${available.join("\n  ")}\n`);
} catch (err) {
  console.error(bad(`Nie udało się pobrać listy modeli: ${err.message}`));
  process.exit(1);
}
for (const [role, m] of [["rozmowa (NOMI_CHAT_MODEL)", chatModel], ["opowieści (NOMI_NARRATE_MODEL)", narrateModel], ["planer (NOMI_PLAN_MODEL)", planModel]]) {
  console.log(available.includes(m) ? ok(`${role}: ${m}`) : bad(`${role}: ${m} – brak na liście modeli`));
}

// 2) Wywoływanie narzędzi
const tool = {
  type: "function",
  function: {
    name: "get_departures",
    description: "Najbliższe odjazdy tramwajów z przystanku.",
    parameters: { type: "object", properties: { stop_name: { type: "string" } }, required: ["stop_name"], additionalProperties: false },
  },
};
const toolTargets = testAll
  ? available.filter((m) => !/e5|bge|stella|embed/i.test(m))
  : [...new Set([chatModel, narrateModel])];
console.log("\nWywoływanie narzędzi (function calling):");
for (const model of toolTargets) {
  const r = await chat({
    model,
    messages: [{ role: "user", content: "Kiedy odjeżdża najbliższy tramwaj z przystanku Rondo Mogilskie? Użyj narzędzia." }],
    tools: [tool],
    tool_choice: "auto",
    max_tokens: 1024,
  });
  if (r.error) {
    console.log(bad(`${model}: ${r.error}`));
    continue;
  }
  const msg = r.data.choices?.[0]?.message || {};
  const call = msg.tool_calls?.[0];
  if (call) console.log(ok(`${model}: natywne wywołanie ${call.function.name}(${call.function.arguments}) – ${r.ms} ms`));
  else if (/<tool_call>/.test(msg.content || "")) console.log(warn(`${model}: wywołanie zapisane tekstem <tool_call> (NOMI to obsłuży) – ${r.ms} ms`));
  else console.log(bad(`${model}: brak wywołania narzędzia – odpowiedź: "${(msg.content || "").slice(0, 100)}"`));
}

// 3) Streaming i czas do pierwszego tokenu (model opowieści)
console.log("\nStreaming (opowieści):");
{
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: narrateModel,
      stream: true,
      max_tokens: 200,
      messages: [{ role: "user", content: "W dwóch zdaniach opowiedz turyście o Barbakanie w Krakowie." }],
    }),
  });
  if (!res.ok) console.log(bad(`${narrateModel}: HTTP ${res.status}`));
  else {
    let first = null;
    let text = "";
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      for (const line of decoder.decode(chunk, { stream: true }).split("\n")) {
        if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
        try {
          const d = JSON.parse(line.slice(5)).choices?.[0]?.delta?.content;
          if (d) {
            first ??= Date.now() - t0;
            text += d;
          }
        } catch {
          /* niepełna linia */
        }
      }
    }
    console.log(ok(`${narrateModel}: pierwszy token po ${first} ms, całość ${Date.now() - t0} ms`));
    console.log(`  „${text.trim().slice(0, 240)}”`);
  }
}

// 4) JSON ze schematem (planer)
console.log("\nJSON ze schematem (planer):");
{
  const schema = { type: "object", properties: { stops: { type: "array", items: { type: "string" } } }, required: ["stops"], additionalProperties: false };
  const r = await chat({
    model: planModel,
    messages: [{ role: "user", content: "Podaj 3 atrakcje Krakowa jako JSON {\"stops\": [...]}." }],
    response_format: { type: "json_schema", json_schema: { name: "t", schema, strict: true } },
    max_tokens: 2000,
  });
  if (r.error) console.log(warn(`${planModel}: response_format nieobsługiwany (${r.error}) – NOMI użyje zwykłego JSON-a`));
  else {
    try {
      JSON.parse(r.data.choices[0].message.content);
      console.log(ok(`${planModel}: poprawny JSON – ${r.ms} ms`));
    } catch {
      console.log(warn(`${planModel}: odpowiedź nie jest czystym JSON-em – NOMI spróbuje go wyłuskać`));
    }
  }
}
