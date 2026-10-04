// Tryb dzienny / nocny: "auto" (jak system), "light" albo "dark". Atrybut data-theme na <html>.
import { emit, on, state } from "./state.js";

const media = matchMedia("(prefers-color-scheme: dark)");
const THEME_COLOR = { light: "#ffffff", dark: "#111214" };

export function resolvedTheme() {
  const t = state.settings.theme || "auto";
  return t === "auto" ? (media.matches ? "dark" : "light") : t;
}

let applied = null;

export function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[t]);
  if (t !== applied) {
    const first = applied === null;
    applied = t;
    if (!first) emit("theme", t);
  }
}

export function initTheme() {
  applyTheme();
  media.addEventListener("change", () => (state.settings.theme || "auto") === "auto" && applyTheme());
  on("settings", applyTheme);
}
