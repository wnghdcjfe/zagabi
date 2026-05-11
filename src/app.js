'use strict';

const http = require('node:http');
const path = require('node:path');

const DEFAULT_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_CORS_ORIGINS = [
  'http://127.0.0.1:3100',
  'http://localhost:3100',
  'https://cosal.aviss.kr',
];
const DEFAULT_CORS_METHODS = 'GET, POST, OPTIONS';
const DEFAULT_CORS_HEADERS = 'content-type, authorization';

const VERDICT_MAP = {
  AC: 'accepted',
  WA: 'wrong_answer',
  TLE: 'time_limit_exceeded',
  MLE: 'memory_limit_exceeded',
  CE: 'compilation_error',
  RE: 'runtime_error',
  IE: 'internal_error',
};

const STATUS_BY_VERDICT = {
  accepted: { id: 3, description: 'Accepted' },
  wrong_answer: { id: 4, description: 'Wrong Answer' },
  time_limit_exceeded: { id: 5, description: 'Time Limit Exceeded' },
  compilation_error: { id: 6, description: 'Compilation Error' },
  memory_limit_exceeded: { id: 7, description: 'Memory Limit Exceeded' },
  runtime_error: { id: 11, description: 'Runtime Error' },
  internal_error: { id: 13, description: 'Internal Error' },
};

class HttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = statusCode < 500;
  }
}

function jsonResponse(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function resolveCorsOrigins(value) {
  if (Array.isArray(value)) return value.map(String).map((origin) => origin.trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((origin) => origin.trim()).filter(Boolean);
  }
  return DEFAULT_CORS_ORIGINS;
}

function applyCors(req, res, allowedOrigins = DEFAULT_CORS_ORIGINS) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;

  const allowAll = allowedOrigins.includes('*');
  if (!allowAll && !allowedOrigins.includes(origin)) return false;

  res.setHeader('access-control-allow-origin', allowAll ? '*' : origin);
  res.setHeader('access-control-allow-methods', DEFAULT_CORS_METHODS);
  res.setHeader(
    'access-control-allow-headers',
    req.headers['access-control-request-headers'] || DEFAULT_CORS_HEADERS,
  );
  res.setHeader('access-control-max-age', '600');
  res.setHeader('vary', 'Origin');
  return true;
}

function assertCorsAllowed(req, res, allowedOrigins) {
  if (!applyCors(req, res, allowedOrigins)) {
    throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'origin not allowed');
  }
}

function optionsResponse(res) {
  res.writeHead(204, {
    'content-length': '0',
    'cache-control': 'no-store',
  });
  res.end();
}

function notFound(res) {
  jsonResponse(res, 404, { ok: false, error: 'not found' });
}

function methodNotAllowed(res, allowedMethods) {
  res.setHeader('allow', allowedMethods.join(', '));
  jsonResponse(res, 405, { ok: false, error: 'method not allowed' });
}

function getRequestUrl(req) {
  return new URL(req.url || '/', 'http://127.0.0.1');
}

