'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Japanizer, convert, toHiragana } = require('../src');

test('default conversion returns the top Japanese candidate', () => {
  const ime = new Japanizer();
  assert.equal(ime.convert('kyouhaiitenkidesune'), '今日はいい天気ですね');
  assert.equal(ime.convert('ashita10jiniikimasu'), '明日10時に行きます');
  assert.equal(ime.convert('saikinnnekowonadetayo'), '最近猫を撫でたよ');
  assert.equal(ime.convert('atarasiisumahowokatta'), '新しいスマホを買った');
  assert.equal(convert('neko'), '猫');
});

test('debug exposes kana and selected viterbi path', () => {
  const result = new Japanizer().debug('kyou');
  assert.equal(result.kana, 'きょう');
  assert.equal(result.output, '今日');
  assert.ok(Array.isArray(result.path));
});

test('preserves English spans while converting surrounding Japanese', () => {
  assert.equal(
    convert('saikinOpenAIhaDotswokoukaisita'),
    '最近OpenAIはDotsを公開した'
  );
});

test('toHiragana converts without loading or using the dictionary', () => {
  assert.equal(toHiragana('saikinOpenAIhaDotswokoukaisita.'), 'さいきんOpenAIはDotsをこうかいした。');
  assert.equal(new Japanizer().toHiragana('neko,inu'), 'ねこ、いぬ');
});
