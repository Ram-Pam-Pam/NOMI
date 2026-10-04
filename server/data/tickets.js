// Taryfa Komunikacji Miejskiej w Krakowie (KMK) obowiązująca od 2 marca 2026 r.
// Źródło: https://ztp.krakow.pl/wszystkie-aktualnosci/kmk/taryfa-biletowa-od-2-marca-wszystkie-dostepne-bilety.html
// Zasady zakupu: https://ztp.krakow.pl/en/kmk-public-transport/buy-a-kmk-ticket
// Przed wdrożeniem produkcyjnym zweryfikuj ceny – taryfy się zmieniają.

export const TICKETS = {
  validFrom: "2026-03-02",
  currency: "PLN",
  source: "https://ztp.krakow.pl/wszystkie-aktualnosci/kmk/taryfa-biletowa-od-2-marca-wszystkie-dostepne-bilety.html",
  single: [
    { id: "15min", minutes: 15, normal: 4, reduced: 2, label: { pl: "bilet 15-minutowy", en: "15-minute ticket" } },
    { id: "30min", minutes: 30, normal: 6, reduced: 3, label: { pl: "bilet 30-minutowy", en: "30-minute ticket" } },
    { id: "60min", minutes: 60, normal: 8, reduced: 4, label: { pl: "bilet 60-minutowy", en: "60-minute ticket" } },
    { id: "90min", minutes: 90, normal: 9, reduced: 4.5, label: { pl: "bilet 90-minutowy", en: "90-minute ticket" } },
    { id: "1ride", minutes: null, normal: 6, reduced: 3, label: { pl: "bilet jednoprzejazdowy", en: "single-ride ticket" } },
  ],
  passes: [
    { id: "24h", normal: 20, reduced: 10, label: { pl: "24-godzinny (strefa I)", en: "24-hour (zone I)" } },
    { id: "24h-all", normal: 25, reduced: 12.5, label: { pl: "24-godzinny (strefy I+II+III)", en: "24-hour (zones I+II+III)" } },
    { id: "48h", normal: 40, reduced: 20, label: { pl: "48-godzinny", en: "48-hour" } },
    { id: "72h", normal: 55, reduced: 27.5, label: { pl: "72-godzinny", en: "72-hour" } },
    { id: "7d", normal: 65, reduced: 32.5, label: { pl: "7-dniowy (strefa I)", en: "7-day (zone I)" } },
    { id: "7d-all", normal: 80, reduced: 40, label: { pl: "7-dniowy (strefy I+II+III)", en: "7-day (zones I+II+III)" } },
    { id: "family-weekend", normal: 25, reduced: null, label: { pl: "weekendowy rodzinny", en: "family weekend ticket" } },
    { id: "group", normal: 50, reduced: 25, label: { pl: "grupowy do 20 osób (strefa I)", en: "group up to 20 people (zone I)" } },
  ],
  howToBuy: {
    pl: [
      "Biletomat w pojeździe – płatność kartą lub gotówką (zgodnie z piktogramem na drzwiach). Kup bilet od razu po wejściu.",
      "Aplikacje mobilne: mPay, iMKA, moBiLET, SkyCash, jakdojade, zbiletem.pl. Bilet mobilny trzeba kupić natychmiast po wejściu do pojazdu – podajesz numer pojazdu (2 litery + 3 cyfry) albo skanujesz kod QR w pojeździe. Konto w aplikacji załóż i doładuj przed wejściem.",
      "Automaty stacjonarne KKM/MKA na przystankach. Bilet papierowy do kasowania skasuj w kasowniku zaraz po wejściu.",
    ],
    en: [
      "Ticket machine inside the vehicle – card or cash (see the pictogram on the doors). Buy right after boarding.",
      "Mobile apps: mPay, iMKA, moBiLET, SkyCash, jakdojade, zbiletem.pl. A mobile ticket must be bought immediately after boarding – enter the vehicle number (2 letters + 3 digits) or scan the QR code inside. Set up and top up the app before boarding.",
      "Stationary KKM/MKA machines at stops. Validate a paper ticket in the validator right after boarding.",
    ],
  },
  notes: {
    pl: [
      "Bilety czasowe pozwalają na przesiadki w czasie ich ważności.",
      "Ulgi przysługują osobom uprawnionym (np. polskim studentom i uczniom) – trzeba mieć dokument uprawniający.",
    ],
    en: [
      "Time-based tickets allow transfers within their validity period.",
      "Reduced fares are only for eligible passengers (e.g. Polish students) with a valid ID.",
    ],
  },
};

/** Rekomendacja biletu dla podróży o danym czasie jazdy (minuty, od wejścia do wyjścia z ostatniego pojazdu). */
export function recommendTicket(rideMinutes, lang = "pl") {
  const buffer = rideMinutes + 5; // zapas na opóźnienia
  const t = TICKETS.single.find((x) => x.minutes && x.minutes >= buffer);
  if (t) return { id: t.id, label: t.label[lang] || t.label.pl, price: t.normal, reduced: t.reduced };
  const day = TICKETS.passes[0];
  return { id: day.id, label: day.label[lang] || day.label.pl, price: day.normal, reduced: day.reduced };
}
