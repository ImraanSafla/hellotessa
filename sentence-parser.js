const COMMON_ABBREVIATIONS = new Set([
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "prof.",
  "sr.",
  "jr.",
  "st.",
  "vs.",
  "etc.",
  "no.",
  "fig.",
  "e.g.",
  "i.e.",
  "u.k.",
  "u.s.",
  "a.m.",
  "p.m.",
  "inc.",
  "ltd.",
  "co.",
  "corp."
]);

const NON_TERMINAL_ABBREVIATIONS = new Set(["mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st."]);

export function parseSentences(text) {
  if (!text.trim()) return [];
  const sentences = [];
  let start = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const isTerminator = ch === "." || ch === "!" || ch === "?";

    if (!isTerminator) {
      i += 1;
      continue;
    }
    if (ch === "." && isDecimal(text, i)) {
      i += 1;
      continue;
    }
    if (ch === "." && isAbbreviation(text, i)) {
      i += 1;
      continue;
    }
    if (ch === "." && isEllipsisContinuation(text, i)) {
      i += 1;
      continue;
    }

    let end = i + 1;
    if (ch === "." && text[i + 1] === ".") {
      while (text[end] === ".") end += 1;
    }
    while (isTrailingCloser(text[end])) end += 1;

    const raw = text.slice(start, end);
    if (raw.trim()) {
      const s = firstNonWs(text, start, end);
      sentences.push({ start: s, end, text: text.slice(s, end) });
    }
    start = end;
    i = end;
  }

  if (start < text.length) {
    const tail = text.slice(start);
    if (tail.trim()) {
      const s = firstNonWs(text, start, text.length);
      sentences.push({ start: s, end: text.length, text: text.slice(s) });
    }
  }

  return sentences.length ? sentences : [{ start: 0, end: text.length, text }];
}

function firstNonWs(text, from, to) {
  let i = from;
  while (i < to && /\s/.test(text[i])) i += 1;
  return i;
}

function isDecimal(text, idx) {
  return /\d/.test(text[idx - 1] || "") && /\d/.test(text[idx + 1] || "");
}

function isAbbreviation(text, idx) {
  const token = tokenBefore(text, idx).toLowerCase();
  if (!token) return false;

  const next = nextNonWhitespace(text, idx + 1);
  if (NON_TERMINAL_ABBREVIATIONS.has(token)) return true;
  if (/^[a-z]\.$/.test(token) && /[A-Z]/.test(text[idx + 1] || "")) return true;
  if (/^([a-z]\.){2,}$/.test(token)) {
    return !!next && /[a-z0-9]/.test(next);
  }
  if (COMMON_ABBREVIATIONS.has(token)) {
    return !!next && /[a-z0-9]/.test(next);
  }
  if (next && /[a-z]/.test(next)) return true;
  return false;
}

function tokenBefore(text, idx) {
  let i = idx;
  while (i >= 0 && !/\s/.test(text[i])) i -= 1;
  return text.slice(i + 1, idx + 1).replace(/^[("'[\]]+/, "");
}

function isTrailingCloser(ch) {
  return ch === '"' || ch === "'" || ch === ")" || ch === "]" || ch === "}";
}

function isEllipsisContinuation(text, idx) {
  if (text[idx] !== ".") return false;
  let left = idx;
  let right = idx;
  while (text[left - 1] === ".") left -= 1;
  while (text[right + 1] === ".") right += 1;
  const runLength = right - left + 1;
  if (runLength < 3) return false;
  const next = nextNonWhitespace(text, right + 1);
  return !!next && /[a-z0-9]/.test(next);
}

function nextNonWhitespace(text, from) {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return text[i] || "";
}
