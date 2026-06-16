'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  compareOutputs,
  validateHideAndSeekPath,
  validateLisOutput,
} = require('../src/compare');

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
  assert.equal(compareOutputs('0.526562 extra', '0.5265618908306351 extra', { problemId: 1344 }).ok, false);
  assert.equal(compareOutputs('0.526562', '0.5265618908306351', { problemId: 1000 }).ok, false);
});

test('13913 special judge accepts any shortest valid path only', () => {
  const input = '5 17\n';
  assert.equal(validateHideAndSeekPath('4\n5 10 9 18 17\n', input).ok, true);
  assert.equal(validateHideAndSeekPath('4\n5 4 8 16 17\n', input).ok, true);
  assert.equal(validateHideAndSeekPath('0\n0\n', '0 0\n').ok, true);

  assert.equal(validateHideAndSeekPath('5\n5 4 8 16 17 18\n', input), null, 'non-shortest distance fails');
  assert.equal(validateHideAndSeekPath('4\n5 11 12 16 17\n', input), null, 'invalid transition fails');
  assert.equal(validateHideAndSeekPath('4\n4 8 16 18 17\n', input), null, 'wrong start fails');
  assert.equal(validateHideAndSeekPath('4\n5 4 8 16\n', input), null, 'wrong end/missing token fails');
});

test('14003 special judge accepts any valid LIS only', () => {
  const publicInput = '6\n10 20 10 30 20 50\n';
  assert.equal(validateLisOutput('4\n10 20 30 50\n', publicInput).ok, true);
  assert.equal(validateLisOutput('1\n5\n', '5\n5 4 3 2 1\n').ok, true);
  assert.equal(validateLisOutput('1\n2\n', '4\n2 2 2 2\n').ok, true);
  assert.equal(validateLisOutput('5\n-3 -2 0 1 5\n', '7\n-3 -2 -2 0 4 1 5\n').ok, true);

  assert.equal(validateLisOutput('3\n10 20 50\n', publicInput), null, 'reported length must be true LIS length');
  assert.equal(validateLisOutput('4\n10 20 20 50\n', publicInput), null, 'sequence must strictly increase');
  assert.equal(validateLisOutput('4\n10 20 40 50\n', publicInput), null, 'sequence must be a subsequence');
  assert.equal(validateLisOutput('4\n10 30 20 50\n', publicInput), null, 'subsequence must preserve increasing order');
});
