'use strict';

class Dictionary {
  constructor(entries = []) {
    this.byReading = new Map();
    this.maxReadingLength = 1;
    for (const entry of entries) {
      const normalized = Array.isArray(entry)
        ? { reading: entry[0], surface: entry[1], cost: entry[2] ?? 1000, leftId: 0, rightId: 0 }
        : { leftId: 0, rightId: 0, cost: 1000, ...entry };
      if (!normalized.reading || !normalized.surface) continue;
      const list = this.byReading.get(normalized.reading) || [];
      list.push(normalized);
      this.byReading.set(normalized.reading, list);
      this.maxReadingLength = Math.max(this.maxReadingLength, normalized.reading.length);
    }
  }

  lookup(reading) {
    return this.byReading.get(reading) || [];
  }
}

module.exports = { Dictionary };
