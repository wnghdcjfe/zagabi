'use strict';

// Keep real-judging contract assertions deterministic across CI hardware: the
// host-speed time-limit calibration would otherwise stretch effectiveTimeLimitMs
// on slow runners. The runtime-calibration logic is covered explicitly below
// with pure functions and forced env, not via the shared judging fixtures.
process.env.JUDGE_RUNTIME_CALIBRATION = 'off';

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

const shortWorkAccepted = `#include <bits/stdc++.h>
using namespace std;
int main(){
  auto started = chrono::steady_clock::now();
  while (chrono::duration_cast<chrono::milliseconds>(chrono::steady_clock::now() - started).count() < 20) {}
  int a,b;
  if(cin>>a>>b) cout << (a+b) << "\\n";
}
`;

const hideAndSeekAlternativePath = `#include <bits/stdc++.h>
using namespace std;
int main(){ cout << "4\\n5 4 8 16 17\\n"; }
`;

const lisNewlineOutput = `#include <bits/stdc++.h>
using namespace std;
int main(){ cout << "4\\n10\\n20\\n30\\n50\\n"; }
`;

const darwinY1CollisionSource = `#include <stdio.h>
#include <algorithm>
#include <queue>
using namespace std;
int n, m, x1, y1, x2, y2;
int main(){
  scanf("%d %d", &y1, &x1);
  printf("%d\\n", y1 + x1);
}
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
  // Windows binaries are statically linked so they do not depend on toolchain
  // runtime DLLs (libstdc++/libc++, libgcc/libunwind, libwinpthread) at run time.
  assert.equal(winArgs.includes('-static'), true);
  assert.ok(winArgs.includes('-finput-charset=UTF-8'));
  assert.ok(winArgs.includes('-fexec-charset=UTF-8'));
  assert.deepEqual(winArgs.slice(-3), ['main.cpp', '-o', 'main.exe']);

  // The bundled <bits/stdc++.h> shim must be on the include path (via -idirafter,
  // a fallback so toolchains shipping the real header keep using it) so that
  // submissions including it compile on Windows toolchains that lack the header.
  const idirafterIndex = winArgs.indexOf('-idirafter');
  assert.ok(idirafterIndex !== -1, 'default args must expose the bits/stdc++.h shim');
  assert.match(winArgs[idirafterIndex + 1], /runtime-include$/);
  assert.equal(
    buildDefaultCompileArgs({ platform: 'win32', bitsCompatIncludeDir: null }).includes('-idirafter'),
    false,
    'bitsCompatIncludeDir: null must omit the shim include path',
  );
  assert.equal(cppStandardForLanguage('gnu++20'), 'gnu++20');
  assert.equal(buildDefaultCompileArgs({ platform: 'win32', language: 'gnu++20' })[0], '-std=gnu++20');

  const posixArgs = buildDefaultCompileArgs({ platform: 'linux' });
  assert.equal(binaryFileNameForPlatform('linux'), 'main');
  assert.equal(posixArgs[0], '-std=gnu++17');
  assert.equal(posixArgs.includes('-pipe'), true);
  // POSIX/BOJ judging keeps dynamic linking (macOS does not support -static).
  assert.equal(posixArgs.includes('-static'), false);
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
  assert.equal(result.summary.aggregateTimeLimitMs, null);
});

test('no-additional-time does not aggregate separate testcase process launches', async (t) => {
  const testCases = Array.from({ length: 50 }, () => ({ input: '2 3\n', output: '5\n' }));
  const result = await runJudgeCase(t, shortWorkAccepted, {
    timeLimit: '1 초 (추가 시간 없음)',
    testCases,
  });
  if (!result) return;

  assert.equal(verdictOf(result), 'AC', JSON.stringify(result, null, 2));
  assert.equal(result.summary.effectiveTimeLimitMs, 750);
  assert.equal(result.summary.aggregateTimeLimitMs, null);
  assert.equal(result.summary.total, testCases.length);
  assert.equal(result.summary.passed, testCases.length);
});

test('judge contract accepts alternate shortest path for 13913', async () => {
  const { judgeSubmission } = loadJudgeModule();
  const result = await judgeSubmission({
    problemId: 13913,
    sourceCode: hideAndSeekAlternativePath,
    language: 'cpp',
    timeLimit: '2 초',
    memoryLimit: '512 MB',
    testCases: [
      { input: '5 17\n', output: '4\n5 10 9 18 17\n' },
    ],
  });

  assert.equal(verdictOf(result), 'AC', JSON.stringify(result, null, 2));
  assert.equal(result.cases[0].compareMode, 'special-13913');
});

test('judge contract accepts valid alternate LIS layout for 14003', async () => {
  const { judgeSubmission } = loadJudgeModule();
  const result = await judgeSubmission({
    problemId: 14003,
    sourceCode: lisNewlineOutput,
    language: 'cpp',
    timeLimit: '3 초',
    memoryLimit: '512 MB',
    testCases: [
      { input: '6\n10 20 10 30 20 50\n', output: '4\n10 20 30 50\n' },
    ],
  });

  assert.equal(verdictOf(result), 'AC', JSON.stringify(result, null, 2));
  assert.match(result.cases[0].compareMode, /^(special-14003|tokens)$/u);
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

test('known macOS y1 symbol collision is retried without hiding general compile errors', async (t) => {
  const {
    judgeSubmission,
    isDarwinY1CollisionCompileError,
    applyDarwinY1CompatibilityPatch,
  } = loadJudgeModule();

  assert.equal(applyDarwinY1CompatibilityPatch('int y1; y1++;'), 'int judge_y1; judge_y1++;');
  assert.equal(isDarwinY1CollisionCompileError({ stderr: 'plain syntax error' }, 'darwin'), false);
  assert.equal(isDarwinY1CollisionCompileError({
    stderr: "main.cpp:6:15: error: redefinition of 'y1' as different kind of symbol\n/usr/include/math.h: note: previous definition is here y1",
  }, 'darwin'), true);
  assert.equal(isDarwinY1CollisionCompileError({
    stderr: "main.cpp:6:15: error: redefinition of 'y1' as different kind of symbol\n/usr/include/math.h: note: previous definition is here y1",
  }, 'linux'), false);

  if (process.platform !== 'darwin') {
    t.skip('real y1 collision retry is macOS-specific');
    return;
  }

  const result = await judgeSubmission({
    problemId: 'contract-darwin-y1',
    sourceCode: darwinY1CollisionSource,
    language: 'cpp',
    timeLimit: '1 초',
    memoryLimit: '128 MB',
    testCases: [
      { input: '2 3\n', output: '5\n' },
    ],
  });

  assert.equal(verdictOf(result), 'AC', JSON.stringify(result, null, 2));
  assert.equal(result.compile.compatibilityPatch, 'darwin-y1-symbol-collision');
});

test('judge contract returns TLE for non-terminating C++', { timeout: 5000 }, async (t) => {
  const result = await runJudgeCase(t, infiniteLoop, {
    timeLimit: '1 초',
    testCases: [{ input: '', output: '' }],
  });
  if (!result) return;

  assert.equal(verdictOf(result), 'TLE', JSON.stringify(result, null, 2));
});

test('calibrated compile timeout scales with probe time but stays clamped', () => {
  const { computeCalibratedCompileTimeoutMs } = loadJudgeModule();

  // Fast machine: a ~2s probe stays at the platform floor (10s/30s), unchanged.
  assert.equal(computeCalibratedCompileTimeoutMs(2000, { platform: 'linux', env: {} }), 10_000);
  assert.equal(computeCalibratedCompileTimeoutMs(2000, { platform: 'win32', env: {} }), 30_000);

  // Slow machine: a 7s probe * default 4x => 28s budget (the i5-8257U case).
  assert.equal(computeCalibratedCompileTimeoutMs(7000, { platform: 'linux', env: {} }), 28_000);

  // Degenerate probe never grants an unbounded budget (capped at the ceiling).
  assert.equal(computeCalibratedCompileTimeoutMs(40_000, { platform: 'linux', env: {} }), 60_000);

  // Multiplier and ceiling are configurable via env.
  assert.equal(
    computeCalibratedCompileTimeoutMs(7000, { platform: 'linux', env: { JUDGE_COMPILE_TIMEOUT_MULTIPLIER: '2' } }),
    14_000,
  );
  assert.equal(
    computeCalibratedCompileTimeoutMs(40_000, { platform: 'linux', env: { JUDGE_COMPILE_TIMEOUT_MAX: '120000' } }),
    120_000,
  );

  // Non-positive / non-finite probe degrades to the platform floor.
  assert.equal(computeCalibratedCompileTimeoutMs(0, { platform: 'linux', env: {} }), 10_000);
  assert.equal(computeCalibratedCompileTimeoutMs(NaN, { platform: 'linux', env: {} }), 10_000);
});

test('compile timeout precedence: request > env override > calibration > default', async () => {
  const { resolveCompileTimeoutMs } = loadJudgeModule();

  // Explicit per-request value wins outright (no calibration triggered).
  assert.equal(await resolveCompileTimeoutMs({ platform: 'linux', env: {}, explicitTimeoutMs: 12_345 }), 12_345);

  // JUDGE_COMPILE_TIMEOUT_MS hard override wins over calibration.
  assert.equal(
    await resolveCompileTimeoutMs({ platform: 'linux', env: { JUDGE_COMPILE_TIMEOUT_MS: '45000' } }),
    45_000,
  );

  // Calibration disabled => platform default, no probe compile performed.
  assert.equal(
    await resolveCompileTimeoutMs({ platform: 'linux', env: { JUDGE_COMPILE_CALIBRATION: 'off' } }),
    10_000,
  );
  assert.equal(
    await resolveCompileTimeoutMs({ platform: 'win32', env: { JUDGE_COMPILE_CALIBRATION: 'off' } }),
    30_000,
  );
});

test('calibration enabled flag honors explicit off switches', () => {
  const { isCompileCalibrationEnabled } = loadJudgeModule();
  assert.equal(isCompileCalibrationEnabled({}), true);
  assert.equal(isCompileCalibrationEnabled({ JUDGE_COMPILE_CALIBRATION: 'on' }), true);
  for (const off of ['off', 'false', '0', 'no', 'disabled']) {
    assert.equal(isCompileCalibrationEnabled({ JUDGE_COMPILE_CALIBRATION: off }), false);
  }
});

test('calibration probe measures this machine and never lowers the platform budget', { timeout: 120_000 }, async (t) => {
  const { calibrateCompileEnvironment, platformBaseCompileTimeoutMs } = loadJudgeModule();
  const calibration = await calibrateCompileEnvironment();

  if (!calibration.ok) {
    t.skip(`compile calibration probe unavailable: ${calibration.error || 'unknown'}`);
    return;
  }

  assert.ok(Number.isFinite(calibration.probeMs) && calibration.probeMs > 0, JSON.stringify(calibration));
  assert.ok(
    calibration.compileTimeoutMs >= platformBaseCompileTimeoutMs(process.platform),
    `calibrated budget must not drop below the platform default: ${JSON.stringify(calibration)}`,
  );
  assert.ok(calibration.compileTimeoutMs <= calibration.ceilingMs, JSON.stringify(calibration));
});

test('time-limit multiplier scales with CPU bench but never shrinks the limit', () => {
  const { computeTimeLimitMultiplier } = loadJudgeModule();

  // Reference-speed host (300ms default) => 1x, the limit is unchanged.
  assert.equal(computeTimeLimitMultiplier(300, { env: {} }), 1);
  // Faster than reference still clamps to 1x (we never tighten a limit).
  assert.equal(computeTimeLimitMultiplier(150, { env: {} }), 1);
  // The slow i5 case: ~1800ms bench / 300ms reference => 6x.
  assert.equal(computeTimeLimitMultiplier(1800, { env: {} }), 6);
  // Capped at the configurable max (default 10x).
  assert.equal(computeTimeLimitMultiplier(99999, { env: {} }), 10);
  assert.equal(computeTimeLimitMultiplier(99999, { env: { JUDGE_TIME_LIMIT_MULTIPLIER_MAX: '20' } }), 20);
  // Reference time is configurable.
  assert.equal(computeTimeLimitMultiplier(1200, { env: { JUDGE_REFERENCE_CPU_BENCH_MS: '600' } }), 2);
  // Non-positive / non-finite bench => no scaling.
  assert.equal(computeTimeLimitMultiplier(0, { env: {} }), 1);
  assert.equal(computeTimeLimitMultiplier(NaN, { env: {} }), 1);
});

test('time-limit multiplier precedence: forced > calibration off > default', async () => {
  const { resolveTimeLimitMultiplier } = loadJudgeModule();

  // Explicit operator override wins, no benchmark performed.
  assert.equal(await resolveTimeLimitMultiplier({ env: { JUDGE_TIME_LIMIT_MULTIPLIER: '7' } }), 7);
  // A forced value below 1 is ignored (cannot tighten); falls through to off/default.
  assert.equal(
    await resolveTimeLimitMultiplier({ env: { JUDGE_TIME_LIMIT_MULTIPLIER: '0.5', JUDGE_RUNTIME_CALIBRATION: 'off' } }),
    1,
  );
  // Calibration disabled => 1x, no benchmark performed.
  assert.equal(await resolveTimeLimitMultiplier({ env: { JUDGE_RUNTIME_CALIBRATION: 'off' } }), 1);
});

test('effective time limit applies the host multiplier on top of strict ratio', async () => {
  const { judgeSubmission } = loadJudgeModule();
  const result = await judgeSubmission({
    problemId: 'contract-multiplier',
    sourceCode: addTwoAccepted,
    language: 'cpp',
    timeLimit: '2 초 (추가 시간 없음)',
    memoryLimit: '128 MB',
    testCases: [{ input: '2 3\n', output: '5\n' }],
  }, { timeLimitMultiplier: 3 });

  assert.equal(verdictOf(result), 'AC', JSON.stringify(result, null, 2));
  // base 2000ms * strict 0.75 * multiplier 3 = 4500ms
  assert.equal(result.summary.timeLimitMs, 2000);
  assert.equal(result.summary.strictTimeLimitRatio, 0.75);
  assert.equal(result.summary.timeLimitMultiplier, 3);
  assert.equal(result.summary.effectiveTimeLimitMs, 4500);
  assert.equal(result.summary.aggregateTimeLimitMs, null);
});

test('runtime calibration benchmark measures this host without shrinking limits', { timeout: 90_000 }, async (t) => {
  const { calibrateRuntimeSpeed } = loadJudgeModule();
  const calibration = await calibrateRuntimeSpeed({ env: { JUDGE_RUNTIME_CALIBRATION: 'on' } });

  if (!calibration.ok) {
    t.skip(`runtime calibration probe unavailable: ${calibration.error || 'unknown'}`);
    return;
  }
  assert.ok(Number.isFinite(calibration.benchMs) && calibration.benchMs > 0, JSON.stringify(calibration));
  assert.ok(calibration.multiplier >= 1, `multiplier must never shrink a limit: ${JSON.stringify(calibration)}`);
  assert.ok(calibration.multiplier <= 10, JSON.stringify(calibration));
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
