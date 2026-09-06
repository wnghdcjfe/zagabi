'use strict';

const { getSpecialJudgeEntry, resolveChecker } = require('./checkers');
const { withinTolerance } = require('./checkers/float');

// testCase.floatTolerance 로 직접 호출할 때 쓰는 기본 오차. 문제별 오차는 registry.json 이 정한다.
const DEFAULT_FLOAT_TOLERANCE = 1e-6;

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

function parseFiniteNumberToken(token) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(String(token))) return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

function resolveTolerance(options = {}) {
  const candidate = Number.isFinite(options.absoluteTolerance)
    ? options.absoluteTolerance
    : options.epsilon;
  return Number.isFinite(candidate) && candidate > 0 ? candidate : DEFAULT_FLOAT_TOLERANCE;
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

  const tolerance = resolveTolerance(options);
  for (let index = 0; index < actualTokens.length; index += 1) {
    const actualNumber = parseFiniteNumberToken(actualTokens[index]);
    const expectedNumber = parseFiniteNumberToken(expectedTokens[index]);
    if (actualNumber === null || expectedNumber === null) return null;
    if (!withinTolerance(actualNumber, expectedNumber, tolerance)) return null;
  }

  return {
    ok: true,
    actual: actualTokens.join(' '),
    expected: expectedTokens.join(' '),
    mode: 'float',
  };
}

/**
 * Special judge: problems whose answer is not unique cannot be graded by
 * comparing text. src/checkers/registry.json lists them and the matching
 * checker validates the submitted output against the statement's conditions.
 */
function compareSpecialJudge(actual, expected, context = {}) {
  const checker = resolveChecker(context.problemId);
  if (!checker) return null;

  const entry = getSpecialJudgeEntry(context.problemId);
  const mode = entry.mode === 'float' ? 'float' : `special-${entry.problemId}`;
  const result = checker({
    input: context.input,
    stdout: actual,
    expectedOutput: expected,
  });

  const comparison = {
    ok: result.ok === true,
    actual: normalizeOutput(actual),
    expected: normalizeOutput(expected),
    mode,
  };
  if (result.ok === true) return comparison;

  // 체커가 던진 예외는 학생의 오답이 아니라 서버 문제다. error 를 그대로 올려보낸다.
  return {
    ...comparison,
    code: result.code,
    reason: result.reason,
    ...(result.error === true ? { error: true } : {}),
  };
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

  // 특수 채점 대상이면 체커의 판정이 최종이다. 토큰 비교로 되돌아가지 않는다.
  const special = compareSpecialJudge(actual, expected, context);
  if (special) return special;

  if (context.floatTolerance === true) {
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
  compareSpecialJudge,
  compareOutputs,
};
