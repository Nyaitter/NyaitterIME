'use strict';

const { defaultRomanizer } = require('./romanizer');
const { defaultConverter } = require('./converter');
const englishWords = require('./romanizer/english-words');

class Japanizer {
  constructor(options = {}) {
    this.romanizer = options.romanizer ?? defaultRomanizer;
    this.converter = options.converter ?? defaultConverter;
    this.dictionary = options.dictionary ?? null;
    this.ignoredTexts = options.ignoredTexts ?? [];
  }

  toHiragana(text, options = {}) {
    return mapUnignoredText(String(text ?? ''), options.ignoredTexts ?? this.ignoredTexts,
      part => normalizeInputSymbols(convertMixedText(part, this, options)));
  }

  convert(text, options = {}) {
    if (!this.dictionary) throw new Error('A dictionary is required');
    return mapUnignoredText(String(text ?? ''), options.ignoredTexts ?? this.ignoredTexts,
      part => convertJapaneseSections(normalizeInputSymbols(convertMixedText(part, this, options)), this, options));
  }

  createSession(options = {}) {
    const cache = { run: '', best: [], analyses: new Map(), outputs: new Map() };
    const sessionOptions = { ...options, _incrementalCache: cache };
    return {
      convert: text => this.convert(text, sessionOptions),
      reset: () => { cache.run = ''; cache.best = []; cache.analyses.clear(); cache.outputs.clear(); },
    };
  }

  debug(text, options = {}) {
    if (!this.dictionary) throw new Error('A dictionary is required');
    const kana = this.toHiragana(text, options);
    return { input: String(text ?? ''), kana, ...this.converter.debug(kana, this.dictionary, options) };
  }
}

function convertJapaneseSections(kana, ime, options) {
  // Literal English and hashtag markers must not affect Japanese connection costs.
  return kana.split(/([A-Za-z]+|#)/).map(part =>
    /^[A-Za-z]+$/.test(part) || part === '#' ? part : ime.converter.convert(part, ime.dictionary, options)
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
  return text.replace(/[A-Za-z]+/g, (run) => {
    if (/[A-Z]/.test(run)) return ime.romanizer.convert(run, options);
    return chooseEnglishJapanese(run, ime, options);
  });
}

function chooseEnglishJapanese(run, ime, options) {
  const cache = options._incrementalCache;
  if (cache?.outputs.has(run)) return cache.outputs.get(run);
  const best = Array(run.length + 1).fill(null);
  best[0] = { cost: 0, text: '' };
  let shared = 0;
  if (cache) {
    while (shared < run.length && shared < cache.run.length && run[shared] === cache.run[shared]) shared += 1;
  }
  // Revisit the romanization boundary: a terminal n can become na/nya/nn.
  const reusable = Math.max(0, shared - ime.romanizer.maxRuleLength);
  for (let end = 1; end <= reusable; end += 1) best[end] = cache.best[end];
  for (let i = 0; i < run.length; i += 1) {
    if (!best[i]) continue;
    for (let end = Math.max(i + 1, reusable + 1); end <= run.length; end += 1) {
      // Do not split an n+y syllable into terminal n and a separate ya/yu/yo.
      if (run[end - 1] === 'n' && /^y[auo]/.test(run.slice(end))) continue;
      const part = run.slice(i, end);
      let analysis = cache?.analyses.get(part);
      if (!analysis) {
        const kana = ime.romanizer.convert(part, options);
        const parsed = ime.converter.debug(kana, ime.dictionary, options);
        const unknownPenalty = parsed.path.reduce((sum, edge) => sum + (edge.kind === 'identity' ? 6500 * edge.reading.length : 0), 0);
        analysis = { kana, japaneseCost: parsed.cost + unknownPenalty + 180 };
        if (cache) {
          if (cache.analyses.size >= 8192) cache.analyses.delete(cache.analyses.keys().next().value);
          cache.analyses.set(part, analysis);
        }
      }
      const { kana, japaneseCost } = analysis;
      update(best, end, best[i].cost + japaneseCost, best[i].text + kana);
      if (part.length >= 2 && englishWords.has(part)) {
        // Prefer a dictionary-backed Japanese reading when both interpretations fit.
        update(best, end, best[i].cost + 5900, best[i].text + run.slice(i, end));
      }
    }
  }
  const output = best[run.length]?.text ?? ime.romanizer.convert(run, options);
  if (cache) {
    cache.run = run;
    cache.best = best;
    if (cache.outputs.size >= 128) cache.outputs.delete(cache.outputs.keys().next().value);
    cache.outputs.set(run, output);
  }
  return output;
}

function update(best, end, cost, text) {
  if (!best[end] || cost < best[end].cost) best[end] = { cost, text };
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
