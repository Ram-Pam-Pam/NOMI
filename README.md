# NOMI – przewodnik AI po Krakowie

Aplikacja webowa (PWA) dla turystów z agentem AI **NOMI** – tekstowym i głosowym. NOMI prowadzi z punktu A do B pieszo i komunikacją miejską (tramwaje, autobusy), wie, gdzie jesteś i w którą stronę patrzysz, sam opowiada o mijanych atrakcjach, przypomina o bilecie i podpowiada, gdzie zjeść.

## Funkcje

| Zakładka | Co robi |
|---|---|
| **NOMI** (agent) | Koleżeński przewodnik „na każde zawołanie”. **Każda odpowiedź jest sprawdzana w oficjalnych źródłach** (twierdzenia bez pokrycia są usuwane lub poprawiane), a źródła są wypisane na końcu odpowiedzi. Czat z agentem AI (Sherlock CloudFerro: GPT-OSS + Bielik, albo Claude) – pisany lub mówiony (mikrofon, czytanie odpowiedzi na głos, tryb rozmowy bez rąk). Agent ma **bazę wiedzy z ~440 oficjalnych stron** (krakow.travel, krakow.pl, muzea, ZTP) – fragmenty pasujące do pytania dostaje automatycznie, a w odpowiedzi pokazuje przypisy z linkami do źródeł. Narzędzia: trasy, odjazdy na żywo, restauracje i kawiarnie z OpenStreetMap, „co jest przede mną” (GPS + kompas), cennik biletów, **wydarzenia** (kalendarz krakow.travel), **pogoda i ostrzeżenia IMGW**, przeszukiwanie bazy wiedzy, **zapamiętywanie preferencji** (dieta, poruszanie się, zainteresowania), pinezki na mapie, dodawanie do planu. Nad polem wpisywania – stały pasek podstawowych pytań („Co jest przede mną?”, „Opowiedz o najbliższej atrakcji”, „Gdzie dobrze zjeść?”, bilety, wydarzenia, pogoda…), a pod odpowiedziami – podpowiedzi zależne od tematu. |
| **Mapa** | MapLibre GL (tylko 2D) z wektorowymi mapami OpenFreeMap. Domyślnie bez znaczników – tylko twoja pozycja z promieniem patrzenia. Wyszukiwarka celu, warianty tras (pieszo / tramwaj / autobus) z opóźnieniami na żywo, rozróżnienie środków transportu na mapie. Szybkie przyciski: atrakcje, jedzenie, informacja turystyczna, toaleta, biletomat, bankomat/kantor, apteka. |
| **Planer** | Trzy kroki: ile masz czasu → co lubisz → „Ułóż plan”. AI układa plan wg zainteresowań i **oficjalnych godzin otwarcia**, a serwer wyznacza **prawdziwe trasy między punktami** (pieszo po ulicach, dłuższe odcinki tramwajem/autobusem wg rozkładu ZTP) i przelicza godziny. Plan to oś trasy z odcinkami (kliknięcie = odcinek na mapie), rozwijanymi kartami miejsc (oficjalne godziny, ceny, źródło), zmianą kolejności i usuwaniem – po każdej zmianie trasy przeliczają się na nowo. |

Działa w czasie rzeczywistym:
- **Nawigacja krok po kroku** z komunikatami głosowymi („Za 40 m skręć w lewo”), strzałką wskazującą kierunek względem tego, gdzie patrzysz, wyznaczaniem nowej trasy po zboczeniu z obecnej oraz fazami „czekaj na tramwaj → jedziesz → wysiadasz na następnym”.
- **Przypomnienia o bilecie** – przed wejściem do pojazdu (z rekomendacją biletu czasowego i ceną) oraz gdy aplikacja wykryje, że jedziesz tramwajem lub autobusem (pozycja użytkownika porównywana z pozycjami pojazdów z GTFS-Realtime).
- **Opowieści o atrakcjach** – po zbliżeniu się do zabytku NOMI sam o nim opowiada (najpierw te w polu widzenia).
- **Ciekawostki po drodze w nawigacji** – gdy trasa prowadzi obok atrakcji, a do najbliższego skrętu jest daleko (≥ 110 m), NOMI opowiada krótką ciekawostkę. Na ten czas komunikaty „gdzie skręcić” są wstrzymane (zamiast nich krótka wibracja, na banerze: „NOMI opowiada ciekawostkę”), a po opowieści NOMI wraca do trasy, czytając bieżącą instrukcję. Komunikaty krytyczne (wysiadka, cel) nie są wstrzymywane. Wyłącznik: „Ciekawostki po drodze w nawigacji” w ustawieniach.

