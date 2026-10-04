// Opowieści o atrakcjach: automatycznie przy zbliżaniu się, a w trakcie nawigacji – ciekawostki o tym,
// co jest po drodze (gdy do najbliższego skrętu jest daleko; komunikaty nawigacji są wtedy wstrzymane).
import { agentBusy, narrationMessage } from "./agent.js";
import { streamSSE } from "./api.js";
import { buildContext } from "./context.js";
import { angleDiff, bearing, distance, projectOnLine, stripEmoji } from "./format.js";
import { t } from "./i18n.js";
import { attractions } from "./map.js";
import { storyEnd, storyStart, storyWindow } from "./navigation.js";
import { emit, on, sessionId, state, store } from "./state.js";
import { toast } from "./ui.js";
import { speak, ttsSupported, whenSilent } from "./voice.js";

const REPEAT_AFTER = 4 * 3600_000; // ta sama atrakcja najwcześniej po 4 h
const GAP = 60_000; // odstęp między kolejnymi opowieściami
const NAV_GAP = 45_000; // w nawigacji – trochę częściej, bo trasa sama prowadzi obok atrakcji
const ROUTE_NEAR_M = 90; // atrakcja „po drodze”: tyle metrów od linii trasy
const ROUTE_AHEAD_M = 180; // i nie dalej niż tyle od użytkownika
let lastCheck = 0;
let lastNarration = 0;
let current = null;

export function initProximity() {
  on("position", check);
  on("narrate-request", (id) => narrate(id, { manual: true }));
  on("arrived", (dest) => {
    const a = attractions.find((x) => dest && distance(x, dest) < 60);
    if (a) setTimeout(() => narrate(a.id, { manual: true }), 2500);
  });
}

function recentlyNarrated(id) {
  return state.recentNarrations.some((r) => r.id === id && Date.now() - r.at < REPEAT_AFTER);
}

/** Atrakcje blisko trasy przed użytkownikiem (ciekawostki po drodze). */
function onRouteCandidates(pos, win) {
  return attractions
    .filter((a) => !recentlyNarrated(a.id))
    .map((a) => {
      const d = distance(pos, a);
      if (d > ROUTE_AHEAD_M) return null;
      const p = projectOnLine(a, win.geometry);
      if (p.dist > ROUTE_NEAR_M || p.along < win.along - 30) return null;
      return { a, d, score: d + p.dist };
    })
    .filter(Boolean)
    .sort((x, y) => x.score - y.score);
}

function check(pos) {
  if (current || agentBusy()) return;
  const navigating = Boolean(state.nav);
  if (navigating ? !state.settings.navStories : !state.settings.narrate) return;
  if (Date.now() - lastCheck < 4000 || Date.now() - lastNarration < (navigating ? NAV_GAP : GAP)) return;
  lastCheck = Date.now();
  if ((pos.speed ?? 0) > 7 || state.nav?.phase === "ride") return; // w pojeździe za szybko na opowieści

  if (navigating) {
    const win = storyWindow();
    if (!win?.allowed) return;
    const [best] = onRouteCandidates(pos, win);
    if (best) narrate(best.a.id, { onRoute: true });
    return;
  }

  const acc = Math.min(pos.accuracy || 15, 30);
  const candidates = attractions
    .filter((a) => !recentlyNarrated(a.id))
    .map((a) => {
      const d = distance(pos, a);
      const inView = state.heading !== null && Math.abs(angleDiff(state.heading, bearing(pos, a))) < 40;
      return { a, d, score: d - (inView ? 40 : 0) };
    })
    .filter((x) => x.d <= x.a.radius + acc)
    .sort((x, y) => x.score - y.score);
  if (candidates.length) narrate(candidates[0].a.id);
}

export async function narrate(id, { manual = false, onRoute = false } = {}) {
  const a = attractions.find((x) => x.id === id);
  if (!a) return;
  if (current) {
    if (!manual) return;
    current.abort();
  }
  lastNarration = Date.now();
  state.recentNarrations = [...state.recentNarrations.filter((r) => r.id !== id), { id, at: Date.now() }].slice(-30);
  store.set("recentNarrations", state.recentNarrations);

  // W nawigacji opowieść czytamy, jeśli włączone są komunikaty nawigacji (nawet gdy czytanie czatu jest wyłączone).
  const voiceOn = ttsSupported && (state.settings.voice || (state.nav && state.settings.navVoice));
  const story = Boolean(state.nav) && voiceOn && storyStart(a.name);

  const msg = narrationMessage(a.name);
  if (state.activeTab !== "agent") {
    toast(t("narrating", { name: a.name }), { icon: "book", action: t("show"), onAction: () => emit("show-tab", "agent") });
  }
  const controller = new AbortController();
  current = controller;
  let error = null;
  let spoken = false;
  const speakNow = () => {
    if (spoken) return;
    spoken = true;
    if (voiceOn && msg.text().trim()) speak(stripEmoji(msg.text()), { force: true });
  };
  try {
    // Serwer najpierw sprawdza opowieść w faktach, potem wysyła ją w całości ("answer") – czytamy od razu.
    await streamSSE(
      "/api/narrate",
      { attractionId: id, sessionId: sessionId(), context: buildContext(), onRoute },
      (event, data) => {
        if (event === "verifying") msg.pending(t("verifying"));
        else if (event === "answer") {
          msg.show(data.text, data.status);
          speakNow();
        } else if (event === "text") msg.append(data.delta);
        else if (event === "action" && data.type === "sources") msg.setSources(data.sources);
        else if (event === "error") error = data.message;
      },
      { signal: controller.signal },
    );
  } catch (err) {
    if (err.name !== "AbortError") error = err.message;
  } finally {
    if (!error) speakNow(); // zgodność wstecz: serwer bez zdarzenia "answer"
    msg.finish(error);
    if (current === controller) current = null;
    if (story) {
      await whenSilent();
      storyEnd();
    }
  }
}
