// Drobne elementy interfejsu: powiadomienia (toasty) i ikony w statycznym HTML.
import { escapeHtml } from "./format.js";
import { flag, icon } from "./icons.js";

/** Wstawia ikony w elementy z data-icon="nazwa" i flagi w data-flag="pl|en". */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    if (el.dataset.hydrated === el.dataset.icon) continue;
    el.innerHTML = icon(el.dataset.icon);
    el.dataset.hydrated = el.dataset.icon;
  }
  for (const el of root.querySelectorAll("[data-flag]")) {
    if (el.dataset.hydrated === el.dataset.flag) continue;
    el.innerHTML = flag(el.dataset.flag);
    el.dataset.hydrated = el.dataset.flag;
  }
}

export function toast(message, { action, onAction, timeout = 4500, icon: iconName } = {}) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `${iconName ? icon(iconName) : ""}<span>${escapeHtml(message)}</span>${action ? `<button class="btn small" type="button">${escapeHtml(action)}</button>` : ""}`;
  if (action) {
    el.querySelector("button").addEventListener("click", () => {
      onAction?.();
      el.remove();
    });
  }
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), timeout);
  return el;
}
