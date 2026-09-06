'use strict';

// 특수 채점(special judge) 레지스트리.
//
// 정답이 유일하지 않은 문제는 문자열 엄격 비교로 채점할 수 없다. registry.json 에 등재된
// 문제는 여기서 고른 체커가 출력을 직접 검증한다. 문제별 하드코딩 분기 대신 표를 읽으므로
// 대상 문제가 늘어도 registry.json 한 줄과 체커 파일만 더하면 된다.

const registry = require('./registry.json');
const { createFloatChecker } = require('./float');

const CUSTOM_CHECKERS = new Map([
  [2467, require('./2467').check],
  [2470, require('./2470').check],
  [2816, require('./2816').check],
  [11780, require('./11780').check],
  [12852, require('./12852').check],
  [13913, require('./13913').check],
  [14002, require('./14002').check],
  [14003, require('./14003').check],
]);

// 체커는 출력 전체를 토큰으로 쪼갠다. 악의적으로 거대한 출력에 그 비용을 치르지 않도록 자른다.
const MAX_CHECKER_STDOUT_BYTES = 8 * 1024 * 1024;

function buildEntry(raw, index) {
  const problemId = Number(raw && raw.problemId);
  if (!Number.isInteger(problemId) || problemId <= 0) {
    throw new Error(`special judge registry[${index}]: problemId must be a positive integer`);
  }

  if (raw.mode === 'float') {
    const epsilon = Number(raw.epsilon);
    if (!Number.isFinite(epsilon) || epsilon <= 0) {
      throw new Error(`special judge registry[${problemId}]: float mode needs a positive epsilon`);
    }
    return {
      problemId,
      mode: 'float',
      epsilon,
      reason: raw.reason || '',
      check: createFloatChecker(epsilon),
    };
  }

  if (raw.mode === 'custom') {
    const check = CUSTOM_CHECKERS.get(problemId);
    if (!check) {
      throw new Error(`special judge registry[${problemId}]: custom mode needs src/checkers/${problemId}.js`);
    }
    return { problemId, mode: 'custom', epsilon: null, reason: raw.reason || '', check };
  }

  throw new Error(`special judge registry[${problemId}]: unknown mode ${JSON.stringify(raw && raw.mode)}`);
}

function loadRegistry(source = registry) {
  const problems = Array.isArray(source && source.problems) ? source.problems : [];
  const entries = new Map();

  problems.forEach((raw, index) => {
    const entry = buildEntry(raw, index);
    if (entries.has(entry.problemId)) {
      throw new Error(`special judge registry: duplicate problemId ${entry.problemId}`);
    }
    entries.set(entry.problemId, entry);
  });

  // 체커 파일만 있고 표에 없으면 그 문제는 조용히 엄격 비교로 채점된다. 등재를 강제한다.
  for (const problemId of CUSTOM_CHECKERS.keys()) {
    if (!entries.has(problemId)) {
      throw new Error(`src/checkers/${problemId}.js exists but is not listed in registry.json`);
    }
  }

  return entries;
}

const REGISTRY = loadRegistry();

function getSpecialJudgeEntry(problemId) {
  return REGISTRY.get(Number(problemId)) || null;
}

function listSpecialJudgeProblemIds() {
  return [...REGISTRY.keys()].sort((left, right) => left - right);
}

// 체커가 던진 예외를 오답으로 바꾸면 서버 버그가 학생의 오답으로 둔갑한다. error 로 구분해
// 올려보내고 판정은 wrong_answer 가 아니라 internal_error 로 간다.
function resolveChecker(problemId) {
  const entry = getSpecialJudgeEntry(problemId);
  if (!entry) return null;

  return function safeCheck({ input, stdout, expectedOutput }) {
    const output = stdout == null ? '' : String(stdout);
    if (Buffer.byteLength(output, 'utf8') > MAX_CHECKER_STDOUT_BYTES) {
      return { ok: false, code: 'output_too_large', reason: '출력이 너무 큽니다.' };
    }

    let result;
    try {
      result = entry.check({
        input: input == null ? '' : String(input),
        stdout: output,
        expectedOutput: expectedOutput == null ? '' : String(expectedOutput),
      });
    } catch (error) {
      return {
        ok: false,
        error: true,
        code: 'checker_error',
        reason: `특수 채점기 내부 오류: ${(error && error.message) || 'unknown'}`,
      };
    }

    if (result && result.ok === true) return { ok: true };

    return {
      ok: false,
      code: (result && result.code) || 'wrong_answer',
      reason: (result && result.reason) || '출력이 문제 조건을 만족하지 않습니다.',
    };
  };
}

module.exports = {
  MAX_CHECKER_STDOUT_BYTES,
  getSpecialJudgeEntry,
  listSpecialJudgeProblemIds,
  resolveChecker,
};
