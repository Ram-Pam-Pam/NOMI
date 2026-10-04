// Ocena wyszukiwania w bazie wiedzy: trafność BM25, wektorów i hybrydy na pytaniach turystów.
// Użycie: npm run rag:eval [-- --model BAAI/bge-multilingual-gemma2]
// Dla modelu innego niż w indeksie fragmenty są liczone od nowa (wynik zapisywany w data/rag/eval-*.i8).
import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "../server/config.js";
import { embed } from "../server/rag/embed.js";
import { FUSION_WEIGHTS, dequantize, loadRag, quantize, rankChunks } from "../server/rag/index.js";

// Pytanie → fragmenty adresu, z których dowolny oznacza trafienie.
const QUESTIONS = [
  ["Ile kosztuje bilet do Barbakanu?", ["barbakan"]],
  ["Kiedy usypano Kopiec Kościuszki?", ["kopiec-kosciuszki", "kopiec-kosciuszk"]],
  ["Legenda o smoku wawelskim", ["smocza-jama", "smok"]],
  ["Dlaczego hejnał mariacki urywa się w połowie?", ["mariack", "hejnal"]],
  ["Kto wyrzeźbił ołtarz w Kościele Mariackim?", ["mariack"]],
  ["Jak dojechać z lotniska Balice do centrum?", ["lotnisk", "jak-dojechac", "balice"]],
  ["Gdzie kupić bilet na tramwaj i ile kosztuje?", ["ztp.krakow.pl", "bilet", "komunikacj", "poruszamy"]],
  ["What is Kazimierz famous for?", ["kazimierz"]],
  ["Oskar Schindler's factory museum", ["schindler", "fabryka"]],
  ["Rynek Podziemny – co tam zobaczę?", ["rynek-podziemny", "podziemn"]],
  ["Collegium Maius – najstarszy budynek uniwersytetu", ["collegium-maius", "maius"]],
  ["Gdzie pochowano polskich królów?", ["wawel", "katedr"]],
  ["Ogród Botaniczny Uniwersytetu Jagiellońskiego", ["botaniczn", "ogrod.uj"]],
  ["Co zobaczyć w Nowej Hucie?", ["nowa-huta", "nowej-huty", "nowa_huta", "huta"]],
  ["Bulwary Wiślane spacer nad rzeką", ["bulwar"]],
  ["Dzwon Zygmunt na Wawelu", ["zygmunt", "wawel"]],
  ["Krakowski obwarzanek i szlak kulinarny", ["kulinarn", "obwarzan"]],
  ["Where can I see Lady with an Ermine?", ["czartorysk", "dama", "mnk.pl"]],
  ["Pomnik Adama Mickiewicza na Rynku", ["mickiewicz"]],
  ["Kopiec Krakusa", ["krakusa"]],
  ["Muzeum Lotnictwa Polskiego", ["lotnictw"]],
  ["Opactwo Benedyktynów w Tyńcu", ["tyniec", "tynca", "tyniecki"]],
  ["Sukiennice – historia hali targowej", ["sukiennic"]],
  ["Brama Floriańska i mury obronne", ["florian", "mury"]],
  ["Droga Królewska przez Kraków", ["droga-krolewska", "krolewsk"]],
  ["Kościół Świętych Piotra i Pawła", ["piotra-i-pawla", "piotra"]],
  ["Synagoga Stara na Kazimierzu", ["synagog", "stara-synagoga"]],
  ["Cmentarz Rakowicki", ["rakowick"]],
  ["Kamienica Hipolitów", ["hipolit"]],
  ["Ile dni potrzeba na zwiedzanie Krakowa?", ["trzy-dni", "dni-w-krakowie", "weekend"]],
];
// Pytania spoza tematu – do kalibracji progu trafności (agent nie powinien dostać do nich „wiedzy”).
const OFF_TOPIC = ["Jaki jest dziś kurs euro?", "Przepis na sernik", "Who won the 2022 World Cup?", "Jak naprawić przebitą dętkę w rowerze?", "Napisz wiersz o kocie"];

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};

// --weights 1,0.5,1 = wagi rankingów hybrydy: wektory, BM25, tytuł.
const w = arg("weights")?.split(",").map(Number);
const weights = w ? { dense: w[0], bm25: w[1], title: w[2] } : FUSION_WEIGHTS;

