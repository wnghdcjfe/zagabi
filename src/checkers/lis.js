'use strict';

// 14002 가장 긴 증가하는 부분 수열 4 / 14003 가장 긴 증가하는 부분 수열 5 — LIS 는 길이만 유일하다.
// 14002 는 "그러한 수열이 여러가지인 경우 아무거나 출력한다" 고 적었고, 14003 은 "정답이 될 수 있는
// 가장 긴 증가하는 부분 수열" 이라고만 적었지만 둘 다 수열 자체는 여럿일 수 있다.
// (예: A = {1, 3, 2, 4} 는 `1 3 4` 와 `1 2 4` 가 모두 길이 3 짜리 LIS 다.)
//
// LIS 길이는 유일하므로 첫 줄은 기대 출력과 그대로 비교하고,
// 둘째 줄은 A 의 부분수열이면서 강하게 증가하는지 직접 검증한다.

const { fail, pass, readExpectedInteger, tokenize, toIntegers } = require('./utils');

function createLisChecker(problemId) {
  return function check({ input, stdout, expectedOutput }) {
    const { values: inputValues } = toIntegers(tokenize(input));
    if (inputValues === null || inputValues.length < 1) {
      throw new Error(`${problemId} input must be a list of integers`);
    }
    const size = inputValues[0];
    const sequence = inputValues.slice(1, size + 1);
    if (sequence.length !== size) {
      throw new Error(`${problemId} input must contain N numbers after N`);
    }
    const expectedLength = readExpectedInteger(expectedOutput);

    const tokens = tokenize(stdout);
    if (tokens.length === 0) {
      return fail('empty_output', '출력이 비어 있습니다.');
    }

    const { values, badIndex } = toIntegers(tokens);
    if (values === null) {
      return fail('not_integer', `${badIndex}번째 값이 정수가 아닙니다.`);
    }

    const length = values[0];
    if (length !== expectedLength) {
      return fail('not_optimal', '첫째 줄의 길이가 최댓값이 아닙니다.');
    }

    const answer = values.slice(1);
    if (answer.length !== length) {
      return fail('length_mismatch', `둘째 줄의 수는 ${length}개여야 하는데 ${answer.length}개입니다.`);
    }

    for (let index = 0; index + 1 < answer.length; index += 1) {
      if (answer[index] >= answer[index + 1]) {
        return fail('not_increasing', `${index + 1}번째와 ${index + 2}번째가 증가하지 않습니다.`);
      }
    }

    // 순서를 지키는 부분수열인지 확인한다. 값만 증가해도 A 에서 그 순서로 뽑을 수 없으면 오답이다.
    let cursor = 0;
    for (let index = 0; index < answer.length; index += 1) {
      while (cursor < sequence.length && sequence[cursor] !== answer[index]) {
        cursor += 1;
      }
      if (cursor === sequence.length) {
        return fail('not_subsequence', `${index + 1}번째 값부터는 수열 A 에서 순서대로 뽑을 수 없습니다.`);
      }
      cursor += 1;
    }

    return pass();
  };
}

module.exports = { createLisChecker };
