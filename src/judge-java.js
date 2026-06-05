'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { runProcess } = require('./processRunner');
const {
  parseTimeLimitMs,
  parseMemoryLimitMb,
  normalizeSubmissionSource,
  resolveSubmissionInput,
  resolveMemoryPolicy,
  resolveTempRoot,
  findExecutableOnPath,
  stripWrappingQuotes,
  hasNoAdditionalTime,
  resolveEffectiveTimeLimitMs,
  resolveAggregateTimeLimitMs,
  buildCompileSummary,
  formatCompileLog,
  buildCaseResult,
  finalVerdictFromCases,
  resolveTimeLimitMultiplier,
} = require('./judge');

const SOURCE_FILE_NAME = 'Main.java';
const VERDICT_PRIORITY = ['TLE', 'MLE', 'RE', 'WA'];
const DEFAULT_JAVA_COMPILE_TIMEOUT_MS = 15_000;
const DEFAULT_JVM_MEMORY_OVERHEAD_MB = 64;

const JAVA_LANGUAGE_ALIASES = new Map([
  ['java', 'java'],
  ['java8', 'java8'],
  ['java11', 'java11'],
  ['java17', 'java17'],
  ['java21', 'java21'],
]);

let jdkVersionCache = null;
let jvmStartupCache = null;

function normalizeJavaLanguage(value) {
  if (value === undefined || value === null || value === '') return 'java';
  const lang = String(value).trim().toLowerCase();
  return JAVA_LANGUAGE_ALIASES.get(lang) || null;
}

function normalizeJavaSource(source) {
  let normalized = normalizeSubmissionSource(source);
  normalized = normalized.replace(/^\s*package\s+[\w.]+\s*;\s*$/gm, '');
  return normalized;
}

async function resolveJavaRuntime(options = {}) {
  const env = options.env ? { ...process.env, ...options.env } : process.env;
  const explicit = options.javaRuntime || env.JUDGE_JAVA || env.JAVA_HOME
    ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : null;
  if (explicit) return stripWrappingQuotes(String(explicit));
  return 'java';
}

async function resolveJavaCompiler(options = {}) {
  const env = options.env ? { ...process.env, ...options.env } : process.env;
  const explicitCompiler = options.javaCompiler || env.JUDGE_JAVAC;
  if (explicitCompiler) return stripWrappingQuotes(String(explicitCompiler));
  if (env.JAVA_HOME) {
    const candidate = path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
    try {
      await fs.access(candidate);
      return candidate;
    } catch (_) { /* fall through to PATH */ }
  }
  const found = await findExecutableOnPath('javac', { env, platform: process.platform });
  return found || 'javac';
}

async function detectJdkVersion(options = {}) {
  if (jdkVersionCache !== null) return jdkVersionCache;
  try {
    const compiler = await resolveJavaCompiler(options);
    const result = await runProcess(compiler, ['-version'], {
      timeoutMs: 10_000,
      maxOutputBytes: 4096,
    });
    const output = (result.stderr || '') + (result.stdout || '');
    const match = output.match(/javac\s+(?:1\.)?(\d+)/);
    if (match) {
      jdkVersionCache = Number(match[1]);
      return jdkVersionCache;
    }
  } catch (_) { /* detection failed */ }
  return null;
}

function resolveJavaCompileArgs(language) {
  const args = ['-encoding', 'UTF-8'];
  if (!language || language === 'java') return [...args, SOURCE_FILE_NAME];

  const versionMatch = language.match(/^java(\d+)$/);
  if (!versionMatch) return [...args, SOURCE_FILE_NAME];

  const targetVersion = Number(versionMatch[1]);
  if (jdkVersionCache !== null && jdkVersionCache >= 9) {
    args.push('--release', String(targetVersion));
  } else if (jdkVersionCache !== null && jdkVersionCache < 9) {
    args.push('-source', `1.${targetVersion}`, '-target', `1.${targetVersion}`);
  }
  args.push(SOURCE_FILE_NAME);
  return args;
}

async function calibrateJvmStartup(options = {}) {
  if (jvmStartupCache !== null) return jvmStartupCache;
  try {
    const javaRuntime = await resolveJavaRuntime(options);
    const start = Date.now();
    await runProcess(javaRuntime, ['-version'], {
      timeoutMs: 10_000,
      maxOutputBytes: 4096,
    });
    const durationMs = Date.now() - start;
    jvmStartupCache = Math.max(0, durationMs);
    return jvmStartupCache;
  } catch (_) {
    jvmStartupCache = 0;
    return 0;
  }
}

async function warmupJvmCalibration(options = {}) {
  const startupMs = await calibrateJvmStartup(options);
  return { ok: true, startupMs };
}

