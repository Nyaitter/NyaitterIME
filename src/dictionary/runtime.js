'use strict';

const MAGIC_V2 = 'NYIME002';
const MAGIC_V3 = 'NYIME003';
const MAGIC_V4 = 'NYIME004';
const MAGIC_V5 = 'NYIME005';
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
    if (this.version < 5) this.#buildIndex();
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

  lookup(reading) {
    if (this.cache.has(reading)) return this.cache.get(reading);
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
    if (this.cache.size >= 4096) this.cache.clear();
    this.cache.set(reading, candidates);
  }

  #findGroupOffset(reading) {
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
