// Buduje bazę wiedzy NOMI z oficjalnych źródeł. Użycie: npm run rag:build
import { buildRag } from "../server/rag/index.js";

try {
  const status = await buildRag();
  console.log(status);
} catch (err) {
  console.error("Budowa bazy wiedzy nieudana:", err.message);
  process.exit(1);
}
