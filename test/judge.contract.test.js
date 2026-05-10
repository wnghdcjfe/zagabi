'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

function loadJudge() {
  try {
    const mod = require('../src/judge');
    const candidates = [
      mod,
      mod && mod.judge,
      mod && mod.runJudge,
      mod && mod.judgeSubmission,
      mod && mod.evaluateSubmission,
      mod && mod.default,
    ];
    const fn = candidates.find((candidate) => typeof candidate === 'function');
    return { fn, missing: !fn };
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('../src/judge')) {
      return { missing: true, error };
    }
    throw error;
  }
}

function verdictOf(result) {
  return String(
    result && (result.verdict || result.status || result.result || result.outcome || result.code) || ''
  ).toUpperCase();
}

async function runJudgeCase(t, sourceCode, extra = {}) {
  const { fn, missing, error } = loadJudge();
  if (missing) {
    t.skip(`src/judge.js contract target is not available yet${error ? `: ${error.message}` : ''}`);
    return null;
  }

  return await fn({
    problemId: 'contract-smoke',
    sourceCode,
    language: 'cpp',
    timeLimit: extra.timeLimit || '1 초',
    memoryLimit: extra.memoryLimit || '128 MB',
    testCases: extra.testCases || [
      { input: '2 3\n', output: '5\n' },
      { input: '10 -4\n', output: '6\n' },
    ],
  });
}

const addTwoAccepted = `#include <bits/stdc++.h>
using namespace std;
int main(){ long long a,b; if(cin>>a>>b) cout << (a+b) << "\\n"; }
`;

const wrongAnswer = `#include <bits/stdc++.h>
using namespace std;
int main(){ cout << 0 << "\\n"; }
`;

const compileError = `#include <bits/stdc++.h>
using namespace std;
int main(){ this is not valid C++ }
`;

const infiniteLoop = `#include <bits/stdc++.h>
using namespace std;
int main(){ volatile int x = 0; while(true){ ++x; } }
`;

test('judge contract returns AC for matching C++ output', async (t) => {
  const result = await runJudgeCase(t, addTwoAccepted);
  if (!result) return;

  assert.equal(verdictOf(result), 'AC', JSON.stringify(result, null, 2));
  assert.ok(Array.isArray(result.cases || result.testCases || result.results), 'expected per-case debug details array');
});

test('judge contract returns WA for mismatched output', async (t) => {
  const result = await runJudgeCase(t, wrongAnswer);
  if (!result) return;

  assert.equal(verdictOf(result), 'WA', JSON.stringify(result, null, 2));
});

test('judge contract returns CE with compile diagnostics for invalid C++', async (t) => {
  const result = await runJudgeCase(t, compileError);
  if (!result) return;

  assert.equal(verdictOf(result), 'CE', JSON.stringify(result, null, 2));
  assert.ok(
    result.compileLog || result.stderr || result.error || result.details,
    'expected compile diagnostics in compileLog/stderr/error/details'
  );
});

test('judge contract returns TLE for non-terminating C++', { timeout: 5000 }, async (t) => {
  const result = await runJudgeCase(t, infiniteLoop, {
    timeLimit: '1 초',
    testCases: [{ input: '', output: '' }],
  });
  if (!result) return;

  assert.equal(verdictOf(result), 'TLE', JSON.stringify(result, null, 2));
});
