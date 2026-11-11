'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Japanizer } = require('../src');

test('dakuten-less readings reach voiced words when the exact reading is unknown', () => {
  const ime = new Japanizer();
  // Some input methods cannot produce dakuten/handakuten at all, so
  // てんふら must still reach 天ぷら through the dakuten/handakuten fallback.
  assert.equal(ime.convert('てんふら'), '天ぷら');
  assert.equal(ime.convert('てんふらをたべる'), '天ぷらを食べる');
});

test('readings needing two toggles still reach the voiced word', () => {
  const ime = new Japanizer();
  // とうふつ -> どうぶつ requires toggling both と->ど and ふ->ぶ.
  assert.equal(ime.convert('とうふつ'), '動物');
});

test('readings that exist as-is keep their own words over voiced variants', () => {
  const ime = new Japanizer();
  assert.equal(ime.convert('かんし'), '監視');
  assert.equal(ime.convert('かくせい'), '覚醒');
  assert.equal(ime.convert('けんき'), '嫌気');
});

test('conversion does not mutate the dictionary', () => {
  const ime = new Japanizer();
  // dictionary.lookup() returns the dictionary's own (cached) array.
  // The fallback must not push variant candidates into it, or the
  // dictionary would grow and later conversions would drift.
  const readings = ['あめた', 'てんふら'];
  const before = readings.map((reading) => ime.dictionary.lookup(reading).length);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(ime.convert('あしたのてんきはあめたよ'), '明日の天気は雨だよ');
    assert.equal(ime.convert('てんふらをたべる'), '天ぷらを食べる');
  }
  const after = readings.map((reading) => ime.dictionary.lookup(reading).length);
  assert.deepEqual(after, before, 'lookup results must not change as a side effect of conversion');
});

test('dakuten-less copula reaches the voiced entry when the exact reading is name-only', () => {
  const ime = new Japanizer();
  // あめた exists only as the names 雨田/飴田, so the toggled reading
  // あめだ (雨だ) may compete for the span.
  assert.equal(ime.convert('あめたよ'), '雨だよ');
  assert.equal(ime.convert('あしたのてんきはあめたよ'), '明日の天気は雨だよ');
});
