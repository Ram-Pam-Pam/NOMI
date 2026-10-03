// Drobne elementy interfejsu: powiadomienia (toasty).
import { escapeHtml } from "./format.js";

export function toast(message, { action, onAction, timeout = 4500 } = {}) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button class="btn small" type="button">${escapeHtml(action)}</button>` : ""}`;
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
