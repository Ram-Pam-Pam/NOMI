// Narzędzia agenta NOMI: definicje (JSON Schema) + implementacje.
import { attractionById } from "../data/attractions.js";
import { TICKETS, recommendTicket } from "../data/tickets.js";
import { angleDiff, relativeDirection } from "../geo.js";
import { attractionsInView, nearbyAttractions, withGeometry } from "../services/attractions.js";
import { findEvents } from "../services/events.js";
import { resolvePlace, searchPlaces } from "../services/geocode.js";
import { officialPublic, officialSourcesFor } from "../services/official.js";
import { DIETS, PLACE_TYPES, findPlaces } from "../services/places.js";
import { planRoute, summarizeRoute } from "../services/routes.js";
import { getWeather } from "../services/weather.js";
import { addDays, fmtClock, localYmd } from "../time.js";
import { nextDepartures } from "../transit/index.js";
import { PREF_KEYS, hasPosition } from "./context.js";
import { knowledgeTool, snippetFor } from "./knowledge.js";
import { sourceLabel } from "../rag/sources.js";

const RYNEK = { lat: 50.0617, lon: 19.9373, name: "Rynek Główny" };
const TAGS = ["history", "architecture", "art", "museums", "churches", "jewish", "views", "nature", "food", "nightlife", "kids", "ww2", "university"];

export const TOOL_LABELS = {
  find_attractions: { pl: "Szukam atrakcji", en: "Finding attractions" },
  look_around: { pl: "Rozglądam się", en: "Looking around" },
  find_places: { pl: "Szukam miejsc w okolicy", en: "Searching nearby places" },
  plan_route: { pl: "Planuję trasę", en: "Planning the route" },
  get_departures: { pl: "Sprawdzam odjazdy", en: "Checking departures" },
  get_ticket_info: { pl: "Sprawdzam bilety", en: "Checking tickets" },
  search_place: { pl: "Szukam miejsca", en: "Looking up the place" },
  show_on_map: { pl: "Pokazuję na mapie", en: "Showing on the map" },
  add_to_plan: { pl: "Dodaję do planu", en: "Adding to your plan" },
  search_knowledge: { pl: "Szukam w oficjalnych źródłach", en: "Searching official sources" },
  get_events: { pl: "Sprawdzam wydarzenia", en: "Checking events" },
  get_weather: { pl: "Sprawdzam pogodę", en: "Checking the weather" },
  remember_preference: { pl: "Zapamiętuję", en: "Remembering" },
};

const point = {
  type: "object",
  properties: {
    name: { type: "string" },
    lat: { type: "number" },
    lon: { type: "number" },
    note: { type: "string", description: "Krótki opis (1 zdanie)." },
  },
  required: ["name", "lat", "lon"],
  additionalProperties: false,
};