Wygląd: styl nowoczesny i minimalistyczny (font Inter, ikony liniowe zamiast emoji), **tryb dzienny i nocny** (przycisk słońce/księżyc w górnym pasku albo Ustawienia → Wygląd: Auto / Dzienny / Nocny – razem z mapą), **język zmieniany flagą** w górnym pasku (PL / EN).

## Szybki start

Wymagany Node.js ≥ 20.12.

```bash
npm install
cp .env.example .env        # wpisz LLM_API_KEY (klucz Sherlock CloudFerro)
npm run check:llm           # sprawdza klucz, modele i wywoływanie narzędzi
npm run rag:build           # buduje bazę wiedzy z oficjalnych stron (ok. 5 min; inaczej serwer zrobi to w tle)
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
| `OFFICIAL_TTL_HOURS` | `72` | Jak często odświeżać dane z oficjalnych stron |
| `RAG_EMBED_MODEL` | `BAAI/bge-multilingual-gemma2` | Model embeddingów bazy wiedzy (Sherlock); `off` – samo wyszukiwanie słów kluczowych |
| `RAG_TTL_DAYS` | `7` | Co ile dni przebudowywać bazę wiedzy w tle |
| `NOMI_DATA_DIR` | `data/` | Katalog na rozkłady GTFS i dane oficjalne |
| `NOMI_VERIFY` | włączone | `off` wyłącza sprawdzanie odpowiedzi w źródłach |
| `NOMI_VERIFY_EFFORT` | `medium` | Staranność sprawdzania (`low` szybciej, ale gorzej wyłapuje przeniesione fakty) |

## Architektura

```
public/                 Frontend bez kroku budowania (ES modules + MapLibre GL)
  js/app.js             start, zakładki, ustawienia
  js/sensors.js         GPS (watchPosition) + kompas (DeviceOrientation, kompensacja pochylenia) + tryb demo
  js/agent.js           czat NOMI (SSE), mikrofon, karty akcji, stan sprawdzenia w źródłach, przypisy i lista źródeł
  js/icons.js           ikony liniowe (SVG) i flagi; js/theme.js – tryb dzienny/nocny
  js/voice.js           Web Speech API: rozpoznawanie mowy, czytanie zdanie po zdaniu w trakcie streamingu
  js/navigation.js      nawigacja w czasie rzeczywistym, zmiana trasy, fazy jazdy, symulacja
  js/tickets.js         przypomnienia o biletach, wykrywanie jazdy pojazdem
  js/proximity.js       automatyczne opowieści o atrakcjach w pobliżu
  js/map.js, mapui.js   mapa MapLibre (2D): warstwy tras i planu, znaczniki, panel wariantów tras
  js/planner.js         planer dnia
