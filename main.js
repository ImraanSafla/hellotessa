import { parseSentences } from "./sentence-parser.js";

const appEl = document.getElementById("app");
const textInput = document.getElementById("textInput");
const highlightLayer = document.getElementById("highlightLayer");
const prevBtn = document.getElementById("prevBtn");
const playPauseBtn = document.getElementById("playPauseBtn");
const nextBtn = document.getElementById("nextBtn");
const pasteClearBtn = document.getElementById("pasteClearBtn");
const wordCountEl = document.getElementById("wordCount");
const speedPills = [...document.querySelectorAll(".speed-pill")];

const SPEED_OPTIONS = [1, 1.2, 1.5, 1.8, 2];
const DEFAULT_PITCH = 0.9;
const BASE_WPM_AT_1X = 180;
const state = {
  text: "",
  sentences: [],
  wordCount: 0,
  speaking: false,
  paused: false,
  speechReady: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
  voice: null,
  rate: 1.5,
  sentenceIndex: 0,
  cursorIntent: 0,
  currentCharIndex: 0,
  currentUtterance: null,
  currentSentenceStartChar: 0,
  boundarySupported: false,
  boundarySeen: false,
  lastBackAt: 0,
  stopRequested: false
};

boot();

function boot() {
  if (!state.speechReady) {
    playPauseBtn.disabled = true;
    playPauseBtn.textContent = "Unavailable";
  }
  wireEvents();
  updateFromText("");
  updateSkipButtons();
  mirrorScroll();
  primeVoices();
}

function wireEvents() {
  textInput.addEventListener("input", () => {
    if (state.speaking && !state.paused) {
      stopPlayback({ clearHighlight: true });
    }
    updateFromText(textInput.value);
  });

  textInput.addEventListener("scroll", mirrorScroll);
  textInput.addEventListener("click", syncCursorIntent);
  textInput.addEventListener("keyup", syncCursorIntent);
  textInput.addEventListener("paste", onNativePaste);

  playPauseBtn.addEventListener("click", togglePlayPause);
  prevBtn.addEventListener("click", handlePreviousSentence);
  nextBtn.addEventListener("click", handleNextSentence);
  pasteClearBtn.addEventListener("click", handlePasteClear);

  speedPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      setRate(Number(pill.dataset.speed));
    });
  });

  document.addEventListener("keydown", onKeyDown);
}

function onKeyDown(event) {
  const active = document.activeElement;
  const inText = active === textInput;
  const modPaste = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v";

  if (modPaste) {
    if (!inText) {
      textInput.focus();
    }
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    stopPlayback({ clearHighlight: true, resetIntent: false });
    return;
  }

  if (!inText && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    handlePreviousSentence();
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    handleNextSentence();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    stepSpeed(1);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    stepSpeed(-1);
  }
}

function onNativePaste() {
  // Native paste updates value after this event tick; refresh state on next frame.
  requestAnimationFrame(() => {
    updateFromText(textInput.value);
    textInput.selectionStart = 0;
    textInput.selectionEnd = 0;
    textInput.scrollTop = 0;
    textInput.scrollLeft = 0;
    mirrorScroll();
    syncCursorIntent();
  });
}

function updateFromText(raw) {
  state.text = raw;
  state.sentences = parseSentences(raw);
  state.wordCount = countWords(raw);
  syncCursorIntent();
  updateWordCount();
  updatePasteClearButton();
  renderHighlight();
}

function updateWordCount() {
  const label = state.wordCount === 1 ? "word" : "words";
  const seconds = estimateReadSeconds(state.wordCount, state.rate);
  wordCountEl.textContent = `${state.wordCount} ${label} ~ ${formatDuration(seconds)}`;
}

function updatePasteClearButton() {
  const hasText = state.text.trim().length > 0;
  pasteClearBtn.textContent = hasText ? "Clear" : "Paste";
  pasteClearBtn.setAttribute("aria-label", hasText ? "Clear text" : "Paste text");
}

function togglePlayPause() {
  if (!state.speechReady || !state.text.trim()) {
    return;
  }
  primeVoices();
  if (!state.speaking) {
    syncCursorIntent();
    startPlaybackFromChar(state.cursorIntent || 0, true);
    return;
  }
  if (state.paused) {
    const cursorMoved = textInput.selectionStart !== state.currentCharIndex;
    if (cursorMoved) {
      startPlaybackFromChar(textInput.selectionStart, true);
    } else {
      speechSynthesis.resume();
      state.paused = false;
      updatePlayButton();
    }
    return;
  }
  speechSynthesis.pause();
  state.paused = true;
  updatePlayButton();
}

