// Oficjalne źródła bazy wiedzy: odkrywanie adresów i wyciąganie czystej treści stron.
import { config } from "../config.js";
import { OFFICIAL_SOURCES } from "../data/officialSources.js";
import { cleanGuide, focusText, htmlToText } from "../services/official.js";

const KT = "https://krakow.travel";
const KPL = "https://www.krakow.pl";
const UA = { "User-Agent": `Mozilla/5.0 (compatible; ${config.userAgent})`, Accept: "text/html" };

// Kategorie przewodnika krakow.travel (oficjalny portal turystyczny Gminy Miejskiej Kraków).
const KT_CATEGORIES = ["zwiedzanie,102", "muzea,106", "przyroda,108", "rekreacja,107", "kultura,105", "miejsca-pamieci,116", "swiatynie,110", "ulice-i-place,112", "zabytki,104"];
// Strony z listami artykułów praktycznych i ciekawostek.
const KT_ARTICLE_LISTS = ["/informacje", "/ciekawostki"];
// Oficjalny serwis miejski krakow.pl – informacje praktyczne i trasy tematyczne (punkty startowe).
const KPL_SEEDS = [
  "/odwiedz_krakow/264,glowna.html",
  "/turystyka/148881,artykul,o-krakowie.html",
  "/turystyka/1128,artykul,jak-dojechac-do-krakowa.html",
  "/turystyka/40581,artykul,poruszamy-sie-po-krakowie.html",
  "/turystyka/1177,artykul,trzy-dni-w-krakowie.html",
  "/turystyka/1218,artykul,droga-krolewska.html",
  "/turystyka/306312,artykul,historyczny-krakowski-szlak-kulinarny.html",
];
const KPL_PATTERN = /^\/(turystyka|odwiedz_krakow|informacje_praktyczne)\/\d+,artykul,/;
// Oddziały muzeów miejskich – własne strony instytucji (opis, godziny, ceny).
const INSTITUTION_LISTS = [
  { list: "https://muzeumkrakowa.pl/oddzialy", pattern: /href="(?:https:\/\/muzeumkrakowa\.pl)?(\/oddzialy\/[a-z0-9-]+)"/g, base: "https://muzeumkrakowa.pl" },
  { list: "https://mnk.pl/oddzialy/", pattern: /href="https:\/\/mnk\.pl(\/oddzialy\/[a-z0-9-]+\/)"/g, base: "https://mnk.pl" },
];
// ZTP Kraków – bilety i zasady komunikacji miejskiej.
const ZTP_PAGES = [
  "https://ztp.krakow.pl/wszystkie-aktualnosci/kmk/taryfa-biletowa-od-2-marca-wszystkie-dostepne-bilety.html",
  "https://ztp.krakow.pl/en/kmk-public-transport/buy-a-kmk-ticket",
  "https://ztp.krakow.pl/en/kmk-public-transport/kmk-ticket-guide",
];

export const SOURCE_LABELS = {
  "krakow.travel": "krakow.travel – oficjalny portal turystyczny Krakowa",
  "www.krakow.pl": "krakow.pl – oficjalny serwis miejski",
  "ztp.krakow.pl": "ZTP Kraków – Zarząd Transportu Publicznego",
  "muzeumkrakowa.pl": "Muzeum Krakowa",
  "mnk.pl": "Muzeum Narodowe w Krakowie",
  "wawel.krakow.pl": "Zamek Królewski na Wawelu",
  "www.katedra-wawelska.pl": "Katedra Wawelska",
  "maius.uj.edu.pl": "Muzeum Uniwersytetu Jagiellońskiego",
  "ogrod.uj.edu.pl": "Ogród Botaniczny UJ",
};

export function sourceLabel(url) {
  const host = new URL(url).hostname;
  return SOURCE_LABELS[host] || host.replace(/^www\./, "");
}

// Strony pobrane już przy odkrywaniu adresów (krakow.pl) – żeby przy budowie nie pobierać ich drugi raz.
const htmlCache = new Map();
export const clearHtmlCache = () => htmlCache.clear();

async function fetchHtml(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Linie interfejsu stron (ciasteczka, kontrast, rozmiar czcionki, odtwarzacze) – bez wartości dla bazy wiedzy.
const BOILERPLATE =
  /(używa|wykorzystuje|stosuje) (plików )?(cookies|ciasteczek)|uses cookies|ustawienia (plików )?cookies|plik(i|ów)? cookie|PHPSESSID|^(odrzucam|akceptuję) wszystkie|przeglądarka nie obsługuje|your browser does not support|^contrast\b|^kontrast|przejdź do (treści|menu)|skip to (content|main)|^(zaakceptuj|akceptuj|accept)\b|^(udostępnij|share)$|^(drukuj|print)$/i;

// Nazwy serwisów, które bywają w <h1>/<title> zamiast nazwy obiektu (np. logo krakow.travel).
const GENERIC_TITLES = /^(kraków travel|magiczny kraków|strona główna)$/i;

/** Tytuł strony: og:title (krakow.travel ma nazwę obiektu tylko tam), potem <h1>, potem <title>. */
export function titleOf(html) {
  const og = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i) ||
    html.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:title"/i) || [])[1];
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const title = (html.match(/<title>([^<]+)/i) || [])[1];
  const clean = (s) => htmlToText(s || "").split(/\s[-–|]\s/)[0].trim();
  return [og, h1, title].map(clean).find((t) => t && !GENERIC_TITLES.test(t)) || clean(title);
}

