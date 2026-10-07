'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const core = require('./core');

let defaultDictionary = null;
let defaultJapanizer = null;

function getDefaultDictionary() {
  if (!defaultDictionary) {
    const file = path.resolve(__dirname, '..', 'data', 'nyaitter-ime-core.bin.gz');
    const bytes = zlib.gunzipSync(fs.readFileSync(file));
    defaultDictionary = new core.RuntimeDictionary(bytes);
  }
  return defaultDictionary;
}

class Japanizer extends core.Japanizer {
  constructor(options = {}) {
    super({ ...options, dictionary: options.dictionary ?? getDefaultDictionary() });
  }
}

function getDefaultJapanizer() {
  if (!defaultJapanizer) defaultJapanizer = new Japanizer();
  return defaultJapanizer;
}

function convert(text, options) {
  return getDefaultJapanizer().convert(text, options);
}

function toHiragana(text, options) {
  return getDefaultJapanizer().toHiragana(text, options);
}

module.exports = {
  ...core,
  Japanizer,
  convert,
  toHiragana,
  getDefaultDictionary,
  getDefaultJapanizer
};