function handleNextSentence() {
  if (isPlaybackLocked()) return;
  if (!state.text.trim()) return;
  const baseChar = textInput.selectionStart ?? state.cursorIntent;
  const idx = state.speaking ? state.sentenceIndex + 1 : sentenceIndexForChar(baseChar) + 1;
  const next = Math.min(idx, state.sentences.length - 1);
  moveToSentence(next);
}

function handlePreviousSentence() {
  if (isPlaybackLocked()) return;
  if (!state.text.trim()) return;
  const now = Date.now();
  const quickDoubleBack = now - state.lastBackAt < 560;
  state.lastBackAt = now;
  const baseChar = textInput.selectionStart ?? state.cursorIntent;
  const currentIdx = state.speaking ? state.sentenceIndex : sentenceIndexForChar(baseChar);
  const targetIdx = quickDoubleBack ? currentIdx : Math.max(0, currentIdx - 1);
  moveToSentence(targetIdx);
}

function moveToSentence(targetIdx) {
  const sentence = state.sentences[targetIdx];
  if (!sentence) return;

  stopPlayback({ clearHighlight: true, resetIntent: false });
  state.sentenceIndex = targetIdx;
  state.currentCharIndex = sentence.start;
  state.cursorIntent = sentence.start;

  const [wordStart, wordEnd] = wordRangeAt(state.text, sentence.start);
  const selStart = wordStart === wordEnd ? sentence.start : wordStart;
  const selEnd = wordStart === wordEnd ? sentence.start : wordEnd;
  textInput.focus();
  textInput.selectionStart = selStart;
  textInput.selectionEnd = selEnd;
}

async function handlePasteClear() {
  const hasText = state.text.trim().length > 0;
  if (hasText) {
    textInput.value = "";
    stopPlayback({ clearHighlight: true, resetIntent: true });
    updateFromText("");
    textInput.focus();
    return;
  }
  await focusAndPaste();
}

async function focusAndPaste() {
  textInput.focus();
  try {
    const clip = await navigator.clipboard.readText();
    if (!clip) return;
    textInput.value = clip;
    updateFromText(clip);
    textInput.selectionStart = 0;
    textInput.selectionEnd = 0;
  } catch (_err) {
    // Clipboard API may be blocked; browser paste shortcut still works after focus.
  }
}

function setRate(nextRate) {
  if (!SPEED_OPTIONS.includes(nextRate)) return;
  state.rate = nextRate;
  updateWordCount();
  speedPills.forEach((pill) => {
    const active = Number(pill.dataset.speed) === nextRate;
    pill.classList.toggle("active", active);
    pill.setAttribute("aria-checked", String(active));
  });
  if (state.speaking && !state.paused) {
    startPlaybackFromChar(state.currentCharIndex, true);
  }
}

function estimateReadSeconds(words, rate) {
  if (!words || words <= 0) return 0;
  const effectiveWpm = BASE_WPM_AT_1X * Math.max(0.1, rate);
  return Math.round((words / effectiveWpm) * 60);
}

function formatDuration(totalSeconds) {
  const sec = Math.max(0, Math.round(totalSeconds));
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    if (m === 60) return `${h + 1}h 0m`;
    return `${h}h ${m}m`;
  }
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  }
  return `${sec}s`;
}

function stepSpeed(direction) {
  const idx = SPEED_OPTIONS.indexOf(state.rate);
  const next = Math.max(0, Math.min(SPEED_OPTIONS.length - 1, idx + direction));
  setRate(SPEED_OPTIONS[next]);
}

function startPlaybackFromChar(charIndex, autoplay) {
  if (!state.text.trim()) return;
  stopCurrentUtterance();
  primeVoices();
  state.stopRequested = false;
  state.paused = false;
  state.speaking = true;
  appEl.classList.add("is-speaking");
  const safeChar = clamp(charIndex, 0, state.text.length);
  state.currentCharIndex = safeChar;
  state.cursorIntent = safeChar;
  state.sentenceIndex = sentenceIndexForChar(safeChar);
  textInput.focus();
  speakFromCurrentPosition(autoplay);
  updatePlayButton();
}

