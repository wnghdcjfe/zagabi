'use strict';

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

function compareOutputs(actual, expected) {
  const normalizedActual = normalizeOutput(actual);
  const normalizedExpected = normalizeOutput(expected);
  return {
    ok: normalizedActual === normalizedExpected,
    actual: normalizedActual,
    expected: normalizedExpected,
  };
}

module.exports = {
  normalizeOutput,
  compareOutputs,
};
