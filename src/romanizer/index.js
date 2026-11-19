'use strict';

const { RULES } = require('./rules');
const englishWords = require('./english-words');

const VOWELS = new Set(['a','i','u','e','o']);
const JAPANESE_BOUNDARY_ROMAJI = ['wo', 'ha', 'ga', 'ni', 'de', 'to', 'no', 'mo'];

function findPreservedEnglishEnd(text, start) {
  if (!/[A-Z]/.test(text[start] || '')) return -1;

  let runEnd = start + 1;
  while (runEnd < text.length && /[A-Za-z]/.test(text[runEnd])) runEnd += 1;
  const run = text.slice(start, runEnd);
  if (run.length < 2) return -1;
  // Recognized English words end at their dictionary boundary, so appended
  // Japanese romaji is not swallowed by capitalization-based preservation.
  for (let length = run.length; length >= 2; length -= 1) {
    if (englishWords.has(run.slice(0, length).toLowerCase())) return start + length;
  }

  const uppercaseCount = [...run].filter((char) => /[A-Z]/.test(char)).length;
  const minPrefixLength = uppercaseCount >= 2 ? 2 : 4;

  // CamelCase / acronym input marks the beginning of a literal English span.
  // The following Japanese text is commonly joined without a separator, so
  // resume romanization at a particle boundary: OpenAIha..., Dotswo....
  for (let i = minPrefixLength; i < run.length; i += 1) {
    const suffix = run.slice(i).toLowerCase();
    if (JAPANESE_BOUNDARY_ROMAJI.some((particle) => suffix.startsWith(particle))) {
      return start + i;
    }
  }

  return runEnd;
}

// Romanizes text, optionally recording the source index of every produced
// character so callers can map kana positions back to romaji positions.
function romanize(text, rules, maxRuleLength, starts) {
  let out = '';
  let i = 0;
  const emit = starts
    ? (chunk, from) => { out += chunk; for (let k = 0; k < chunk.length; k += 1) starts.push(from); }
    : (chunk) => { out += chunk; };

  while (i < text.length) {
    const current = text[i];
    const lower = current.toLowerCase();

    const englishEnd = findPreservedEnglishEnd(text, i);
    if (englishEnd > i) {
      emit(text.slice(i, englishEnd), i);
      i = englishEnd;
      continue;
    }

    if (!/[a-z]/i.test(current)) {
      emit(current, i);
      i += 1;
      continue;
    }

    const next = (text[i + 1] || '').toLowerCase();

    // A capital letter starts a preserved English span. Do not let a
    // romaji rule consume across that boundary (e.g. saikinOpenAI: nO must
    // not be interpreted as "no").
    if (lower === 'n' && /[A-Z]/.test(text[i + 1] || '')) {
      emit('ん', i);
      i += 1;
      continue;
    }

    if (lower === 'n' && text[i + 1] === "'") {
      emit('ん', i);
      i += 2;
      continue;
    }

    if (lower === 'n' && next === 'n') {
      emit('ん', i);
      const afterNext = (text[i + 2] || '').toLowerCase();
      i += (VOWELS.has(afterNext) || afterNext === 'y') ? 1 : 2;
      continue;
    }

    if (lower === 'n' && next && !VOWELS.has(next) && next !== 'y' && /[a-z]/.test(next)) {
      emit('ん', i);
      i += 1;
      continue;
    }

    if (next && lower === next && /[bcdfghjkmprstvwxyz]/.test(lower) && lower !== 'n') {
      emit('っ', i);
      i += 1;
      continue;
    }

    let matched = false;
    for (let len = maxRuleLength; len >= 1; len -= 1) {
      const rawToken = text.slice(i, i + len);
      if (/[A-Z]/.test(rawToken.slice(1))) continue;
      const token = rawToken.toLowerCase();
      if (rules[token]) {
        emit(rules[token], i);
        i += len;
        matched = true;
        break;
      }
    }

    if (!matched) {
      if (lower === 'n' && (!next || !/[a-z]/.test(next))) {
        emit('ん', i);
      } else {
        emit(current, i);
      }
      i += 1;
    }
  }

  return out;
}

class Romanizer {
  constructor(rules = RULES) {
    this.rules = rules;
    this.maxRuleLength = Math.max(...Object.keys(rules).map((key) => key.length));
  }

  convert(input) {
    return romanize(String(input ?? ''), this.rules, this.maxRuleLength, null);
  }

  convertWithMap(input) {
    const text = String(input ?? '');
    const starts = [];
    const kana = romanize(text, this.rules, this.maxRuleLength, starts);
    return { kana, starts, length: text.length };
  }
}

const defaultRomanizer = new Romanizer();

module.exports = { Romanizer, defaultRomanizer, romanize };