server/
  index.js              Express: REST + strumienie SSE
  agent/nomi.js         wspólna warstwa agenta: sesje (historia tylko dopisywana), opowieści, planer, wybór dostawcy
  agent/openaiCompat.js backend Sherlock / serwerów zgodnych z OpenAI: streaming, narzędzia, JSON
  agent/anthropic.js    backend Claude (Anthropic SDK)
  agent/tools.js        narzędzia agenta (JSON Schema + walidacja wejścia)
  agent/context.js      kontekst czasu rzeczywistego dołączany do każdego pytania (pozycja, kierunek, nawigacja, preferencje)
  agent/knowledge.js    wiedza dla agenta: automatyczny dobór fragmentów, etykiety cytowań [K1], źródła narzędzi, podpowiedzi pytań
  agent/verify.js       sprawdzanie odpowiedzi w dowodach tury + sprzątanie „zbugowanych” odpowiedzi
  rag/                  baza wiedzy: sources.js (oficjalne strony), text.js (fragmenty, BM25, RRF), embed.js, index.js (budowa, wyszukiwanie)
  transit/gtfs.js       pobieranie i parsowanie GTFS (A – autobusy MPK, M – Mobilis, T – tramwaje)
  transit/router.js     wyszukiwanie połączeń: Connection Scan Algorithm z przesiadkami pieszymi
  transit/realtime.js   GTFS-Realtime: pozycje pojazdów i opóźnienia
  services/             trasy piesze (OSRM), lokale (Overpass), wyszukiwanie (Nominatim), planer zapasowy,
                        planRouting.js – trasy między punktami planu i przeliczony harmonogram,
                        official.js – dane z oficjalnych stron, events.js – kalendarz krakow.travel, weather.js – IMGW
  data/attractions.js   45 atrakcji ze sprawdzonymi faktami (podstawa opowieści – mniej konfabulacji)
  data/tickets.js       taryfa ZTP od 2.03.2026
