'use strict';

// 절대/상대 오차를 허용하는 실수 출력 문제용 범용 비교기.
//
// 기준 풀이의 고정 서식(setprecision)을 정답 문자열로 박으면 같은 값을 다른 자릿수로 출력한
// 올바른 풀이가 전부 오답이 된다. 1064 는 기준 풀이 출력이 지문 samples 5개 전부와 다르다.
// 그래서 토큰 단위로 끊어 숫자는 오차 비교, 숫자가 아니면 문자열 비교를 한다.

const { fail, pass, tokenize } = require('./utils');

const NUMERIC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

function parseNumeric(token) {
  if (!NUMERIC_RE.test(token)) return null;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

// 절대 오차와 상대 오차를 따로 본다. 기대값이 0 이면 상대 오차가 없으므로 절대 오차만 남는다.
function withinTolerance(actual, expected, epsilon) {
  const diff = Math.abs(actual - expected);
  if (diff <= epsilon) return true;
  const scale = Math.abs(expected);
  return scale > 0 && diff <= epsilon * scale;
}

function createFloatChecker(epsilon) {
  if (!Number.isFinite(epsilon) || epsilon <= 0) {
    throw new Error('float checker epsilon must be a positive finite number');
  }

  return function check({ stdout, expectedOutput }) {
    const actualTokens = tokenize(stdout);
    const expectedTokens = tokenize(expectedOutput);

    if (actualTokens.length !== expectedTokens.length) {
      return fail(
        'token_count_mismatch',
        `출력 값의 개수가 다릅니다. 기대 ${expectedTokens.length}개, 제출 ${actualTokens.length}개입니다.`,
      );
    }

    for (let index = 0; index < expectedTokens.length; index += 1) {
      const expectedValue = parseNumeric(expectedTokens[index]);
      const actualValue = parseNumeric(actualTokens[index]);

      // 기대 출력이 숫자가 아닌 자리는 서식 자유가 없으므로 그대로 같아야 한다.
      if (expectedValue === null || actualValue === null) {
        if (expectedTokens[index] !== actualTokens[index]) {
          return fail('token_mismatch', `${index + 1}번째 값이 기대 출력과 다릅니다.`);
        }
        continue;
      }

      if (!withinTolerance(actualValue, expectedValue, epsilon)) {
        return fail('tolerance_exceeded', `${index + 1}번째 값이 허용 오차(${epsilon})를 벗어났습니다.`);
      }
    }

    return pass();
  };
}

module.exports = {
  withinTolerance,
  createFloatChecker,
};