/** Czysta treść strony zależnie od serwisu (bez menu, stopek i bloków z innymi obiektami). */
/** Usuwa panele zgody na cookies: elementy <div>, których class/id wskazuje na cookies/zgodę (z zagnieżdżeniem). */
export function stripCookiePanels(html) {
  const open = /<div\b[^>]*\b(?:class|id)="[^"]*(?:cookie|consent|gdpr)[^"]*"[^>]*>/gi;
  let out = html;
  for (let guard = 0; guard < 10; guard++) {
    open.lastIndex = 0;
    const m = open.exec(out);
    if (!m) break;
    const tag = /<\/?div\b[^>]*>/gi;
    tag.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = out.length;
    for (let t; depth && (t = tag.exec(out)); ) {
      depth += t[0][1] === "/" ? -1 : 1;
      if (!depth) end = t.index + t[0].length;
    }
    out = out.slice(0, m.index) + out.slice(end);
  }
  return out;
}

export async function fetchDoc(url) {
  const html = stripCookiePanels(htmlCache.get(url) ?? (await fetchHtml(url)));
  htmlCache.delete(url);
  const title = titleOf(html);
  const host = new URL(url).hostname;
  let text;
  if (host === "krakow.travel") {
    text = cleanGuide(htmlToText(html)).replace(/^Opis\n/, "");
  } else if (host === "www.krakow.pl") {
    // Artykuł: od nagłówka do bloku udostępniania.
    const start = html.search(/<h1[\s>]/i);
    const end = html.search(/article__socials|article-actions|id="footer"/);
    text = htmlToText(start >= 0 ? html.slice(start, end > start ? end : undefined) : html);
  } else {
    // Strony instytucji: główna treść (<main>, jeśli jest – bez paneli cookies i menu),
    // bez krótkich linii menu, z liniami o godzinach i cenach.
    const main = html.search(/<main[\s>]/i);
    const mainEnd = html.search(/<\/main>/i);
    const body = main >= 0 && mainEnd > main ? html.slice(main, mainEnd) : html;
    text = focusText(
      htmlToText(body)
        .split("\n")
        .filter((l) => l.length >= 40 || /\d/.test(l))
        .join("\n"),
      12000,
    );
  }
  text = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !BOILERPLATE.test(l))
    .join("\n");
  return { url, title, source: sourceLabel(url), text };
}

// ------------------------------------------------------------------ odkrywanie adresów

async function ktItems() {
  const urls = new Set();
  for (const cat of KT_CATEGORIES) {
    let prev = "";
    for (let page = 1; page <= 30; page++) {
      let html;
      try {
        html = await fetchHtml(`${KT}/przewodnik/${cat}?Item_page=${page}`);
      } catch {
        break;
      }
      const links = [...new Set([...html.matchAll(/href="(\/\d+-krakow-[^"#?]+)"/g)].map((m) => m[1]))].sort().join(" ");
      if (!links || links === prev) break; // za ostatnią stroną portal zwraca ponownie tę samą listę
      prev = links;
      for (const l of links.split(" ")) urls.add(KT + l);
    }
  }
  return [...urls];
}

async function ktArticles() {
  const urls = new Set();
  for (const list of KT_ARTICLE_LISTS) {
    try {
      const html = await fetchHtml(KT + list);
      for (const m of html.matchAll(/href="(\/artykul\/\d+\/[^"#?]+)"/g)) urls.add(KT + m[1]);
    } catch {
      /* lista niedostępna */
    }
  }
  return [...urls];
}

async function krakowPl(max) {
  const seen = new Set();
  const queue = KPL_SEEDS.map((p) => ({ path: p, depth: 0 }));
  const found = [];
  while (queue.length && found.length < max) {
    const { path, depth } = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    let html;
    try {
      html = await fetchHtml(KPL + path);
    } catch {
      continue;
    }
    if (path !== KPL_SEEDS[0]) {
      found.push(KPL + path);
      htmlCache.set(KPL + path, html);
    }
    if (depth >= 2) continue;
    for (const m of html.matchAll(/href="(?:https?:\/\/www\.krakow\.pl)?(\/[^"#?]+)"/g)) {
      const p = m[1];
      if (KPL_PATTERN.test(p) && !seen.has(p)) queue.push({ path: p, depth: depth + 1 });
    }
  }
  return found;
}

async function institutionBranches() {
  const urls = [];
  for (const { list, pattern, base } of INSTITUTION_LISTS) {
    try {
      const html = await fetchHtml(list);
      for (const m of html.matchAll(pattern)) urls.push(base + m[1]);
    } catch {
      /* lista niedostępna */
    }
  }
  return urls;
}

/** Wszystkie adresy do zaindeksowania (bez duplikatów). */
export async function discoverUrls({ maxKrakowPl = 220 } = {}) {
  const institution = Object.values(OFFICIAL_SOURCES).flatMap((s) => s.pages);
  const [items, articles, kpl, branches] = await Promise.all([ktItems(), ktArticles(), krakowPl(maxKrakowPl), institutionBranches()]);
  return [...new Set([...items, ...articles, ...kpl, ...institution, ...branches, ...ZTP_PAGES])];
}
