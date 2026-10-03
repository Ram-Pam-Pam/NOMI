# NOMI – przewodnik AI po Krakowie

Aplikacja webowa (PWA) dla turystów z agentem AI **NOMI** – tekstowym i głosowym. NOMI prowadzi z punktu A do B pieszo i komunikacją miejską (tramwaje, autobusy), wie, gdzie jesteś i w którą stronę patrzysz, sam opowiada o mijanych atrakcjach, przypomina o bilecie i podpowiada, gdzie zjeść.

## Funkcje

| Zakładka | Co robi |
|---|---|
| **NOMI** (agent) | Czat z agentem AI (Sherlock CloudFerro: GPT-OSS + Bielik, albo Claude) – pisany lub mówiony (mikrofon, czytanie odpowiedzi na głos, tryb rozmowy bez rąk). Agent korzysta z narzędzi: trasy, odjazdy na żywo, restauracje i kawiarnie z OpenStreetMap, „co jest przede mną” (GPS + kompas), cennik biletów, pinezki na mapie, dodawanie do planu. |
| **Mapa** | Pozycja ze stożkiem kierunku patrzenia, atrakcje, wyszukiwarka celu, warianty tras (pieszo / tramwaj / autobus) z opóźnieniami na żywo, odjazdy z najbliższego przystanku, tramwaje i autobusy na żywo, szybkie wyszukiwanie: jedzenie, kawa, biletomat, toaleta. |
| **Planer** | Plan dnia układany przez AI wg zainteresowań, czasu i tempa (z przerwami na posiłki), oś czasu z nawigacją do kolejnych punktów; lista atrakcji w pobliżu. |

Działa w czasie rzeczywistym:
- **Nawigacja krok po kroku** z komunikatami głosowymi („Za 40 m skręć w lewo”), strzałką wskazującą kierunek względem tego, gdzie patrzysz, wyznaczaniem nowej trasy po zboczeniu z obecnej oraz fazami „czekaj na tramwaj → jedziesz → wysiadasz na następnym”.
- **Przypomnienia o bilecie** – przed wejściem do pojazdu (z rekomendacją biletu czasowego i ceną) oraz gdy aplikacja wykryje, że jedziesz tramwajem lub autobusem (pozycja użytkownika porównywana z pozycjami pojazdów z GTFS-Realtime).
- **Opowieści o atrakcjach** – po zbliżeniu się do zabytku NOMI sam o nim opowiada (najpierw te w polu widzenia).

## Szybki start

Wymagany Node.js ≥ 20.12.

```bash
npm install
cp .env.example .env        # wpisz LLM_API_KEY (klucz Sherlock CloudFerro)
npm run check:llm           # sprawdza klucz, modele i wywoływanie narzędzi
npm start                   # http://localhost:3000
```

Przy pierwszym starcie serwer pobiera rozkłady GTFS ZTP Kraków (~25 MB) do `data/gtfs/` i buduje z nich sieć połączeń (ok. 5 s). Rozkład jest przebudowywany automatycznie po zmianie doby i odświeżany co 12 h.

Bez klucza API działają mapa, trasy, odjazdy, nawigacja, przypomnienia o biletach, planer uproszczony i opowieści o atrakcjach z bazy faktów; czat AI pokazuje komunikat o brakującym kluczu.

**Tryb demo** (na komputerze bez GPS): `http://localhost:3000/?demo` albo przełącznik w ustawieniach. Kliknięcie w mapę ustawia pozycję, przyciski ⟲ ⟳ obracają kierunek patrzenia, a „▶ Symuluj trasę” przeprowadza wirtualnego turystę po aktywnej trasie (pieszo i tramwajem).

### Telefon (GPS, kompas, mikrofon)

Przeglądarki udostępniają lokalizację, kompas i mikrofon tylko przez **HTTPS** (lub `localhost`). Do testów na telefonie:

