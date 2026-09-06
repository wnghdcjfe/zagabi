'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compareOutputs } = require('../src/compare');

test('BOJ token comparison accepts whitespace layout only', () => {
  const accepted = compareOutputs('0 1 2 0 \n-1\t-1 0 1 \n', '0 1 2 0\n-1 -1 0 1\n');
  assert.equal(accepted.ok, true);
  assert.equal(accepted.mode, 'tokens');

  assert.equal(compareOutputs('0 1 3', '0 1 2').ok, false, 'changed token must fail');
  assert.equal(compareOutputs('0 1 2 3', '0 1 2').ok, false, 'extra token must fail');
  assert.equal(compareOutputs('12', '1 2').ok, false, 'merged token must fail');
  assert.equal(compareOutputs('2 1', '1 2').ok, false, 'reordered token must fail');
});

test('floating comparison is narrow and problem-scoped', () => {
  const accepted = compareOutputs('0.526562', '0.5265618908306351', { problemId: 1344 });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.mode, 'float');

  assert.equal(compareOutputs('0.5265', '0.5265618908306351', { problemId: 1344 }).ok, false);
  assert.equal(compareOutputs('0.526562', '0.5265618908306351', { problemId: 1000 }).ok, false);

  // 숫자가 아닌 토큰은 서식 자유가 없다. 그대로 같아야 하고, 개수도 맞아야 한다.
  assert.equal(compareOutputs('0.526562 extra', '0.5265618908306351 extra', { problemId: 1344 }).ok, true);
  assert.equal(compareOutputs('0.526562 other', '0.5265618908306351 extra', { problemId: 1344 }).ok, false);
  assert.equal(compareOutputs('0.526562', '0.5265618908306351 extra', { problemId: 1344 }).ok, false);
});

test('special judge accepts any answer that satisfies the statement', () => {
  // 13913: 지문 samples[0] 과 samples[1] 이 같은 입력에 서로 다른 경로를 정답으로 준다.
  const hideAndSeek = { problemId: 13913, input: '5 17\n' };
  assert.equal(compareOutputs('4\n5 10 9 18 17\n', '4\n5 4 8 16 17\n', hideAndSeek).ok, true);
  assert.equal(compareOutputs('5\n5 6 7 8 16 17\n', '4\n5 4 8 16 17\n', hideAndSeek).ok, false);

  // 14003: 기준 풀이는 둘째 줄을 줄바꿈으로 구분한다. 공백 구분도, 다른 LIS 도 정답이다.
  const lis = { problemId: 14003, input: '6\n10 20 10 30 20 50\n' };
  assert.equal(compareOutputs('4\n10 20 30 50\n', '4\n10\n20\n30\n50\n', lis).ok, true);
  assert.equal(compareOutputs('4\n10 10 30 50\n', '4\n10\n20\n30\n50\n', lis).ok, false);
});

test('special judge verdicts carry a reason that never quotes the test case', () => {
  const rejected = compareOutputs('3\n12 5 2 1\n', '3\n12 4 2 1', { problemId: 12852, input: '12\n' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.mode, 'special-12852');
  assert.equal(rejected.code, 'invalid_transition');
  // 사유에는 위치만 담는다. 프라이빗 케이스의 사유도 학생에게 그대로 내려가기 때문이다.
  assert.match(rejected.reason, /^\d+번째에서 \d+번째로 가는 연산이/u);

  // 같은 자리에서 같은 이유로 틀렸다면, 케이스가 달라도 사유 문구는 똑같아야 한다.
  const first = compareOutputs('2\n1 4\n', '3\n1 3 4', { problemId: 14002, input: '4\n1 3 2 4\n' });
  const second = compareOutputs('2\n5 9\n', '5\n5 6 7 8 9', { problemId: 14002, input: '5\n5 6 7 8 9\n' });
  assert.equal(first.code, 'not_optimal');
  assert.equal(first.reason, second.reason, '사유가 케이스마다 달라지면 값이 새어 나간 것이다');
});

test('problems outside the registry stay on strict comparison', () => {
  assert.equal(compareOutputs('3\n1 2 3\n', '3\n1 2 3\n', { problemId: 1000 }).mode, 'exact');
  assert.equal(compareOutputs('3\n1 2 3\n', '3\n1 2 4\n', { problemId: 1000 }).ok, false);
  assert.equal(compareOutputs('0.5', '0.5000001', { problemId: 1000 }).ok, false, '오차 허용은 등재된 문제만');
});
