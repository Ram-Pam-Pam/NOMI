// Głos: rozpoznawanie mowy (Web Speech API) i czytanie odpowiedzi na głos.
import { emit, state } from "./state.js";
import { speechLang } from "./i18n.js";

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = Boolean(Recognition);
export const ttsSupported = "speechSynthesis" in window;

// ------------------------------------------------ rozpoznawanie mowy

let recognition = null;

export function isListening() {
  return Boolean(recognition);
}

export function listen({ onInterim, onFinal, onEnd, onError }) {
  if (!sttSupported) {
    onError?.("unsupported");
    return () => {};
  }
  stopSpeaking();
  const rec = new Recognition();
  recognition = rec;
  rec.lang = speechLang();
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onInterim?.(finalText + interim);
  };
  rec.onerror = (e) => {
    if (e.error !== "no-speech" && e.error !== "aborted") onError?.(e.error);
  };
  rec.onend = () => {
    if (recognition === rec) recognition = null;
    const text = finalText.trim();
    if (text) onFinal?.(text);
    onEnd?.(text);
    emit("listening", false);
  };
  try {
    rec.start();
    emit("listening", true);
  } catch (err) {
    recognition = null;
    onError?.(err.message);
  }
  return () => rec.stop();
}

export function stopListening() {
  recognition?.stop();
}

// ------------------------------------------------ synteza mowy

let voice = null;
let queue = [];
let speaking = false;
let streamBuffer = "";
let unlocked = false;

function pickVoice() {
  if (!ttsSupported) return null;
  const lang = speechLang().slice(0, 2);
  const voices = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith(lang));
  const preferred = ["Google", "Natural", "Neural", "Premium", "Enhanced", "Zosia", "Ewa", "Paulina", "Marek"];
  for (const p of preferred) {
    const v = voices.find((x) => x.name.includes(p));
    if (v) return v;
  }
  return voices[0] || null;
}

if (ttsSupported) {
  speechSynthesis.onvoiceschanged = () => (voice = pickVoice());
}

/** Na iOS mowa musi zostać zainicjowana gestem użytkownika – wołamy przy pierwszym kliknięciu. */
export function unlockSpeech() {
  if (!ttsSupported || unlocked) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
}

export function cleanForSpeech(text) {
  return String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s?\[K\d+(?:\s*[,;]\s*K?\d+)*\]/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/→|->/g, ", ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function next() {
  if (speaking || !queue.length) {
    if (!speaking && !queue.length) emit("speaking", false);
    return;
  }
  const text = queue.shift();
  const u = new SpeechSynthesisUtterance(text);
  voice = voice || pickVoice();
  if (voice) u.voice = voice;
  u.lang = speechLang();
  u.rate = 1.03;
  speaking = true;
  emit("speaking", true);
  const done = () => {
    speaking = false;
    next();
  };
  u.onend = done;
  u.onerror = done;
  speechSynthesis.speak(u);
}

/** Dodaje tekst do kolejki mówienia (jeśli głos jest włączony). */
export function speak(text, { force = false, interrupt = false } = {}) {
  if (!ttsSupported || (!state.settings.voice && !force)) return;
  const clean = cleanForSpeech(text);
  if (!clean) return;
  if (interrupt) stopSpeaking();
  // Krótkie fragmenty – obejście ucinania długich wypowiedzi w Chrome.
  for (const part of clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean]) if (part.trim()) queue.push(part.trim());
  next();
}

/** Strumieniowe czytanie: dostaje kolejne fragmenty tekstu i mówi pełne zdania. */
export function speakStream(delta) {
  if (!ttsSupported || !state.settings.voice) return;
  streamBuffer += delta;
  const re = /^([\s\S]*?[.!?…:])(\s+|\n)/;
  let m;
  while ((m = streamBuffer.match(re))) {
    const sentence = m[1];
    streamBuffer = streamBuffer.slice(m[0].length);
    if (sentence.trim().length > 1) speak(sentence);
  }
}

export function flushSpeech() {
  const rest = streamBuffer;
  streamBuffer = "";
  if (rest.trim()) speak(rest);
}

export function stopSpeaking() {
  queue = [];
  streamBuffer = "";
  if (ttsSupported) speechSynthesis.cancel();
  speaking = false;
  emit("speaking", false);
}

export function isSpeaking() {
  return speaking || queue.length > 0;
}
