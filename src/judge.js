'use strict';

const { constants: fsConstants } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { compareOutputs } = require('./compare');
const { runProcess } = require('./processRunner');

const DEFAULT_DATA_PATH = path.resolve(process.cwd(), 'data.json');
const DEFAULT_COMPILE_TIMEOUT_MS = 10_000;
const DEFAULT_WINDOWS_COMPILE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_CPP_STANDARD = 'gnu++17';
const DEFAULT_NO_ADDITIONAL_TIME_RATIO = 0.75;
// Adaptive compile timeout. Low-spec machines (e.g. an Intel 1.4GHz i5 with 8GB
// RAM that thermally throttles and swaps) can take far longer than the fixed
// platform default to compile the same source, tripping a spurious "compiler
// timed out" CE. At startup we compile a tiny reference program with the real
// judge flags, measure how long THIS machine takes, and scale the compile budget
// to probeMs * multiplier — clamped so we never drop below the platform default
// and never balloon past a hard ceiling. This reflects throttling, swap, slow
// toolchains, and AV scanning that a static spec heuristic cannot see.
const DEFAULT_COMPILE_TIMEOUT_MULTIPLIER = 4;
const DEFAULT_COMPILE_TIMEOUT_CEILING_MS = 60_000;
// Hard wall for the calibration probe itself so a pathological toolchain cannot
// hang startup forever; on timeout we fall back to the platform default.
const CALIBRATION_PROBE_MAX_MS = 90_000;
const CALIBRATION_REFERENCE_SOURCE = '#include <bits/stdc++.h>\nint main(){ return 0; }\n';
// Adaptive run-time limit. A fixed problem time limit (e.g. 1s) assumes the
// judge's reference hardware. On a much slower host the SAME correct solution
// runs slower and trips a spurious TLE. We measure this host's CPU throughput
// with a tight integer benchmark (run as a child process so it never blocks the
// event loop) and stretch the per-case time limit by benchMs / referenceMs —
// clamped so we never SHRINK a limit (min 1x) and never balloon past the max.
// Compile-probe time is a poor runtime proxy (it is dominated by header I/O, AV
// scanning, and swap), so runtime gets its own CPU-only probe.
const CPU_BENCH_ITERATIONS = 50_000_000;
const DEFAULT_REFERENCE_CPU_BENCH_MS = 300; // fast modern single core (this dev machine ~305ms)
const DEFAULT_TIME_LIMIT_MULTIPLIER_MAX = 10;
const CPU_BENCH_PROBE_MAX_MS = 60_000;
// Runs in a child `node -e`; prints the best-of-3 wall time (ms) of the workload.
const CPU_BENCH_SCRIPT = [
  'function once(){',
  '  const t=process.hrtime.bigint();',
  '  let acc=0;',
  `  for(let i=0;i<${CPU_BENCH_ITERATIONS};i++){acc=(acc+i*2654435761)>>>0;}`,
  '  return Number((process.hrtime.bigint()-t)/1000000n)+(acc&0);',
  '}',
  'once();',
  'let best=Infinity;',
  'for(let k=0;k<3;k++){const m=once();if(m<best)best=m;}',
  'process.stdout.write(String(best));',
].join('');
const SOURCE_FILE_NAME = 'main.cpp';
const POSIX_BINARY_FILE_NAME = 'main';
const WINDOWS_BINARY_FILE_NAME = 'main.exe';
// Bundled portable <bits/stdc++.h> shim. Added to the compiler include path so
// submissions that include it still compile on toolchains that don't ship the
// header (MSYS2 clang64 g++, MSVC). See runtime-include/bits/stdc++.h.
const BITS_COMPAT_INCLUDE_DIR = path.join(__dirname, 'runtime-include');
const VERDICT_PRIORITY = ['TLE', 'MLE', 'RE', 'WA'];
const WINDOWS_COMPILER_CANDIDATES = [
  'g++',
  'g++.exe',
  'C:\\msys64\\ucrt64\\bin\\g++.exe',
  'C:\\msys64\\mingw64\\bin\\g++.exe',
  'C:\\msys64\\clang64\\bin\\g++.exe',
  'C:\\MinGW\\bin\\g++.exe',
  'C:\\ProgramData\\chocolatey\\bin\\g++.exe',
];

