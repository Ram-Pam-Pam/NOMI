// Przypomnienia o biletach: przed wejściem do pojazdu (nawigacja) i po wykryciu jazdy (GTFS-RT).
import { getJSON } from "./api.js";
import { t } from "./i18n.js";
import { emit, on, state, store } from "./state.js";
import { speak } from "./voice.js";

const HOW = {
  pl: [
    "Biletomat w pojeździe – karta lub gotówka.",
    "Aplikacja: jakdojade, mPay, moBiLET, SkyCash, iMKA lub zbiletem.pl – kup zaraz po wejściu, podając numer pojazdu.",
    "Bilet papierowy z automatu na przystanku skasuj zaraz po wejściu.",
  ],
  en: [
    "Ticket machine inside the vehicle – card or cash.",
    "App: jakdojade, mPay, moBiLET, SkyCash, iMKA or zbiletem.pl – buy right after boarding using the vehicle number.",
    "Validate a paper ticket from a stop machine right after boarding.",
  ],
};

const vehicleName = (mode, line) => `${t(mode === "tram" ? "tram" : "bus")} ${line}`;

let pending = null;

/**
 * Pokazuje przypomnienie (modal + głos). onResult(true) – użytkownik ma bilet.
 */
export function showTicketReminder({ mode, line, ticket, onBoard = false, onResult }) {
  if (!state.settings.tickets) return;
  const dlg = document.getElementById("ticket-modal");
  const vehicle = vehicleName(mode, line);
  const main = onBoard ? t("ticketOnVehicle", { vehicle }) : t("ticketBoardSoon", { vehicle });
  const rec = ticket ? ` ${t("ticketRecommend", { ticket: ticket.label, price: String(ticket.price).replace(".", ",") })}` : "";
  document.getElementById("ticket-text").textContent = main + rec;
  document.getElementById("ticket-how").innerHTML = HOW[state.settings.lang === "en" ? "en" : "pl"].map((h) => `<li>${h}</li>`).join("");
  pending = onResult || null;
  if (!dlg.open) dlg.showModal();
  speak(`${main}${rec}`, { interrupt: true });
  navigator.vibrate?.([120, 80, 120]);
}

export function initTickets() {
  const dlg = document.getElementById("ticket-modal");
  document.getElementById("ticket-ok").addEventListener("click", () => {
    dlg.close();
    store.set("ticketConfirmedAt", Date.now());
    pending?.(true);
    pending = null;
  });
  document.getElementById("ticket-later").addEventListener("click", () => {
    dlg.close();
    pending?.(false);
    pending = null;
  });
  initVehicleDetection();
}

// ------------------------------------------------ wykrywanie jazdy pojazdem (bez nawigacji)

const CHECK_EVERY = 20_000;
const REMIND_COOLDOWN = 45 * 60_000;
let lastCheck = 0;
let candidate = null;
let slowSince = null;

function initVehicleDetection() {
  on("position", async (pos) => {
    const speed = pos.speed ?? 0;
    // Zejście z pojazdu: dłuższy postój / marsz.
    if (state.onVehicle && speed < 1.5) {
      slowSince ??= Date.now();
      if (Date.now() - slowSince > 120_000) {
        state.onVehicle = null;
        emit("on-vehicle", null);
      }
    } else slowSince = null;

    if (pos.simulated || speed < 3 || Date.now() - lastCheck < CHECK_EVERY) return;
    // Podczas nawigacji komunikacją przypomnienia obsługuje navigation.js.
    if (state.nav && state.nav.option.type === "transit") return;
    lastCheck = Date.now();
    let near;
    try {
      near = await getJSON("/api/vehicles", { lat: pos.lat, lon: pos.lon, radius: 70 });
    } catch {
      return;
    }
    const v = near[0];
    if (!v) {
      candidate = null;
      return;
    }
    // Dwa kolejne trafienia tej samej linii = jedziemy tym pojazdem.
    if (candidate && candidate.line === v.line && candidate.mode === v.mode) {
      if (!state.onVehicle || state.onVehicle.line !== v.line) {
        state.onVehicle = { line: v.line, mode: v.mode, since: Date.now() };
        emit("on-vehicle", state.onVehicle);
        const confirmed = store.get("ticketConfirmedAt", 0);
        const reminded = store.get("ticketRemindedAt", 0);
        if (Date.now() - confirmed > REMIND_COOLDOWN && Date.now() - reminded > REMIND_COOLDOWN) {
          store.set("ticketRemindedAt", Date.now());
          showTicketReminder({ mode: v.mode, line: v.line, onBoard: true });
        }
      }
    }
    candidate = { line: v.line, mode: v.mode };
  });
}
