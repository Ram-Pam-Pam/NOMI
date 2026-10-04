// Baza wiedzy (RAG): podział tekstu, BM25, RRF, kwantyzacja wektorów, cytowania, podpowiedzi, daty wydarzeń.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Citations, retrievalQuery, suggestionsFor } from "../server/agent/knowledge.js";
import { dequantize, quantize, rankChunks } from "../server/rag/index.js";
import { BM25, chunkText, rrf, tokenize } from "../server/rag/text.js";
import { parseEventDates } from "../server/services/events.js";

test("podział na fragmenty wzdłuż akapitów, bez cięcia zdań, z zakładką", () => {
  const para = (n) => `Akapit ${n}. ` + "Zdanie o Krakowie i jego zabytkach. ".repeat(8);
  const chunks = chunkText([para(1), para(2), para(3), para(4)].join("\n"), { size: 700, overlap: 400 });
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(c.length <= 700 * 1.6, `fragment za długi: ${c.length}`);
  // Zakładka: ostatni akapit fragmentu powtarza się na początku następnego.
  assert.ok(chunks[1].startsWith(chunks[0].split("\n").at(-1)));
  // Bardzo długi akapit tniemy po zdaniach.
  const long = chunkText("To jest zdanie testowe numer jeden. ".repeat(80), { size: 500 });
  assert.ok(long.length > 2 && long.every((c) => c.trim().endsWith(".")));
});

test("BM25: odmiana polska (stemming), stop-słowa, pokrycie zapytania", () => {
  assert.deepEqual(tokenize("Ile kosztuje bilet do Barbakanu?"), ["kosztu", "bilet", "barbak"]);
  const bm = new BM25([
    "Barbakan – bilet normalny 22 zł, wstęp kosztuje mniej z kartą.",
    "Kopiec Kościuszki to punkt widokowy na Salwatorze.",
    "Tramwaje kursują od 5 rano. Bilet 20-minutowy.",
  ]);
  const r = bm.search("Ile kosztuje bilet do Barbakanu?");
  assert.equal(r[0].i, 0);
  assert.equal(r[0].coverage, 1);
  assert.ok(r.find((x) => x.i === 2).coverage < 0.5);
  assert.deepEqual(bm.search("kurs euro"), []);
});

test("RRF łączy rankingi; ranking hybrydowy i samo BM25 bez wektora zapytania", () => {
  const fused = rrf([[1, 2, 3], [3, 1, 4]]);
  assert.equal(fused[0].i, 1);
  assert.ok(fused.some((x) => x.i === 4));

  const chunks = [{ text: "Wawel zamek" }, { text: "Smok wawelski legenda" }, { text: "Bilety MPK" }];
  const bm25 = new BM25(chunks.map((c) => c.text));
  const dim = 2;
  const vectors = Float32Array.from([1, 0, 0.8, 0.6, 0, 1]);
  const lex = rankChunks({ query: "smok", chunks, bm25, vectors, dim, qvec: null });
  assert.deepEqual(lex.map((x) => x.i), [1]);
  const dense = rankChunks({ query: "smok", chunks, bm25, vectors, dim, qvec: [1, 0], mode: "dense" });
  assert.equal(dense[0].i, 0);
  assert.equal(dense[0].similarity, 1);
  const hybrid = rankChunks({ query: "smok", chunks, bm25, vectors, dim, qvec: [0.8, 0.6] });
  assert.equal(hybrid[0].i, 1); // pierwszy w obu rankingach
});

test("kwantyzacja int8 zachowuje wektory (błąd < 1%)", () => {
  const dim = 64;
  const v = new Float32Array(3 * dim).map((_, i) => Math.sin(i * 1.7) / 8);
  const back = dequantize(quantize(v, dim), dim);
  for (let i = 0; i < v.length; i++) assert.ok(Math.abs(back[i] - v[i]) < 0.01 * 0.125 + 1e-6);
});