const index = await loadRag();
if (!index) {
  console.error("Brak bazy wiedzy – najpierw npm run rag:build.");
  process.exit(1);
}
const model = arg("model") || index.model;
let { vectors, dim } = index;
if (model && model !== index.model) {
  const file = path.join(config.dataDir, "rag", `eval-${model.replace(/\W+/g, "_")}.i8`);
  try {
    const meta = JSON.parse(await fsp.readFile(`${file}.json`, "utf8"));
    if (meta.count !== index.chunks.length) throw new Error("nieaktualne");
    dim = meta.dim;
    vectors = dequantize(await fsp.readFile(file), dim);
  } catch {
    console.log(`Liczę wektory fragmentów modelem ${model}…`);
    const vecs = await embed(index.chunks.map((c) => `${c.title}\n${c.text}`), "doc", { model });
    dim = vecs[0].length;
    vectors = new Float32Array(vecs.length * dim);
    vecs.forEach((v, i) => vectors.set(v, i * dim));
    await fsp.writeFile(file, quantize(vectors, dim));
    await fsp.writeFile(`${file}.json`, JSON.stringify({ dim, count: vecs.length }));
  }
}
const qvecs = model ? await embed([...QUESTIONS.map((q) => q[0]), ...OFF_TOPIC], "query", { model }) : [];

/** Ranking dokumentów (pierwsze wystąpienie każdego adresu). */
function docRanking(query, qvec, mode) {
  const ranked = rankChunks({ ...index, vectors, dim, query, qvec, mode, weights });
  const seen = new Set();
  const out = [];
  for (const r of ranked) {
    const c = index.chunks[r.i];
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push({ url: c.url, title: c.title, ...r });
    if (out.length >= 10) break;
  }
  return out;
}

const modes = model ? ["bm25", "dense", "hybrid"] : ["bm25"];
const stats = Object.fromEntries(modes.map((m) => [m, { h1: 0, h3: 0, h5: 0, mrr: 0 }]));
const misses = [];
const topSim = [];
QUESTIONS.forEach(([q, expect], qi) => {
  for (const mode of modes) {
    const docs = docRanking(q, qvecs[qi], mode);
    const rank = docs.findIndex((d) => expect.some((e) => d.url.toLowerCase().includes(e))) + 1;
    const s = stats[mode];
    if (rank === 1) s.h1++;
    if (rank && rank <= 3) s.h3++;
    if (rank && rank <= 5) s.h5++;
    if (rank) s.mrr += 1 / rank;
    if (mode === modes.at(-1)) {
      if (!rank || rank > 3) misses.push(`${q}\n    → ${docs.slice(0, 3).map((d) => d.url.replace(/^https?:\/\//, "")).join("\n      ")}`);
      if (docs[0]?.similarity != null) topSim.push(docs[0].similarity);
    }
  }
});

const n = QUESTIONS.length;
console.log(`\nModel: ${model || "(brak – tylko BM25)"} · fragmentów: ${index.chunks.length} · pytań: ${n}`);
console.log("tryb     hit@1  hit@3  hit@5  MRR");
for (const m of modes) {
  const s = stats[m];
  const pct = (x) => `${Math.round((100 * x) / n)}%`.padStart(5);
  console.log(`${m.padEnd(8)} ${pct(s.h1)}  ${pct(s.h3)}  ${pct(s.h5)}  ${(s.mrr / n).toFixed(3)}`);
}
if (misses.length) console.log(`\nPoza top 3 (${modes.at(-1)}):\n  ${misses.join("\n  ")}`);

if (model) {
  const off = OFF_TOPIC.map((q, i) => docRanking(q, qvecs[n + i], "dense")[0]?.similarity ?? 0);
  const fmt = (xs) => xs.map((x) => x.toFixed(2)).join(" ");
  topSim.sort((a, b) => a - b);
  console.log(`\nPodobieństwo najlepszego fragmentu – pytania o Kraków (rosnąco): ${fmt(topSim)}`);
  console.log(`Podobieństwo najlepszego fragmentu – pytania spoza tematu:      ${fmt(off)}`);
}
