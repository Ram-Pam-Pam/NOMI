// Planowanie trasy z A do B: pieszo i/lub komunikacją miejską (tramwaje + autobusy).
import { distance } from "../geo.js";
import { recommendTicket } from "../data/tickets.js";
import { transitJourneys } from "../transit/index.js";
import { walkRoute } from "./walk.js";

const WALK_ONLY_BELOW = 700; // m – bliżej nie ma sensu szukać tramwaju

/**
 * @param {{lat:number, lon:number, name?:string}} from
 * @param {{lat:number, lon:number, name?:string}} to
 * @param {"auto"|"walk"|"transit"} mode
 */
export async function planRoute({ from, to, mode = "auto", departAt = Date.now(), lang = "pl" }) {
  const straight = distance(from.lat, from.lon, to.lat, to.lon);
  const options = [];

  const walk = await walkRoute(from, to);
  const walkOption = {
    type: "walk",
    departure: departAt,
    arrival: departAt + walk.duration * 1000,
    duration: walk.duration,
    distance: walk.distance,
    transfers: 0,
    legs: [{ type: "walk", kind: "direct", from, to, departure: departAt, arrival: departAt + walk.duration * 1000, ...walk }],
  };

  let transitError = null;
  if (mode !== "walk" && straight >= (mode === "transit" ? 300 : WALK_ONLY_BELOW)) {
    const res = await transitJourneys(from, to, departAt, 3);
    if (res.error) transitError = res.error;
    for (const j of res.journeys || []) {
      // Geometria i wskazówki dla odcinków pieszych (równolegle).
      await Promise.all(
        j.legs.map(async (leg) => {
          if (leg.type !== "walk") return;
          if (distance(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon) < 40) {
            Object.assign(leg, { distance: 0, geometry: [[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]], steps: [] });
            return;
          }
          const w = await walkRoute(leg.from, leg.to);
          Object.assign(leg, { distance: w.distance, geometry: w.geometry, steps: w.steps, source: w.source });
        }),
      );
      for (const leg of j.legs) {
        if (leg.type === "transit") leg.geometry = leg.stops.map((s) => [s.lat, s.lon]);
      }
      const rideMin = Math.ceil(j.transitSeconds / 60);
      j.ticket = recommendTicket(rideMin, lang);
      j.distance = j.legs.reduce((a, l) => a + (l.distance || 0), 0);
      options.push(j);
    }
  }

  // Kolejność: w trybie auto pieszo wygrywa, jeśli jest krótko lub komunikacja oszczędza < 5 min.
  const bestTransit = options[0];
  const preferWalk =
    mode === "walk" ||
    !bestTransit ||
    walk.duration <= 15 * 60 ||
    (bestTransit.arrival - walkOption.arrival) / 1000 > -5 * 60;
  if (mode === "transit" && bestTransit) {
    if (walk.duration <= 45 * 60) options.push(walkOption);
  } else if (preferWalk) {
    options.unshift(walkOption);
  } else {
    options.push(walkOption);
  }

  return {
    from,
    to,
    straightDistance: Math.round(straight),
    recommended: 0,
    options,
    warning: transitError || (walk.source === "estimate" ? walk.warning : undefined),
  };
}

/** Zwięzłe podsumowanie trasy dla agenta AI (bez geometrii). */
export function summarizeRoute(route, lang = "pl") {
  const fmt = (ms) =>
    new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" }).format(ms);
  return route.options.slice(0, 3).map((o) => ({
    type: o.type,
    leave: fmt(o.departure),
    arrive: fmt(o.arrival),
    minutes: Math.round(o.duration / 60),
    transfers: o.transfers,
    ticket: o.ticket,
    legs: o.legs.map((l) =>
      l.type === "walk"
        ? { walk_minutes: Math.max(1, Math.round(l.duration / 60)), meters: l.distance, to: l.to.name || "cel" }
        : {
            mode: l.mode,
            line: l.line,
            direction: l.headsign,
            board_at: `${l.from.name}${l.from.platform ? ` (słupek ${l.from.platform})` : ""}`,
            depart: fmt(l.departure),
            alight_at: l.to.name,
            arrive: fmt(l.arrival),
            stops: l.stops.length - 1,
            delay_min: l.delay != null ? Math.round(l.delay / 60) : null,
          },
    ),
  }));
}
