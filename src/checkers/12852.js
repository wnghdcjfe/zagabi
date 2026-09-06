'use strict';

// 12852 1로 만들기 2 — "정답이 여러 가지인 경우에는 아무거나 출력한다".
//
// 최소 연산 횟수는 유일하므로 첫 줄은 기대 출력과 그대로 비교하고,
// 둘째 줄은 N 에서 1 까지 실제로 이어지는 연산열인지 직접 검증한다.

const { fail, pass, readExpectedInteger, tokenize, toInteger, toIntegers } = require('./utils');

function check({ input, stdout, expectedOutput }) {
  const target = toInteger(tokenize(input)[0]);
  if (target === null) {
    throw new Error('12852 input must start with an integer');
  }
  const expectedCount = readExpectedInteger(expectedOutput);

  const tokens = tokenize(stdout);
  if (tokens.length === 0) {
    return fail('empty_output', '출력이 비어 있습니다.');
  }

  const count = toInteger(tokens[0]);
  if (count === null) {
    return fail('not_integer', '첫째 줄은 연산 횟수(정수)여야 합니다.');
  }
  if (count !== expectedCount) {
    return fail('not_optimal', '첫째 줄의 연산 횟수가 최솟값이 아닙니다.');
  }

  const { values: path, badIndex } = toIntegers(tokens.slice(1));
  if (path === null) {
    return fail('not_integer', `둘째 줄 ${badIndex}번째 값이 정수가 아닙니다.`);
  }
  if (path.length !== count + 1) {
    return fail('length_mismatch', `둘째 줄의 수는 ${count + 1}개여야 하는데 ${path.length}개입니다.`);
  }
  if (path[0] !== target) {
    return fail('bad_start', '둘째 줄은 N 으로 시작해야 합니다.');
  }
  if (path[path.length - 1] !== 1) {
    return fail('bad_end', '둘째 줄은 1 로 끝나야 합니다.');
  }

  for (let index = 0; index + 1 < path.length; index += 1) {
    const current = path[index];
    const next = path[index + 1];
    const divisibleByThree = current % 3 === 0 && next === current / 3;
    const divisibleByTwo = current % 2 === 0 && next === current / 2;
    const decrement = next === current - 1;

    if (!divisibleByThree && !divisibleByTwo && !decrement) {
      return fail(
        'invalid_transition',
        `${index + 1}번째에서 ${index + 2}번째로 가는 연산이 3으로 나누기·2로 나누기·1 빼기 중 어느 것도 아닙니다.`,
      );
    }
  }

  return pass();
}

module.exports = { check };
