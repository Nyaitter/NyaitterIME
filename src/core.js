'use strict';

const { Japanizer, normalizeInputSymbols, convertMixedText } = require('./japanizer');
const { Romanizer, defaultRomanizer } = require('./romanizer');
const { Converter, defaultConverter } = require('./converter');
const { Dictionary } = require('./dictionary');
const { RuntimeDictionary } = require('./dictionary/runtime');

module.exports = {
  Japanizer,
  normalizeInputSymbols,
  convertMixedText,
  Romanizer,
  Converter,
  Dictionary,
  RuntimeDictionary,
  defaultRomanizer,
  defaultConverter
};
