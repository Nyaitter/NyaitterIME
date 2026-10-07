'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const zlib = require('node:zlib');
const { once } = require('node:events');

const MAGIC = Buffer.from('NYIME005');

function patternToRegExp(pattern) {
  let source = '^' + pattern.replace(/\*/g, '[^,]+');
  if (!pattern.endsWith(',')) source += '(?:,|$)';
  return new RegExp(source);
}

function readPosFeatures(file, size) {
  const features = new Array(size).fill('');
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const space = line.indexOf(' ');
    if (space < 0) continue;
    const id = Number(line.slice(0, space));
    if (Number.isInteger(id) && id >= 0 && id < size) features[id] = line.slice(space + 1);
  }
  return features;
}

function buildBoundaryPenalties(boundaryFile, idFile, size) {
  const rules = { PREFIX: [], SUFFIX: [] };
  for (const raw of fs.readFileSync(boundaryFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 3 || !rules[fields[0]]) continue;
    const cost = Number(fields[2]);
    if (!Number.isInteger(cost) || cost < 0 || cost > 0xffff) continue;
    rules[fields[0]].push({ regex: patternToRegExp(fields[1]), cost });
  }
  const features = readPosFeatures(idFile, size);
  const prefix = Buffer.alloc(size * 2);
  const suffix = Buffer.alloc(size * 2);
  for (let id = 0; id < size; id += 1) {
    const feature = features[id];
    const prefixRule = rules.PREFIX.find((rule) => rule.regex.test(feature));
    const suffixRule = rules.SUFFIX.find((rule) => rule.regex.test(feature));
    prefix.writeUInt16LE(prefixRule?.cost ?? 0, id * 2);
    suffix.writeUInt16LE(suffixRule?.cost ?? 0, id * 2);
  }
  return { prefix, suffix };
}

async function readConnectionMatrix(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let size = null;
  let matrix = null;
  let index = 0;
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (size === null) {
      size = Number(line);
      if (!Number.isInteger(size) || size <= 0 || size > 0xffff) throw new Error('Invalid Mozc connection matrix size');
      matrix = Buffer.allocUnsafe(size * size * 2);
      continue;
    }
    const cost = Number(line);
    if (!Number.isInteger(cost) || cost < -32768 || cost > 32767) throw new Error(`Invalid connection cost at ${index}: ${line}`);
    if (index >= size * size) throw new Error('Mozc connection matrix has too many entries');
    matrix.writeInt16LE(cost, index * 2);
    index += 1;
  }
  if (size === null || index !== size * size) throw new Error(`Incomplete Mozc connection matrix: ${index}/${size ? size * size : 0}`);
  return { size, matrix };
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

async function writeGroup(stream, reading, candidateMap) {
  if (!reading || candidateMap.size === 0) return;
  const readingBytes = Buffer.from(reading, 'utf8');
  const candidates = [...candidateMap.values()].filter((candidate) => Buffer.byteLength(candidate.surface, 'utf8') <= 0xffff);
  if (readingBytes.length > 0xffff || candidates.length > 0xffff) return;

  const chunks = [];
  const groupHeader = Buffer.allocUnsafe(4);
  groupHeader.writeUInt16LE(readingBytes.length, 0);
  groupHeader.writeUInt16LE(candidates.length, 2);
  chunks.push(groupHeader, readingBytes);
  for (const candidate of candidates) {
    const surfaceBytes = Buffer.from(candidate.surface, 'utf8');
    if (surfaceBytes.length > 0xffff) continue;
    const header = Buffer.allocUnsafe(8);
    header.writeUInt16LE(surfaceBytes.length, 0);
    header.writeUInt16LE(candidate.leftId, 2);
    header.writeUInt16LE(candidate.rightId, 4);
    header.writeInt16LE(candidate.cost, 6);
    chunks.push(header, surfaceBytes);
  }
  await writeChunk(stream, Buffer.concat(chunks));
}

function* mergedGroups(sources) {
  const indices = new Array(sources.length).fill(0);
  while (sources.some((source, i) => indices[i] < source.length)) {
    let reading = null;
    for (let i = 0; i < sources.length; i += 1) {
      if (indices[i] >= sources[i].length) continue;
      const candidateReading = sources[i][indices[i]].reading;
      if (reading === null || candidateReading < reading) reading = candidateReading;
    }

    const candidates = new Map();
    let sourceEntries = 0;
    for (let i = 0; i < sources.length; i += 1) {
      while (indices[i] < sources[i].length && sources[i][indices[i]].reading === reading) {
        const entry = sources[i][indices[i]];
        const key = `${entry.surface}\u0000${entry.leftId}\u0000${entry.rightId}`;
        const existing = candidates.get(key);
        if (!existing || entry.cost < existing.cost) candidates.set(key, entry);
        sourceEntries += 1;
        indices[i] += 1;
      }
    }
    yield { reading, candidates, sourceEntries };
  }
}

