'use strict';

// 2467 용액 / 2470 두 용액 — "경우가 두 개 이상일 경우에는 그 중 아무것이나 하나를 출력한다".
//
// 특성값 합의 절댓값 최솟값은 유일하지만, 그 최솟값을 만드는 쌍은 여럿일 수 있다.
// (예: -2 와 3, 그리고 -3 과 2 는 둘 다 |합| = 1 이다.)
// 그래서 기대 출력의 합으로 최솟값만 가져오고, 제출 출력은 조건을 직접 검사한다.
//
// 검사 항목
//   1. 정수 두 개인가
//   2. 오름차순인가 (지문이 "특성값의 오름차순으로 출력한다" 로 서식을 고정했다)
//   3. 입력 용액 중 서로 다른 두 개인가 (같은 값이면 입력에 그 값이 두 번 이상 있어야 한다)
//   4. 두 값의 합의 절댓값이 최솟값과 같은가

const { fail, pass, tokenize, toIntegers } = require('./utils');

function parseSolutions(input, problemId) {
  const { values } = toIntegers(tokenize(input));
  if (values === null || values.length < 1) {
    throw new Error(`${problemId} input must be a list of integers`);
  }
  const size = values[0];
  const solutions = values.slice(1, size + 1);
  if (solutions.length !== size) {
    throw new Error(`${problemId} input must contain N characteristic values after N`);
  }
  return solutions;
}

function optimalAbsoluteSum(expectedOutput, problemId) {
  const { values } = toIntegers(tokenize(expectedOutput));
  if (values === null || values.length !== 2) {
    throw new Error(`${problemId} expected output must be exactly two integers`);
  }
  return Math.abs(values[0] + values[1]);
}

function createSolutionPairChecker(problemId) {
  return function check({ input, stdout, expectedOutput }) {
    const solutions = parseSolutions(input, problemId);
    const optimal = optimalAbsoluteSum(expectedOutput, problemId);

    const tokens = tokenize(stdout);
    if (tokens.length === 0) {
      return fail('empty_output', '출력이 비어 있습니다.');
    }
    if (tokens.length !== 2) {
      return fail('token_count_mismatch', `특성값 2개를 출력해야 하는데 ${tokens.length}개입니다.`);
    }

    const { values, badIndex } = toIntegers(tokens);
    if (values === null) {
      return fail('not_integer', `${badIndex}번째 값이 정수가 아닙니다.`);
    }

    const [first, second] = values;
    if (first > second) {
      return fail('not_ascending', '두 특성값을 오름차순으로 출력해야 합니다.');
    }

    // 서로 다른 두 용액이어야 한다. 값이 같다면 입력에 그 값이 두 번 이상 있어야 한다.
    const available = new Map();
    for (const value of solutions) {
      available.set(value, (available.get(value) ?? 0) + 1);
    }
    for (const value of values) {
      const remaining = available.get(value) ?? 0;
      if (remaining === 0) {
        return fail('not_in_input', '입력에 없는 특성값을 출력했습니다.');
      }
      available.set(value, remaining - 1);
    }

    if (Math.abs(first + second) !== optimal) {
      return fail('not_optimal', '두 특성값의 합이 0 에 가장 가깝지 않습니다.');
    }

    return pass();
  };
}

module.exports = { createSolutionPairChecker };
