import assert from "node:assert/strict";
import { test } from "node:test";
import { validateInput, TOOLS } from "../server/agent/tools.js";
import { recommendTicket } from "../server/data/tickets.js";
import { angleDiff, bearing, distance, relativeDirection } from "../server/geo.js";
import { parseCsvLine, parseTime } from "../server/transit/gtfs.js";
import { addDays, serviceDayEpoch } from "../server/time.js";
import { htmlToText } from "../server/services/official.js";

test("parser CSV obsługuje cudzysłowy i puste pola", () => {
  assert.deepEqual(parseCsvLine('a,"b, c","say ""hi""",,e'), ["a", "b, c", 'say "hi"', "", "e"]);
  assert.deepEqual(parseCsvLine("x,"), ["x", ""]);
  assert.deepEqual(parseCsvLine('20260930_1_1,06:07:00,06:07:00,17546,1,"Bielany",0,1,,1').length, 10);
});

test("czasy GTFS po północy", () => {
  assert.equal(parseTime("25:10:30"), 25 * 3600 + 10 * 60 + 30);
});

test("dzień służbowy GTFS (południe − 12 h) uwzględnia zmianę czasu", () => {
  // 25 października 2026 – zmiana czasu z letniego na zimowy w Polsce: odniesienie przesuwa się o 25 h.
  assert.equal(serviceDayEpoch("20261025") - serviceDayEpoch("20261024"), 25 * 3600_000);
  assert.equal(serviceDayEpoch("20261021") - serviceDayEpoch("20261020"), 24 * 3600_000);
  // Zwykły dzień: odniesienie = lokalna północ (CEST, UTC+2).
  assert.equal(new Date(serviceDayEpoch("20261020")).toISOString(), "2026-10-19T22:00:00.000Z");
  assert.equal(addDays("20261231", 1), "20270101");
});

test("geometria: odległość, azymut, kierunek względny", () => {
  const d = distance(50.0617, 19.9373, 50.0541, 19.93545);
  assert.ok(d > 800 && d < 900, `Rynek → Wawel ${d}`);
  const b = bearing(50.0617, 19.9373, 50.0541, 19.93545);
  assert.ok(b > 180 && b < 200);
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(relativeDirection(0, 90, "pl"), "po prawej");
  assert.equal(relativeDirection(0, 180, "pl"), "za tobą");
});

test("rekomendacja biletu wg czasu jazdy", () => {
  assert.equal(recommendTicket(8).id, "15min");
  assert.equal(recommendTicket(20).id, "30min");
  assert.equal(recommendTicket(50).id, "60min");
  assert.equal(recommendTicket(80).id, "90min");
  assert.equal(recommendTicket(100).id, "24h");
});

test("walidacja wejścia narzędzi", () => {
  const schema = TOOLS.find((t) => t.name === "find_places").input_schema;
  assert.equal(validateInput(schema, { type: "restaurant", radius_m: 400 }), null);
  assert.match(validateInput(schema, { radius_m: 400 }), /type/);
  assert.match(validateInput(schema, { type: "spaceship" }), /type/);
  assert.match(validateInput(schema, { type: "cafe", extra: 1 }), /extra/);
  const show = TOOLS.find((t) => t.name === "show_on_map").input_schema;
  assert.equal(validateInput(show, { places: [{ name: "A", lat: 50, lon: 19 }] }), null);
  assert.match(validateInput(show, { places: [{ name: "A", lat: "50", lon: 19 }] }), /places/);
});

test("HTML → tekst: encje, skrypty, menu i komórki tabel", () => {
  const html = '<nav>Menu</nav><script>var x=1</script><h1>Barbakan</h1><p>Wt&ndash;nd 10:30&nbsp;&ndash; 18:00</p><table><tr><td>Normalny</td><td>22&nbsp;z&#322;</td></tr></table><p>G&ouml;rlitz &amp; Carcassonne</p>';
  const text = htmlToText(html);
  assert.ok(!text.includes("Menu") && !text.includes("var x"));
  assert.match(text, /Wt–nd 10:30 – 18:00/);
  assert.ok(text.includes("Normalny | 22 zł"), text);
  assert.match(text, /Görlitz & Carcassonne/);
});
