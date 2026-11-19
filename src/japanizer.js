'use strict';

const { defaultRomanizer } = require('./romanizer');
const { defaultConverter } = require('./converter');
const englishWords = require('./romanizer/english-words');
const { Dictionary } = require('./dictionary');

function withCustomDictionary(base, entries) {
  if (!Array.isArray(entries)) throw new TypeError('customDictionary must be an array');
  const custom = new Dictionary(entries.map(entry => {
    const value = Array.isArray(entry) ? { reading: entry[0], surface: entry[1], cost: entry[2] } : entry;
    if (!value || typeof value.reading !== 'string' || typeof value.surface !== 'string' || !value.reading || !value.surface) {
      throw new TypeError('Custom entries require nonempty reading and surface strings');
    }
    const reading = value.reading.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
    return { ...value, reading, cost: value.cost ?? -10000, leftId: value.leftId ?? 5968, rightId: value.rightId ?? 5968 };
  }));
  const combined = Object.create(base);
  combined.customReadings = [...new Set([...(base.customReadings ?? []), ...custom.byReading.keys()])];
  combined.maxReadingLength = Math.max(base.maxReadingLength, custom.maxReadingLength);
  combined.lookup = reading => [...custom.lookup(reading), ...base.lookup(reading)];
  return combined;
}

class Japanizer {
  constructor(options = {}) {
    this.romanizer = options.romanizer ?? defaultRomanizer;
    this.converter = options.converter ?? defaultConverter;
    this.dictionary = options.dictionary ?? null;
    this.ignoredTexts = options.ignoredTexts ?? [];
    if (options.customDictionary) {
      if (!this.dictionary) throw new Error('A base dictionary is required');
      this.dictionary = withCustomDictionary(this.dictionary, options.customDictionary);
      this.ignoredTexts = [...this.ignoredTexts, ...options.customDictionary.map(e => Array.isArray(e) ? e[1] : e.surface)];
    }
  }

  toHiragana(text, options = {}) {
    if (options.customDictionary) {
      const scoped = new Japanizer({ ...options, dictionary: this.dictionary });
      return scoped.toHiragana(text, { ...options, customDictionary: null, ignoredTexts: scoped.ignoredTexts });
    }
    return mapUnignoredText(String(text ?? ''), options.ignoredTexts ?? this.ignoredTexts,
      part => normalizeInputSymbols(convertMixedText(part, this, options)));
  }

  convert(text, options = {}) {
    if (options.customDictionary) {
      const scoped = new Japanizer({ ...options, dictionary: this.dictionary });
      return scoped.convert(text, { ...options, customDictionary: null, ignoredTexts: scoped.ignoredTexts });
    }
    if (!this.dictionary) throw new Error('A dictionary is required');
    return mapUnignoredText(String(text ?? ''), options.ignoredTexts ?? this.ignoredTexts,
      part => convertJapaneseSections(normalizeInputSymbols(convertMixedText(part, this, options)), this, options));
  }

  createSession(options = {}) {
    if (options.customDictionary) {
      const scoped = new Japanizer({ ...options, dictionary: this.dictionary });
      return scoped.createSession({ ...options, customDictionary: null, ignoredTexts: scoped.ignoredTexts });
    }
    const cache = { outputs: new Map() };
    const sessionOptions = { ...options, _incrementalCache: cache };
    return {
      convert: text => this.convert(text, sessionOptions),
      reset: () => { cache.outputs.clear(); },
    };
  }

  debug(text, options = {}) {
    if (options.customDictionary) {
      const scoped = new Japanizer({ ...options, dictionary: this.dictionary });
      return scoped.debug(text, { ...options, customDictionary: null, ignoredTexts: scoped.ignoredTexts });
    }
    if (!this.dictionary) throw new Error('A dictionary is required');
    const kana = this.toHiragana(text, options);
    return { input: String(text ?? ''), kana, ...this.converter.debug(kana, this.dictionary, options) };
  }
}

