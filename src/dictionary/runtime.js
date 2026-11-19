'use strict';

const MAGIC_V2 = 'NYIME002';
const MAGIC_V3 = 'NYIME003';
const MAGIC_V4 = 'NYIME004';
const MAGIC_V5 = 'NYIME005';
const HASH_OFFSET = 0x811c9dc5;
const HASH_PRIME = 0x01000193;
const CACHE_LIMIT = 16384;
let decoder = null;

function decodeUtf8(bytes) {
  if (!decoder) {
    if (typeof TextDecoder === 'function') decoder = new TextDecoder();
    else {
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      return decodeURIComponent(escape(binary));
    }
  }
  return decoder.decode(bytes);
}

function asUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('Dictionary data must be an ArrayBuffer or Uint8Array');
}

class RuntimeDictionary {
  constructor(data) {
    this.bytes = asUint8Array(data);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    const magic = decodeUtf8(this.bytes.subarray(0, 8));
    if (magic !== MAGIC_V2 && magic !== MAGIC_V3 && magic !== MAGIC_V4 && magic !== MAGIC_V5) throw new Error('Invalid NyaitterIME dictionary');

    this.version = magic === MAGIC_V5 ? 5 : (magic === MAGIC_V4 ? 4 : (magic === MAGIC_V3 ? 3 : 2));
    if (this.version === 5) {
      this.leftSize = this.view.getUint16(8, true);
      this.rightSize = this.view.getUint16(10, true);
      this.groupCount = this.view.getUint32(12, true);
      this.maxReadingLength = this.view.getUint16(16, true);
      this.prefixPenaltyOffset = 20;
      this.suffixPenaltyOffset = this.prefixPenaltyOffset + this.leftSize * 2;
      this.matrixOffset = this.suffixPenaltyOffset + this.rightSize * 2;
      this.groupOffsetsOffset = this.matrixOffset + this.leftSize * this.rightSize * 2;
      this.lexiconOffset = this.groupOffsetsOffset + this.groupCount * 4;
      this.contextFlagsOffset = -1;
    } else if (this.version === 4) {
      this.leftSize = this.view.getUint16(8, true);
      this.rightSize = this.view.getUint16(10, true);
      this.prefixPenaltyOffset = 12;
      this.suffixPenaltyOffset = this.prefixPenaltyOffset + this.leftSize * 2;
      this.matrixOffset = this.suffixPenaltyOffset + this.rightSize * 2;
      this.lexiconOffset = this.matrixOffset + this.leftSize * this.rightSize * 2;
      this.contextFlagsOffset = -1;
      this.groupCount = 0;
      this.maxReadingLength = 0;
    } else if (this.version === 3) {
      this.leftSize = this.view.getUint16(8, true);
      this.rightSize = this.view.getUint16(10, true);
      this.prefixPenaltyOffset = -1;
      this.suffixPenaltyOffset = -1;
      this.matrixOffset = 12;
      this.lexiconOffset = this.matrixOffset + this.leftSize * this.rightSize * 2;
      this.contextFlagsOffset = -1;
      this.groupCount = 0;
      this.maxReadingLength = 0;
    } else {
      this.lexiconLength = this.view.getUint32(8, true);
      this.leftSize = this.view.getUint16(12, true);
      this.rightSize = this.view.getUint16(14, true);
      this.prefixPenaltyOffset = -1;
      this.suffixPenaltyOffset = -1;
      this.lexiconOffset = 16;
      this.contextFlagsOffset = this.lexiconOffset + this.lexiconLength;
      this.matrixOffset = this.contextFlagsOffset + this.leftSize;
      this.groupCount = this.view.getUint32(this.lexiconOffset, true);
      this.maxReadingLength = this.view.getUint16(this.lexiconOffset + 4, true);
    }
    this.index = this.version >= 5 ? null : new Map();
    this.cache = new Map();
    this.hash = null;
    this.hashMask = 0;
    this.groupOffsets = null;
    this.encoder = null;
    this.encoded = null;
    if (this.version < 5) this.#buildIndex();
    else this.#buildHashIndex();
  }

