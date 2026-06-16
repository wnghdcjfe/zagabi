'use strict';

const FLOAT_TOLERANCE_PROBLEM_IDS = new Set(['1344']);
const DEFAULT_FLOAT_ABSOLUTE_TOLERANCE = 1e-6;
const DEFAULT_FLOAT_RELATIVE_TOLERANCE = 1e-6;
const MAX_HIDE_AND_SEEK_POSITION = 200000;

/**
 * Normalize output for standard algorithm judging: CRLF becomes LF and only
 * trailing whitespace is ignored. Internal whitespace stays significant.
 */
function normalizeOutput(output) {
  if (output == null) {
    return '';
  }
  return String(output).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\s\uFEFF\xA0]+$/u, '');
}

function tokenizeOutput(output) {
  const normalized = normalizeOutput(output).trim();
  return normalized === '' ? [] : normalized.split(/\s+/u);
}

function parseIntegerToken(token) {
  if (!/^[+-]?\d+$/u.test(String(token))) return null;
  const value = Number(token);
  return Number.isSafeInteger(value) ? value : null;
}

function parseFiniteNumberToken(token) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(String(token))) return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

function numbersClose(actual, expected, options = {}) {
  const absoluteTolerance = Number.isFinite(options.absoluteTolerance)
    ? options.absoluteTolerance
    : DEFAULT_FLOAT_ABSOLUTE_TOLERANCE;
  const relativeTolerance = Number.isFinite(options.relativeTolerance)
    ? options.relativeTolerance
    : DEFAULT_FLOAT_RELATIVE_TOLERANCE;
  const scale = Math.max(1, Math.abs(expected));
  return Math.abs(actual - expected) <= Math.max(absoluteTolerance, relativeTolerance * scale);
}

function compareTokens(actual, expected) {
  const actualTokens = tokenizeOutput(actual);
  const expectedTokens = tokenizeOutput(expected);
  if (actualTokens.length !== expectedTokens.length) return null;
  for (let index = 0; index < actualTokens.length; index += 1) {
    if (actualTokens[index] !== expectedTokens[index]) return null;
  }
  return {
    ok: true,
    actual: actualTokens.join(' '),
    expected: expectedTokens.join(' '),
    mode: 'tokens',
  };
}

function compareFloatingPoint(actual, expected, options = {}) {
  const actualTokens = tokenizeOutput(actual);
  const expectedTokens = tokenizeOutput(expected);
  if (actualTokens.length === 0 || actualTokens.length !== expectedTokens.length) return null;

  for (let index = 0; index < actualTokens.length; index += 1) {
    const actualNumber = parseFiniteNumberToken(actualTokens[index]);
    const expectedNumber = parseFiniteNumberToken(expectedTokens[index]);
    if (actualNumber === null || expectedNumber === null) return null;
    if (!numbersClose(actualNumber, expectedNumber, options)) return null;
  }

  return {
    ok: true,
    actual: actualTokens.join(' '),
    expected: expectedTokens.join(' '),
    mode: 'float',
  };
}

function shortestHideAndSeekDistance(start, target) {
  if (start === target) return 0;

  const distance = new Int32Array(MAX_HIDE_AND_SEEK_POSITION + 1);
  distance.fill(-1);
  const queue = new Int32Array(MAX_HIDE_AND_SEEK_POSITION + 1);
  let head = 0;
  let tail = 0;

  distance[start] = 0;
  queue[tail] = start;
  tail += 1;

  while (head < tail) {
    const here = queue[head];
    head += 1;
    const nextDistance = distance[here] + 1;
    const candidates = [here - 1, here + 1, here * 2];
    for (const next of candidates) {
      if (next < 0 || next > MAX_HIDE_AND_SEEK_POSITION || distance[next] !== -1) continue;
      if (next === target) return nextDistance;
      distance[next] = nextDistance;
      queue[tail] = next;
      tail += 1;
    }
  }

  return null;
}

