// Komunikacja z serwerem NOMI.
async function parseError(res) {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || `${res.status} ${res.statusText}`);
}

export async function getJSON(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") qs.set(k, v);
  const res = await fetch(`${path}${qs.size ? `?${qs}` : ""}`);
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function postJSON(path, body, { signal } = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

/** POST ze strumieniem Server-Sent Events; onEvent(nazwa, dane) dla każdego zdarzenia. */
export async function streamSSE(path, body, onEvent, { signal } = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw await parseError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      let parsed = {};
      try {
        parsed = data ? JSON.parse(data) : {};
      } catch {
        parsed = { raw: data };
      }
      onEvent(event, parsed);
    }
  }
}
