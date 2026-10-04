// Weryfikacja odpowiedzi NOMI: każde twierdzenie faktograficzne musi mieć pokrycie w dowodach tej tury
// (fragmenty oficjalnych stron, wyniki narzędzi, kontekst z urządzenia, dane z wcześniejszych tur).
// Twierdzenia bez pokrycia są usuwane albo poprawiane – zanim odpowiedź zostanie przeczytana na głos.

export const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["ok", "corrected"] },
    unsupported: { type: "array", items: { type: "string" } },
    answer: { type: "string" },
    sources: { type: "array", items: { type: "string" } },
  },
  required: ["verdict", "unsupported", "answer", "sources"],
  additionalProperties: false,
};

export const VERIFY_SYSTEM = `Jesteś weryfikatorem faktów w aplikacji NOMI – przewodniku po Krakowie. Dostajesz PYTANIE użytkownika, DOWODY i ODPOWIEDŹ przewodnika.
DOWODY to jedyne wiarygodne źródło: fragmenty oficjalnych stron (krakow.travel, krakow.pl, strony muzeów i instytucji, ZTP, IMGW), wyniki narzędzi aplikacji (rozkłady ZTP, taryfa biletowa, dane OpenStreetMap o lokalach, kalendarz wydarzeń), kontekst z telefonu (czas, pozycja, kierunek, pobliskie atrakcje z odległościami i kierunkiem) oraz dane z wcześniejszych tur rozmowy.

Zadanie: sprawdź KAŻDE twierdzenie faktograficzne w ODPOWIEDZI – liczby, ceny, godziny, daty, dni tygodnia, nazwy miejsc, lokali, linii i przystanków, adresy, odległości i kierunki, fakty historyczne, legendy, opisy wydarzeń, dania i opinie o lokalach.
- Poparte = wynika z dowodów (dopuszczalne: parafraza, tłumaczenie, zaokrąglenie, przeliczenie jednostek, odniesienie godzin otwarcia do dzisiejszej daty z kontekstu, wniosek z liczb w dowodach).
- Uważaj na przeniesienie faktu: liczba, data lub nazwa, która jest w dowodach, ale dotyczy czegoś innego, to twierdzenie NIEPOPARTE. Przykłady: „od XVI wieku hejnał grany jest co godzinę” użyte jako „legenda wydarzyła się w XVI wieku”; godziny i ceny jednej wystawy lub trasy na Wawelu podane jako godziny i ceny całego zamku. Sprawdzaj, którego obiektu dotyczy każdy fragment dowodów.
- Niepoparte (brak w dowodach albo sprzeczne z nimi) – usuń je albo popraw zgodnie z dowodami. Jeśli po usunięciu brakuje odpowiedzi na pytanie, napisz uczciwie jednym zdaniem, że nie masz na ten temat oficjalnej informacji.
- NIE dodawaj żadnych nowych faktów spoza dowodów. Zostaw treści, których nie da się sprawdzić z natury: powitania, pytania do użytkownika, propozycje pomocy („Prowadzić cię tam?”), ogólne rady (wygodne buty, uwaga na torowiska), numer alarmowy 112, informację, że trasa jest na mapie.
- Zachowaj język odpowiedzi, koleżeński styl, formatowanie (akapity, listy) i etykiety cytowań [K…] przy zdaniach, które zostają. Usuń etykiety, których nie ma w dowodach, oraz artefakty: znaczniki, JSON, emoji, urwane lub powtórzone zdania, listy adresów URL na końcu.
- verdict = "ok", gdy nic nie trzeba zmieniać (answer = odpowiedź bez zmian); "corrected", gdy cokolwiek poprawiłeś lub usunąłeś. W unsupported wypisz krótko usunięte lub poprawione twierdzenia.
- W sources wypisz etykiety fragmentów dowodów (np. "K3"), na których opiera się ostateczna odpowiedź – także wtedy, gdy odpowiedź ich nie cytuje. Pusta lista, gdy odpowiedź nie zawiera faktów z oznaczonych fragmentów.`;

