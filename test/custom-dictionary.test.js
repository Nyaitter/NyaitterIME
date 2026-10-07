'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { convert, createSession, Japanizer } = require('../src');
const customDictionary = [
  { reading: 'にゃいったー', surface: 'Nyaitter' },
  { reading: 'あってん', surface: 'Atten' },
  { reading: 'スクラッチャー', surface: 'Scratcher' },
  { reading: 'ぶいあーるちゃっと', surface: 'VRChat' },
];
test('custom readings convert in sentences and preserve registered spelling', () => {
  const session = createSession({ customDictionary });
  for (const [input, expected] of [
    ['nyaitta-', 'Nyaitter'], ['atten', 'Atten'],
    ['sukuraccha-', 'Scratcher'], ['buia-ruchatto', 'VRChat'],
    ['nyaitta-hasukidesu', 'Nyaitterは好きです'], ['VRChat', 'VRChat'],
  ]) assert.equal(session.convert(input), expected);
});
test('custom dictionary is scoped and participates in incremental input', () => {
  const normal = convert('あってん');
  assert.equal(convert('あってん', { customDictionary }), 'Atten');
  assert.equal(convert('あってん'), normal);
  const ime = new Japanizer({ customDictionary });
  const session = ime.createSession();
  for (const input of ['a', 'at', 'att', 'atte', 'atten', 'atte', 'at']) {
    assert.equal(session.convert(input), ime.convert(input));
  }
  assert.throws(() => createSession({ customDictionary: [{ surface: 'bad' }] }), TypeError);
});