const CPP_LANGUAGE_STANDARDS = new Map([
  ['c++', DEFAULT_CPP_STANDARD],
  ['cpp', DEFAULT_CPP_STANDARD],
  ['cxx', DEFAULT_CPP_STANDARD],
  ['cplusplus', DEFAULT_CPP_STANDARD],
  ['c++17', 'gnu++17'],
  ['cpp17', 'gnu++17'],
  ['cxx17', 'gnu++17'],
  ['cplusplus17', 'gnu++17'],
  ['gnuc++17', 'gnu++17'],
  ['gnucpp17', 'gnu++17'],
  ['gnu++17', 'gnu++17'],
  ['c++20', 'gnu++20'],
  ['cpp20', 'gnu++20'],
  ['cxx20', 'gnu++20'],
  ['cplusplus20', 'gnu++20'],
  ['gnuc++20', 'gnu++20'],
  ['gnucpp20', 'gnu++20'],
  ['gnu++20', 'gnu++20'],
  ['c++2a', 'gnu++20'],
  ['gnu++2a', 'gnu++20'],
]);

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

function hasNoAdditionalTime(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized.includes('추가 시간 없음')
    || normalized.includes('추가시간없음')
    || normalized.includes('no additional time');
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function defaultCompileTimeoutMsForPlatform(platform = process.platform, env = process.env) {
  const configured = parsePositiveInteger(env && env.JUDGE_COMPILE_TIMEOUT_MS);
  if (configured !== null) return configured;
  return platform === 'win32' ? DEFAULT_WINDOWS_COMPILE_TIMEOUT_MS : DEFAULT_COMPILE_TIMEOUT_MS;
}

function platformBaseCompileTimeoutMs(platform = process.platform) {
  return platform === 'win32' ? DEFAULT_WINDOWS_COMPILE_TIMEOUT_MS : DEFAULT_COMPILE_TIMEOUT_MS;
}

function isCompileCalibrationEnabled(env = process.env) {
  const raw = String((env && env.JUDGE_COMPILE_CALIBRATION) ?? '').trim().toLowerCase();
  return !['off', 'false', '0', 'no', 'disabled'].includes(raw);
}

function compileTimeoutMultiplier(env = process.env) {
  const parsed = Number(env && env.JUDGE_COMPILE_TIMEOUT_MULTIPLIER);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_COMPILE_TIMEOUT_MULTIPLIER;
}

function compileTimeoutCeilingMs(env = process.env) {
  const parsed = parsePositiveInteger(env && env.JUDGE_COMPILE_TIMEOUT_MAX);
  return parsed !== null ? parsed : DEFAULT_COMPILE_TIMEOUT_CEILING_MS;
}

// Pure: turn a measured calibration probe time into a compile budget. The budget
// scales linearly with how slow this machine is, but is floored at the platform
// default (so fast machines keep the original 10s/30s budget) and capped at the
// ceiling (so a degenerate probe cannot grant an unbounded budget).
function computeCalibratedCompileTimeoutMs(probeMs, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const floorMs = platformBaseCompileTimeoutMs(platform);
  const ceilingMs = Math.max(floorMs, compileTimeoutCeilingMs(env));
  if (!Number.isFinite(probeMs) || probeMs <= 0) return floorMs;
  const scaled = Math.round(probeMs * compileTimeoutMultiplier(env));
  return Math.min(ceilingMs, Math.max(floorMs, scaled));
}

const compileCalibrationCache = new Map();

// Compile a tiny reference program once per (platform, compiler, args) and cache
// the derived compile budget. Memoized so the probe cost is paid at most once per
// process. Any failure (probe error/timeout) degrades gracefully to the platform
// default budget.
function calibrateCompileEnvironment(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const sourceFileName = options.sourceFileName || SOURCE_FILE_NAME;
  const binaryFileName = options.binaryFileName || binaryFileNameForPlatform(platform);

  const run = (async () => {
    const compiler = options.compiler || await resolveCompiler({ env, platform });
    const compileArgs = options.compileArgs || buildDefaultCompileArgs({
      platform,
      sourceFileName,
      binaryFileName,
    });
    const cacheKey = `${platform}::${compiler}::${compileArgs.join(' ')}`;
    if (compileCalibrationCache.has(cacheKey)) return compileCalibrationCache.get(cacheKey);

    const promise = (async () => {
      const floorMs = platformBaseCompileTimeoutMs(platform);
      const tempRoot = resolveTempRoot({ env, platform, cwd: options.cwd });
      let workDir = null;
      try {
        await fs.mkdir(tempRoot, { recursive: true });
        workDir = await fs.mkdtemp(path.join(tempRoot, 'judge-cal-'));
        await fs.writeFile(path.join(workDir, sourceFileName), CALIBRATION_REFERENCE_SOURCE, 'utf8');
        const result = await runProcess(compiler, compileArgs, {
          cwd: workDir,
          env: options.spawnEnv,
          timeoutMs: CALIBRATION_PROBE_MAX_MS,
          maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
        });
        const probeMs = Number.isFinite(result.durationMs) ? result.durationMs : null;
        const ok = result.exitCode === 0 && !result.timedOut && !result.error && probeMs !== null;
        const compileTimeoutMs = ok
          ? computeCalibratedCompileTimeoutMs(probeMs, { platform, env })
          : floorMs;
        return {
          ok,
          compiler,
          probeMs,
          compileTimeoutMs,
          floorMs,
          multiplier: compileTimeoutMultiplier(env),
          ceilingMs: Math.max(floorMs, compileTimeoutCeilingMs(env)),
          timedOut: Boolean(result.timedOut),
          error: result.error,
        };
      } catch (error) {
        return { ok: false, compiler, probeMs: null, compileTimeoutMs: floorMs, floorMs, error: error.message };
      } finally {
        if (workDir) await fs.rm(workDir, { recursive: true, force: true });
      }
    })();

    compileCalibrationCache.set(cacheKey, promise);
    return promise;
  })();

  return run;
}

// Resolve the compile budget for a submission. Order of precedence:
//   1. explicit per-request compileTimeoutMs
//   2. JUDGE_COMPILE_TIMEOUT_MS env (hard operator override)
//   3. adaptive calibration (unless disabled via JUDGE_COMPILE_CALIBRATION=off)
//   4. platform default
async function resolveCompileTimeoutMs(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;

  const requested = parsePositiveInteger(options.explicitTimeoutMs);
  if (requested !== null) return requested;

  const envOverride = parsePositiveInteger(env && env.JUDGE_COMPILE_TIMEOUT_MS);
  if (envOverride !== null) return envOverride;

  if (isCompileCalibrationEnabled(env)) {
    try {
      const calibration = await calibrateCompileEnvironment(options);
      if (calibration && Number.isFinite(calibration.compileTimeoutMs)) {
        return calibration.compileTimeoutMs;
      }
    } catch {
      // Fall through to the platform default on any calibration failure.
    }
  }

  return platformBaseCompileTimeoutMs(platform);
}

// Convenience entry point for server startup: warm the calibration cache (and let
// callers log the result) unless an explicit env override makes it pointless.
async function warmupCompileCalibration(options = {}) {
  const env = options.env || process.env;
  if (parsePositiveInteger(env && env.JUDGE_COMPILE_TIMEOUT_MS) !== null) return null;
  if (!isCompileCalibrationEnabled(env)) return null;
  return calibrateCompileEnvironment(options);
}

function isRuntimeCalibrationEnabled(env = process.env) {
  const raw = String((env && env.JUDGE_RUNTIME_CALIBRATION) ?? '').trim().toLowerCase();
  return !['off', 'false', '0', 'no', 'disabled'].includes(raw);
}

function referenceCpuBenchMs(env = process.env) {
  const parsed = Number(env && env.JUDGE_REFERENCE_CPU_BENCH_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REFERENCE_CPU_BENCH_MS;
}

function timeLimitMultiplierMax(env = process.env) {
  const parsed = Number(env && env.JUDGE_TIME_LIMIT_MULTIPLIER_MAX);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_TIME_LIMIT_MULTIPLIER_MAX;
}

// Pure: turn a measured CPU benchmark time into a time-limit multiplier. Never
// below 1x (we never shrink a problem's limit) and never above the configured
// max (so a degenerate probe cannot grant an unbounded run budget).
function computeTimeLimitMultiplier(benchMs, options = {}) {
  const env = options.env || process.env;
  if (!Number.isFinite(benchMs) || benchMs <= 0) return 1;
  const ratio = benchMs / referenceCpuBenchMs(env);
  return Math.min(timeLimitMultiplierMax(env), Math.max(1, ratio));
}

let runtimeCalibrationCache = null;

// Measure this host's CPU throughput once via a child `node -e` benchmark.
// Memoized; non-blocking; degrades to "no scaling" on any failure.
function calibrateRuntimeSpeed(options = {}) {
  const env = options.env || process.env;
  if (runtimeCalibrationCache) return runtimeCalibrationCache;

  const promise = (async () => {
    const referenceMs = referenceCpuBenchMs(env);
    try {
      const result = await runProcess(process.execPath, ['-e', CPU_BENCH_SCRIPT], {
        cwd: options.cwd,
        env: options.spawnEnv,
        timeoutMs: CPU_BENCH_PROBE_MAX_MS,
        maxOutputBytes: 4096,
      });
      const benchMs = Number(String(result.stdout).trim());
      const ok = result.exitCode === 0 && !result.timedOut && !result.error
        && Number.isFinite(benchMs) && benchMs > 0;
      return {
        ok,
        benchMs: ok ? benchMs : null,
        referenceMs,
        multiplier: ok ? computeTimeLimitMultiplier(benchMs, { env }) : 1,
        timedOut: Boolean(result.timedOut),
        error: result.error,
      };
    } catch (error) {
      return { ok: false, benchMs: null, referenceMs, multiplier: 1, error: error.message };
    }
  })();

  runtimeCalibrationCache = promise;
  return promise;
}

// Resolve the per-case time-limit multiplier. Precedence:
//   1. JUDGE_TIME_LIMIT_MULTIPLIER (hard operator override)
//   2. CPU calibration (unless disabled via JUDGE_RUNTIME_CALIBRATION=off)
//   3. 1x (no scaling)
async function resolveTimeLimitMultiplier(options = {}) {
  const env = options.env || process.env;

  const forced = Number(env && env.JUDGE_TIME_LIMIT_MULTIPLIER);
  if (Number.isFinite(forced) && forced >= 1) return forced;

  if (!isRuntimeCalibrationEnabled(env)) return 1;

  try {
    const calibration = await calibrateRuntimeSpeed(options);
    if (calibration && Number.isFinite(calibration.multiplier)) return calibration.multiplier;
  } catch {
    // Fall through to no scaling on any failure.
  }
  return 1;
}

async function warmupRuntimeCalibration(options = {}) {
  const env = options.env || process.env;
  if (Number.isFinite(Number(env && env.JUDGE_TIME_LIMIT_MULTIPLIER))) return null;
  if (!isRuntimeCalibrationEnabled(env)) return null;
  return calibrateRuntimeSpeed(options);
}

function normalizeCppLanguage(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_CPP_STANDARD;
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, '');
  return CPP_LANGUAGE_STANDARDS.get(normalized) || null;
}

function cppStandardForLanguage(value, fallback = DEFAULT_CPP_STANDARD) {
  return normalizeCppLanguage(value) || fallback;
}

function stripWrappingQuotes(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function normalizeSubmissionSource(source) {
  let normalized = String(source ?? '')
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const fenced = normalized.trim().match(/^(```+|~~~+)[^\n]*\n([\s\S]*?)\n\1\s*$/u);
  if (fenced) {
    normalized = fenced[2].replace(/^\uFEFF/u, '');
  }

  return normalized
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B\u200C\u200D\u2060]/gu, '');
}

function hasRiskyWindowsPathCharacters(value) {
  return /[^\x20-\x7E]|\s/u.test(String(value || ''));
}

function resolveTempRoot(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const explicitTempRoot = options.tempRoot || env.JUDGE_TEMP_ROOT;
  if (explicitTempRoot) return String(explicitTempRoot);

  const systemTempRoot = options.systemTempRoot || os.tmpdir();
  if (platform !== 'win32' || !hasRiskyWindowsPathCharacters(systemTempRoot)) {
    return systemTempRoot;
  }

  const cwd = options.cwd || process.cwd();
  if (hasRiskyWindowsPathCharacters(cwd)) {
    return systemTempRoot;
  }

  return path.win32.join(cwd, '.judge-tmp');
}

function normalizeRatio(value, fallback = 1) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0.01, value));
}

function resolveEffectiveTimeLimitMs(problem, judgeOptions, timeLimitMs, timeLimitMultiplier = 1) {
  const strictRatio = judgeOptions.strictTimeLimitRatio !== undefined
    ? normalizeRatio(Number(judgeOptions.strictTimeLimitRatio))
    : hasNoAdditionalTime(problem.timeLimit)
      ? DEFAULT_NO_ADDITIONAL_TIME_RATIO
      : 1;
  const multiplier = Number.isFinite(timeLimitMultiplier) && timeLimitMultiplier >= 1
    ? timeLimitMultiplier
    : 1;
  return {
    strictRatio,
    timeLimitMultiplier: multiplier,
    effectiveTimeLimitMs: Math.max(1, Math.floor(timeLimitMs * strictRatio * multiplier)),
  };
}

function resolveAggregateTimeLimitMs(problem, judgeOptions, effectiveTimeLimitMs) {
  if (judgeOptions.aggregateTimeLimitMs === null || judgeOptions.aggregateTimeLimitMs === false) {
    return null;
  }
  if (Number.isFinite(judgeOptions.aggregateTimeLimitMs)) {
    return Math.max(1, Math.floor(judgeOptions.aggregateTimeLimitMs));
  }
  return null;
}

function normalizeMemoryPolicy(value) {
  const normalized = String(value || 'auto').trim().toLowerCase();
  if (['enforce', 'enforced', 'strict', 'on', 'true'].includes(normalized)) return 'enforce';
  if (['advisory', 'warn', 'warning', 'report'].includes(normalized)) return 'advisory';
  if (['off', 'false', 'none', 'disabled'].includes(normalized)) return 'off';
  return 'auto';
}

function resolveMemoryPolicy(options = {}) {
  const platform = options.platform || process.platform;
  const memoryLimitMb = Number(options.memoryLimitMb);
  const hasMemoryLimit = Number.isFinite(memoryLimitMb) && memoryLimitMb > 0;
  const requestedPolicy = normalizeMemoryPolicy(options.memoryPolicy);
  const memoryLimitBytes = hasMemoryLimit ? memoryLimitMb * 1024 * 1024 : null;

  if (!hasMemoryLimit || requestedPolicy === 'off') {
    return {
      platform,
      mode: 'off',
      enforced: false,
      trackMemory: false,
      memoryLimitMb: hasMemoryLimit ? memoryLimitMb : null,
      memoryLimitBytes,
      reason: hasMemoryLimit ? 'memory check disabled' : 'no memory limit configured',
    };
  }

  if (requestedPolicy === 'enforce') {
    return {
      platform,
      mode: 'enforced',
      enforced: true,
      trackMemory: platform !== 'win32',
      memoryLimitMb,
      memoryLimitBytes,
      reason: platform === 'win32'
        ? 'forced memory enforcement requested, but native Windows memory sampling is unavailable'
        : 'memory enforcement forced by judge option',
    };
  }

  if (requestedPolicy === 'advisory') {
    return {
      platform,
      mode: 'advisory',
      enforced: false,
      trackMemory: platform !== 'win32',
      memoryLimitMb,
      memoryLimitBytes,
      reason: 'memory is reported only by judge option',
    };
  }

  if (platform === 'linux') {
    return {
      platform,
      mode: 'enforced',
      enforced: true,
      trackMemory: true,
      memoryLimitMb,
      memoryLimitBytes,
      reason: 'Linux memory sampling is close enough to enforce local MLE',
    };
  }

  return {
    platform,
    mode: 'advisory',
    enforced: false,
    trackMemory: false,
    memoryLimitMb,
    memoryLimitBytes,
    reason: platform === 'win32'
      ? 'native Windows process memory does not match BOJ Linux memory accounting'
      : 'native macOS process memory includes platform/runtime overhead unlike BOJ Linux',
  };
}

function normalizeOutput(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\s\n]+$/g, '');
}

// Convert captured child output to LF line endings without trimming. On Windows
// the MinGW C runtime opens stdout in text mode and rewrites '\n' to '\r\n', so
// the bytes on the pipe carry CRLF even though the program printed LF. We report
// the program's logical output, so strip the carriage returns while preserving
// content and trailing newlines. (Verdict comparison runs on raw output via
// compareOutputs, so this only affects the reported actual/stderr fields.)
function normalizeReportedOutput(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function binaryFileNameForPlatform(platform = process.platform) {
  return platform === 'win32' ? WINDOWS_BINARY_FILE_NAME : POSIX_BINARY_FILE_NAME;
}

function executableCommandForFile(binaryFileName, platform = process.platform) {
  const separator = platform === 'win32' ? '\\' : '/';
  return `.${separator}${binaryFileName}`;
}

function buildDefaultCompileArgs(options = {}) {
  const platform = options.platform || process.platform;
  const sourceFileName = options.sourceFileName || SOURCE_FILE_NAME;
  const binaryFileName = options.binaryFileName || binaryFileNameForPlatform(platform);
  const standard = cppStandardForLanguage(options.language || options.standard);
  const bitsCompatIncludeDir = options.bitsCompatIncludeDir === undefined
    ? BITS_COMPAT_INCLUDE_DIR
    : options.bitsCompatIncludeDir;
  const args = [`-std=${standard}`, '-O2'];

  if (platform !== 'win32') {
    args.push('-pipe');
  } else {
    // Statically link the C/C++ runtime on Windows. MinGW/LLVM-MinGW binaries
    // otherwise depend on toolchain DLLs (libstdc++/libc++, libgcc/libunwind,
    // libwinpthread) that are not on the judge's runtime PATH, which surfaces as
    // a spurious RE. Static linking makes the produced .exe self-contained.
    // (POSIX/BOJ judging keeps dynamic linking; macOS does not support -static.)
    args.push('-static');
  }

  // Expose the bundled <bits/stdc++.h> shim as a fallback include path. -idirafter
  // searches it AFTER the toolchain's own headers, so g++ that ships the real header
  // keeps using it, while libc++/MSVC toolchains that lack it resolve to our shim.
  if (bitsCompatIncludeDir) {
    args.push('-idirafter', bitsCompatIncludeDir);
  }

  return [
    ...args,
    '-finput-charset=UTF-8',
    '-fexec-charset=UTF-8',
    sourceFileName,
    '-o',
    binaryFileName,
  ];
}

function hasPathSeparator(command) {
  return command.includes('/') || command.includes('\\');
}

function windowsPathExts(env = process.env) {
  const raw = env.PATHEXT || '.EXE;.CMD;.BAT;.COM';
  const exts = raw.split(';').map((ext) => ext.trim()).filter(Boolean);
  return ['', ...exts, ...exts.map((ext) => ext.toLowerCase())];
}

async function canAccessFile(filePath) {
  try {
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    try {
      await fs.access(filePath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

async function findExecutableOnPath(command, options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path;
  const executable = stripWrappingQuotes(command);

  if (!executable || hasPathSeparator(executable) || pathApi.isAbsolute(executable)) {
    return await canAccessFile(executable) ? executable : null;
  }

  const pathValue = env.PATH || env.Path || env.path || '';
  const pathDelimiter = platform === 'win32' ? ';' : path.delimiter;
  const pathDirs = pathValue.split(pathDelimiter).filter(Boolean);
  const extensions = platform === 'win32' ? windowsPathExts(env) : [''];
  const commandLower = executable.toLowerCase();
  const alreadyHasWindowsExt = platform === 'win32'
    && windowsPathExts(env).some((ext) => ext && commandLower.endsWith(ext.toLowerCase()));

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      if (alreadyHasWindowsExt && ext) continue;
      const candidate = pathApi.join(dir, `${executable}${ext}`);
      if (await canAccessFile(candidate)) return candidate;
    }
  }

  return null;
}

async function resolveCompiler(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env ? { ...process.env, ...options.env } : process.env;
  const explicitCompiler = options.compiler || env.JUDGE_CXX || env.CXX;
  if (explicitCompiler) return stripWrappingQuotes(explicitCompiler);

  if (platform !== 'win32') return 'g++';

  for (const candidate of WINDOWS_COMPILER_CANDIDATES) {
    const resolved = await findExecutableOnPath(candidate, { env, platform });
    if (resolved) return resolved;
  }

  return 'g++';
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

function formatCompileLog(compile) {
  const details = [
    compile?.stdout,
    compile?.stderr,
    compile?.timedOut ? `compiler timed out after ${compile.durationMs} ms` : '',
    compile?.error,
  ];
  return details.filter(Boolean).join('\n');
}

function buildCaseResult(testCase, index, run, policy = {}) {
  let status;
  const comparison = compareOutputs(run.stdout, testCase.output);
  const memoryPolicy = policy.memoryPolicy || resolveMemoryPolicy();
  const memoryExceeded = Boolean(
    memoryPolicy.enforced
    && Number.isFinite(memoryPolicy.memoryLimitBytes)
    && Number.isFinite(run.peakMemoryBytes)
    && run.peakMemoryBytes > memoryPolicy.memoryLimitBytes
  );
  if (run.timedOut || policy.aggregateTimedOut) {
    status = 'TLE';
  } else if (memoryExceeded) {
    status = 'MLE';
  } else if (run.error || run.exitCode !== 0) {
    status = 'RE';
  } else if (!comparison.ok) {
    status = 'WA';
  } else {
    status = 'AC';
  }

  return {
    index: index + 1,
    status,
    input: String(testCase.input ?? ''),
    expected: String(testCase.output ?? ''),
    actual: normalizeReportedOutput(run.stdout),
    stderr: normalizeReportedOutput(run.stderr),
    exitCode: run.exitCode,
    signal: run.signal,
    timedOut: run.timedOut || Boolean(policy.aggregateTimedOut),
    durationMs: run.durationMs,
    peakMemoryBytes: run.peakMemoryBytes,
    memorySampleAvailable: run.memorySampleAvailable,
    memoryLimitBytes: memoryPolicy.memoryLimitBytes,
    memoryCheckMode: memoryPolicy.mode,
    memoryCheckEnforced: memoryPolicy.enforced,
    memoryExceeded,
    stdoutTruncated: run.stdoutTruncated,
    stderrTruncated: run.stderrTruncated,
    error: run.error,
    compareMode: comparison.mode,
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
          language: request.language ?? request.lang,
          testCases: request.testCases,
          timeLimit: request.timeLimit,
          memoryLimit: request.memoryLimit,
        }
      : undefined
  );
  const language = request.language ?? request.lang ?? problem?.language;

  return {
    sourceCode: request.sourceCode,
    options: {
      ...options,
      ...(problem ? { problem } : {}),
      ...(language ? { language } : {}),
      ...(request.dataPath ? { dataPath: request.dataPath } : {}),
      ...(request.timeLimitMs ? { timeLimitMs: request.timeLimitMs } : {}),
      ...(request.memoryLimitMb ? { memoryLimitMb: request.memoryLimitMb } : {}),
      ...(request.memoryPolicy ? { memoryPolicy: request.memoryPolicy } : {}),
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

  const rawSubmissionSource = sourceCode ?? problem.sourceCode;
  if (typeof rawSubmissionSource !== 'string') {
    throw new Error('sourceCode is required either in the request or data.json');
  }
  const submissionSource = normalizeSubmissionSource(rawSubmissionSource);
  if (submissionSource.trim() === '') {
    throw new Error('sourceCode is required either in the request or data.json');
  }

  const runtimePlatform = process.platform;
  const runnerEnv = judgeOptions.env ? { ...process.env, ...judgeOptions.env } : process.env;

  const timeLimitMs = judgeOptions.timeLimitMs || parseTimeLimitMs(problem.timeLimit);
  const timeLimitMultiplier = judgeOptions.timeLimitMultiplier !== undefined
    ? (Number.isFinite(Number(judgeOptions.timeLimitMultiplier)) ? Math.max(1, Number(judgeOptions.timeLimitMultiplier)) : 1)
    : await resolveTimeLimitMultiplier({ env: runnerEnv, spawnEnv: judgeOptions.env, cwd: judgeOptions.cwd });
  const { strictRatio, timeLimitMultiplier: appliedTimeLimitMultiplier, effectiveTimeLimitMs } = resolveEffectiveTimeLimitMs(
    problem,
    judgeOptions,
    timeLimitMs,
    timeLimitMultiplier,
  );
  const aggregateTimeLimitMs = resolveAggregateTimeLimitMs(
    problem,
    judgeOptions,
    effectiveTimeLimitMs,
  );
  const memoryLimitMb = judgeOptions.memoryLimitMb || parseMemoryLimitMb(problem.memoryLimit);
  const memoryPolicy = resolveMemoryPolicy({
    platform: judgeOptions.platform || process.platform,
    memoryLimitMb,
    memoryPolicy: judgeOptions.memoryPolicy,
  });
  const maxOutputBytes = judgeOptions.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES;
  const tempRoot = resolveTempRoot({
    tempRoot: judgeOptions.tempRoot,
    env: runnerEnv,
    platform: runtimePlatform,
    cwd: judgeOptions.cwd,
  });
  await fs.mkdir(tempRoot, { recursive: true });
  const workDir = await fs.mkdtemp(path.join(tempRoot, 'judge-cpp-'));
  const binaryFileName = binaryFileNameForPlatform(runtimePlatform);
  const sourcePath = path.join(workDir, SOURCE_FILE_NAME);
  const compiler = await resolveCompiler({
    compiler: judgeOptions.compiler,
    env: runnerEnv,
    platform: runtimePlatform,
  });
  const compileArgs = judgeOptions.compileArgs || buildDefaultCompileArgs({
    platform: runtimePlatform,
    language: judgeOptions.language || problem.language,
    sourceFileName: SOURCE_FILE_NAME,
    binaryFileName,
  });
  const compileCommand = [compiler, ...compileArgs].join(' ');
  const binaryCommand = executableCommandForFile(binaryFileName, runtimePlatform);

  const compileTimeoutMs = await resolveCompileTimeoutMs({
    platform: runtimePlatform,
    env: runnerEnv,
    spawnEnv: judgeOptions.env,
    compiler,
    compileArgs,
    sourceFileName: SOURCE_FILE_NAME,
    binaryFileName,
    cwd: judgeOptions.cwd,
    explicitTimeoutMs: judgeOptions.compileTimeoutMs,
  });

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
          ? effectiveTimeLimitMs
          : Math.max(1, Math.min(effectiveTimeLimitMs, remainingAggregateMs));
        const run = await runProcess(binaryCommand, [], {
          cwd: workDir,
          env: judgeOptions.env,
          input: String(testCase.input ?? ''),
          timeoutMs: caseTimeoutMs,
          maxOutputBytes,
          trackCpuTime: true,
          trackMemory: memoryPolicy.trackMemory,
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
  loadProblem,
  parseTimeLimitMs,
  parseMemoryLimitMb,
  hasNoAdditionalTime,
  resolveMemoryPolicy,
  normalizeOutput,
  normalizeSubmissionSource,
  resolveSubmissionInput,
  binaryFileNameForPlatform,
  buildDefaultCompileArgs,
  executableCommandForFile,
  defaultCompileTimeoutMsForPlatform,
  findExecutableOnPath,
  resolveTempRoot,
  resolveCompiler,
  stripWrappingQuotes,
  cppStandardForLanguage,
  platformBaseCompileTimeoutMs,
  isCompileCalibrationEnabled,
  computeCalibratedCompileTimeoutMs,
  calibrateCompileEnvironment,
  resolveCompileTimeoutMs,
  warmupCompileCalibration,
  isRuntimeCalibrationEnabled,
  computeTimeLimitMultiplier,
  calibrateRuntimeSpeed,
  resolveTimeLimitMultiplier,
  warmupRuntimeCalibration,
};