const MAX_EVIDENCE = 30000;
const MAX_ITEM = 7000;

// Emoji i znaki modyfikujące (interfejs ich nie używa; głos by je przeczytał).
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;
const LEAKED_TAGS = /<\/?(think|tool_call|kontekst_aplikacji|wiedza_z_oficjalnych_zrodel|zdarzenie_aplikacji)\b[^>]*>/g;

/**
 * Sprzątanie odpowiedzi modelu („zbugowane” fragmenty): ukryte bloki i znaczniki, wymyślone etykiety cytowań
 * (inne niż [K…] albo [K…] spoza wydanych w sesji), emoji, nadmiarowe puste linie.
 */
export function cleanAnswer(text, { maxLabel = Infinity } = {}) {
  return String(text ?? "")
    // Etykiety cytowań w nietypowej postaci: „[ K1 ]”, „【K1】”, „[K 1, K 2]” → „[K1]”, „[K1, K2]”.
    .replace(/[[【]\s*(K\s*\d+(?:\s*[,;]\s*K?\s*\d+)*)\s*[\]】]/g, (_, l) => `[${l.replace(/K\s+/g, "K").replace(/\s*([,;])\s*/g, "$1 ")}]`)
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(LEAKED_TAGS, "")
    .replace(/\s?\[([A-Z]\d+(?:\s*[,;]\s*[A-Z]?\d+)*)\]/g, (m, labels) => {
      const ok = [...labels.matchAll(/([A-Z]?)(\d+)/g)].every(([, letter, n]) => (letter === "K" || letter === "") && Number(n) < maxLabel);
      return ok && /^K/.test(labels) ? m : "";
    })
    .replace(EMOJI_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Krótkie odpowiedzi bez liczb i nazw (np. „Jasne, już sprawdzam!”) nie wymagają sprawdzania. */
export function needsVerification(answer) {
  const a = String(answer).trim();
  if (!a) return false;
  return a.length >= 60 || /\d/.test(a);
}

const squash = (s) => String(s).replace(/\s+/g, " ").trim();

/**
 * Sprawdza odpowiedź w dowodach. Zwraca { status: "ok" | "corrected", answer, unsupported }.
 * runJson – funkcja dostawcy AI (odpowiedź JSON zgodna ze schematem).
 */
export async function verifyAnswer({ question, answer, evidence, runJson, signal, maxLabel, effort = "medium" }) {
  let budget = MAX_EVIDENCE;
  const parts = [];
  for (const e of evidence.filter(Boolean)) {
    const item = String(e).slice(0, MAX_ITEM);
    if (budget - item.length < 0) break;
    budget -= item.length;
    parts.push(item);
  }
  const request = [
    `PYTANIE UŻYTKOWNIKA:\n${question}`,
    `DOWODY:\n${parts.join("\n\n---\n\n") || "(brak dowodów – żadnego twierdzenia faktograficznego nie da się potwierdzić)"}`,
    `ODPOWIEDŹ DO SPRAWDZENIA:\n${answer}`,
  ].join("\n\n=====\n\n");
  const r = await runJson({ system: VERIFY_SYSTEM, request, schema: VERIFY_SCHEMA, signal, effort, name: "verify" });
  const unsupported = Array.isArray(r?.unsupported) ? r.unsupported.filter((x) => typeof x === "string").slice(0, 10) : [];
  // Etykiety fragmentów, na których opiera się odpowiedź (do listy źródeł, gdy model ich nie zacytował).
  const support = Array.isArray(r?.sources) ? [...new Set(r.sources.map((x) => (String(x).match(/K\s*(\d+)/) || [])[1]).filter(Boolean).map((n) => `K${n}`))] : [];
  const fixed = cleanAnswer(typeof r?.answer === "string" ? r.answer : "", { maxLabel });
  if (r?.verdict !== "corrected" || !fixed || squash(fixed) === squash(answer)) return { status: "ok", answer, unsupported: [], support };
  return { status: "corrected", answer: fixed, unsupported, support };
}