test("cytowania: etykiety unikalne w sesji, tylko faktycznie użyte źródła", () => {
  const session = {};
  const a = new Citations(session);
  const [k1, k2] = a.label([{ title: "Barbakan", url: "https://krakow.travel/1", source: "krakow.travel", fetched: "2026-10-04" }, { title: "Wawel", url: "https://wawel.krakow.pl", source: "wawel.krakow.pl" }]);
  assert.deepEqual([k1.label, k2.label], ["K1", "K2"]);
  assert.deepEqual(a.cited("Zbudowano go w XV wieku [K1]."), [a.turn[0]]);
  assert.equal(a.cited("Bez źródeł.").length, 0);
  assert.equal(a.cited("Oba [K1, K2] i [K2].").length, 2);
  const b = new Citations(session); // kolejna tura – numeracja trwa
  assert.equal(b.label([{ title: "X", url: "u" }])[0].label, "K3");
});

test("krótka odpowiedź („chcę”) łączona z ostatnią wypowiedzią NOMI w zapytaniu do bazy wiedzy", () => {
  const history = [
    { role: "user", content: "<zdarzenie_aplikacji>…</zdarzenie_aplikacji>" },
    { role: "assistant", content: "Przed tobą Barbakan. Opowiedzieć legendę?" },
  ];
  assert.match(retrievalQuery("chcę", history), /Barbakan[\s\S]*chcę$/);
  assert.equal(retrievalQuery("Jak dojechać tramwajem z Rynku do Kazimierza?", history), "Jak dojechać tramwajem z Rynku do Kazimierza?");
  // Historia w formacie Claude (lista bloków).
  const claude = [{ role: "assistant", content: [{ type: "text", text: "To Sukiennice." }] }];
  assert.match(retrievalQuery("a ile kosztuje?", claude), /Sukiennice/);
});

test("podpowiedzi: tak/nie po pytaniu, zależnie od narzędzi, bez powtórzeń", () => {
  const s = suggestionsFor({ tools: ["plan_route"], answer: "Jedź tramwajem 18. Pokazać odjazdy? [K2]", lang: "pl" });
  assert.deepEqual(s.slice(0, 2), ["Tak", "Nie, dzięki"]);
  assert.ok(s.includes("Jaki bilet kupić?"));
  assert.ok(suggestionsFor({ tools: [], answer: "Cześć!", lang: "en" }).includes("What's nearby?"));
  assert.ok(suggestionsFor({ tools: ["find_attractions", "find_attractions"], answer: "x", lang: "pl" }).length <= 4);
});

test("daty wydarzeń z kalendarza krakow.travel", () => {
  assert.deepEqual(parseEventDates("piątek, 16 października 2026, 19:30 - poniedziałek, 19 października 2026"), {
    start: "2026-10-16",
    end: "2026-10-19",
    time: "19:30",
  });
  assert.deepEqual(parseEventDates("sobota, 3 stycznia 2027, 9:00"), { start: "2027-01-03", end: "2027-01-03", time: "09:00" });
  assert.equal(parseEventDates("wkrótce"), null);
});

