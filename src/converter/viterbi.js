'use strict';

const UNKNOWN_COST = 8000;
const OOV_LEFT_ID = 5968;
const OOV_RIGHT_ID = 5968;
const ASCII_RUN_COST = 120;

function isAscii(char) {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return code >= 0x20 && code <= 0x7E;
}

function buildEdges(text, dictionary, position) {
  const edges = [];
  const max = Math.min(text.length, position + dictionary.maxReadingLength);

  for (let end = position + 1; end <= max; end += 1) {
    const reading = text.slice(position, end);
    const candidates = dictionary.lookup(reading);
    for (const candidate of candidates) {
      const wordCost = candidate.cost ?? 1000;
      edges.push({
        start: position,
        end,
        reading,
        surface: candidate.surface,
        cost: wordCost
          + (position === 0 && typeof dictionary.prefixPenalty === 'function' ? dictionary.prefixPenalty(candidate.leftId ?? 0) : 0)
          + (end === text.length && typeof dictionary.suffixPenalty === 'function' ? dictionary.suffixPenalty(candidate.rightId ?? 0) : 0),
        wordCost,
        leftId: candidate.leftId ?? 0,
        rightId: candidate.rightId ?? 0,
        kind: 'dictionary'
      });
    }
  }

  const current = text[position];
  if (isAscii(current)) {
    let end = position + 1;
    while (end < text.length && isAscii(text[end])) end += 1;
    edges.push({ start: position, end, reading: text.slice(position, end), surface: text.slice(position, end), cost: ASCII_RUN_COST, leftId: OOV_LEFT_ID, rightId: OOV_RIGHT_ID, kind: 'identity' });
  } else {
    edges.push({ start: position, end: position + 1, reading: current, surface: current, cost: UNKNOWN_COST, leftId: OOV_LEFT_ID, rightId: OOV_RIGHT_ID, kind: 'identity' });
  }

  return edges;
}

function connectionCost(previous, current, dictionary) {
  if (typeof dictionary.connectionCost === 'function') {
    return dictionary.connectionCost(previous?.rightId ?? 0, current.leftId ?? 0) || 0;
  }
  return 0;
}

function viterbi(text, dictionary) {
  if (!text) return { output: '', cost: 0, path: [] };

  // The future connection cost depends on the previous node's rightId, so a
  // single best path per character position is insufficient. Keep the best
  // state for every rightId at each position.
  const bestAt = Array.from({ length: text.length + 1 }, () => new Map());
  bestAt[0].set(0, { cost: 0, previous: null, edge: null, last: { rightId: 0 } });

  for (let position = 0; position < text.length; position += 1) {
    const states = bestAt[position];
    if (states.size === 0) continue;

    for (const edge of buildEdges(text, dictionary, position)) {
      let bestPrevious = null;
      let bestScore = Infinity;
      for (const state of states.values()) {
        const score = state.cost + edge.cost + connectionCost(state.last, edge, dictionary);
        if (score < bestScore) {
          bestScore = score;
          bestPrevious = state;
        }
      }
      const existing = bestAt[edge.end].get(edge.rightId);
      if (bestPrevious && (!existing || bestScore < existing.cost)) {
        bestAt[edge.end].set(edge.rightId, {
          cost: bestScore,
          previous: bestPrevious,
          edge,
          last: edge
        });
      }
    }
  }

  let result = null;
  let finalCost = Infinity;
  for (const state of bestAt[text.length].values()) {
    const eosCost = state.cost + (typeof dictionary.connectionCost === 'function'
      ? dictionary.connectionCost(state.last?.rightId ?? 0, 0)
      : 0);
    if (eosCost < finalCost) {
      finalCost = eosCost;
      result = state;
    }
  }
  if (!result) return { output: text, cost: Infinity, path: [] };
  const path = [];
  for (let state = result; state && state.edge; state = state.previous) path.push(state.edge);
  path.reverse();
  return { output: path.map((edge) => edge.surface).join(''), cost: finalCost, path };
}

module.exports = { viterbi };
