'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Romanizer } = require('../src');

const romanizer = new Romanizer();

test('romaji to kana basics', () => {
  assert.equal(romanizer.convert('kyou'), 'きょう');
  assert.equal(romanizer.convert('gakkou'), 'がっこう');
  assert.equal(romanizer.convert("kan'i"), 'かんい');
  assert.equal(romanizer.convert('shinbun'), 'しんぶん');
});

test('preserves non romaji text', () => {
  assert.equal(romanizer.convert('ashita10ji'), 'あした10じ');
  assert.equal(romanizer.convert('猫123'), '猫123');
});

test('preserves capitalized English spans inside romaji input', () => {
  assert.equal(
    romanizer.convert('saikinOpenAIhaDotswokoukaisita'),
    'さいきんOpenAIはDotsをこうかいした'
  );
});