function convertJapaneseSections(kana, ime, options) {
  // Hashtag markers still delimit fragments, but literal Latin spans stay
  // inside the conversion: the converter gives them identity edges with
  // loanword-noun ids, so the surrounding Japanese keeps its connection
  // context. Splitting Latin out made every neighbouring fragment look like
  // a standalone sentence (BOS/EOS penalties, no left context), which is
  // what let e.g. a した after a Latin word degrade to the noun 下.
  return kana.split(/(#)/).map(part =>
    part === '#' ? part : ime.converter.convert(part, ime.dictionary, options)
  ).join('');
}

function mapUnignoredText(text, ignoredTexts, convert) {
  const literals = [...new Set(Array.isArray(ignoredTexts) ? ignoredTexts.filter(x => typeof x === 'string' && x.length) : [])]
    .sort((a, b) => b.length - a.length);
  if (!literals.length) return convert(text);
  let output = '', cursor = 0, plainStart = 0;
  while (cursor < text.length) {
    const literal = literals.find(value => text.startsWith(value, cursor));
    if (!literal) { cursor += 1; continue; }
    output += convert(text.slice(plainStart, cursor)) + literal;
    cursor += literal.length;
    plainStart = cursor;
  }
  return output + convert(text.slice(plainStart));
}

function convertMixedText(text, ime, options) {
  if (!ime.dictionary || options.englishDetection === false) return ime.romanizer.convert(text, options);
  const convertPlain = value => value.replace(/[A-Za-z]+/g, (run) => {
    if (/[A-Z]/.test(run)) return ime.romanizer.convert(run, options);
    return chooseEnglishJapanese(run, ime, options);
  });
  const readings = ime.dictionary.customReadings;
  if (!readings?.length) return convertPlain(text);
  const readingSet = new Set(readings);
  const maxInputLength = Math.max(...readings.map(reading => reading.length)) * 4;
  let output = '', plainStart = 0;
  for (let start = 0; start < text.length; start += 1) {
    let match = null;
    for (let end = start + 1; end <= Math.min(text.length, start + maxInputLength); end += 1) {
      const reading = normalizeInputSymbols(ime.romanizer.convert(text.slice(start, end)))
        .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
      if (readingSet.has(reading)) match = { end, reading };
    }
    if (!match) continue;
    output += convertPlain(text.slice(plainStart, start)) + match.reading;
    start = match.end - 1;
    plainStart = match.end;
  }
  return output + convertPlain(text.slice(plainStart));
}

const MAX_ENGLISH_WORD_LENGTH = 24;

function chooseEnglishJapanese(run, ime, options) {
  const cache = options._incrementalCache;
  const cached = cache?.outputs.get(run);
  if (cached !== undefined) return cached;
  // Romaji that reads as kana without leaving anything behind is Japanese;
  // Latin must come from a span that cannot be read any other way.
  const { kana, starts } = ime.romanizer.convertWithMap(run, options);
  const spans = /[A-Za-z]/.test(kana) ? findEnglishSpans(run, kana, starts, ime, options) : [];
  let output = kana;
  if (spans.length > 0) {
    output = '';
    let cursor = 0;
    for (const span of spans) {
      output += ime.romanizer.convert(run.slice(cursor, span.start), options) + run.slice(span.start, span.end);
      cursor = span.end;
    }
    output += ime.romanizer.convert(run.slice(cursor), options);
  }
  if (cache) {
    if (cache.outputs.size >= 128) cache.outputs.delete(cache.outputs.keys().next().value);
    cache.outputs.set(run, output);
  }
  return output;
}

// Finds the word-list spans that cover the places where romanization left Latin
// behind (github, push, python: consonant clusters no kana rule can read).
function findEnglishSpans(run, kana, starts, ime, options) {
  const regions = [];
  for (let i = 0; i < kana.length; i += 1) {
    if (!/[A-Za-z]/.test(kana[i])) continue;
    const start = starts[i];
    const end = Math.max(starts[i + 1] ?? run.length, start + 1);
    const previous = regions[regions.length - 1];
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else regions.push({ start, end });
  }

  const spans = [];
  for (const region of regions) {
    let best = null;
    const first = Math.max(0, region.start - MAX_ENGLISH_WORD_LENGTH + 1);
    for (let start = first; start <= region.start; start += 1) {
      if (best && start + best.length <= region.end) continue;
      const last = Math.min(run.length, start + MAX_ENGLISH_WORD_LENGTH);
      for (let end = last; end >= Math.max(region.end, start + 2); end -= 1) {
        const part = run.slice(start, end);
        if (!englishWords.has(part)) continue;
        if (!/[A-Za-z]/.test(ime.romanizer.convert(part, options))) continue;
        if (!best || end - start > best.length) best = { start, end, length: end - start };
      }
    }
    if (!best) continue;
    const previous = spans[spans.length - 1];
    if (previous && best.start <= previous.end) previous.end = Math.max(previous.end, best.end);
    else spans.push({ start: best.start, end: best.end });
  }
  return spans;
}

function normalizeInputSymbols(text) {
  return text.replace(/[,.!?;:()\[\]{}\-]/g, (symbol, offset, value) => {
    const before = value.slice(0, offset).match(/[^\s]$/)?.[0] ?? '';
    const after = value.slice(offset + 1).match(/^[^\s]/)?.[0] ?? '';
    const beforeEnglish = /[A-Za-z0-9]/.test(before);
    const afterEnglish = /[A-Za-z0-9]/.test(after);
    const englishContext = symbol === '-'
      ? beforeEnglish && afterEnglish
      : (symbol === '(' || symbol === '[' || symbol === '{')
        ? afterEnglish
        : (symbol === ')' || symbol === ']' || symbol === '}')
          ? beforeEnglish
          : beforeEnglish || (!before && afterEnglish);
    if (englishContext) return symbol;
    return ({ ',': '、', '.': '。', '!': '！', '?': '？', ';': '；', ':': '：', '(': '（', ')': '）', '[': '［', ']': '］', '{': '｛', '}': '｝', '-': 'ー' })[symbol];
  });
}

module.exports = { Japanizer, normalizeInputSymbols, convertMixedText };
