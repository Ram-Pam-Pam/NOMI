// Automatyczne opowieści o atrakcjach, do których zbliża się użytkownik.
import { agentBusy, narrationMessage } from "./agent.js";
import { streamSSE } from "./api.js";
import { buildContext } from "./context.js";
import { angleDiff, bearing, distance } from "./format.js";
import { t } from "./i18n.js";
import { attractions } from "./map.js";
import { emit, on, sessionId, state, store } from "./state.js";
import { toast } from "./ui.js";
import { flushSpeech, speakStream } from "./voice.js";

const REPEAT_AFTER = 4 * 3600_000; // ta sama atrakcja najwcześniej po 4 h
const GAP = 60_000; // odstęp między kolejnymi opowieściami
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

function check(pos) {
  if (!state.settings.narrate || current || agentBusy()) return;
  if (Date.now() - lastCheck < 4000 || Date.now() - lastNarration < GAP) return;
  lastCheck = Date.now();
  if ((pos.speed ?? 0) > 7 || state.nav?.phase === "ride") return; // w pojeździe za szybko na opowieści

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

export async function narrate(id, { manual = false } = {}) {
  const a = attractions.find((x) => x.id === id);
  if (!a) return;
  if (current) {
    if (!manual) return;
    current.abort();
  }
  lastNarration = Date.now();
  state.recentNarrations = [...state.recentNarrations.filter((r) => r.id !== id), { id, at: Date.now() }].slice(-30);
  store.set("recentNarrations", state.recentNarrations);

  const msg = narrationMessage(`${t("nearby")}: ${a.name}`);
  if (state.activeTab !== "agent") {
    toast(t("narrating", { name: a.name }), { action: t("show"), onAction: () => emit("show-tab", "agent") });
  }
  const controller = new AbortController();
  current = controller;
  let error = null;
  try {
    await streamSSE(
      "/api/narrate",
      { attractionId: id, sessionId: sessionId(), context: buildContext() },
      (event, data) => {
        if (event === "text") {
          msg.append(data.delta);
          speakStream(data.delta);
        } else if (event === "error") error = data.message;
      },
      { signal: controller.signal },
    );
  } catch (err) {
    if (err.name !== "AbortError") error = err.message;
  } finally {
    flushSpeech();
    msg.finish(error);
    if (current === controller) current = null;
  }
}
