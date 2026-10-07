'use strict';

const { viterbi } = require('./viterbi');

class Converter {
  convert(text, dictionary) {
    return viterbi(String(text ?? ''), dictionary).output;
  }

  debug(text, dictionary) {
    return viterbi(String(text ?? ''), dictionary);
  }
}

const defaultConverter = new Converter();

module.exports = { Converter, defaultConverter };
