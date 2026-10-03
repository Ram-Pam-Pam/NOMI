import { state } from "./state.js";

const DICT = {
  pl: {
    tagline: "Twój przewodnik po Krakowie",
    gps: "GPS", compass: "Kompas",
    tabPlanner: "Planer", tabMap: "Mapa",
    plannerTitle: "Zaplanuj dzień z NOMI",
    plannerLead: "Powiedz, co lubisz – ułożę trasę z przerwami na jedzenie i dojazdami.",
    startTime: "Start", startFrom: "Skąd", myLocation: "Moja lokalizacja", rynek: "Rynek Główny", station: "Dworzec Główny",
    howLong: "Ile masz czasu?", fullDay: "Cały dzień", interests: "Co cię interesuje?",
    pace: "Tempo", paceRelaxed: "Spokojne", paceNormal: "Normalne", paceIntense: "Intensywne",
    transport: "Poruszanie się", onFoot: "Pieszo", footTransit: "+ tramwaje",
    notes: "Dodatkowe życzenia", notesPh: "np. jedzenie wegetariańskie, wózek dziecięcy, bez muzeów",
    makePlan: "Ułóż plan z NOMI", planning: "NOMI układa plan…", discover: "Odkrywaj w pobliżu", all: "Wszystko",
    searchPh: "Dokąd idziemy?", food: "Jedzenie", coffee: "Kawa", departures: "Odjazdy", liveVehicles: "Pojazdy na żywo",
    ticketMachine: "Biletomat", toilets: "Toaleta",
    demoTitle: "Tryb demo", demoHint: "Kliknij mapę, aby ustawić pozycję.", simulate: "▶ Symuluj trasę", stopSim: "■ Stop",
    listening: "Słucham…", askPh: "Zapytaj NOMI…",
    ticketTitle: "Pamiętaj o bilecie", remindLater: "Przypomnij później", haveTicket: "Mam bilet",
    settings: "Ustawienia", language: "Język", setVoice: "Czytaj odpowiedzi na głos", setConversation: "Tryb rozmowy (słucha po odpowiedzi)",
    setNarrate: "Opowiadaj o mijanych atrakcjach", setTickets: "Przypomnienia o biletach", setDemo: "Tryb demo (pozycja z mapy)",
    compassSetting: "Kompas", enable: "Włącz", enabled: "Włączony", conversation: "Rozmowa", newChat: "Nowa rozmowa", close: "Zamknij",
    // interests
    i_history: "Historia", i_architecture: "Architektura", i_art: "Sztuka", i_museums: "Muzea", i_churches: "Kościoły",
    i_jewish: "Dziedzictwo żydowskie", i_views: "Widoki", i_nature: "Natura", i_food: "Jedzenie", i_nightlife: "Nocne życie",
    i_kids: "Z dziećmi", i_ww2: "II wojna światowa", i_university: "Uniwersytet",
    // chat
    welcome:
      "Cześć, jestem **NOMI** – twój przewodnik po Krakowie. Mogę poprowadzić cię pieszo albo tramwajem, opowiedzieć o tym, co widzisz, i podpowiedzieć, gdzie dobrze zjeść. Pisz albo naciśnij mikrofon i mów.",
    s1: "Co jest przede mną?", s2: "Gdzie dobrze zjeść w pobliżu?", s3: "Jak dojechać na Kazimierz?", s4: "Jaki bilet kupić?",
    s5: "Opowiedz o najbliższej atrakcji", s6: "Co zobaczyć w 2 godziny?",
    you: "Ty", nomi: "NOMI", nearby: "W pobliżu", stop: "Zatrzymaj",
    showOnMap: "Pokaż na mapie", startNav: "Start", navigate: "Prowadź", tellMe: "Opowiedz", addToPlan: "Do planu",
    routeReady: "Trasa gotowa", placesShown: "Miejsca na mapie",
    // map / routes
    walk: "Pieszo", best: "Najlepsza", transit: "Komunikacją", minShort: "min", leave: "Wyjście", arrive: "Przyjazd",
    transfers: "przesiadki", noTransfers: "bez przesiadek", oneTransfer: "1 przesiadka", ticket: "Bilet",
    onTime: "na czas", delayed: "opóźn.", walkTo: "Idź do", ride: "Jedź", direction: "kierunek", getOff: "wysiądź", stopsCount: "przyst.",
    noRoute: "Nie znaleziono trasy.", routeLoading: "Szukam trasy…", noGps: "Włącz GPS albo tryb demo, by ustalić twoją pozycję.",
    departuresTitle: "Najbliższe odjazdy", noDepartures: "Brak odjazdów w najbliższej godzinie.", now: "teraz",
    placesTitle: "W pobliżu", noPlaces: "Nic nie znaleziono w okolicy.", open: "Godziny",
    vehiclesOn: "Pokazuję tramwaje i autobusy na żywo", vehiclesOff: "Ukryto pojazdy",
    // nav
    navStarted: "Nawigacja rozpoczęta.", navArrived: "Jesteś na miejscu", navEnded: "Nawigacja zakończona.",
    rerouting: "Zboczyłeś z trasy – szukam nowej…", turnAround: "Odwróć się – cel jest za tobą.",
    waitFor: "Czekaj na", at: "na przystanku", departsIn: "odjazd za", departsAt: "odjazd", getOffAt: "Wysiadasz na",
    nextStopGetOff: "Na następnym przystanku wysiadasz", stopsLeft: "przystanków do wyjścia", remaining: "zostało",
    // tickets
    ticketBoardSoon: "Za chwilę wsiadasz do: {vehicle}. Kup bilet od razu po wejściu.",
    ticketRecommend: "Polecam: {ticket} za {price} zł.",
    ticketOnVehicle: "Wygląda na to, że jedziesz: {vehicle}. Masz bilet?",
    ticketValidUntil: "Twój bilet czasowy powinien być jeszcze ważny – sprawdź godzinę.",
    tram: "tramwaj", bus: "autobus", line: "linii",
    // plan
    planFrom: "Plan", aiPlan: "AI", simplePlan: "uproszczony", planEmpty: "Ułóż plan albo dodaj atrakcje z listy poniżej.",
    showPlan: "Pokaż plan na mapie", clearPlan: "Wyczyść", visited: "Odwiedzone", remove: "Usuń", findFood: "Znajdź lokale",
    planTips: "Wskazówki", added: "Dodano do planu", myPlan: "Mój plan",
    // misc
    narrating: "NOMI opowiada o: {name}", show: "Pokaż", gpsDenied: "Brak zgody na lokalizację. Włącz ją w ustawieniach przeglądarki albo użyj trybu demo.",
    compassDenied: "Brak dostępu do kompasu.", compassUnsupported: "To urządzenie nie ma kompasu.",
    sttUnsupported: "Rozpoznawanie mowy nie jest dostępne w tej przeglądarce (użyj Chrome lub Safari).",
    serverOk: "Serwer: rozkład {day}, {stops} przystanków.", serverLoading: "Rozkład jazdy się ładuje…", aiMissing: "Brak klucza API modelu AI – czat AI wyłączony.",
    error: "Błąd", m: "m", km: "km",
  },
  en: {
    tagline: "Your guide to Kraków",
    gps: "GPS", compass: "Compass",
    tabPlanner: "Planner", tabMap: "Map",
    plannerTitle: "Plan your day with NOMI",
    plannerLead: "Tell me what you like – I'll build a route with food breaks and transport.",
    startTime: "Start", startFrom: "From", myLocation: "My location", rynek: "Main Square", station: "Main Station",
    howLong: "How much time?", fullDay: "Full day", interests: "What are you into?",
    pace: "Pace", paceRelaxed: "Relaxed", paceNormal: "Normal", paceIntense: "Intense",
    transport: "Getting around", onFoot: "On foot", footTransit: "+ trams",
    notes: "Extra wishes", notesPh: "e.g. vegetarian food, pushchair, no museums",
    makePlan: "Plan it with NOMI", planning: "NOMI is planning…", discover: "Discover nearby", all: "All",
    searchPh: "Where to?", food: "Food", coffee: "Coffee", departures: "Departures", liveVehicles: "Live vehicles",
    ticketMachine: "Ticket machine", toilets: "Toilets",
    demoTitle: "Demo mode", demoHint: "Click the map to set your position.", simulate: "▶ Simulate route", stopSim: "■ Stop",
    listening: "Listening…", askPh: "Ask NOMI…",
    ticketTitle: "Remember your ticket", remindLater: "Remind me later", haveTicket: "I have a ticket",
    settings: "Settings", language: "Language", setVoice: "Read answers aloud", setConversation: "Conversation mode (listens after reply)",
    setNarrate: "Tell me about places I pass", setTickets: "Ticket reminders", setDemo: "Demo mode (position from map)",
    compassSetting: "Compass", enable: "Enable", enabled: "Enabled", conversation: "Conversation", newChat: "New chat", close: "Close",
    i_history: "History", i_architecture: "Architecture", i_art: "Art", i_museums: "Museums", i_churches: "Churches",
    i_jewish: "Jewish heritage", i_views: "Views", i_nature: "Nature", i_food: "Food", i_nightlife: "Nightlife",
    i_kids: "With kids", i_ww2: "WWII", i_university: "University",
    welcome:
      "Hi, I'm **NOMI** – your Kraków guide. I can walk you or take you by tram, tell you about what you're looking at, and suggest where to eat. Type or tap the mic and talk.",
    s1: "What's in front of me?", s2: "Where to eat nearby?", s3: "How do I get to Kazimierz?", s4: "Which ticket should I buy?",
    s5: "Tell me about the nearest sight", s6: "What to see in 2 hours?",
    you: "You", nomi: "NOMI", nearby: "Nearby", stop: "Stop",
    showOnMap: "Show on map", startNav: "Start", navigate: "Navigate", tellMe: "Tell me", addToPlan: "Add to plan",
    routeReady: "Route ready", placesShown: "Places on the map",
    walk: "Walk", best: "Best", transit: "Public transport", minShort: "min", leave: "Leave", arrive: "Arrive",
    transfers: "transfers", noTransfers: "direct", oneTransfer: "1 transfer", ticket: "Ticket",
    onTime: "on time", delayed: "late", walkTo: "Walk to", ride: "Take", direction: "towards", getOff: "get off", stopsCount: "stops",
    noRoute: "No route found.", routeLoading: "Finding a route…", noGps: "Turn on GPS or demo mode so I know where you are.",
    departuresTitle: "Next departures", noDepartures: "No departures in the next hour.", now: "now",
    placesTitle: "Nearby", noPlaces: "Nothing found nearby.", open: "Hours",
    vehiclesOn: "Showing live trams and buses", vehiclesOff: "Vehicles hidden",
    navStarted: "Navigation started.", navArrived: "You have arrived", navEnded: "Navigation ended.",
    rerouting: "Off route – finding a new one…", turnAround: "Turn around – your destination is behind you.",
    waitFor: "Wait for", at: "at", departsIn: "leaves in", departsAt: "leaves at", getOffAt: "Get off at",
    nextStopGetOff: "Get off at the next stop", stopsLeft: "stops to go", remaining: "left",
    ticketBoardSoon: "You're about to board: {vehicle}. Buy a ticket right after boarding.",
    ticketRecommend: "I recommend: {ticket} for {price} PLN.",
    ticketOnVehicle: "Looks like you're riding: {vehicle}. Got a ticket?",
    ticketValidUntil: "Your time ticket should still be valid – check the time.",
    tram: "tram", bus: "bus", line: "line",
    planFrom: "Plan", aiPlan: "AI", simplePlan: "basic", planEmpty: "Make a plan or add sights from the list below.",
    showPlan: "Show plan on map", clearPlan: "Clear", visited: "Visited", remove: "Remove", findFood: "Find places",
    planTips: "Tips", added: "Added to plan", myPlan: "My plan",
    narrating: "NOMI is telling you about: {name}", show: "Show", gpsDenied: "Location permission denied. Enable it in browser settings or use demo mode.",
    compassDenied: "Compass access denied.", compassUnsupported: "This device has no compass.",
    sttUnsupported: "Speech recognition isn't available in this browser (use Chrome or Safari).",
    serverOk: "Server: timetable {day}, {stops} stops.", serverLoading: "Timetable is loading…", aiMissing: "No AI API key – AI chat disabled.",
    error: "Error", m: "m", km: "km",
  },
};

export function t(key, vars) {
  const lang = state.settings.lang;
  let s = DICT[lang]?.[key] ?? DICT.pl[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function applyI18n(root = document) {
  document.documentElement.lang = state.settings.lang;
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
}

export const speechLang = () => (state.settings.lang === "en" ? "en-GB" : "pl-PL");