function speakFromCurrentPosition(autoplay) {
  const sentence = state.sentences[state.sentenceIndex];
  if (!sentence) {
    stopPlayback({ clearHighlight: true, resetIntent: false });
    return;
  }
  const startChar = Math.max(state.currentCharIndex, sentence.start);
  const chunk = state.text.slice(startChar, sentence.end);
  const speechChunk = normalizeForSpeech(chunk);
  if (!chunk.trim()) {
    moveToNextSentenceOrStop();
    return;
  }

  state.currentSentenceStartChar = startChar;
  state.boundarySeen = false;
  highlightSentence(sentence.start, sentence.end);

  const utter = new SpeechSynthesisUtterance(speechChunk);
  utter.rate = state.rate;
  utter.pitch = DEFAULT_PITCH;
  utter.volume = 1;
  utter.lang = (state.voice && state.voice.lang) || "en-GB";
  if (state.voice) utter.voice = state.voice;

  utter.onboundary = (ev) => {
    if (typeof ev.charIndex !== "number") return;
    if (typeof ev.name === "string" && ev.name !== "word") return;
    state.boundarySupported = true;
    state.boundarySeen = true;
    const local = clamp(ev.charIndex, 0, speechChunk.length);
    const global = state.currentSentenceStartChar + local;
    state.currentCharIndex = global;
    highlightWordAt(global);
  };

  utter.onend = () => {
    state.currentUtterance = null;
    if (state.stopRequested) return;
    if (!state.boundarySeen && state.sentences.length > 1) {
      highlightSentence(sentence.start, sentence.end);
    } else if (!state.boundarySeen) {
      const paragraph = paragraphRangeAt(state.text, sentence.start);
      renderHighlight(paragraph);
    }
    state.currentCharIndex = sentence.end;
    moveToNextSentenceOrStop();
  };

  utter.onerror = () => {
    state.currentUtterance = null;
    moveToNextSentenceOrStop();
  };

  state.currentUtterance = utter;
  if (autoplay) {
    speechSynthesis.speak(utter);
  }
}

