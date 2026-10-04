// Pogoda z oficjalnego źródła: IMGW-PIB (dane synoptyczne stacji Kraków + ostrzeżenia meteorologiczne).
const API = "https://danepubliczne.imgw.pl/api/data";
const KRAKOW_TERYT = "1261"; // powiat m. Kraków
const TTL = 15 * 60_000;
const WIND = ["północny", "północno-wschodni", "wschodni", "południowo-wschodni", "południowy", "południowo-zachodni", "zachodni", "północno-zachodni"];

let cache = { at: 0, data: null };

async function getJson(path) {
  const res = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`IMGW HTTP ${res.status}`);
  return res.json();
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

export async function getWeather() {
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;
  const [synop, warnings] = await Promise.all([
    getJson("synop/station/krakow"),
    getJson("warningsmeteo").catch(() => null),
  ]);
  const windDir = num(synop.kierunek_wiatru);
  // Czasy ostrzeżeń IMGW są w czasie polskim.
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Warsaw" });
  const data = {
    source: "IMGW-PIB – Instytut Meteorologii i Gospodarki Wodnej (danepubliczne.imgw.pl)",
    station: synop.stacja,
    // Godzina pomiaru IMGW jest w UTC – podajemy czas polski.
    measured_at: new Date(`${synop.data_pomiaru}T${String(synop.godzina_pomiaru).padStart(2, "0")}:00:00Z`).toLocaleString("pl-PL", {
      timeZone: "Europe/Warsaw",
      dateStyle: "short",
      timeStyle: "short",
    }),
    temperature_c: num(synop.temperatura),
    wind_ms: num(synop.predkosc_wiatru),
    wind_direction: windDir === null ? null : WIND[Math.round(windDir / 45) % 8],
    humidity_pct: num(synop.wilgotnosc_wzgledna),
    precipitation_mm: num(synop.suma_opadu),
    pressure_hpa: num(synop.cisnienie),
    warnings: Array.isArray(warnings)
      ? warnings
          .filter((w) => Array.isArray(w.teryt) && w.teryt.includes(KRAKOW_TERYT) && String(w.obowiazuje_do) >= now)
          .map((w) => ({ event: w.nazwa_zdarzenia, level: num(w.stopien), from: w.obowiazuje_od, to: w.obowiazuje_do, text: w.tresc }))
      : null,
    forecast_note:
      "To pomiar z podanej godziny, NIE prognoza. Nie przewiduj pogody na później (np. czy będzie padać) – powiedz, że prognozy nie masz, i odeślij do https://meteo.imgw.pl. Ostrzeżenia IMGW (warnings) obowiązują w podanym czasie.",
  };
  cache = { at: Date.now(), data };
  return data;
}
