'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('./processRunner');

const DEFAULT_DATA_PATH = path.resolve(process.cwd(), 'data.json');
const DEFAULT_COMPILE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const VERDICT_PRIORITY = ['TLE', 'RE', 'WA'];

function parseTimeLimitMs(value, fallbackMs = 1_000) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, value);
  if (typeof value !== 'string') return fallbackMs;

  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallbackMs;
  if (normalized.includes('ms') || normalized.includes('밀리')) return Math.max(1, Math.round(amount));
  return Math.max(1, Math.round(amount * 1_000));
}

function parseMemoryLimitMb(value, fallbackMb = null) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.round(value));
  if (typeof value !== 'string') return fallbackMb;

  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return fallbackMb;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallbackMb;
  if (normalized.includes('gb') || normalized.includes('기가')) return Math.max(1, Math.round(amount * 1024));
  if (normalized.includes('kb') || normalized.includes('킬로')) return Math.max(1, Math.round(amount / 1024));
  return Math.max(1, Math.round(amount));
}

function normalizeOutput(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\s\n]+$/g, '');
}

function validateProblem(problem) {
  if (!problem || typeof problem !== 'object') {
    throw new Error('data.json must contain an object');
  }
  if (!Array.isArray(problem.testCases) || problem.testCases.length === 0) {
    throw new Error('data.json must contain a non-empty testCases array');
  }

  problem.testCases.forEach((testCase, index) => {
    if (!testCase || typeof testCase !== 'object') {
      throw new Error(`testCases[${index}] must be an object`);
    }
    if (!Object.prototype.hasOwnProperty.call(testCase, 'input')) {
      throw new Error(`testCases[${index}].input is required`);
    }
    if (!Object.prototype.hasOwnProperty.call(testCase, 'output')) {
      throw new Error(`testCases[${index}].output is required`);
    }
  });
}

async function loadProblem(dataPath = DEFAULT_DATA_PATH) {
  const raw = await fs.readFile(dataPath, 'utf8');
  const problem = JSON.parse(raw);
  validateProblem(problem);
  return problem;
}

function buildCompileSummary(result, commandText) {
  return {
    ok: result.exitCode === 0 && !result.timedOut && !result.error,
    command: commandText,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    error: result.error,
  };
}

function buildCaseResult(testCase, index, run) {
  let status;
  if (run.timedOut) {
    status = 'TLE';
  } else if (run.error || run.exitCode !== 0) {
    status = 'RE';
  } else if (normalizeOutput(run.stdout) !== normalizeOutput(testCase.output)) {
    status = 'WA';
  } else {
    status = 'AC';
  }

  return {
    index: index + 1,
    status,
    input: String(testCase.input ?? ''),
    expected: String(testCase.output ?? ''),
    actual: run.stdout,
    stderr: run.stderr,
    exitCode: run.exitCode,
    signal: run.signal,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    stdoutTruncated: run.stdoutTruncated,
    stderrTruncated: run.stderrTruncated,
    error: run.error,
  };
}

function finalVerdictFromCases(cases) {
  for (const verdict of VERDICT_PRIORITY) {
    if (cases.some((testCase) => testCase.status === verdict)) return verdict;
  }
  return 'AC';
}

function resolveSubmissionInput(sourceCodeOrRequest, options = {}) {
  if (!sourceCodeOrRequest || typeof sourceCodeOrRequest !== 'object' || Buffer.isBuffer(sourceCodeOrRequest)) {
    return {
      sourceCode: sourceCodeOrRequest,
      options,
    };
  }

  const request = sourceCodeOrRequest;
  const problem = request.problem || (
    Array.isArray(request.testCases)
      ? {
          problemId: request.problemId,
          sourceCode: request.sourceCode,
          testCases: request.testCases,
          timeLimit: request.timeLimit,
          memoryLimit: request.memoryLimit,
        }
      : undefined
  );

  return {
    sourceCode: request.sourceCode,
    options: {
      ...options,
      ...(problem ? { problem } : {}),
      ...(request.dataPath ? { dataPath: request.dataPath } : {}),
      ...(request.timeLimitMs ? { timeLimitMs: request.timeLimitMs } : {}),
      ...(request.memoryLimitMb ? { memoryLimitMb: request.memoryLimitMb } : {}),
      ...(request.keepTemp !== undefined ? { keepTemp: request.keepTemp } : {}),
    },
  };
}

async function judgeSubmission(sourceCodeOrRequest, options = {}) {
  const resolved = resolveSubmissionInput(sourceCodeOrRequest, options);
  const sourceCode = resolved.sourceCode;
  const judgeOptions = resolved.options;
  const problem = judgeOptions.problem || await loadProblem(judgeOptions.dataPath);
  validateProblem(problem);

  const submissionSource = sourceCode ?? problem.sourceCode;
  if (typeof submissionSource !== 'string' || submissionSource.trim() === '') {
    throw new Error('sourceCode is required either in the request or data.json');
  }

  const timeLimitMs = judgeOptions.timeLimitMs || parseTimeLimitMs(problem.timeLimit);
  const memoryLimitMb = judgeOptions.memoryLimitMb || parseMemoryLimitMb(problem.memoryLimit);
  const maxOutputBytes = judgeOptions.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES;
  const tempRoot = judgeOptions.tempRoot || os.tmpdir();
  const workDir = await fs.mkdtemp(path.join(tempRoot, 'judge-cpp-'));
  const sourcePath = path.join(workDir, 'main.cpp');
  const binaryPath = path.join(workDir, process.platform === 'win32' ? 'main.exe' : 'main');
  const compiler = judgeOptions.compiler || 'g++';
  const compileArgs = judgeOptions.compileArgs || [
    '-std=c++17',
    '-O2',
    '-pipe',
    sourcePath,
    '-o',
    binaryPath,
  ];
  const compileCommand = [compiler, ...compileArgs].join(' ');

  let compile;
  let cases = [];
  let verdict = 'AC';

  try {
    await fs.writeFile(sourcePath, submissionSource, 'utf8');

    compile = buildCompileSummary(
      await runProcess(compiler, compileArgs, {
        cwd: workDir,
        timeoutMs: judgeOptions.compileTimeoutMs || DEFAULT_COMPILE_TIMEOUT_MS,
        maxOutputBytes,
      }),
      compileCommand,
    );

    if (!compile.ok) {
      verdict = 'CE';
    } else {
      for (let index = 0; index < problem.testCases.length; index += 1) {
        const testCase = problem.testCases[index];
        const run = await runProcess(binaryPath, [], {
          cwd: workDir,
          input: String(testCase.input ?? ''),
          timeoutMs: timeLimitMs,
          maxOutputBytes,
        });
        cases.push(buildCaseResult(testCase, index, run));
      }
      verdict = finalVerdictFromCases(cases);
    }
  } finally {
    if (judgeOptions.keepTemp !== true) {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }

  return {
    problemId: problem.problemId,
    verdict,
    ...(verdict === 'CE' ? {
      compileLog: [compile?.stdout, compile?.stderr].filter(Boolean).join('\n'),
      stderr: compile?.stderr || '',
    } : {}),
    summary: {
      passed: cases.filter((testCase) => testCase.status === 'AC').length,
      total: problem.testCases.length,
      timeLimitMs,
      memoryLimitMb,
      tempDirCleaned: judgeOptions.keepTemp !== true,
    },
    compile,
    cases,
  };
}

module.exports = {
  judgeSubmission,
  loadProblem,
  parseTimeLimitMs,
  parseMemoryLimitMb,
  normalizeOutput,
  resolveSubmissionInput,
};
