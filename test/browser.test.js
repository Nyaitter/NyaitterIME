'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('browser bundle exposes NyaitterIME global', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'dist', 'nyaitter-ime.js'), 'utf8');
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  assert.equal(typeof context.globalThis.NyaitterIME.Japanizer, 'function');
  assert.equal(context.globalThis.NyaitterIME.toHiragana('neko,inu'), 'ねこ、いぬ');
  assert.equal(typeof context.globalThis.NyaitterIME.convert, 'function');
  assert.equal(typeof context.globalThis.NyaitterIME.ready?.then, 'function');
});