- tunel: `npx localtunnel --port 3000` albo `cloudflared tunnel --url http://localhost:3000`, **lub**
- certyfikat w sieci lokalnej (np. [mkcert](https://github.com/FiloSottile/mkcert)) i w `.env`: `HTTPS_KEY=certs/key.pem`, `HTTPS_CERT=certs/cert.pem`.

Na iPhonie kompas włącza się po dotknięciu pigułki „Kompas” (wymóg iOS). Rozpoznawanie mowy działa w Chrome i Safari.

## Konfiguracja (`.env`)

### AI: Sherlock (CloudFerro) – domyślnie

Sherlock udostępnia API zgodne z OpenAI; dane nie są używane do trenowania modeli ani przechowywane, a serwery są w Europie. NOMI używa trzech modeli:

| Zmienna | Domyślnie | Rola |
|---|---|---|
| `LLM_PROVIDER` | `sherlock` | `sherlock`, `openai-compatible` (dowolny serwer zgodny z OpenAI, np. vLLM/Ollama) albo `anthropic` |
| `LLM_API_KEY` | – | Klucz z panelu [sherlock.cloudferro.com](https://sherlock.cloudferro.com) |
| `LLM_BASE_URL` | `https://api-sherlock.cloudferro.com/openai/v1` | |
| `NOMI_CHAT_MODEL` | `openai/gpt-oss-120b` | Rozmowa z narzędziami (trasy, odjazdy, lokale) – mocne function calling |
| `NOMI_NARRATE_MODEL` | `speakleash/Bielik-11B-v3.0-Instruct` | Opowieści o atrakcjach – najlepsza polszczyzna |
| `NOMI_PLAN_MODEL` | `openai/gpt-oss-120b` | Planer dnia (JSON ze schematem) |
| `NOMI_REASONING_EFFORT` / `NOMI_PLAN_REASONING_EFFORT` | `low` / `medium` | Poziom rozumowania gpt-oss |

`npm run check:llm` pokazuje modele dostępne w projekcie i sprawdza, czy wybrane modele wywołują narzędzia, streamują i zwracają JSON; `npm run check:llm -- --all` testuje narzędzia na wszystkich modelach (np. żeby porównać `mistralai/Mistral-Small-4-119B-2603` albo `MiniMaxAI/MiniMax-M2.5` jako model rozmowy). Jeśli serwer odrzuci któryś parametr (np. `reasoning_effort`, `response_format`), NOMI ponowi zapytanie bez niego; bloki rozumowania `<think>` są ukrywane, a wywołania narzędzi zapisane tekstem (`<tool_call>`) – rozpoznawane.

### AI: Claude (alternatywa)

`LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `NOMI_MODEL` (domyślnie `claude-opus-5-5`), `NOMI_EFFORT` (`low`), `NOMI_PLAN_EFFORT` (`medium`), `NOMI_FALLBACKS` (`off` wyłącza serwerowy fallback przy odmowie klasyfikatora).

### Pozostałe

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT`, `HOST` | `3000`, `0.0.0.0` | |
| `OSRM_FOOT_URL`, `OVERPASS_URL`, `NOMINATIM_URL` | publiczne instancje | Własne instancje do produkcji |

## Architektura

```
public/                 Frontend bez kroku budowania (ES modules + Leaflet)
  js/app.js             start, zakładki, ustawienia
  js/sensors.js         GPS (watchPosition) + kompas (DeviceOrientation, kompensacja pochylenia) + tryb demo
  js/agent.js           czat NOMI (SSE), mikrofon, karty akcji agenta
  js/voice.js           Web Speech API: rozpoznawanie mowy, czytanie zdanie po zdaniu w trakcie streamingu
  js/navigation.js      nawigacja w czasie rzeczywistym, zmiana trasy, fazy jazdy, symulacja
  js/tickets.js         przypomnienia o biletach, wykrywanie jazdy pojazdem
  js/proximity.js       automatyczne opowieści o atrakcjach w pobliżu
  js/map.js, mapui.js   mapa, trasy, lokale, pojazdy na żywo, panel wariantów
  js/planner.js         planer dnia
server/
  index.js              Express: REST + strumienie SSE
  agent/nomi.js         wspólna warstwa agenta: sesje (historia tylko dopisywana), opowieści, planer, wybór dostawcy
  agent/openaiCompat.js backend Sherlock / serwerów zgodnych z OpenAI: streaming, narzędzia, JSON
  agent/anthropic.js    backend Claude (Anthropic SDK)
  agent/tools.js        narzędzia agenta (JSON Schema + walidacja wejścia)
  agent/context.js      kontekst czasu rzeczywistego dołączany do każdego pytania (pozycja, kierunek, nawigacja)
  transit/gtfs.js       pobieranie i parsowanie GTFS (A – autobusy MPK, M – Mobilis, T – tramwaje)
  transit/router.js     wyszukiwanie połączeń: Connection Scan Algorithm z przesiadkami pieszymi
  transit/realtime.js   GTFS-Realtime: pozycje pojazdów i opóźnienia
  services/             trasy piesze (OSRM), lokale (Overpass), wyszukiwanie (Nominatim), planer zapasowy
  data/attractions.js   45 atrakcji ze sprawdzonymi faktami (podstawa opowieści – mniej konfabulacji)
  data/tickets.js       taryfa ZTP od 2.03.2026
```

### API serwera

`GET /api/health` · `/api/attractions` · `/api/nearby` · `/api/places?type=restaurant&lat&lon` · `/api/search?q` · `/api/route?fromlat&fromlon&tolat&tolon&mode=auto|walk|transit` · `/api/departures?lat&lon|stop` · `/api/vehicles?bbox=s,w,n,e` · `/api/tickets`
`POST /api/chat` (SSE) · `/api/narrate` (SSE) · `/api/plan` · `/api/chat/reset`

## Testy

```bash
npm test
```

Testy działają offline na atrapach serwerów AI:
- **Sherlock / OpenAI-compatible:**
  - wywołania narzędzi dzielone na fragmenty w streamingu,
  - ukrywanie `<think>`,
  - wywołania `<tool_call>` zapisane tekstem,
  - ponowienie zapytania bez odrzuconego parametru,
  - opowieści (Bielik),
  - planer JSON.
- **Claude:** pętla narzędzi przez prawdziwe SDK.
- **Pozostałe:** parser CSV/GTFS, zmiana czasu, geometria, rekomendacje biletów, walidacja narzędzi.

## Źródła danych i ograniczenia

- Rozkłady i dane na żywo: [GTFS ZTP Kraków](https://gtfs.ztp.krakow.pl) (feed autobusów MPK bywa chwilowo niedostępny w czasie prac serwisowych – wtedy routing działa na rozkładzie bez opóźnień).
- Ceny biletów: [taryfa ZTP od 2 marca 2026](https://ztp.krakow.pl/wszystkie-aktualnosci/kmk/taryfa-biletowa-od-2-marca-wszystkie-dostepne-bilety.html), sposoby zakupu: [ZTP – Buy a KMK ticket](https://ztp.krakow.pl/en/kmk-public-transport/buy-a-kmk-ticket). Przed wdrożeniem zweryfikuj aktualność.
- Mapa, lokale, trasy piesze, wyszukiwanie: OpenStreetMap (kafelki OSM, Overpass, OSRM, Nominatim). Publiczne instancje mają limity – przy ruchu produkcyjnym potrzebne własne lub komercyjne.
- Współrzędne atrakcji są przybliżone (±30 m) – można je doprecyzować w `server/data/attractions.js`.
- Kompas w telefonach bywa niedokładny (zakłócenia magnetyczne); bez kompasu NOMI używa kierunku ruchu z GPS.