```

### API serwera

`GET /api/health` · `/api/attractions` · `/api/nearby` · `/api/places?type=restaurant&lat&lon` · `/api/search?q` · `/api/route?fromlat&fromlon&tolat&tolon&mode=auto|walk|transit` · `/api/departures?lat&lon|stop` · `/api/vehicles?bbox=s,w,n,e` · `/api/tickets`
`POST /api/chat` (SSE) · `/api/narrate` (SSE) · `/api/plan` (plan z trasami) · `/api/plan/route` (przeliczenie tras po edycji planu) · `/api/chat/reset` · `GET /api/official/:id` · `GET /api/knowledge?q=` (podgląd wyszukiwania w bazie wiedzy)

## Oficjalne źródła danych

Godziny otwarcia, ceny biletów wstępu, zasady zwiedzania i fakty historyczne pochodzą wyłącznie z oficjalnych stron:

- **instytucje zarządzające obiektami** – m.in. Muzeum Krakowa, Muzeum Narodowe w Krakowie, Zamek Królewski na Wawelu, Katedra Wawelska, Bazylika Mariacka, Muzeum UJ Collegium Maius, Ogród Botaniczny UJ, Kopiec Kościuszki, MOCAK, Manggha, Muzeum Lotnictwa Polskiego, Muzeum Archeologiczne, Sanktuarium na Skałce;
- **oficjalny portal turystyczny Krakowa** [krakow.travel](https://krakow.travel) (prowadzony przez Krakowskie Biuro Festiwalowe na rzecz Gminy Miejskiej Kraków) – opisy i fakty;
- **ZTP Kraków** – rozkłady jazdy, opóźnienia, ceny biletów komunikacji.

Mapa źródeł jest w `server/data/officialSources.js`. Serwer pobiera strony, czyści HTML i za pomocą modelu AI wyciąga z nich wyłącznie to, co jest w ich treści (zakaz uzupełniania z wiedzy modelu); wynik z listą źródeł i datą pobrania trafia do `data/official/`. Dane są odświeżane w tle (co `OFFICIAL_TTL_HOURS`, domyślnie 72 h; model jest wywoływany tylko, gdy treść strony się zmieniła). Ręcznie: `npm run official:refresh` (`-- --force` – wszystko od nowa, `-- barbakan mariacki` – wybrane).

### Baza wiedzy (RAG)

Oprócz danych strukturalnych o 45 atrakcjach NOMI ma bazę wiedzy z pełnych treści oficjalnych stron: wszystkie obiekty z przewodnika krakow.travel (zabytki, muzea, kościoły, przyroda, miejsca pamięci…) i jego artykuły praktyczne, artykuły turystyczne serwisu miejskiego krakow.pl (trasy tematyczne, poruszanie się po mieście, dojazd), strony oddziałów Muzeum Krakowa i Muzeum Narodowego, strony instytucji z `officialSources.js` i ZTP.

- **Budowa** (`npm run rag:build`, w tle co `RAG_TTL_DAYS`): pobranie stron (3 naraz, z przerwami), czyszczenie HTML, podział na fragmenty ok. 900 znaków wzdłuż akapitów, embeddingi `bge-multilingual-gemma2` przez Sherlock (przy przebudowie liczone tylko dla zmienionych fragmentów). Wynik w `data/rag/` (~6 MB; wektory int8). Gdy pobierze się wyraźnie mniej stron niż poprzednio, stary indeks zostaje.
- **Wyszukiwanie hybrydowe**: wektory (znaczenie, pytania po angielsku) + BM25 z polskim stemmingiem (nazwy własne) + dopasowanie tytułu strony, łączone metodą RRF; maks. 2 fragmenty z jednej strony.
- **W rozmowie**: do każdego pytania serwer dobiera do 4 fragmentów powyżej progu trafności (krótkie odpowiedzi typu „chcę” łączy z ostatnią wypowiedzią NOMI). Fragmenty mają etykiety `[K1]`, `[K2]`… – NOMI cytuje je w odpowiedzi, a aplikacja zamienia je na przypisy z listą źródeł (syntezator ich nie czyta). Gdy to za mało, agent sam wywołuje `search_knowledge`.
- **Ocena**: `npm run rag:eval` – 30 pytań turystów (PL/EN) z oczekiwanymi stronami: hit@1/3/5 i MRR dla BM25, wektorów i hybrydy oraz podobieństwo dla pytań spoza tematu (kalibracja progu). Wynik na obecnym indeksie (433 strony, 1457 fragmentów): hybryda hit@1 90%, hit@3 100%, MRR 0,94 (samo BM25: 67%, 87%, 0,78). `-- --model <nazwa>` porównuje inny model embeddingów (`e5-mistral-7b-instruct`: hit@3 47%; `stella-pl-retrieval-8k` na Sherlocku nie rozróżnia tekstów).

### Sprawdzanie każdej odpowiedzi

Po wygenerowaniu odpowiedzi (czat i opowieści) serwer przekazuje ją weryfikatorowi (ten sam dostawca AI, `NOMI_VERIFY_EFFORT`) razem z **dowodami tej tury**: fragmentami oficjalnych stron, wynikami narzędzi (rozkłady ZTP, taryfa, dane instytucji, OSM, IMGW, kalendarz wydarzeń), kontekstem z telefonu i danymi z poprzednich tur. Każde twierdzenie faktograficzne (liczby, ceny, godziny, daty, nazwy, adresy, historia, legendy, opisy lokali) musi wynikać z dowodów – inaczej jest usuwane albo poprawiane; gdy po poprawce brakuje odpowiedzi, NOMI mówi wprost, że nie ma oficjalnej informacji. Weryfikator wyłapuje też fakty „przeniesione” (data z innego zdarzenia).

- **Najpierw sprawdzenie, potem odpowiedź.** Serwer nie przesyła tekstu modelu w trakcie pisania – zbiera go, sprawdza i dopiero wtedy wysyła jedną gotową odpowiedź (zdarzenie SSE `answer`). W międzyczasie aplikacja pokazuje stan: „Myślę…” → używane narzędzia → „Sprawdzam w oficjalnych źródłach…”. Dzięki temu tekst nie podmienia się ani nie urywa w trakcie, a głos od razu czyta całość. Odpowiedzią jest ostatnia runda modelu (wtrącenia typu „Już sprawdzam…” sprzed wywołania narzędzia są pomijane). Pod odpowiedzią: „Sprawdzone w oficjalnych źródłach” albo „Poprawione po sprawdzeniu”; w historii rozmowy zapisywana jest wersja sprawdzona.
- Na końcu odpowiedzi – lista źródeł: cytowane fragmenty bazy wiedzy (przypisy w tekście) i źródła danych narzędzi, o których odpowiedź mówi (strony instytucji, ZTP, IMGW, OpenStreetMap).
- Sprzątanie odpowiedzi: ukryte bloki modelu, znaczniki, wymyślone etykiety cytowań, emoji, puste linie; pusta odpowiedź → prośba o ponowienie pytania.
- Gdy weryfikator jest niedostępny, odpowiedź jest pokazana z ostrzeżeniem „Nie udało się sprawdzić w źródłach”.

NOMI podaje godziny i ceny tylko z tych danych i mówi, skąd pochodzą; jeśli ich brak – odsyła do oficjalnej strony. Lokale gastronomiczne nie mają oficjalnego rejestru – są wyszukiwane w OpenStreetMap, a NOMI zaznacza, że godziny warto potwierdzić na stronie lokalu.

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
  - planer JSON,
  - baza wiedzy: fragmenty dołączone do pytania, cytaty → źródła, numeracja etykiet w sesji, `search_knowledge`,
  - sprawdzanie odpowiedzi: poprawka niepopartych twierdzeń, poprawiona wersja w historii, awaria weryfikatora, opowieść po drodze bez pytania.
- **Claude:** pętla narzędzi przez prawdziwe SDK.
- **Baza wiedzy:** podział na fragmenty, BM25 z odmianą polską, RRF i ranking hybrydowy, kwantyzacja wektorów, cytowania, zapytania dla krótkich odpowiedzi, podpowiedzi, daty wydarzeń.
- **Pozostałe:** parser CSV/GTFS, zmiana czasu, geometria, rekomendacje biletów, walidacja narzędzi.

## Źródła danych i ograniczenia

- Rozkłady i dane na żywo: [GTFS ZTP Kraków](https://gtfs.ztp.krakow.pl) (feed autobusów MPK bywa chwilowo niedostępny w czasie prac serwisowych – wtedy routing działa na rozkładzie bez opóźnień).
- Ceny biletów: [taryfa ZTP od 2 marca 2026](https://ztp.krakow.pl/wszystkie-aktualnosci/kmk/taryfa-biletowa-od-2-marca-wszystkie-dostepne-bilety.html), sposoby zakupu: [ZTP – Buy a KMK ticket](https://ztp.krakow.pl/en/kmk-public-transport/buy-a-kmk-ticket). Przed wdrożeniem zweryfikuj aktualność.
- Mapa: MapLibre GL z wektorowymi kafelkami [OpenFreeMap](https://openfreemap.org) (bez klucza API; przy niedostępności – rastrowe kafelki OSM). Lokale, trasy piesze, wyszukiwanie: OpenStreetMap (Overpass, OSRM, Nominatim). Publiczne instancje mają limity – przy ruchu produkcyjnym potrzebne własne lub komercyjne.
- Współrzędne atrakcji są przybliżone (±30 m) – można je doprecyzować w `server/data/attractions.js`.
- Kompas w telefonach bywa niedokładny (zakłócenia magnetyczne); bez kompasu NOMI używa kierunku ruchu z GPS.
- Głosowe komunikaty nawigacji można wyłączyć przyciskiem z głośnikiem na banerze nawigacji albo w ustawieniach (niezależnie od czytania odpowiedzi czatu).
- Lokale i obiekty z OpenStreetMap: publiczne serwery Overpass bywają przeciążone (połączenie > 10 s, zapytanie – minuta), więc aplikacja nie odpytuje ich w chwili kliknięcia. Serwer trzyma **migawkę miejsc dla całego Krakowa** w `data/osm/` (usługi: apteki, toalety, bankomaty i kantory, biletomaty, informacja turystyczna; jedzenie; zwiedzanie), pobieraną w tle przy starcie z kilku serwerów Overpass (`OVERPASS_URLS` albo publiczny + zapasowe) i odświeżaną co tydzień. Przyciski na mapie i narzędzie agenta filtrują ją lokalnie – od razu. Dopóki migawki nie ma (pierwsze uruchomienie, kilka minut), działa zapytanie o okolicę z pamięcią 2 h i rozgrzewaniem (`POST /api/warm` po ustaleniu pozycji). Stan migawek: `GET /api/health` → `places`.
- Pogoda: publiczne API IMGW-PIB daje aktualny pomiar ze stacji Kraków i ostrzeżenia – bez prognozy (NOMI odsyła wtedy do meteo.imgw.pl). Wydarzenia: kalendarz krakow.travel (odświeżany co 6 h).
- Zmiana układu oficjalnej strony może zubożyć wyciągnięte dane – po `npm run official:refresh` warto przejrzeć wynik; niedostępne strony nie nadpisują ostatnich poprawnych danych.
