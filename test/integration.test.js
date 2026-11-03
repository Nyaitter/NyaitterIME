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

test('honours unparseable English words in the middle of a romaji run', () => {
  // github/push cannot be parsed as romaji (their consonant clusters leave
  // ASCII residue), so they pass through as Latin anywhere in the run, not
  // only at the edges.
  assert.equal(convert('kyouhagithubnipushsita'), '今日はgithubにpushした');
  assert.equal(convert('watashihapythonwotsukau'), '私はpythonを使う');
  assert.equal(convert('githubwomiru'), 'githubを見る');
  // A substring that parses cleanly as romaji stays Japanese (boo in kiiboodo).
  assert.equal(convert('kiiboodo'), 'キーボード');
});

test('keeps grammatical context across Latin spans', () => {
  // A sentence-final した after a Latin word is the past-tense verb, not 下.
  assert.equal(convert('kyouhaGithubdePushsita'), '今日はGithubでPushした');
  assert.equal(convert('check sita'), 'check した');
  // Contexts where 下 is the correct noun stay untouched.
  assert.equal(convert('sitanioku'), '下に置く');
  assert.equal(convert('sitanimita'), '下に見た');
  assert.equal(convert('uekara shitamade'), '上から 下まで');
});

test('gives digit spans numeral connections', () => {
  assert.equal(convert('100en'), '100円');
  assert.equal(convert('5ji'), '5時');
  assert.equal(convert('3hon'), '3本');
});
