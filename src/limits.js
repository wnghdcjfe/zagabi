'use strict';

const SECOND_UNITS = new Set(['s', 'sec', 'secs', 'second', 'seconds', '초']);
const MILLISECOND_UNITS = new Set(['ms', 'msec', 'millisecond', 'milliseconds']);
const MEMORY_UNITS_TO_MB = new Map([
  ['b', 1 / (1024 * 1024)],
  ['byte', 1 / (1024 * 1024)],
  ['bytes', 1 / (1024 * 1024)],
  ['kb', 1 / 1024],
  ['kib', 1 / 1024],
  ['mb', 1],
  ['mib', 1],
  ['gb', 1024],
  ['gib', 1024],
]);

function parsePositiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} must contain a positive number`);
  }
  return number;
}

function splitLimit(limit, fieldName) {
  if (typeof limit === 'number') {
    return { amount: parsePositiveNumber(limit, fieldName), unit: '' };
  }
  if (typeof limit !== 'string' || limit.trim() === '') {
    throw new Error(`${fieldName} must be a non-empty string or positive number`);
  }

  const match = limit.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([^\d\s]+)?$/u);
  if (!match) {
    throw new Error(`${fieldName} has unsupported format: ${limit}`);
  }

  return {
    amount: parsePositiveNumber(match[1], fieldName),
    unit: (match[2] || '').toLowerCase(),
  };
}

/**
 * Parse BOJ-style Korean time limits such as "1 초" into milliseconds.
 * A bare number is treated as seconds because problem statements normally do so.
 */
function parseTimeLimit(limit) {
  const { amount, unit } = splitLimit(limit, 'timeLimit');
  if (unit === '' || SECOND_UNITS.has(unit)) {
    return Math.ceil(amount * 1000);
  }
  if (MILLISECOND_UNITS.has(unit)) {
    return Math.ceil(amount);
  }
  throw new Error(`timeLimit has unsupported unit: ${unit}`);
}

/**
 * Parse memory limits such as "128 MB" into integer megabytes.
 * The judge engine can use this normalized value for reporting or best-effort limits.
 */
function parseMemoryLimit(limit) {
  const { amount, unit } = splitLimit(limit, 'memoryLimit');
  const normalizedUnit = unit || 'mb';
  const multiplier = MEMORY_UNITS_TO_MB.get(normalizedUnit);
  if (!multiplier) {
    throw new Error(`memoryLimit has unsupported unit: ${unit}`);
  }
  return Math.ceil(amount * multiplier);
}

module.exports = {
  parseTimeLimit,
  parseMemoryLimit,
};