function buildLexiconIndex(sources) {
  const offsets = [];
  let byteOffset = 0;
  let maxReadingLength = 0;
  let sourceEntries = 0;
  for (const group of mergedGroups(sources)) {
    const readingBytes = Buffer.byteLength(group.reading, 'utf8');
    const candidates = [...group.candidates.values()].filter((candidate) => Buffer.byteLength(candidate.surface, 'utf8') <= 0xffff);
    if (readingBytes > 0xffff || candidates.length === 0 || candidates.length > 0xffff) continue;
    offsets.push(byteOffset);
    maxReadingLength = Math.max(maxReadingLength, group.reading.length);
    sourceEntries += group.sourceEntries;
    byteOffset += 4 + readingBytes;
    for (const candidate of candidates) byteOffset += 8 + Buffer.byteLength(candidate.surface, 'utf8');
  }
  const buffer = Buffer.allocUnsafe(offsets.length * 4);
  for (let i = 0; i < offsets.length; i += 1) buffer.writeUInt32LE(offsets[i], i * 4);
  return { buffer, groups: offsets.length, maxReadingLength, sourceEntries };
}

function loadDictionaryEntries(file) {
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const cells = line.split('\t');
    if (cells.length < 5) continue;
    const [reading, leftText, rightText, costText, surface] = cells;
    const leftId = Number(leftText);
    const rightId = Number(rightText);
    const cost = Number(costText);
    if (!reading || !surface || !Number.isInteger(leftId) || !Number.isInteger(rightId) || !Number.isInteger(cost)) continue;
    if (leftId < 0 || leftId > 0xffff || rightId < 0 || rightId > 0xffff || cost < -32768 || cost > 32767) continue;
    entries.push({ reading, surface, leftId, rightId, cost });
  }
  entries.sort((a, b) => a.reading < b.reading ? -1 : (a.reading > b.reading ? 1 : 0));
  return entries;
}

async function writeLexicon(stream, sources) {
  for (const group of mergedGroups(sources)) await writeGroup(stream, group.reading, group.candidates);
}

async function main() {
  const [mozcRootArg, outputArg] = process.argv.slice(2);
  if (!mozcRootArg) {
    console.error('Usage: node tools/build-mozc-runtime-stream.js <mozc-root> [output.gz]');
    console.error('The Mozc checkout must contain src/data/dictionary_oss and src/data/rules.');
    process.exitCode = 1;
    return;
  }

  const root = path.resolve(__dirname, '..');
  const mozcRoot = path.resolve(mozcRootArg);
  const dictDir = path.join(mozcRoot, 'src', 'data', 'dictionary_oss');
  const dictionaryFiles = [
    ...Array.from({ length: 10 }, (_, i) => path.join(dictDir, `dictionary${String(i).padStart(2, '0')}.txt`)),
    path.join(dictDir, 'suffix.txt')
  ];
  const connectionFile = path.join(dictDir, 'connection_single_column.txt');
  const idFile = path.join(dictDir, 'id.def');
  const boundaryFile = path.join(mozcRoot, 'src', 'data', 'rules', 'boundary.def');
  const outputPath = path.resolve(outputArg || path.join(root, 'data', 'nyaitter-ime-core.bin.gz'));

  const { size, matrix } = await readConnectionMatrix(connectionFile);
  const penalties = buildBoundaryPenalties(boundaryFile, idFile, size);
  const sources = dictionaryFiles.map(loadDictionaryEntries);
  const lexiconIndex = buildLexiconIndex(sources);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const output = fs.createWriteStream(outputPath);
  const gzip = zlib.createGzip({ level: 9 });
  gzip.pipe(output);

  const header = Buffer.alloc(20);
  MAGIC.copy(header, 0);
  header.writeUInt16LE(size, 8);
  header.writeUInt16LE(size, 10);
  header.writeUInt32LE(lexiconIndex.groups, 12);
  header.writeUInt16LE(lexiconIndex.maxReadingLength, 16);
  await writeChunk(gzip, header);
  await writeChunk(gzip, penalties.prefix);
  await writeChunk(gzip, penalties.suffix);
  await writeChunk(gzip, matrix);
  await writeChunk(gzip, lexiconIndex.buffer);
  await writeLexicon(gzip, sources);
  gzip.end();
  await once(output, 'close');

  console.log(JSON.stringify({ source: 'Mozc OSS', matrixSize: size, sourceEntries: lexiconIndex.sourceEntries, groups: lexiconIndex.groups, maxReadingLength: lexiconIndex.maxReadingLength, output: outputPath, compressedBytes: fs.statSync(outputPath).size }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