  #buildIndex() {
    let offset = this.version >= 3 ? this.lexiconOffset : this.lexiconOffset + 8;
    const endOffset = this.version >= 3 ? this.bytes.length : this.contextFlagsOffset;
    let groups = 0;
    while (offset < endOffset && (this.version >= 3 || groups < this.groupCount)) {
      const groupOffset = offset;
      const readingLength = this.view.getUint16(offset, true);
      const candidateCount = this.view.getUint16(offset + 2, true);
      offset += 4;
      const reading = decodeUtf8(this.bytes.subarray(offset, offset + readingLength));
      offset += readingLength;
      this.index.set(reading, groupOffset);
      if (this.version >= 3) this.maxReadingLength = Math.max(this.maxReadingLength, reading.length);
      for (let j = 0; j < candidateCount; j += 1) {
        const surfaceLength = this.view.getUint16(offset, true);
        offset += 8 + surfaceLength;
      }
      groups += 1;
    }
    if (offset !== endOffset) throw new Error('Corrupt NyaitterIME lexicon');
    if (this.version >= 3) this.groupCount = groups;
  }

  #buildHashIndex() {
    let size = 1;
    while (size < this.groupCount * 1.7) size <<= 1;
    const table = new Uint32Array(size);
    const mask = size - 1;
    const { bytes, view } = this;
    const { groupCount, groupOffsetsOffset, lexiconOffset } = this;
    let offsets = null;
    if (groupOffsetsOffset % 4 === 0) offsets = new Uint32Array(bytes.buffer, bytes.byteOffset + groupOffsetsOffset, groupCount);
    for (let i = 0; i < groupCount; i += 1) {
      const relative = offsets ? offsets[i] : view.getUint32(groupOffsetsOffset + i * 4, true);
      const offset = lexiconOffset + relative;
      const length = view.getUint16(offset, true);
      const end = offset + 4 + length;
      let hash = HASH_OFFSET;
      let b = offset + 4;
      for (; b + 3 < end; b += 4) {
        hash ^= bytes[b] | (bytes[b + 1] << 8) | (bytes[b + 2] << 16) | (bytes[b + 3] << 24);
        hash = Math.imul(hash, HASH_PRIME);
      }
      for (; b < end; b += 1) {
        hash ^= bytes[b];
        hash = Math.imul(hash, HASH_PRIME);
      }
      hash ^= length;
      let slot = hash >>> 0 & mask;
      while (table[slot] !== 0) slot = slot + 1 & mask;
      table[slot] = i + 1;
    }
    this.hash = table;
    this.hashMask = mask;
    this.groupOffsets = offsets;
  }

  lookup(reading) {
    const cached = this.cache.get(reading);
    if (cached !== undefined) return cached;
    const groupOffset = this.version >= 5 ? this.#findGroupOffset(reading) : this.index.get(reading);
    if (groupOffset === undefined) {
      this.#cache(reading, []);
      return [];
    }

    let offset = groupOffset;
    const readingLength = this.view.getUint16(offset, true);
    const candidateCount = this.view.getUint16(offset + 2, true);
    offset += 4 + readingLength;
    const candidates = new Array(candidateCount);
    for (let i = 0; i < candidateCount; i += 1) {
      const surfaceLength = this.view.getUint16(offset, true);
      const leftId = this.view.getUint16(offset + 2, true);
      const rightId = this.view.getUint16(offset + 4, true);
      const cost = this.view.getInt16(offset + 6, true);
      offset += 8;
      const surface = decodeUtf8(this.bytes.subarray(offset, offset + surfaceLength));
      offset += surfaceLength;
      const flags = this.version === 2 ? (this.bytes[this.contextFlagsOffset + leftId] ?? 0) : 0;
      candidates[i] = { reading, surface, leftId, rightId, cost, flags };
    }
    this.#cache(reading, candidates);
    return candidates;
  }

  #cache(reading, candidates) {
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(reading, candidates);
  }

  #findGroupOffset(reading) {
    if (this.hash && typeof TextEncoder === 'function') return this.#findGroupOffsetHashed(reading);
    return this.#findGroupOffsetBinary(reading);
  }

  #findGroupOffsetHashed(reading) {
    if (!this.encoder) this.encoder = new TextEncoder();
    let buffer = this.encoded;
    if (!buffer || buffer.length < reading.length * 3) {
      buffer = new Uint8Array(reading.length * 3);
      this.encoded = buffer;
    }
    const length = this.encoder.encodeInto(reading, buffer).written;
    if (length === 0) return undefined;
    let hash = HASH_OFFSET;
    let b = 0;
    for (; b + 3 < length; b += 4) {
      hash ^= buffer[b] | (buffer[b + 1] << 8) | (buffer[b + 2] << 16) | (buffer[b + 3] << 24);
      hash = Math.imul(hash, HASH_PRIME);
    }
    for (; b < length; b += 1) {
      hash ^= buffer[b];
      hash = Math.imul(hash, HASH_PRIME);
    }
    hash ^= length;
    const { bytes, view, lexiconOffset, groupOffsets } = this;
    let slot = hash >>> 0 & this.hashMask;
    for (;;) {
      const entry = this.hash[slot];
      if (entry === 0) return undefined;
      const relative = groupOffsets ? groupOffsets[entry - 1] : view.getUint32(this.groupOffsetsOffset + (entry - 1) * 4, true);
      const offset = lexiconOffset + relative;
      const readingLength = view.getUint16(offset, true);
      if (readingLength === length) {
        let same = true;
        for (let b = 0; b < length; b += 1) {
          if (bytes[offset + 4 + b] !== buffer[b]) { same = false; break; }
        }
        if (same) return offset;
      }
      slot = slot + 1 & this.hashMask;
    }
  }

  #findGroupOffsetBinary(reading) {
    let low = 0;
    let high = this.groupCount - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const relativeOffset = this.view.getUint32(this.groupOffsetsOffset + mid * 4, true);
      const groupOffset = this.lexiconOffset + relativeOffset;
      const readingLength = this.view.getUint16(groupOffset, true);
      const candidateReading = decodeUtf8(this.bytes.subarray(groupOffset + 4, groupOffset + 4 + readingLength));
      if (candidateReading === reading) return groupOffset;
      if (candidateReading < reading) low = mid + 1;
      else high = mid - 1;
    }
    return undefined;
  }

  connectionCost(previousRightId, currentLeftId) {
    if (previousRightId < 0 || currentLeftId < 0 || previousRightId >= this.rightSize || currentLeftId >= this.leftSize) return 0;
    const index = this.version >= 4
      ? previousRightId * this.leftSize + currentLeftId
      : currentLeftId * this.leftSize + previousRightId;
    return this.view.getInt16(this.matrixOffset + 2 * index, true);
  }

  prefixPenalty(leftId) {
    if (this.version < 4 || leftId < 0 || leftId >= this.leftSize) return 0;
    return this.view.getUint16(this.prefixPenaltyOffset + leftId * 2, true);
  }

  suffixPenalty(rightId) {
    if (this.version < 4 || rightId < 0 || rightId >= this.rightSize) return 0;
    return this.view.getUint16(this.suffixPenaltyOffset + rightId * 2, true);
  }
}

module.exports = { RuntimeDictionary };
