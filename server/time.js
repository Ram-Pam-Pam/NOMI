// Czas lokalny Krakowa (Europe/Warsaw) niezależnie od strefy serwera.
const TZ = "Europe/Warsaw";

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const offsetFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" });

function parts(date) {
  const out = {};
  for (const p of partsFmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** Przesunięcie strefy Warszawy względem UTC w minutach dla danej chwili. */
function offsetMinutes(date) {
  const tz = offsetFmt.formatToParts(date).find((p) => p.type === "timeZoneName")?.value || "GMT+1";
  const m = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 60;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** Data lokalna w formacie YYYYMMDD. */
export function localYmd(date = new Date()) {
  const p = parts(date);
  return `${p.year}${p.month}${p.day}`;
}

export function addDays(ymd, n) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + n));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Dzień tygodnia 0=poniedziałek … 6=niedziela. */
export function weekdayOf(ymd) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  return (d.getUTCDay() + 6) % 7;
}

/**
 * Epoka (ms) "dnia służbowego" GTFS: lokalne południe minus 12 h.
 * Dzięki temu czasy GTFS (także > 24:00) są poprawne w dni zmiany czasu.
 */
export function serviceDayEpoch(ymd) {
  const utcNoon = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 12);
  const off = offsetMinutes(new Date(utcNoon));
  return utcNoon - off * 60000 - 12 * 3600000;
}

/** HH:MM dla czasu podanego jako epoka (ms). */
export function fmtClock(epochMs) {
  const p = parts(new Date(epochMs));
  return `${p.hour}:${p.minute}`;
}

/** Czytelny opis "teraz" dla agenta. */
export function describeNow(lang = "pl", date = new Date()) {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