function readJsonBody(req, options = {}) {
  const limitBytes = options.limitBytes || DEFAULT_BODY_LIMIT_BYTES;

  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType && !contentType.includes('application/json')) {
      reject(new HttpError(400, 'INVALID_JSON', 'request body must be valid JSON'));
      req.resume();
      return;
    }

    let receivedBytes = 0;
    const chunks = [];
    let oversized = false;

    req.on('data', (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > limitBytes) {
        oversized = true;
        reject(new HttpError(413, 'BODY_TOO_LARGE', `request body exceeds ${limitBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (oversized) return;
      if (receivedBytes === 0) {
        resolve({});
        return;
      }

      const rawBody = Buffer.concat(chunks).toString('utf8');
      try {
        const parsed = JSON.parse(rawBody);
        if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
          reject(new HttpError(400, 'INVALID_JSON', 'request body must be valid JSON'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', 'request body must be valid JSON'));
      }
    });

    req.on('error', (error) => {
      if (!oversized) reject(error);
    });
  });
}

function loadJudgeModule(judgePath) {
  try {
    return require(judgePath);
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes(judgePath)) {
      return null;
    }
    throw error;
  }
}

function resolveJudgeFunction(judgeModule) {
  if (typeof judgeModule === 'function') return judgeModule;
  if (judgeModule && typeof judgeModule.judge === 'function') return judgeModule.judge;
  if (judgeModule && typeof judgeModule.judgeSubmission === 'function') return judgeModule.judgeSubmission;
  if (judgeModule && typeof judgeModule.runJudge === 'function') return judgeModule.runJudge;
  return null;
}

function isCppLanguage(value) {
  if (value === undefined || value === null || value === '') return true;
  const language = String(value).trim().toLowerCase().replace(/\s+/g, '');
  return ['c++', 'cpp', 'cxx', 'cplusplus', 'gnu++17', 'gnu++20'].includes(language);
}

function validateJudgeRequest(body) {
  if (!Number.isInteger(body.problemId) || body.problemId <= 0) {
    throw new HttpError(400, 'INVALID_PROBLEM_ID', 'problemId must be a positive integer');
  }

  if (!isCppLanguage(body.language ?? body.lang)) {
    throw new HttpError(400, 'UNSUPPORTED_LANGUAGE', 'only C++ submissions are supported');
  }

  const sourceCode = body.sourceCode ?? body.code ?? body.source_code;
  if (typeof sourceCode !== 'string' || sourceCode.trim().length === 0) {
    throw new HttpError(400, 'INVALID_SOURCE_CODE', 'sourceCode must be a non-empty string');
  }

  if (!Array.isArray(body.testCases) || body.testCases.length === 0) {
    throw new HttpError(400, 'INVALID_TEST_CASES', 'testCases must be a non-empty array');
  }

  const testCases = body.testCases.map((testCase, index) => {
    if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
      throw new HttpError(400, 'INVALID_TEST_CASE', `testCases[${index}] must be an object`);
    }
    if (typeof testCase.input !== 'string') {
      throw new HttpError(400, 'INVALID_TEST_CASE_INPUT', `testCases[${index}].input must be a string`);
    }
    if (typeof testCase.output !== 'string' || testCase.output.length === 0) {
      throw new HttpError(400, 'INVALID_TEST_CASE_OUTPUT', `testCases[${index}].output must be a non-empty string`);
    }
    return {
      input: testCase.input,
      output: testCase.output,
    };
  });

  return {
    problemId: body.problemId,
    sourceCode,
    testCases,
    timeLimit: body.timeLimit,
    memoryLimit: body.memoryLimit,
  };
}

function normalizeVerdict(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'internal_error';
  const upper = raw.toUpperCase();
  if (VERDICT_MAP[upper]) return VERDICT_MAP[upper];
  if (STATUS_BY_VERDICT[raw]) return raw;
  return 'internal_error';
}

function statusForVerdict(verdict) {
  return STATUS_BY_VERDICT[verdict] || STATUS_BY_VERDICT.internal_error;
}

function formatTime(durationMs) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return null;
  return (durationMs / 1000).toFixed(3);
}

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function messageForCase(testCase, verdict) {
  if (testCase.error) return String(testCase.error);
  if (verdict === 'time_limit_exceeded') return 'time limit exceeded';
  if (verdict === 'runtime_error') {
    if (testCase.signal) return `runtime error: signal ${testCase.signal}`;
    if (Number.isInteger(testCase.exitCode)) return `runtime error: exit code ${testCase.exitCode}`;
    return 'runtime error';
  }
  if (verdict === 'internal_error') return 'internal judge error';
  return '';
}

function buildRuntimeResult(testCase) {
  const verdict = normalizeVerdict(testCase.status);
  const passed = verdict === 'accepted';
  return {
    index: Math.max(0, Number(testCase.index || 1) - 1),
    input: text(testCase.input),
    expectedOutput: text(testCase.expected),
    ok: passed,
    passed,
    verdict,
    status: statusForVerdict(verdict),
    stdout: text(testCase.actual),
    stderr: text(testCase.stderr),
    compileOutput: '',
    message: messageForCase(testCase, verdict),
    time: formatTime(testCase.durationMs),
    memory: null,
  };
}

function buildCompileErrorResults(problem, judgeResult) {
  const compileOutput = text(judgeResult.compileLog || judgeResult.compile?.stderr || judgeResult.stderr);
  const stderr = text(judgeResult.stderr || judgeResult.compile?.stderr);
  return problem.testCases.map((testCase, index) => ({
    index,
    input: testCase.input,
    expectedOutput: testCase.output,
    ok: false,
    passed: false,
    verdict: 'compilation_error',
    status: statusForVerdict('compilation_error'),
    stdout: text(judgeResult.compile?.stdout),
    stderr,
    compileOutput,
    message: compileOutput || 'compilation error',
    time: formatTime(judgeResult.compile?.durationMs),
    memory: null,
  }));
}

function buildInternalErrorResults(problem, judgeResult) {
  const message = text(judgeResult?.error || judgeResult?.message || 'internal judge error');
  return problem.testCases.map((testCase, index) => ({
    index,
    input: testCase.input,
    expectedOutput: testCase.output,
    ok: false,
    passed: false,
    verdict: 'internal_error',
    status: statusForVerdict('internal_error'),
    stdout: '',
    stderr: '',
    compileOutput: '',
    message,
    time: null,
    memory: null,
  }));
}

function formatJudgeResponse(problem, judgeResult) {
  const internalVerdict = normalizeVerdict(judgeResult && judgeResult.verdict);
  const results = internalVerdict === 'compilation_error'
    ? buildCompileErrorResults(problem, judgeResult || {})
    : Array.isArray(judgeResult?.cases) && judgeResult.cases.length > 0
      ? judgeResult.cases.map(buildRuntimeResult)
      : buildInternalErrorResults(problem, judgeResult || {});

  const passed = results.filter((result) => result.passed).length;
  const firstFailed = results.find((result) => !result.passed);
  const firstFailedIndex = firstFailed ? firstFailed.index : null;
  const verdict = firstFailed ? firstFailed.verdict : 'accepted';

  return {
    ok: verdict === 'accepted',
    verdict,
    problemId: problem.problemId,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      firstFailedIndex,
    },
    results,
  };
}

async function runJudge({ body, judgePath }) {
  const problem = validateJudgeRequest(body);
  const judgeModule = loadJudgeModule(judgePath);
  const judge = resolveJudgeFunction(judgeModule);
  if (!judge) {
    throw new HttpError(503, 'JUDGE_SERVICE_UNAVAILABLE', 'judge service unavailable');
  }

  const result = await judge({
    sourceCode: problem.sourceCode,
    problem,
  });
  return formatJudgeResponse(problem, result);
}

function toErrorBody(error) {
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  const message = statusCode >= 500 && !error.expose ? 'judge service unavailable' : error.message;
  return {
    statusCode,
    body: {
      ok: false,
      error: message || 'judge service unavailable',
    },
  };
}

function createApp(options = {}) {
  const judgePath = options.judgePath || path.resolve(__dirname, 'judge');
  const bodyLimitBytes = options.bodyLimitBytes || DEFAULT_BODY_LIMIT_BYTES;
  const corsOrigins = resolveCorsOrigins(options.corsOrigins || process.env.CORS_ORIGIN);

  return http.createServer(async (req, res) => {
    try {
      assertCorsAllowed(req, res, corsOrigins);
      const url = getRequestUrl(req);

      if (req.method === 'OPTIONS') {
        if (url.pathname === '/judge') {
          optionsResponse(res);
        } else {
          notFound(res);
        }
        return;
      }

      if (url.pathname === '/health') {
        if (req.method !== 'GET') {
          methodNotAllowed(res, ['GET']);
          return;
        }

        jsonResponse(res, 200, {
          ok: true,
          service: 'judge_server',
        });
        return;
      }

      if (url.pathname === '/judge') {
        if (req.method !== 'POST') {
          methodNotAllowed(res, ['POST']);
          return;
        }

        const body = await readJsonBody(req, { limitBytes: bodyLimitBytes });
        const result = await runJudge({ body, judgePath });
        jsonResponse(res, 200, result);
        return;
      }

      notFound(res);
    } catch (error) {
      const { statusCode, body } = toErrorBody(error);
      jsonResponse(res, statusCode, body);
    }
  });
}

module.exports = {
  applyCors,
  assertCorsAllowed,
  DEFAULT_BODY_LIMIT_BYTES,
  DEFAULT_CORS_ORIGINS,
  formatJudgeResponse,
  HttpError,
  createApp,
  optionsResponse,
  readJsonBody,
  resolveJudgeFunction,
  resolveCorsOrigins,
  runJudge,
  validateJudgeRequest,
};
