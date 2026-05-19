'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
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

function loadJudgeModule() {
  return require('../src/judge');
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

test('judge contract compiles from temp paths with spaces and non-ASCII characters', async (t) => {
  const { judgeSubmission } = loadJudgeModule();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'judge 한글 path-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));

  const result = await judgeSubmission({
    problemId: 'contract-temp-path',
    sourceCode: addTwoAccepted,
    language: 'cpp',
    timeLimit: '1 초',
    memoryLimit: '128 MB',
    testCases: [
      { input: '7 8\n', output: '15\n' },
    ],
  }, { tempRoot });

  assert.equal(verdictOf(result), 'AC', JSON.stringify(result, null, 2));
  assert.match(result.compile.command, /main\.cpp/);
  assert.doesNotMatch(result.compile.command, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('default compile args avoid Windows-only path and pipe pitfalls', () => {
  const {
    binaryFileNameForPlatform,
    cppStandardForLanguage,
    buildDefaultCompileArgs,
    executableCommandForFile,
  } = loadJudgeModule();

  const winArgs = buildDefaultCompileArgs({ platform: 'win32' });
  assert.equal(binaryFileNameForPlatform('win32'), 'main.exe');
  assert.equal(winArgs[0], '-std=gnu++17');
  assert.equal(winArgs.includes('-pipe'), false);
  assert.ok(winArgs.includes('-finput-charset=UTF-8'));
  assert.ok(winArgs.includes('-fexec-charset=UTF-8'));
  assert.deepEqual(winArgs.slice(-3), ['main.cpp', '-o', 'main.exe']);
  assert.equal(cppStandardForLanguage('gnu++20'), 'gnu++20');
  assert.equal(buildDefaultCompileArgs({ platform: 'win32', language: 'gnu++20' })[0], '-std=gnu++20');

  const posixArgs = buildDefaultCompileArgs({ platform: 'linux' });
  assert.equal(binaryFileNameForPlatform('linux'), 'main');
  assert.equal(posixArgs[0], '-std=gnu++17');
  assert.equal(posixArgs.includes('-pipe'), true);
  assert.deepEqual(posixArgs.slice(-3), ['main.cpp', '-o', 'main']);
  assert.equal(executableCommandForFile('main', 'linux'), './main');
  assert.equal(executableCommandForFile('main.exe', 'win32'), '.\\main.exe');
});

test('judge contract normalizes copied explanation code before compiling', async (t) => {
  const { judgeSubmission, normalizeSubmissionSource } = loadJudgeModule();
  const copiedExplanationCode = [
    '```cpp',
    '\uFEFF#include <bits/stdc++.h>',
    'using namespace std;',
    'int main(){ int a\u00A0=\u00A040; cout << a + 2 << "\\n"; }',
    '```',
    '',
  ].join('\r\n');

  assert.doesNotMatch(normalizeSubmissionSource(copiedExplanationCode), /```|\uFEFF|\u00A0/);

  const result = await judgeSubmission({
    problemId: 'contract-copied-source',
    sourceCode: copiedExplanationCode,
    language: 'cpp',
    timeLimit: '1 초',
    memoryLimit: '128 MB',
    testCases: [
      { input: '', output: '42\n' },
    ],
  });

  assert.equal(verdictOf(result), 'AC', JSON.stringify(result, null, 2));
});

test('Windows compile defaults avoid slow MinGW and risky temp path failures', () => {
  const {
    defaultCompileTimeoutMsForPlatform,
    resolveTempRoot,
    stripWrappingQuotes,
  } = loadJudgeModule();

  assert.equal(defaultCompileTimeoutMsForPlatform('linux', {}), 10_000);
  assert.equal(defaultCompileTimeoutMsForPlatform('win32', {}), 30_000);
  assert.equal(defaultCompileTimeoutMsForPlatform('win32', {
    JUDGE_COMPILE_TIMEOUT_MS: '45000',
  }), 45_000);
  assert.equal(stripWrappingQuotes('"C:\\msys64\\ucrt64\\bin\\g++.exe"'), 'C:\\msys64\\ucrt64\\bin\\g++.exe');
  assert.equal(resolveTempRoot({
    platform: 'win32',
    systemTempRoot: 'C:\\Users\\홍 길동\\AppData\\Local\\Temp',
    cwd: 'C:\\judge04',
    env: {},
  }), 'C:\\judge04\\.judge-tmp');
  assert.equal(resolveTempRoot({
    platform: 'win32',
    systemTempRoot: 'C:\\Users\\홍 길동\\AppData\\Local\\Temp',
    cwd: 'C:\\judge04',
    env: { JUDGE_TEMP_ROOT: 'D:\\judge-tmp' },
  }), 'D:\\judge-tmp');
});

test('judge contract tightens no-additional-time limits without changing accepted output', async (t) => {
  const result = await runJudgeCase(t, addTwoAccepted, {
    timeLimit: '2 초 (추가 시간 없음)',
  });
  if (!result) return;

  assert.equal(verdictOf(result), 'AC', JSON.stringify(result, null, 2));
  assert.equal(result.summary.timeLimitMs, 2000);
  assert.equal(result.summary.effectiveTimeLimitMs, 1500);
  assert.equal(result.summary.strictTimeLimitRatio, 0.75);
  assert.equal(result.summary.aggregateTimeLimitMs, 1500);
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

test('judge contract exposes compiler spawn errors as compile diagnostics', async () => {
  const { judgeSubmission } = loadJudgeModule();
  const result = await judgeSubmission({
    problemId: 'contract-missing-compiler',
    sourceCode: addTwoAccepted,
    language: 'cpp',
    timeLimit: '1 초',
    memoryLimit: '128 MB',
    testCases: [
      { input: '1 2\n', output: '3\n' },
    ],
  }, { compiler: path.join(os.tmpdir(), 'definitely-missing-g++') });

  assert.equal(verdictOf(result), 'CE', JSON.stringify(result, null, 2));
  assert.match(result.compileLog, /spawn|ENOENT|missing/i);
});

test('judge contract returns TLE for non-terminating C++', { timeout: 5000 }, async (t) => {
  const result = await runJudgeCase(t, infiniteLoop, {
    timeLimit: '1 초',
    testCases: [{ input: '', output: '' }],
  });
  if (!result) return;

  assert.equal(verdictOf(result), 'TLE', JSON.stringify(result, null, 2));
});

test('judge memory policy enforces MLE only on Linux by default', () => {
  const { resolveMemoryPolicy } = loadJudgeModule();

  const linux = resolveMemoryPolicy({ platform: 'linux', memoryLimitMb: 4 });
  assert.equal(linux.mode, 'enforced');
  assert.equal(linux.enforced, true);
  assert.equal(linux.trackMemory, true);

  for (const platform of ['darwin', 'win32']) {
    const native = resolveMemoryPolicy({ platform, memoryLimitMb: 4 });
    assert.equal(native.mode, 'advisory');
    assert.equal(native.enforced, false);
    assert.equal(native.trackMemory, false);
  }
});

test('judge memory policy can be forced or disabled explicitly', () => {
  const { resolveMemoryPolicy } = loadJudgeModule();

  const forced = resolveMemoryPolicy({
    platform: 'darwin',
    memoryLimitMb: 4,
    memoryPolicy: 'enforce',
  });
  assert.equal(forced.mode, 'enforced');
  assert.equal(forced.enforced, true);
  assert.equal(forced.trackMemory, true);

  const disabled = resolveMemoryPolicy({
    platform: 'linux',
    memoryLimitMb: 4,
    memoryPolicy: 'off',
  });
  assert.equal(disabled.mode, 'off');
  assert.equal(disabled.enforced, false);
  assert.equal(disabled.trackMemory, false);
});
