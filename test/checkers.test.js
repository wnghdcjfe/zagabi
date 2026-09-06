'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  MAX_CHECKER_STDOUT_BYTES,
  getSpecialJudgeEntry,
  listSpecialJudgeProblemIds,
  resolveChecker,
} = require('../src/checkers');
const { createFloatChecker, withinTolerance } = require('../src/checkers/float');
const { compareOutputs } = require('../src/compare');

const alternativeAnswers = require('./fixtures/alternative-answers.json');
const statementSamples = require('./fixtures/statement-samples.json');

function accept(problemId, testCase, stdout) {
  const result = resolveChecker(problemId)({
    input: testCase.input,
    stdout,
    expectedOutput: testCase.output,
  });
  assert.equal(result.ok, true, `expected accept but got: ${result.reason}`);
}

function reject(problemId, testCase, stdout, expectedCode) {
  const result = resolveChecker(problemId)({
    input: testCase.input,
    stdout,
    expectedOutput: testCase.output,
  });
  assert.equal(result.ok, false, 'expected reject but the checker accepted');
  assert.equal(result.error ?? false, false, `checker crashed: ${result.reason}`);
  if (expectedCode) assert.equal(result.code, expectedCode);
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
}

test('registry lists every problem whose answer is not unique', () => {
  assert.deepEqual(listSpecialJudgeProblemIds(), [
    1007, 1064, 1069, 1198, 1340, 1344, 1546, 2467, 2470, 2816, 11780, 12852, 13913, 14002, 14003,
  ]);

  assert.equal(resolveChecker(1000), null, 'strict comparison problems must have no checker');
  assert.equal(resolveChecker(11658), null);

  assert.equal(getSpecialJudgeEntry(1007).mode, 'float');
  assert.equal(getSpecialJudgeEntry(1007).epsilon, 1e-6);
  assert.equal(getSpecialJudgeEntry(1064).epsilon, 1e-9);
  assert.equal(getSpecialJudgeEntry(1546).epsilon, 1e-2);
  assert.equal(getSpecialJudgeEntry(12852).mode, 'custom');
});

test('a checker crash is an internal error, not a wrong answer', () => {
  // 12852 체커는 입력 첫 토큰이 정수라고 가정한다. 깨진 입력은 학생의 오답이 아니라 서버 문제다.
  const crashed = resolveChecker(12852)({
    input: 'not-a-number\n',
    stdout: '0\n1\n',
    expectedOutput: '0\n1\n',
  });
  assert.equal(crashed.ok, false);
  assert.equal(crashed.error, true);
  assert.equal(crashed.code, 'checker_error');

  // compareOutputs 까지 올라오면 judge 가 WA 가 아니라 IE 로 채점한다.
  // (글자까지 같으면 체커를 부르기 전에 통과하므로 줄바꿈이 다른 출력으로 확인한다.)
  const comparison = compareOutputs('0 1\n', '0\n1\n', { problemId: 12852, input: 'not-a-number\n' });
  assert.equal(comparison.ok, false);
  assert.equal(comparison.error, true);

  // 반대로 기대 출력과 글자까지 같으면 체커가 터져도 정답이다. 학생을 체커 버그의 볼모로 두지 않는다.
  assert.equal(compareOutputs('0\n1\n', '0\n1\n', { problemId: 12852, input: 'not-a-number\n' }).ok, true);
});