function normalizeForSpeech(text) {
  // Keep string length stable so boundary charIndex maps back to original text offsets.
  return text.replace(/["“”]/g, " ");
}

function moveToNextSentenceOrStop() {
  state.sentenceIndex += 1;
  if (state.sentenceIndex >= state.sentences.length) {
    stopPlayback({ clearHighlight: true, resetIntent: false });
    return;
  }
  state.currentCharIndex = state.sentences[state.sentenceIndex].start;
  speakFromCurrentPosition(true);
}

function stopPlayback(options = {}) {
  const { clearHighlight = false, resetIntent = false } = options;
  state.stopRequested = true;
  stopCurrentUtterance();
  state.speaking = false;
  state.paused = false;
  state.currentUtterance = null;
  appEl.classList.remove("is-speaking");
  updatePlayButton();
  if (clearHighlight) {
    renderHighlight();
  }
  if (resetIntent) {
    state.cursorIntent = 0;
    state.currentCharIndex = 0;
  }
}

function stopCurrentUtterance() {
  try {
    speechSynthesis.cancel();
  } catch (_err) {
    // no-op
  }
}

function updatePlayButton() {
  playPauseBtn.textContent = state.speaking && !state.paused ? "Pause" : "Play";
  updateSkipButtons();
}

function updateSkipButtons() {
  const locked = isPlaybackLocked();
  prevBtn.disabled = locked;
  nextBtn.disabled = locked;
  prevBtn.setAttribute("aria-disabled", String(locked));
  nextBtn.setAttribute("aria-disabled", String(locked));
}

function isPlaybackLocked() {
  const engineSpeaking = state.speechReady && speechSynthesis.speaking && !speechSynthesis.paused;
  return (state.speaking && !state.paused) || engineSpeaking;
}

function renderHighlight(range = null) {
  const text = state.text || "";
  if (!range || !state.speaking) {
    highlightLayer.textContent = text;
    return;
  }
  const start = clamp(range.start, 0, text.length);
  const end = clamp(range.end, start, text.length);
  const pre = escapeHtml(text.slice(0, start));
  const mid = escapeHtml(text.slice(start, end));
  const post = escapeHtml(text.slice(end));
  highlightLayer.innerHTML = `${pre}<mark>${mid || " "}</mark>${post}`;
}

function highlightSentence(start, end) {
  renderHighlight({ start, end });
}

function highlightWordAt(index) {
  const [start, end] = wordRangeAt(state.text, index);
  if (start === end) {
    const sentence = state.sentences[state.sentenceIndex];
    if (sentence) highlightSentence(sentence.start, sentence.end);
    return;
  }
  renderHighlight({ start, end });
}

function mirrorScroll() {
  highlightLayer.scrollTop = textInput.scrollTop;
  highlightLayer.scrollLeft = textInput.scrollLeft;
}

function syncCursorIntent() {
  const at = textInput.selectionStart ?? 0;
  state.cursorIntent = at;
  if (!state.speaking || state.paused) {
    state.currentCharIndex = at;
  }
}

function sentenceIndexForChar(charIndex) {
  if (!state.sentences.length) return 0;
  const at = clamp(charIndex, 0, state.text.length);
  let lo = 0;
  let hi = state.sentences.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = state.sentences[mid];
    if (at < s.start) {
      hi = mid - 1;
      continue;
    }
    if (at >= s.end) {
      lo = mid + 1;
      continue;
    }
    return mid;
  }
  return Math.max(0, Math.min(state.sentences.length - 1, lo));
}

function paragraphRangeAt(text, index) {
  if (!text) return { start: 0, end: 0 };
  const at = clamp(index, 0, text.length);
  let start = 0;
  let end = text.length;

  for (let i = at - 1; i > 0; i -= 1) {
    if (text[i] === "\n" && text[i - 1] === "\n") {
      start = i + 1;
      break;
    }
  }
  for (let i = at; i < text.length - 1; i += 1) {
    if (text[i] === "\n" && text[i + 1] === "\n") {
      end = i;
      break;
    }
  }

  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return { start, end };
}

function wordRangeAt(text, index) {
  if (!text) return [0, 0];
  const idx = clamp(index, 0, text.length - 1);
  if (!isWordChar(text[idx])) {
    let right = idx + 1;
    while (right < text.length && !isWordChar(text[right])) right += 1;
    if (right < text.length) return wordRangeAt(text, right);
    let left = idx - 1;
    while (left >= 0 && !isWordChar(text[left])) left -= 1;
    if (left >= 0) return wordRangeAt(text, left);
    return [0, 0];
  }
  let start = idx;
  let end = idx + 1;
  while (start > 0 && isWordChar(text[start - 1])) start -= 1;
  while (end < text.length && isWordChar(text[end])) end += 1;
  return [start, end];
}

function isWordChar(ch) {
  return /[A-Za-z0-9'-]/.test(ch || "");
}

function countWords(text) {
  const m = text.match(/\b[\w'-]+\b/g);
  return m ? m.length : 0;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function primeVoices() {
  if (!state.speechReady) return;
  const choose = () => {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    state.voice = pickVoice(voices);
  };
  choose();
  speechSynthesis.onvoiceschanged = choose;
}

function pickVoice(voices) {
  const exactSamanthaUs = voices.find((voice) => {
    const name = (voice.name || "").trim().toLowerCase();
    return name === "samantha" && /^en-US/i.test(voice.lang || "");
  });
  if (exactSamanthaUs) return exactSamanthaUs;

  const samanthaAnyUs = voices.find((voice) => {
    const name = (voice.name || "").toLowerCase();
    return name.includes("samantha") && /^en-US/i.test(voice.lang || "");
  });
  if (samanthaAnyUs) return samanthaAnyUs;

  const enUsPool = voices.filter((voice) => /^en-US/i.test(voice.lang || ""));
  if (enUsPool.length) {
    const localUs = enUsPool.find((voice) => voice.localService);
    return localUs || enUsPool[0];
  }

  const exactDanielUk = voices.find((voice) => {
    const name = (voice.name || "").trim().toLowerCase();
    return name === "daniel" && /^en-GB/i.test(voice.lang || "");
  });
  if (exactDanielUk) return exactDanielUk;

  const ukPool = voices.filter((voice) => /^en-GB/i.test(voice.lang || ""));
  if (ukPool.length) {
    const localUk = ukPool.find((voice) => voice.localService);
    return localUk || ukPool[0];
  }

  const englishPool = voices.filter((voice) => /^en/i.test(voice.lang || ""));
  if (englishPool.length) return englishPool[0];

  return voices[0] || null;
}