async function judgeSubmission(sourceCodeOrRequest, options = {}) {
  const resolved = resolveSubmissionInput(sourceCodeOrRequest, options);
  const sourceCode = resolved.sourceCode;
  const judgeOptions = resolved.options;
  const problem = judgeOptions.problem || {
    problemId: undefined,
    sourceCode: undefined,
    language: judgeOptions.language,
    testCases: [],
    timeLimit: undefined,
    memoryLimit: undefined,
  };

  const rawSubmissionSource = sourceCode ?? problem.sourceCode;
  if (typeof rawSubmissionSource !== 'string' || rawSubmissionSource.trim() === '') {
    throw new Error('sourceCode is required');
  }
  const submissionSource = normalizeJavaSource(rawSubmissionSource);
  if (submissionSource.trim() === '') {
    throw new Error('sourceCode is required');
  }

  const runnerEnv = judgeOptions.env ? { ...process.env, ...judgeOptions.env } : process.env;
  const timeLimitMs = judgeOptions.timeLimitMs || parseTimeLimitMs(problem.timeLimit);
  const timeLimitMultiplier = judgeOptions.timeLimitMultiplier !== undefined
    ? (Number.isFinite(Number(judgeOptions.timeLimitMultiplier)) ? Math.max(1, Number(judgeOptions.timeLimitMultiplier)) : 1)
    : await resolveTimeLimitMultiplier({ env: runnerEnv, spawnEnv: judgeOptions.env, cwd: judgeOptions.cwd });

  const { strictRatio, timeLimitMultiplier: appliedTimeLimitMultiplier, effectiveTimeLimitMs } = resolveEffectiveTimeLimitMs(
    problem, judgeOptions, timeLimitMs, timeLimitMultiplier,
  );
  const aggregateTimeLimitMs = resolveAggregateTimeLimitMs(problem, judgeOptions, effectiveTimeLimitMs);

  const memoryLimitMb = judgeOptions.memoryLimitMb || parseMemoryLimitMb(problem.memoryLimit);
  const memoryPolicy = resolveMemoryPolicy({
    platform: judgeOptions.platform || process.platform,
    memoryLimitMb,
    memoryPolicy: judgeOptions.memoryPolicy,
  });
  const maxOutputBytes = judgeOptions.maxOutputBytes || 64 * 1024;
  const tempRoot = resolveTempRoot({
    tempRoot: judgeOptions.tempRoot,
    env: runnerEnv,
    platform: process.platform,
    cwd: judgeOptions.cwd,
  });
  await fs.mkdir(tempRoot, { recursive: true });
  const workDir = await fs.mkdtemp(path.join(tempRoot, 'judge-java-'));
  const sourcePath = path.join(workDir, SOURCE_FILE_NAME);

  const compiler = await resolveJavaCompiler({ env: judgeOptions.env });
  await detectJdkVersion({ env: judgeOptions.env });
  const compileArgs = judgeOptions.compileArgs || resolveJavaCompileArgs(judgeOptions.language || problem.language);
  const compileCommand = [compiler, ...compileArgs].join(' ');

  const javaRuntime = await resolveJavaRuntime({ env: judgeOptions.env });
  const runArgs = judgeOptions.runArgs || ['-Dfile.encoding=UTF-8', 'Main'];

  const compileTimeoutMs = judgeOptions.compileTimeoutMs || DEFAULT_JAVA_COMPILE_TIMEOUT_MS;
  const jvmStartupMs = await calibrateJvmStartup({ env: judgeOptions.env });

  let compile;
  let cases = [];
  let verdict = 'AC';
  let aggregateRuntimeMs = 0;

  try {
    await fs.writeFile(sourcePath, submissionSource, 'utf8');

    compile = buildCompileSummary(
      await runProcess(compiler, compileArgs, {
        cwd: workDir,
        env: judgeOptions.env,
        timeoutMs: compileTimeoutMs,
        maxOutputBytes,
      }),
      compileCommand,
    );

    if (!compile.ok) {
      verdict = 'CE';
    } else {
      for (let index = 0; index < problem.testCases.length; index += 1) {
        const testCase = problem.testCases[index];
        const remainingAggregateMs = aggregateTimeLimitMs === null
          ? null
          : aggregateTimeLimitMs - aggregateRuntimeMs;
        const caseTimeoutMs = remainingAggregateMs === null
          ? effectiveTimeLimitMs + jvmStartupMs
          : Math.max(1, Math.min(effectiveTimeLimitMs + jvmStartupMs, remainingAggregateMs + jvmStartupMs));
        const run = await runProcess(javaRuntime, runArgs, {
          cwd: workDir,
          env: judgeOptions.env,
          input: String(testCase.input ?? ''),
          timeoutMs: caseTimeoutMs,
          maxOutputBytes,
          trackCpuTime: true,
          trackMemory: memoryPolicy.trackMemory,
          detached: true,
        });
        const accountedRuntimeMs = Math.max(run.durationMs, run.cpuTimeMs || 0);
        aggregateRuntimeMs += accountedRuntimeMs;
        const aggregateTimedOut = aggregateTimeLimitMs !== null
          && aggregateRuntimeMs >= aggregateTimeLimitMs
          && !run.timedOut;
        cases.push(buildCaseResult(testCase, index, run, {
          aggregateTimedOut,
          memoryPolicy,
        }));
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
      compileLog: formatCompileLog(compile),
      stderr: compile?.stderr || '',
    } : {}),
    summary: {
      passed: cases.filter((testCase) => testCase.status === 'AC').length,
      total: problem.testCases.length,
      timeLimitMs,
      compileTimeoutMs,
      effectiveTimeLimitMs,
      strictTimeLimitRatio: strictRatio,
      timeLimitMultiplier: appliedTimeLimitMultiplier,
      aggregateTimeLimitMs,
      aggregateRuntimeMs: Math.round(aggregateRuntimeMs),
      memoryLimitMb,
      memoryPolicy,
      tempDirCleaned: judgeOptions.keepTemp !== true,
    },
    compile,
    cases,
  };
}

module.exports = {
  judgeSubmission,
  normalizeJavaLanguage,
  normalizeJavaSource,
  resolveJavaCompiler,
  resolveJavaRuntime,
  resolveJavaCompileArgs,
  detectJdkVersion,
  calibrateJvmStartup,
  warmupJvmCalibration,
};
