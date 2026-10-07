'use strict';

const core = require('./core');

const scriptUrl = typeof document !== 'undefined' && document.currentScript ? document.currentScript.src : null;
const defaultDictionaryUrl = scriptUrl
  ? new URL('../data/nyaitter-ime-core.bin.gz', scriptUrl).href
  : '../data/nyaitter-ime-core.bin.gz';

let defaultDictionary = null;
let defaultJapanizer = null;

async function gunzipResponse(response) {
  if (!response.ok) throw new Error(`Dictionary download failed: ${response.status} ${response.statusText}`);
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser does not support DecompressionStream');
  }
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function loadDictionary(url = defaultDictionaryUrl) {
  const bytes = await gunzipResponse(await fetch(url));
  return new core.RuntimeDictionary(bytes);
}

async function create(options = {}) {
  const dictionary = options.dictionary ?? await loadDictionary(options.dictionaryUrl ?? defaultDictionaryUrl);
  return new core.Japanizer({ ...options, dictionary });
}

async function init(options = {}) {
  defaultDictionary = options.dictionary ?? await loadDictionary(options.dictionaryUrl ?? defaultDictionaryUrl);
  defaultJapanizer = new core.Japanizer({ ...options, dictionary: defaultDictionary });
  return defaultJapanizer;
}

function convert(text, options) {
  if (!defaultJapanizer) throw new Error('NyaitterIME is not initialized yet. Await NyaitterIME.ready first.');
  return defaultJapanizer.convert(text, options);
}

function createSession(options) {
  if (!defaultJapanizer) throw new Error('Await NyaitterIME.ready first.');
  return defaultJapanizer.createSession(options);
}

function toHiragana(text, options) {
  if (defaultJapanizer) return defaultJapanizer.toHiragana(text, options);
  return core.normalizeInputSymbols(core.defaultRomanizer.convert(text, options));
}

const ready = typeof fetch === 'function' ? init() : Promise.resolve(null);

module.exports = {
  ...core,
  create,
  init,
  loadDictionary,
  convert,
  createSession,
  toHiragana,
  ready,
  defaultDictionaryUrl
};
