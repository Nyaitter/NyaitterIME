'use strict';

const { RULES } = require('./rules');

const VOWELS = new Set(['a','i','u','e','o']);
const JAPANESE_BOUNDARY_ROMAJI = ['wo', 'ha', 'ga', 'ni', 'de', 'to', 'no', 'mo'];

function findPreservedEnglishEnd(text, start) {
  if (!/[A-Z]/.test(text[start] || '')) return -1;

  let runEnd = start + 1;
  while (runEnd < text.length && /[A-Za-z]/.test(text[runEnd])) runEnd += 1;
  const run = text.slice(start, runEnd);
  if (run.length < 2) return -1;

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

class Romanizer {
  constructor(rules = RULES) {
    this.rules = rules;
    this.maxRuleLength = Math.max(...Object.keys(rules).map((key) => key.length));
  }

  convert(input) {
    const text = String(input ?? '');
    let out = '';
    let i = 0;

    while (i < text.length) {
      const current = text[i];
      const lower = current.toLowerCase();

      const englishEnd = findPreservedEnglishEnd(text, i);
      if (englishEnd > i) {
        out += text.slice(i, englishEnd);
        i = englishEnd;
        continue;
      }

      if (!/[a-z]/i.test(current)) {
        out += current;
        i += 1;
        continue;
      }

      const next = (text[i + 1] || '').toLowerCase();

      // A capital letter starts a preserved English span. Do not let a
      // romaji rule consume across that boundary (e.g. saikinOpenAI: nO must
      // not be interpreted as "no").
      if (lower === 'n' && /[A-Z]/.test(text[i + 1] || '')) {
        out += 'ん';
        i += 1;
        continue;
      }

      if (lower === 'n' && text[i + 1] === "'") {
        out += 'ん';
        i += 2;
        continue;
      }

      if (lower === 'n' && next === 'n') {
        out += 'ん';
        const afterNext = (text[i + 2] || '').toLowerCase();
        i += (VOWELS.has(afterNext) || afterNext === 'y') ? 1 : 2;
        continue;
      }

      if (lower === 'n' && next && !VOWELS.has(next) && next !== 'y' && /[a-z]/.test(next)) {
        out += 'ん';
        i += 1;
        continue;
      }

      if (next && lower === next && /[bcdfghjkmprstvwxyz]/.test(lower) && lower !== 'n') {
        out += 'っ';
        i += 1;
        continue;
      }

      let matched = false;
      for (let len = this.maxRuleLength; len >= 1; len -= 1) {
        const rawToken = text.slice(i, i + len);
        if (/[A-Z]/.test(rawToken.slice(1))) continue;
        const token = rawToken.toLowerCase();
        if (this.rules[token]) {
          out += this.rules[token];
          i += len;
          matched = true;
          break;
        }
      }

      if (!matched) {
        if (lower === 'n' && (!next || !/[a-z]/.test(next))) {
          out += 'ん';
        } else {
          out += current;
        }
        i += 1;
      }
    }

    return out;
  }
}

const defaultRomanizer = new Romanizer();

module.exports = { Romanizer, defaultRomanizer };
