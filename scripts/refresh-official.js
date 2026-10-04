// Pobiera oficjalne strony atrakcji i aktualizuje dane (godziny, ceny, fakty).
// Użycie: npm run official:refresh            – tylko nieaktualne (starsze niż OFFICIAL_TTL_HOURS)
//         npm run official:refresh -- --force – wszystkie od nowa
//         npm run official:refresh -- barbakan mariacki
import { aiStatus } from "../server/agent/nomi.js";
import { officialPublic, refreshAllOfficial, refreshOfficial } from "../server/services/official.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const ids = args.filter((a) => !a.startsWith("--"));

if (!aiStatus().keyConfigured) {
  console.error("Brak klucza AI w .env – ekstrakcja danych z oficjalnych stron wymaga modelu.");
  process.exit(1);
}

const show = (id) => {
  const o = officialPublic(id);
  if (!o) return console.log(`✘ ${id}: brak danych`);
  const hours = o.opening_hours.map((h) => `${h.what ? `${h.what}: ` : ""}${[h.period, h.days, h.hours].filter(Boolean).join(" ")}`).join("; ") || "–";
  const prices = o.prices.slice(0, 3).map((p) => `${p.ticket} ${p.price}`).join("; ") || "–";
  console.log(`✔ ${id}\n   godziny: ${hours}\n   ceny: ${prices}\n   fakty: ${o.facts.length}, źródła: ${o.sources.length}`);
};

if (ids.length) {
  for (const id of ids) {
    await refreshOfficial(id, { force: true });
    show(id);
  }
} else {
  await refreshAllOfficial({ force, onProgress: (id) => show(id) });
}
