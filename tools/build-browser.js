'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('esbuild');
const { Script } = require('node:vm');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'src', 'browser.js');
const modules = new Map();

function normalize(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function resolveModule(from, request) {
  let candidate = path.resolve(path.dirname(from), request);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  if (fs.existsSync(candidate + '.js')) return candidate + '.js';
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    candidate = path.join(candidate, 'index.js');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot resolve ${request} from ${from}`);
}

function visit(file) {
  const id = normalize(file);
  if (modules.has(id)) return id;
  let source = fs.readFileSync(file, 'utf8');
  modules.set(id, '');
  source = source.replace(/require\((['"])(\.\.?\/[^'"]+)\1\)/g, (_match, _quote, request) => {
    const dep = resolveModule(file, request);
    const depId = visit(dep);
    return `__require(${JSON.stringify(depId)})`;
  });
  modules.set(id, source);
  return id;
}

const entryId = visit(entry);
const moduleTable = [...modules.entries()].map(([id, source]) => `${JSON.stringify(id)}:function(module,exports,__require){\n${source}\n}`).join(',\n');
const banner = '/* NyaitterIME v0.1.0 | MIT */';
const bundle = `${banner}\n(function(root,factory){if(typeof module==='object'&&module.exports){module.exports=factory();}else{root.NyaitterIME=factory();}})(typeof globalThis!=='undefined'?globalThis:this,function(){var modules={${moduleTable}};var cache={};function __require(id){if(cache[id])return cache[id].exports;if(!modules[id])throw new Error('Module not found: '+id);var module={exports:{}};cache[id]=module;modules[id](module,module.exports,__require);return module.exports;}return __require(${JSON.stringify(entryId)});});\n`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'nyaitter-ime.js'), bundle);

const min = transformSync(bundle, { minify: true, target: 'es2020', legalComments: 'none' }).code;
new Script(bundle);
new Script(min);
fs.writeFileSync(path.join(root, 'dist', 'nyaitter-ime.min.js'), `${banner}${min}`);
console.log(`Built ${modules.size} modules`);