function validateHideAndSeekPath(actual, input) {
  const inputTokens = tokenizeOutput(input).map(parseIntegerToken);
  if (inputTokens.length < 2 || inputTokens.some((token) => token === null)) return null;

  const [start, target] = inputTokens;
  if (
    start < 0
    || start > MAX_HIDE_AND_SEEK_POSITION
    || target < 0
    || target > MAX_HIDE_AND_SEEK_POSITION
  ) {
    return null;
  }

  const outputTokens = tokenizeOutput(actual).map(parseIntegerToken);
  if (outputTokens.length < 2 || outputTokens.some((token) => token === null)) return null;

  const reportedDistance = outputTokens[0];
  const path = outputTokens.slice(1);
  const shortestDistance = shortestHideAndSeekDistance(start, target);

  if (shortestDistance === null || reportedDistance !== shortestDistance) return null;
  if (path.length !== reportedDistance + 1) return null;
  if (path[0] !== start || path[path.length - 1] !== target) return null;

  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    if (
      current !== previous - 1
      && current !== previous + 1
      && current !== previous * 2
    ) {
      return null;
    }
    if (current < 0 || current > MAX_HIDE_AND_SEEK_POSITION) return null;
  }

  return {
    ok: true,
    actual: outputTokens.join(' '),
    expected: `shortest distance ${shortestDistance} with a valid path`,
    mode: 'special-13913',
  };
}

function lisLength(values) {
  const tails = [];
  for (const value of values) {
    let left = 0;
    let right = tails.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (tails[mid] < value) left = mid + 1;
      else right = mid;
    }
    tails[left] = value;
  }
  return tails.length;
}

function isSubsequence(candidate, values) {
  let cursor = 0;
  for (const value of values) {
    if (cursor < candidate.length && candidate[cursor] === value) cursor += 1;
  }
  return cursor === candidate.length;
}

function validateLisOutput(actual, input) {
  const inputTokens = tokenizeOutput(input).map(parseIntegerToken);
  if (inputTokens.length < 1 || inputTokens.some((token) => token === null)) return null;

  const count = inputTokens[0];
  const values = inputTokens.slice(1);
  if (count < 0 || values.length !== count) return null;

  const outputTokens = tokenizeOutput(actual).map(parseIntegerToken);
  if (outputTokens.length < 1 || outputTokens.some((token) => token === null)) return null;

  const reportedLength = outputTokens[0];
  const sequence = outputTokens.slice(1);
  const expectedLength = lisLength(values);

  if (reportedLength !== expectedLength) return null;
  if (sequence.length !== reportedLength) return null;
  for (let index = 1; index < sequence.length; index += 1) {
    if (sequence[index - 1] >= sequence[index]) return null;
  }
  if (!isSubsequence(sequence, values)) return null;

  return {
    ok: true,
    actual: outputTokens.join(' '),
    expected: `LIS length ${expectedLength} with a valid increasing subsequence`,
    mode: 'special-14003',
  };
}

function compareSpecialJudge(actual, context = {}) {
  const problemId = String(context.problemId || '');
  if (problemId === '13913') return validateHideAndSeekPath(actual, context.input);
  if (problemId === '14003') return validateLisOutput(actual, context.input);
  return null;
}

function shouldUseFloatTolerance(context = {}) {
  if (context.floatTolerance === true) return true;
  return FLOAT_TOLERANCE_PROBLEM_IDS.has(String(context.problemId || ''));
}

function compareOutputs(actual, expected, context = {}) {
  const normalizedActual = normalizeOutput(actual);
  const normalizedExpected = normalizeOutput(expected);
  if (normalizedActual === normalizedExpected) {
    return {
      ok: true,
      actual: normalizedActual,
      expected: normalizedExpected,
      mode: 'exact',
    };
  }

  const special = compareSpecialJudge(actual, context);
  if (special) return special;

  if (shouldUseFloatTolerance(context)) {
    const floatingPoint = compareFloatingPoint(actual, expected, context);
    if (floatingPoint) return floatingPoint;
  }

  const tokens = compareTokens(actual, expected);
  if (tokens) return tokens;

  return {
    ok: false,
    actual: normalizedActual,
    expected: normalizedExpected,
    mode: 'exact',
  };
}

module.exports = {
  normalizeOutput,
  tokenizeOutput,
  compareFloatingPoint,
  compareTokens,
  validateHideAndSeekPath,
  validateLisOutput,
  compareOutputs,
};
