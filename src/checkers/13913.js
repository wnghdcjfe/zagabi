'use strict';

// 13913 숨바꼭질 4 — 최소 시간 경로가 유일하지 않다.
// 지문 samples[0] 과 samples[1] 이 같은 입력 `5 17` 에 서로 다른 경로를 정답으로 제시한다.
//
// 최소 시간은 유일하므로 첫 줄은 기대 출력과 그대로 비교하고,
// 둘째 줄은 N 에서 K 까지 실제로 이어지는 이동열인지 직접 검증한다.
//
// 위치 상한은 두지 않는다. 지문은 주어지는 N, K 의 범위만 정하고 이동 중 위치의 상한은
// 정하지 않는다. 상한 [0, 100000] 은 풀이 쪽 탐색 범위 최적화이지 정답의 조건이 아니다.
// 최적성은 기대 출력의 첫 줄이 이미 못 박고 있으므로 범위로 다시 조일 이유가 없다.

const { fail, pass, readExpectedInteger, tokenize, toIntegers } = require('./utils');

function check({ input, stdout, expectedOutput }) {
  const { values: inputValues } = toIntegers(tokenize(input).slice(0, 2));
  if (inputValues === null || inputValues.length < 2) {
    throw new Error('13913 input must start with two integers');
  }
  const [start, goal] = inputValues;
  const expectedSeconds = readExpectedInteger(expectedOutput);

  const tokens = tokenize(stdout);
  if (tokens.length === 0) {
    return fail('empty_output', '출력이 비어 있습니다.');
  }

  const { values, badIndex } = toIntegers(tokens);
  if (values === null) {
    return fail('not_integer', `${badIndex}번째 값이 정수가 아닙니다.`);
  }

  const seconds = values[0];
  if (seconds !== expectedSeconds) {
    return fail('not_optimal', '첫째 줄의 시간이 최솟값이 아닙니다.');
  }

  const path = values.slice(1);
  if (path.length !== seconds + 1) {
    return fail('length_mismatch', `둘째 줄의 위치는 ${seconds + 1}개여야 하는데 ${path.length}개입니다.`);
  }
  if (path[0] !== start) {
    return fail('bad_start', '둘째 줄은 N 에서 시작해야 합니다.');
  }
  if (path[path.length - 1] !== goal) {
    return fail('bad_end', '둘째 줄은 K 에서 끝나야 합니다.');
  }

  for (let index = 0; index < path.length; index += 1) {
    if (path[index] < 0) {
      return fail('out_of_range', `${index + 1}번째 위치가 음수입니다.`);
    }
  }

  for (let index = 0; index + 1 < path.length; index += 1) {
    const current = path[index];
    const next = path[index + 1];
    if (next !== current - 1 && next !== current + 1 && next !== current * 2) {
      return fail(
        'invalid_transition',
        `${index + 1}번째에서 ${index + 2}번째로 가는 이동이 걷기(X-1, X+1)도 순간이동(2X)도 아닙니다.`,
      );
    }
  }

  return pass();
}

module.exports = { check };