test('an oversized output is rejected without running the checker', () => {
  const result = resolveChecker(14002)({
    input: '1\n7\n',
    stdout: 'x'.repeat(MAX_CHECKER_STDOUT_BYTES + 1),
    expectedOutput: '1\n7\n',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'output_too_large');
});

test('a correct answer that differs from the reference output is accepted', () => {
  const failures = [];
  for (const testCase of alternativeAnswers.cases) {
    const comparison = compareOutputs(testCase.alternativeStdout, testCase.expectedOutput, {
      problemId: testCase.problemId,
      input: testCase.input,
    });
    if (!comparison.ok) {
      failures.push(`${testCase.problemId} ${testCase.title}: ${comparison.reason || comparison.mode}`);
    }
  }
  assert.deepEqual(failures, [], '정답인 다른 출력이 오답으로 채점됐다');
  assert.equal(alternativeAnswers.cases.length, 15);
});

test('checkers accept every statement sample of their problem', () => {
  for (const problemId of listSpecialJudgeProblemIds()) {
    const samples = statementSamples.samples[String(problemId)] || [];
    assert.ok(samples.length > 0, `${problemId} 지문 샘플이 없다`);
    const checker = resolveChecker(problemId);
    samples.forEach((sample, index) => {
      const result = checker({
        input: sample.input,
        stdout: sample.output,
        expectedOutput: sample.output,
      });
      assert.equal(result.ok, true, `${problemId} sample ${index} rejected: ${result.reason}`);
    });
  }
});

test('statement samples that answer the same input differently are both accepted', () => {
  // 13913 samples[0]/[1] 과 2816 samples[1]/[2] 는 같은 입력에 서로 다른 정답을 제시한다.
  const [first, second] = statementSamples.samples['13913'];
  assert.equal(first.input, second.input);
  accept(13913, { input: first.input, output: second.output }, first.output);
  accept(13913, { input: second.input, output: first.output }, second.output);

  const [, third, fourth] = statementSamples.samples['2816'];
  assert.equal(third.input, fourth.input);
  accept(2816, { input: third.input, output: fourth.output }, third.output);
  accept(2816, { input: fourth.input, output: third.output }, fourth.output);
});

test('float checker accepts the same value written with different precision', () => {
  const check = createFloatChecker(1e-9);

  // 1064: 지문 기대 출력과 기준 풀이 출력이 세 갈래로 어긋나는 실제 사례다.
  assert.equal(check({ stdout: '0.8284271247461903\n', expectedOutput: '0.8284271247461898\n' }).ok, true);
  assert.equal(check({ stdout: '4.0000000000000000\n', expectedOutput: '4.0\n' }).ok, true);
  assert.equal(check({ stdout: '-1\n', expectedOutput: '-1.0\n' }).ok, true);
  assert.equal(check({ stdout: '1e3\n', expectedOutput: '1000.0\n' }).ok, true);
  assert.equal(check({ stdout: '1000000000.0000001\n', expectedOutput: '1000000000.0\n' }).ok, true);
});

test('float checker rejects values outside the tolerance and non-numeric mismatches', () => {
  const check = createFloatChecker(1e-9);

  assert.equal(check({ stdout: '0.83\n', expectedOutput: '0.8284271247461898\n' }).code, 'tolerance_exceeded');
  assert.equal(check({ stdout: '1.0 2.0\n', expectedOutput: '1.0\n' }).code, 'token_count_mismatch');
  assert.equal(check({ stdout: '', expectedOutput: '1.0\n' }).code, 'token_count_mismatch');
  assert.equal(check({ stdout: 'impossible\n', expectedOutput: 'IMPOSSIBLE\n' }).code, 'token_mismatch');
  assert.equal(check({ stdout: 'nan\n', expectedOutput: '1.0\n' }).code, 'token_mismatch');
});

test('float tolerance treats absolute and relative error independently', () => {
  const epsilon = 1e-9;
  assert.equal(withinTolerance(1e-10, 0, epsilon), true);
  assert.equal(withinTolerance(1e-8, 0, epsilon), false, '기대값이 0 이면 상대 오차가 없다');
  assert.equal(withinTolerance(1e12 + 1, 1e12, epsilon), true, '큰 값은 상대 오차로 통과한다');

  // 오차는 문제마다 다르다. 1e-2 인 1546 이 통과하는 값이 1e-6 인 1007 에서는 떨어져야 한다.
  assert.equal(compareOutputs('66.67', '66.666667', { problemId: 1546 }).ok, true);
  assert.equal(compareOutputs('66.67', '66.666667', { problemId: 1007 }).ok, false);
});

test('12852 accepts any minimal operation path only', () => {
  const case12 = { input: '12\n', output: '3\n12 4 2 1' };

  accept(12852, case12, '3\n12 4 2 1\n');
  accept(12852, case12, '3\n12 6 3 1\n');
  accept(12852, { input: '1\n', output: '0\n1' }, '0\n1\n');

  reject(12852, case12, '4\n12 6 3 2 1\n', 'not_optimal');
  reject(12852, case12, '3\n12 5 2 1\n', 'invalid_transition');
  reject(12852, case12, '3\n12 4 2\n', 'length_mismatch');
  reject(12852, case12, '3\n4 2 1 1\n', 'bad_start');
  reject(12852, case12, '3\n12 4 2 2\n', 'bad_end');
  reject(12852, case12, '', 'empty_output');
});

test('13913 accepts any shortest valid path only', () => {
  const case5to17 = { input: '5 17\n', output: '4\n5 4 8 16 17' };

  accept(13913, case5to17, '4\n5 10 9 18 17\n');
  accept(13913, case5to17, '4\n5 4 8 16 17\n');
  accept(13913, { input: '0 0\n', output: '0\n0' }, '0\n0\n');

  reject(13913, case5to17, '5\n5 6 7 8 16 17\n', 'not_optimal');
  reject(13913, case5to17, '4\n5 10 9 17 17\n', 'invalid_transition');
  reject(13913, case5to17, '4\n5 10 9 18 19\n', 'bad_end');
  reject(13913, { input: '2 0\n', output: '2\n2 1 0' }, '2\n2 -1 0\n', 'out_of_range');
});

test('14002 and 14003 accept any longest increasing subsequence only', () => {
  // A = {1, 3, 2, 4} 는 길이 3 짜리 LIS 가 `1 3 4` 와 `1 2 4` 로 둘이다.
  const spaced = { input: '4\n1 3 2 4\n', output: '3\n1 3 4' };
  // 14003 기준 풀이는 둘째 줄을 줄바꿈으로 구분해 출력한다. 공백 구분 풀이도 정답이다.
  const newlined = { input: '4\n1 3 2 4\n', output: '3\n1\n3\n4\n' };

  accept(14002, spaced, '3\n1 3 4\n');
  accept(14002, spaced, '3\n1 2 4\n');
  accept(14003, newlined, '3\n1 3 4\n');
  accept(14003, newlined, '3\n1 2 4\n');
  accept(14002, { input: '1\n7\n', output: '1\n7' }, '1\n7\n');

  reject(14002, spaced, '2\n1 4\n', 'not_optimal');
  reject(14002, spaced, '3\n1 3 3\n', 'not_increasing');
  reject(14002, spaced, '3\n1 2 5\n', 'not_subsequence');
  reject(14002, spaced, '3\n1 3\n', 'length_mismatch');
  // A = {2, 3, 1} 에서 1 은 3 보다 뒤에 있다. 값만 증가해도 그 순서로는 뽑을 수 없다.
  reject(14002, { input: '3\n2 3 1\n', output: '2\n2 3' }, '2\n1 3\n', 'not_subsequence');
  reject(14003, newlined, '2\n1 4\n', 'not_optimal');
});

test('2816 simulates the button sequence instead of comparing it', () => {
  const caseSample = { input: '4\nABC1\nABC02\nKBS2\nKBS1\n', output: '11144411144' };

  accept(2816, caseSample, '11144411144\n');
  accept(2816, caseSample, '33144413\n');
  // 화살표가 범위를 넘어가는 명령은 무시되므로 앞에 2 를 아무리 붙여도 결과가 같다.
  accept(2816, caseSample, '2222211144411144\n');

  reject(2816, caseSample, '1111\n', 'bad_final_state');
  reject(2816, caseSample, '111444111445\n', 'invalid_button');
  reject(2816, caseSample, '2'.repeat(500), 'too_long');
  reject(2816, caseSample, '111 444\n', 'extra_output');
});

test('2467 and 2470 accept any pair whose sum is closest to zero', () => {
  // -3 + 3 과 -2 + 2 는 둘 다 합이 0 이다. 어느 쪽을 내도 정답이다.
  const sorted = { input: '4\n-3 -2 2 3\n', output: '-2 2' };
  const unsorted = { input: '4\n2 -3 3 -2\n', output: '-2 2' };

  accept(2467, sorted, '-3 3\n');
  accept(2467, sorted, '-2 2\n');
  accept(2470, unsorted, '-3 3\n');

  reject(2467, sorted, '3 -3\n', 'not_ascending');
  reject(2467, sorted, '-3 2\n', 'not_optimal');
  reject(2467, sorted, '-3 4\n', 'not_in_input');
  // 같은 값을 두 번 쓰려면 입력에 그 값이 두 번 있어야 한다.
  reject(2467, sorted, '2 2\n', 'not_in_input');
  reject(2467, sorted, '-3\n', 'token_count_mismatch');
  reject(2467, sorted, '-3 x\n', 'not_integer');
});

test('11780 verifies each path against the edges instead of comparing it', () => {
  // 1 -> 3 의 최소 비용 2 는 직행(2)과 1 -> 2 -> 3(1+1) 둘 다로 만들 수 있다.
  const tie = {
    input: '3 3\n1 2 1\n2 3 1\n1 3 2\n',
    output: '0 1 2\n0 0 1\n0 0 0\n0\n2 1 2\n2 1 3\n0\n0\n2 2 3\n0\n0\n0\n',
  };
  // 비용 행렬은 같지만 직행이 5 라 1 -> 3 직행은 최소가 아니다.
  const detour = { input: '3 3\n1 2 1\n2 3 1\n1 3 5\n', output: tie.output };
  const viaTwo = '0 1 2\n0 0 1\n0 0 0\n0\n2 1 2\n3 1 2 3\n0\n0\n2 2 3\n0\n0\n0\n';

  accept(11780, tie, tie.output);
  accept(11780, tie, viaTwo);
  accept(11780, detour, viaTwo);

  reject(11780, detour, tie.output, 'not_minimal');
  reject(11780, tie, '0 1 3\n0 0 1\n0 0 0\n0\n2 1 2\n2 1 3\n0\n0\n2 2 3\n0\n0\n0\n', 'cost_mismatch');
  reject(11780, tie, '0 1 2\n0 0 1\n0 0 0\n2 1 1\n2 1 2\n2 1 3\n0\n0\n2 2 3\n0\n0\n0\n', 'expected_zero');
  reject(11780, tie, '0 1 2\n0 0 1\n0 0 0\n0\n1 2\n2 1 3\n0\n0\n2 2 3\n0\n0\n0\n', 'path_too_short');
  reject(11780, tie, '0 1 2\n0 0 1\n0 0 0\n0\n2 1 3\n2 1 3\n0\n0\n2 2 3\n0\n0\n0\n', 'bad_endpoints');
  reject(11780, tie, '0 1 2\n0 0 1\n0 0 0\n0\n2 1 2\n2 1 3\n0\n0\n3 2 1 3\n0\n0\n0\n', 'no_such_edge');
  reject(11780, tie, `${tie.output}0\n`, 'too_long');
});