export const TOOLS = [
  {
    name: "find_attractions",
    description:
      "Atrakcje Krakowa z bazy NOMI (ze sprawdzonymi faktami do opowieści), posortowane według odległości od użytkownika lub wskazanego miejsca, z kierunkiem względem tego, gdzie patrzy użytkownik. Użyj, gdy pytanie dotyczy tego, co warto zobaczyć, albo potrzebujesz faktów, by opowiedzieć o miejscu. Podaj attraction_id, by dostać szczegóły jednej atrakcji.",
    input_schema: {
      type: "object",
      properties: {
        attraction_id: { type: "string", description: "Id atrakcji (np. z kontekstu) – zwraca jej pełne fakty." },
        near: { type: "string", description: "Nazwa miejsca, wokół którego szukać (domyślnie pozycja użytkownika)." },
        radius_m: { type: "integer", description: "Promień w metrach, domyślnie 800, maks. 20000." },
        tag: { type: "string", enum: TAGS, description: "Filtr tematyczny." },
        limit: { type: "integer", description: "Maks. liczba wyników (domyślnie 5)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "look_around",
    description:
      "Co jest w polu widzenia użytkownika – na podstawie GPS i kompasu (kierunku, w którym trzyma telefon). Zwraca atrakcje z bazy NOMI oraz obiekty z OpenStreetMap (zabytki, pomniki, muzea) w stożku przed użytkownikiem. Użyj przy pytaniach typu „co to za budynek?”, „co widzę przed sobą?”.",
    input_schema: {
      type: "object",
      properties: {
        max_distance_m: { type: "integer", description: "Zasięg w metrach (domyślnie 250)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "find_places",
    description:
      "Wyszukuje miejsca w OpenStreetMap w pobliżu użytkownika (lub wskazanego miejsca): restauracje, kawiarnie, bary, fast food, lody, piekarnie, apteki, bankomaty, toalety, biletomaty komunikacji miejskiej. Zwraca nazwy, odległości, kuchnię, godziny otwarcia (jeśli są w OSM), kierunek.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: Object.keys(PLACE_TYPES), description: "Rodzaj miejsca." },
        cuisine: { type: "string", description: "Filtr kuchni wg tagu OSM, np. polish, pizza, italian, sushi, burger, coffee_shop." },
        diet: { type: "string", enum: DIETS, description: "Tylko lokale oznaczone w OSM jako oferujące dania dla tej diety (pola vegetarian/vegan w wyniku: yes = są takie dania, only = wyłącznie). Użyj dla preferencji dietetycznych zamiast cuisine." },
        name: { type: "string", description: "Fragment nazwy lokalu." },
        near: { type: "string", description: "Nazwa miejsca, wokół którego szukać (domyślnie pozycja użytkownika)." },
        radius_m: { type: "integer", description: "Promień w metrach, domyślnie 600, maks. 3000." },
        limit: { type: "integer", description: "Maks. liczba wyników (domyślnie 6)." },
      },
      required: ["type"],
      additionalProperties: false,
    },
  },
  {
    name: "plan_route",
    description:
      "Planuje trasę z bieżącej pozycji (lub z origin) do celu: pieszo i komunikacją miejską (tramwaje, autobusy MPK/Mobilis) wg aktualnego rozkładu ZTP Kraków z opóźnieniami na żywo. Trasa automatycznie pojawia się na mapie w aplikacji z przyciskiem startu nawigacji. Zwraca warianty: godziny, linie, przystanki, polecany bilet.",
    input_schema: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Cel: nazwa atrakcji, adres, przystanek lub miejsca." },
        destination_lat: { type: "number", description: "Szerokość geograficzna celu, jeśli znana (np. z wyników innych narzędzi)." },
        destination_lon: { type: "number", description: "Długość geograficzna celu, jeśli znana." },
        origin: { type: "string", description: "Start, jeśli inny niż bieżąca pozycja użytkownika." },
        mode: { type: "string", enum: ["auto", "walk", "transit"], description: "auto = wybierz najlepszy; transit = wymuś komunikację." },
        depart_in_minutes: { type: "integer", description: "Wyjazd za X minut (domyślnie teraz)." },
      },
      required: ["destination"],
      additionalProperties: false,
    },
  },
  {
    name: "get_departures",
    description:
      "Najbliższe odjazdy tramwajów i autobusów z przystanku najbliższego użytkownikowi albo z przystanku o podanej nazwie – z opóźnieniami na żywo.",
    input_schema: {
      type: "object",
      properties: {
        stop_name: { type: "string", description: "Nazwa przystanku (domyślnie najbliższy użytkownikowi)." },
        line: { type: "string", description: "Tylko wskazana linia." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_ticket_info",
    description:
      "Aktualny cennik biletów komunikacji miejskiej w Krakowie (ZTP/KMK), sposoby zakupu (biletomaty w pojazdach, aplikacje) i zasady. Podaj ride_minutes, by dostać rekomendację biletu.",
    input_schema: {
      type: "object",
      properties: {
        ride_minutes: { type: "integer", description: "Planowany czas jazdy w minutach." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_place",
    description: "Wyszukuje miejsce w Krakowie po nazwie lub adresie i zwraca współrzędne (atrakcje, przystanki, adresy z OSM).",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "show_on_map",
    description: "Pokazuje użytkownikowi pinezki na mapie w aplikacji (np. polecane restauracje). Użyj, gdy polecasz kilka konkretnych miejsc.",
    input_schema: {
      type: "object",
      properties: { places: { type: "array", items: point, description: "1–10 miejsc." } },
      required: ["places"],
      additionalProperties: false,
    },
  },
  {
    name: "add_to_plan",
    description: "Dodaje miejsce do planu zwiedzania użytkownika w zakładce Planer. Używaj tylko, gdy użytkownik o to prosi lub się zgodzi.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        lat: { type: "number" },
        lon: { type: "number" },
        attraction_id: { type: "string" },
        duration_min: { type: "integer", description: "Szacowany czas pobytu." },
        note: { type: "string" },
      },
      required: ["name", "lat", "lon"],
      additionalProperties: false,
    },
  },
  {
    name: "search_knowledge",
    description:
      "Przeszukuje bazę wiedzy NOMI zbudowaną z oficjalnych stron: krakow.travel (oficjalny portal turystyczny miasta – zabytki, muzea, historia, legendy, porady praktyczne), krakow.pl (serwis miejski – trasy tematyczne, informacje dla turystów), strony muzeów i instytucji (godziny, ceny, zasady zwiedzania) i ZTP (komunikacja). Użyj, gdy blok <wiedza_z_oficjalnych_zrodel> nie odpowiada na pytanie albo go nie ma. Zapytanie formułuj konkretnie: nazwa obiektu + czego szukasz (np. „Sukiennice Rynek Podziemny bilety”). Zwraca fragmenty z etykietami [K…] do cytowania.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Zapytanie po polsku lub angielsku." },
        limit: { type: "integer", description: "Liczba fragmentów (domyślnie 4, maks. 6)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_events",
    description:
      "Wydarzenia w Krakowie (koncerty, festiwale, wystawy, inne) z oficjalnego kalendarza krakow.travel. Domyślnie od dziś przez 7 dni. Zwraca nazwę, termin, kategorię, krótki opis i link.",
    input_schema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "Od dnia (YYYY-MM-DD), domyślnie dziś." },
        date_to: { type: "string", description: "Do dnia włącznie (YYYY-MM-DD), domyślnie dziś + 6 dni." },
        category: { type: "string", enum: ["koncert", "festiwal", "wystawa", "inne"] },
        query: { type: "string", description: "Słowo w nazwie lub opisie (np. jazz, film)." },
        limit: { type: "integer", description: "Maks. liczba wyników (domyślnie 8)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_weather",
    description:
      "Aktualna pogoda w Krakowie z IMGW-PIB (pomiar ze stacji synoptycznej: temperatura, wiatr, opad, wilgotność) i obowiązujące ostrzeżenia meteorologiczne dla Krakowa. Prognozy nie ma w publicznym API IMGW.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "remember_preference",
    description:
      "Zapamiętuje w aplikacji trwałą preferencję użytkownika, by uwzględniać ją w kolejnych rozmowach i planach: dieta (także alergie pokarmowe), zainteresowania, poruszanie się (np. wózek, wózek dziecięcy, unikanie schodów), budżet, z kim zwiedza. Użyj, gdy użytkownik mówi o sobie coś ważnego na przyszłość. Ustaw forget=true, gdy prosi o zapomnienie.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", enum: PREF_KEYS },
        value: { type: "string", description: "Krótko, w języku użytkownika (maks. 120 znaków), np. „wegetariańska”." },
        forget: { type: "boolean" },
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
].map((t) => ({ ...t, eager_input_streaming: true }));

// ------------------------------------------------------------------ walidacja

function checkValue(schema, v) {
  if (v === null || v === undefined) return false;
  switch (schema.type) {
    case "string":
      return typeof v === "string" && (!schema.enum || schema.enum.includes(v));
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "array":
      return Array.isArray(v) && (!schema.items || v.every((x) => checkValue(schema.items, x)));
    case "object":
      return validateInput(schema, v) === null;
    default:
      return true;
  }
}

/** Zwraca opis błędu albo null, gdy wejście pasuje do schematu. */
export function validateInput(schema, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "wejście musi być obiektem";
  for (const key of schema.required || []) if (input[key] === undefined) return `brak pola ${key}`;
  for (const [key, value] of Object.entries(input)) {
    const prop = schema.properties?.[key];
    if (!prop) return `nieznane pole ${key}`;
    if (!checkValue(prop, value)) return `niepoprawna wartość pola ${key}`;
  }
  return null;
}

// ------------------------------------------------------------------ implementacje

async function originFor(near, ctx) {
  if (near) {
    const p = await resolvePlace(near);
    if (!p) throw new Error(`Nie znaleziono miejsca „${near}”.`);
    return { ...p, assumed: false };
  }
  if (hasPosition(ctx)) return { lat: ctx.lat, lon: ctx.lon, name: "pozycja użytkownika", assumed: false };
  return { ...RYNEK, assumed: true };
}

const clamp = (v, min, max, def) => (Number.isFinite(v) ? Math.min(Math.max(v, min), max) : def);

const ZTP_SOURCE = { title: "Rozkłady jazdy i opóźnienia na żywo (GTFS ZTP Kraków)", url: "https://ztp.krakow.pl", source: "ZTP Kraków" };
const OSM_SOURCE = { title: "OpenStreetMap – lokalizacja, rodzaj lokalu, trasy piesze", url: "https://www.openstreetmap.org", source: "OpenStreetMap (dane społecznościowe)" };

/** Oficjalne strony atrakcji jako źródła odpowiedzi (gdy odpowiedź wymienia tę atrakcję). */
function useOfficial(citations, o, names) {
  for (const url of o?.sources || []) citations?.use({ title: names[0], url, source: sourceLabel(url), fetched: o.fetched, names });
}

/** Oficjalne dane atrakcji (strona instytucji + portal krakow.travel); bez nich – jasna informacja, skąd wziąć. */
function officialFor(a) {
  const o = officialPublic(a.id);
  if (o) {
    const { id, name, fetchedAt, ...data } = o;
    return { official: data, source_note: "Dane z oficjalnych stron (pole sources). Podając godziny lub ceny, wymień źródło." };
  }
  const urls = officialSourcesFor(a.id);
  return {
    official: null,
    facts_unofficial: a.facts,
    source_note: urls.length
      ? `Oficjalne dane nie zostały jeszcze pobrane. Godzin i cen NIE podawaj – odeślij do oficjalnej strony: ${urls[0]}`
      : "Obiekt ogólnodostępny (plac, ulica, pomnik) – bez biletów i godzin otwarcia.",
  };
}

const handlers = {
  async find_attractions(input, { ctx, citations }) {
    const lang = ctx.lang;
    if (input.attraction_id) {
      const a = attractionById.get(input.attraction_id);
      if (!a) return { error: `Nie ma atrakcji o id ${input.attraction_id}` };
      const base = hasPosition(ctx) ? withGeometry(a, ctx.lat, ctx.lon, ctx.heading, lang) : { id: a.id, name: a.name[lang] };
      const official = officialFor(a);
      useOfficial(citations, officialPublic(a.id), [a.name[lang] || a.name.pl, a.name.pl, a.name.en]);
      // Bez pobranych danych strukturalnych – fragmenty oficjalnych stron tej atrakcji z bazy wiedzy.
      if (!official.official && citations) {
        const urls = officialSourcesFor(a.id);
        const kb = urls.length ? await knowledgeTool(a.name.pl, citations, { limit: 3, urls }).catch(() => null) : null;
        if (kb?.results?.length) official.knowledge = kb.results;
      }
      return { ...base, typical_visit_min: a.visitMin, district: a.district, ...official };
    }
    const origin = await originFor(input.near, ctx);
    const list = nearbyAttractions({
      lat: origin.lat,
      lon: origin.lon,
      heading: input.near ? null : ctx.heading,
      radius: clamp(input.radius_m, 50, 20000, 800),
      tag: input.tag,
      limit: clamp(input.limit, 1, 12, 5),
      lang,
    });
    return {
      origin: origin.assumed ? "Rynek Główny (brak lokalizacji użytkownika – założenie)" : origin.name,
      attractions: list.map((x, i) => {
        if (i >= 3) return x;
        const o = officialPublic(x.id);
        if (o) useOfficial(citations, o, [x.name]);
        return o ? { ...x, summary: o.summary || x.summary, facts: o.facts, sources: o.sources } : x;
      }),
      note: "Godziny i ceny konkretnej atrakcji: find_attractions z attraction_id.",
    };
  },

  async look_around(input, { ctx, citations }) {
    if (!hasPosition(ctx)) return { error: "Brak lokalizacji użytkownika – poproś o włączenie GPS." };
    const maxDistance = clamp(input.max_distance_m, 30, 600, 250);
    const lang = ctx.lang;
    if (ctx.heading === null) {
      return {
        note: "Brak danych z kompasu – pokazuję obiekty dookoła. Poproś użytkownika o włączenie kompasu, by wiedzieć, w którą stronę patrzy.",
        around: nearbyAttractions({ lat: ctx.lat, lon: ctx.lon, radius: maxDistance + 200, limit: 5, lang }),
      };
    }
    const curated = attractionsInView({ lat: ctx.lat, lon: ctx.lon, heading: ctx.heading, maxDistance, lang });
    let osm = [];
    try {
      const [attr, hist] = await Promise.all([
        findPlaces({ type: "attraction", lat: ctx.lat, lon: ctx.lon, radius: maxDistance, limit: 40 }),
        findPlaces({ type: "historic", lat: ctx.lat, lon: ctx.lon, radius: maxDistance, limit: 40 }),
      ]);
      const seen = new Set(curated.map((c) => c.name.toLowerCase()));
      osm = [...attr, ...hist]
        .filter((p) => p.distance < 20 || Math.abs(angleDiff(ctx.heading, p.bearing)) <= 35)
        .filter((p) => !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 6)
        .map((p) => ({
          name: p.name,
          distance: p.distance,
          direction: relativeDirection(ctx.heading, p.bearing, lang),
          description: p.description,
          source: "OpenStreetMap",
        }));
      if (citations) {
        await Promise.all(
          osm.slice(0, 3).map(async (p) => {
            const k = await snippetFor(p.name, citations).catch(() => null);
            if (k) p.official_knowledge = k;
          }),
        );
      }
    } catch (err) {
      osm = [{ error: `OpenStreetMap niedostępny: ${err.message}` }];
    }
    return {
      heading: Math.round(ctx.heading),
      in_view_curated: curated.map((c) => {
        const o = officialPublic(c.id);
        if (o) useOfficial(citations, o, [c.name]);
        return o ? { ...c, facts: o.facts, sources: o.sources } : { ...c, facts_unofficial: attractionById.get(c.id)?.facts };
      }),
      in_view_osm: osm,
    };
  },

  async find_places(input, { ctx, citations }) {
    const origin = await originFor(input.near, ctx);
    let places;
    try {
      places = await findPlaces({
        type: input.type,
        lat: origin.lat,
        lon: origin.lon,
        radius: clamp(input.radius_m, 50, 3000, 600),
        limit: clamp(input.limit, 1, 15, 6),
        cuisine: input.cuisine,
        query: input.name,
        diet: input.diet,
      });
    } catch (err) {
      // Awaria usługi to nie to samo co „brak lokali” – model musi to odróżnić.
      return {
        error: `Usługa mapy OpenStreetMap jest chwilowo niedostępna (${err.message}). Nie mów, że w okolicy nie ma lokali – powiedz, że wyszukiwanie chwilowo nie działa, i zaproponuj ponowienie za chwilę.`,
      };
    }
    const heading = input.near ? null : ctx.heading;
    for (const p of places) {
      citations?.use({ ...OSM_SOURCE, names: [p.name] });
      if (p.website) citations?.use({ title: p.name, url: p.website, source: "strona lokalu", names: [p.name] });
    }
    return {
      origin: origin.assumed ? "Rynek Główny (brak lokalizacji użytkownika – założenie)" : origin.name,
      source: "OpenStreetMap – lokalizacja i rodzaj lokalu (nie ma oficjalnego rejestru lokali)",
      note: "Godzin otwarcia ani cen lokali nie podawaj – nie pochodzą z oficjalnych źródeł. Jeśli lokal ma official_website, zaproponuj sprawdzenie godzin i menu na jego stronie.",
      // Godziny z OSM (dane społecznościowe) celowo nie trafiają do agenta.
      places: places.map(({ id, type, openingHours, website, ...p }) => ({
        ...p,
        official_website: website,
        direction: relativeDirection(heading, p.bearing, ctx.lang) || undefined,
      })),
    };
  },

  async plan_route(input, { ctx, emit, citations }) {
    let to;
    if (Number.isFinite(input.destination_lat) && Number.isFinite(input.destination_lon)) {
      to = { lat: input.destination_lat, lon: input.destination_lon, name: input.destination };
    } else {
      const p = await resolvePlace(input.destination);
      if (!p) return { error: `Nie znaleziono celu „${input.destination}”. Dopytaj użytkownika lub użyj search_place.` };
      to = { lat: p.lat, lon: p.lon, name: p.name };
    }
    let from;
    if (input.origin) {
      const p = await resolvePlace(input.origin);
      if (!p) return { error: `Nie znaleziono miejsca startu „${input.origin}”.` };
      from = { lat: p.lat, lon: p.lon, name: p.name };
    } else if (hasPosition(ctx)) {
      from = { lat: ctx.lat, lon: ctx.lon, name: ctx.lang === "en" ? "Your location" : "Twoja pozycja" };
    } else {
      return { error: "Nie znam pozycji użytkownika. Zapytaj, skąd rusza, albo poproś o włączenie GPS." };
    }
    const departAt = Date.now() + clamp(input.depart_in_minutes, 0, 24 * 60, 0) * 60_000;
    const route = await planRoute({ from, to, mode: input.mode || "auto", departAt, lang: ctx.lang });
    emit("action", { type: "route", route });
    citations?.use(route.options.some((o) => o.type === "transit") ? ZTP_SOURCE : OSM_SOURCE);
    return {
      destination: to.name,
      shown_on_map: true,
      warning: route.warning,
      options: summarizeRoute(route, ctx.lang),
      note: "Pierwszy wariant jest zalecany. Użytkownik może wcisnąć „Start” na karcie trasy, by uruchomić nawigację głosową.",
    };
  },

  async get_departures(input, { ctx, citations }) {
    if (!input.stop_name && !hasPosition(ctx)) return { error: "Podaj nazwę przystanku – nie znam pozycji użytkownika." };
    const res = await nextDepartures({ lat: ctx.lat, lon: ctx.lon, stopName: input.stop_name, limit: 30 });
    if (res.error) return res;
    citations?.use(ZTP_SOURCE);
    let deps = res.departures;
    if (input.line) deps = deps.filter((d) => d.line === input.line);
    return {
      stops: res.stops,
      departures: deps.slice(0, 10).map((d) => ({
        line: d.line,
        mode: d.mode,
        direction: d.headsign,
        stop: d.stop,
        platform: d.platform,
        scheduled: fmtClock(d.scheduled),
        in_minutes: d.minutes,
        delay_min: d.delay != null ? Math.round(d.delay / 60) : null,
        distance_m: d.distance,
      })),
    };
  },

  async get_ticket_info(input, { ctx, citations }) {
    const lang = ctx.lang;
    citations?.use({ title: "Taryfa biletowa KMK", url: TICKETS.source, source: "ZTP Kraków" });
    const L = (x) => x.label[lang] || x.label.pl;
    return {
      valid_from: TICKETS.validFrom,
      source: TICKETS.source,
      time_tickets: TICKETS.single.map((t) => ({ name: L(t), normal_pln: t.normal, reduced_pln: t.reduced })),
      passes: TICKETS.passes.map((t) => ({ name: L(t), normal_pln: t.normal, reduced_pln: t.reduced })),
      how_to_buy: TICKETS.howToBuy[lang],
      notes: TICKETS.notes[lang],
      recommendation: Number.isFinite(input.ride_minutes) ? recommendTicket(input.ride_minutes, lang) : undefined,
    };
  },

  async search_place(input) {
    return { results: await searchPlaces(input.query, { limit: 5 }) };
  },

  async show_on_map(input, { emit }) {
    const places = input.places.slice(0, 10);
    emit("action", { type: "markers", places });
    return { shown: places.length };
  },

  async add_to_plan(input, { emit }) {
    emit("action", { type: "plan_add", item: input });
    return { added: input.name };
  },

  async search_knowledge(input, { citations }) {
    if (!citations) return { error: "Baza wiedzy niedostępna w tym trybie." };
    return knowledgeTool(input.query, citations, { limit: clamp(input.limit, 1, 6, 4) });
  },

  async get_events(input, { citations }) {
    const iso = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    const valid = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : null);
    const from = valid(input.date_from) || iso(localYmd());
    const to = valid(input.date_to) || iso(addDays(from.replaceAll("-", ""), 6));
    try {
      const r = await findEvents({ from, to, query: input.query, category: input.category, limit: clamp(input.limit, 1, 10, 6), withDetails: true });
      const source = "krakow.travel – oficjalny kalendarz wydarzeń";
      // Każde wydarzenie z etykietą [K…] – w aplikacji staje się przypisem z linkiem do strony wydarzenia.
      const fetched = r.fetchedAt.slice(0, 10);
      const labeled = citations ? citations.label(r.events.map((e) => ({ ...e, source, fetched }))) : r.events;
      return {
        source,
        range: { from, to },
        total: r.total,
        events: labeled.map(({ label, title, when, category, details, caption }) => ({ label, title, when, category, details: details || caption })),
        note: r.total
          ? "Opisuj wydarzenia WYŁĄCZNIE na podstawie pól when i details (miejsce, program, ceny – tylko jeśli tam są). Po nazwie wydarzenia dodaj jego etykietę, np. [K5] – aplikacja pokaże link do strony wydarzenia."
          : "Brak wydarzeń w oficjalnym kalendarzu w tym terminie.",
      };
    } catch (err) {
      return { error: `Kalendarz wydarzeń krakow.travel jest chwilowo niedostępny (${err.message}). Nie wymyślaj wydarzeń.` };
    }
  },

  async get_weather(input, { citations }) {
    try {
      const w = await getWeather();
      citations?.use({ title: "Dane synoptyczne i ostrzeżenia meteorologiczne", url: "https://danepubliczne.imgw.pl", source: "IMGW-PIB" });
      return w;
    } catch (err) {
      return { error: `Dane IMGW są chwilowo niedostępne (${err.message}). Nie zgaduj pogody.` };
    }
  },

  async remember_preference(input, { emit }) {
    const value = String(input.value || "").trim().slice(0, 120);
    if (!input.forget && !value) return { error: "Podaj value albo forget=true." };
    emit("action", { type: "pref", key: input.key, value: input.forget ? null : value });
    return input.forget ? { forgotten: input.key } : { saved: { [input.key]: value } };
  },
};

export async function runTool(name, input, toolCtx) {
  const def = TOOLS.find((t) => t.name === name);
  const handler = handlers[name];
  if (!def || !handler) return { isError: true, content: `Nieznane narzędzie: ${name}` };
  const problem = validateInput(def.input_schema, input);
  if (problem) return { isError: true, content: JSON.stringify({ INVALID_INPUT: problem, received: input }) };
  try {
    const result = await handler(input, toolCtx);
    const content = JSON.stringify(result);
    toolCtx?.onResult?.(name, input, content);
    return { isError: Boolean(result?.error), content };
  } catch (err) {
    console.warn(`[tool ${name}]`, err.message);
    return { isError: true, content: JSON.stringify({ error: err.message }) };
  }
}