test("wskazówki tury: język wiadomości i wypowiedzi o sobie do zapamiętania", async () => {
  const { detectLang, preferenceHint, buildContextBlock, sanitizeContext } = await import("../server/agent/context.js");
  assert.equal(detectLang("What's the story behind Kopiec Krakusa?"), "en");
  assert.equal(detectLang("Wawel opening hours"), "en");
  assert.equal(detectLang("Gdzie można zjeść pierogi?"), "pl");
  assert.equal(detectLang("Gdzie zjem pierogi?"), null); // za mało sygnału – język interfejsu
  assert.equal(detectLang("ok"), null);
  assert.equal(preferenceHint("Jestem wegetarianinem, gdzie zjem?"), "diet");
  assert.equal(preferenceHint("I'm vegan"), "diet");
  assert.equal(preferenceHint("Zwiedzam z wózkiem dziecięcym"), "mobility");
  assert.equal(preferenceHint("Gdzie zjem tanio?"), null);

  const ctx = { ...sanitizeContext({ lang: "pl", prefs: { diet: "wegańska", bogus: "x" } }), replyLang: "en", prefHint: "mobility" };
  assert.deepEqual(ctx.prefs ?? {}, { diet: "wegańska" });
  const block = buildContextBlock(ctx);
  assert.match(block, /PO ANGIELSKU/);
  assert.match(block, /Zapamiętane preferencje użytkownika: dieta: wegańska/);
  assert.match(block, /poruszanie się\) – zapisz to narzędziem remember_preference/);
  // Preferencja już zapisana – bez ponownej podpowiedzi.
  assert.doesNotMatch(buildContextBlock({ ...ctx, prefHint: "diet" }), /remember_preference/);
});

test("sprzątanie odpowiedzi: znaczniki, wymyślone etykiety, emoji; które odpowiedzi sprawdzać", async () => {
  const { cleanAnswer, needsVerification } = await import("../server/agent/verify.js");
  const raw = "<think>hmm</think>Barbakan to perła [K2] 🏰 i ma 3 bramy [C2]. Wejście [K9].\n\n\n<tool_call>{}</tool_call>Koniec.";
  assert.equal(cleanAnswer(raw, { maxLabel: 5 }), "Barbakan to perła [K2] i ma 3 bramy. Wejście.\n\nKoniec.");
  assert.equal(needsVerification("Jasne, już szukam!"), false);
  assert.equal(needsVerification("Bilet kosztuje 22 zł."), true);
  assert.equal(needsVerification("Barbakan to jedna z najlepiej zachowanych budowli obronnych w Europie."), true);
});

test("źródła narzędzi na liście tylko, gdy odpowiedź mówi o danym obiekcie", async () => {
  const { Citations } = await import("../server/agent/knowledge.js");
  const c = new Citations({});
  c.use({ title: "Barbakan", url: "https://muzeumkrakowa.pl/oddzialy/barbakan", source: "Muzeum Krakowa", names: ["Barbakan"] });
  c.use({ title: "Kościół Mariacki", url: "https://mariacki.com", source: "mariacki.com", names: ["Kościół Mariacki"] });
  c.use({ title: "Taryfa", url: "https://ztp.krakow.pl/taryfa", source: "ZTP Kraków" });
  const urls = c.cited("Do Barbakanu wejdziesz za 22 zł, a bilet 20-minutowy kosztuje 4 zł.").map((s) => s.url);
  assert.deepEqual(urls, ["https://muzeumkrakowa.pl/oddzialy/barbakan", "https://ztp.krakow.pl/taryfa"]);
  assert.ok(c.cited("W Kościele Mariackim jest ołtarz.").some((s) => s.url === "https://mariacki.com"), "odmiana nazwy");
});

test("ciekawostka po drodze bez pytania na końcu; etykiety w nietypowej postaci", async () => {
  process.env.NOMI_SKIP_DOTENV = "1";
  const { dropTrailingQuestion } = await import("../server/agent/nomi.js");
  const { cleanAnswer } = await import("../server/agent/verify.js");
  assert.equal(dropTrailingQuestion("Przed tobą Barbakan. Wstęp 22 zł. Chcesz więcej?"), "Przed tobą Barbakan. Wstęp 22 zł.");
  assert.equal(dropTrailingQuestion("Czy wiesz, że to najstarszy kopiec?"), "Czy wiesz, że to najstarszy kopiec?");
  assert.equal(cleanAnswer("Otwarte do 18:00 [ K1 ]. Bilety 22 zł【K2】 i [K 3 , K4]."), "Otwarte do 18:00 [K1]. Bilety 22 zł[K2] i [K3, K4].");
});
