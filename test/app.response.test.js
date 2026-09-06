'use strict';

// Keep judging fixtures fast and verdict-stable across CI hardware: skip the
// host-speed CPU calibration probe and time-limit scaling during these tests.
process.env.JUDGE_RUNTIME_CALIBRATION = 'off';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { DEFAULT_BODY_LIMIT_BYTES, createApp } = require('../src/app');

const acceptedSource = `#include <bits/stdc++.h>
using namespace std;
int main(){ long long a,b; cin>>a>>b; cout << (a+b) << "\\n"; }
`;

const wrongSource = `#include <bits/stdc++.h>
using namespace std;
int main(){ cout << 0 << "\\n"; }
`;

const compileErrorSource = `#include <bits/stdc++.h>
using namespace std;
int main(){ this is not valid C++ }
`;

let server;
let baseUrl;

function listen(app) {
  return new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(0, '127.0.0.1', () => {
      app.off('error', reject);
      const address = app.address();
      resolve({ server: app, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function close(app) {
  return new Promise((resolve, reject) => {
    app.close((error) => error ? reject(error) : resolve());
  });
}

function request(method, path, options = {}) {
  const url = new URL(path, options.baseUrl || baseUrl);
  const payload = options.body === undefined ? null : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        ...(payload ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        } : {}),
        ...(options.headers || {}),
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const body = data ? JSON.parse(data) : null;
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function judgePayload(overrides = {}) {
  return {
    problemId: 1000,
    sourceCode: acceptedSource,
    testCases: [
      { input: '1 2\n', output: '3\n' },
      { input: '10 -4\n', output: '6\n' },
    ],
    timeLimit: '1 초',
    memoryLimit: '128 MB',
    ...overrides,
  };
}

before(async () => {
  const app = createApp();
  const started = await listen(app);
  server = started.server;
  baseUrl = started.baseUrl;
});

after(async () => {
  await close(server);
});

test('GET /health matches ret.md health body', async () => {
  const response = await request('GET', '/health');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.deepEqual(response.body, { ok: true, service: 'judge_server' });
});

test('GET / returns browser-friendly judge server status', async () => {
  const response = await request('GET', '/');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    service: 'judge_server',
    endpoints: {
      health: '/health',
      judge: '/judge',
    },
  });
});

test('default JSON request body limit is 10MB', () => {
  assert.equal(DEFAULT_BODY_LIMIT_BYTES, 10 * 1024 * 1024);
});

test('oversized JSON body returns 413', async () => {
  const limitedApp = createApp({ bodyLimitBytes: 64 });
  const started = await listen(limitedApp);

  try {
    const response = await request('POST', '/judge', {
      baseUrl: started.baseUrl,
      body: { payload: 'x'.repeat(128) },
    });

    assert.equal(response.statusCode, 413);
    assert.deepEqual(response.body, { ok: false, error: 'request body exceeds 64 bytes' });
  } finally {
    await close(started.server);
  }
});

test('OPTIONS /judge returns CORS preflight response for allowed origins', async () => {
  for (const origin of ['http://127.0.0.1:3100', 'http://127.0.0.1:3300', 'https://cosal.aviss.kr']) {
    const response = await request('OPTIONS', '/judge', {
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(response.statusCode, 204);
    assert.equal(response.body, null);
    assert.equal(response.headers['access-control-allow-origin'], origin);
    assert.match(String(response.headers['access-control-allow-methods']), /POST/);
  }
});

test('OPTIONS /health supports browser private network preflight', async () => {
  const response = await request('OPTIONS', '/health', {
    headers: {
      origin: 'http://127.0.0.1:3300',
      'access-control-request-method': 'GET',
      'access-control-request-private-network': 'true',
    },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.body, null);
  assert.equal(response.headers['access-control-allow-origin'], 'http://127.0.0.1:3300');
  assert.equal(response.headers['access-control-allow-private-network'], 'true');
  assert.match(String(response.headers['access-control-allow-methods']), /GET/);
});

test('disallowed Origin returns flat 403 error', async () => {
  const response = await request('POST', '/judge', {
    headers: { origin: 'http://evil.example' },
    body: judgePayload(),
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { ok: false, error: 'origin not allowed' });
});


test('missing route and wrong method use flat ret.md error responses', async () => {
  const missing = await request('GET', '/missing');
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.body, { ok: false, error: 'not found' });

  const wrongMethod = await request('GET', '/judge');
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.allow, 'POST');
  assert.deepEqual(wrongMethod.body, { ok: false, error: 'method not allowed' });
});

test('accepted submission returns ret.md judge shape', async () => {
  const response = await request('POST', '/judge', { body: judgePayload() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.verdict, 'accepted');
  assert.equal(response.body.problemId, 1000);
  assert.deepEqual(response.body.summary, {
    total: 2,
    passed: 2,
    failed: 0,
    firstFailedIndex: null,
  });
  assert.equal(response.body.results.length, 2);
  assert.equal(response.body.results[0].index, 0);
  assert.equal(response.body.results[0].expectedOutput, '3\n');
  assert.equal(response.body.results[0].passed, true);
  assert.equal(response.body.results[0].status.description, 'Accepted');
});

test('Coding Salgu samples payload is accepted as judge test cases', async () => {
  const { testCases, ...payload } = judgePayload();
  const response = await request('POST', '/judge', {
    body: {
      ...payload,
      samples: testCases,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.verdict, 'accepted');
  assert.deepEqual(response.body.summary, {
    total: 2,
    passed: 2,
    failed: 0,
    firstFailedIndex: null,
  });
});

test('wrong answer returns HTTP 200 with ok false and first failed index', async () => {
  const response = await request('POST', '/judge', {
    body: judgePayload({ sourceCode: wrongSource }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.verdict, 'wrong_answer');
  assert.equal(response.body.summary.total, 2);
  assert.equal(response.body.summary.passed, 0);
  assert.equal(response.body.summary.failed, 2);
  assert.equal(response.body.summary.firstFailedIndex, 0);
  assert.equal(response.body.results[0].verdict, 'wrong_answer');
  assert.equal(response.body.results[0].stdout, '0\n');
});

test('compilation error maps to result entries with compile output', async () => {
  const response = await request('POST', '/judge', {
    body: judgePayload({ sourceCode: compileErrorSource }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.verdict, 'compilation_error');
  assert.equal(response.body.summary.firstFailedIndex, 0);
  assert.equal(response.body.results.length, 2);
  assert.equal(response.body.results[0].verdict, 'compilation_error');
  assert.match(response.body.results[0].compileOutput, /error/i);
});

test('invalid fields return ret.md flat error response', async () => {
  const response = await request('POST', '/judge', {
    body: judgePayload({ testCases: [] }),
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { ok: false, error: 'testCases must be a non-empty array' });
});

// 2870번처럼 아무것도 출력하지 않는 것이 정답인 문제가 있다.
// 빈 기대 출력을 거부하면 정답 코드가 채점 자체를 못 받는다.
test('empty expected output is judged instead of rejected', async () => {
  const silentSource = '#include <bits/stdc++.h>\nint main(){}\n';
  const response = await request('POST', '/judge', {
    body: judgePayload({
      sourceCode: silentSource,
      testCases: [{ input: '1 2\n', output: '' }],
    }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.verdict, 'accepted');
  assert.equal(response.body.summary.passed, 1);
});

test('empty expected output still fails when the program prints something', async () => {
  const response = await request('POST', '/judge', {
    body: judgePayload({
      sourceCode: wrongSource,
      testCases: [{ input: '1 2\n', output: '' }],
    }),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.verdict, 'wrong_answer');
  assert.equal(response.body.results[0].stdout, '0\n');
});

test('non-string test case output is still rejected', async () => {
  const response = await request('POST', '/judge', {
    body: judgePayload({ testCases: [{ input: '1 2\n', output: 3 }] }),
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { ok: false, error: 'testCases[0].output must be a string' });
});

test('unsupported language returns C++ only validation error', async () => {
  const response = await request('POST', '/judge', {
    body: judgePayload({ language: 'python' }),
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { ok: false, error: 'only C++ submissions are supported' });
});

test('validateJudgeRequest normalizes C++20 language for judge module', () => {
  const { validateJudgeRequest } = require('../src/app');
  const problem = validateJudgeRequest(judgePayload({ language: 'GNU C++20' }));
  assert.equal(problem.language, 'gnu++20');
});

test('validateJudgeRequest accepts Coding Salgu samples alias', () => {
  const { validateJudgeRequest } = require('../src/app');
  const { testCases, ...payload } = judgePayload();
  const problem = validateJudgeRequest({ ...payload, samples: testCases });
  assert.deepEqual(problem.testCases, testCases);
});

test('runJudge forwards normalized language to judge module', async (t) => {
  const { runJudge } = require('../src/app');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'judge-app-fake-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const fakeJudgePath = path.join(tempDir, 'judge.js');
  await fs.writeFile(fakeJudgePath, `
    'use strict';
    module.exports.judgeSubmission = async function judgeSubmission(request) {
      return {
        verdict: request.language === 'gnu++20' && request.problem.language === 'gnu++20' ? 'AC' : 'WA',
        cases: [{
          index: 1,
          status: request.language === 'gnu++20' ? 'AC' : 'WA',
          input: '',
          expected: '',
          actual: '',
          stderr: '',
          durationMs: 0,
          exitCode: 0
        }]
      };
    };
  `);

  const result = await runJudge({
    body: judgePayload({ language: 'GNU C++20' }),
    judgePath: fakeJudgePath,
  });
  assert.equal(result.verdict, 'accepted');
});

const echoInputSource = `#include <bits/stdc++.h>
using namespace std;
int main(){ string line; while (getline(cin, line)) cout << line << "\\n"; }
`;

test('publicTestCaseCount hides the values of private test cases', async () => {
  const response = await request('POST', '/judge', {
    body: judgePayload({ publicTestCaseCount: 1 }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.verdict, 'accepted');

  const [publicCase, privateCase] = response.body.results;
  assert.equal(publicCase.hidden, false);
  assert.equal(publicCase.input, '1 2\n');
  assert.equal(publicCase.expectedOutput, '3\n');
  assert.equal(publicCase.stdout, '3\n');

  assert.equal(privateCase.hidden, true);
  assert.equal(privateCase.input, '[hidden]');
  assert.equal(privateCase.expectedOutput, '[hidden]');
  assert.equal(privateCase.stdout, '[hidden]');
  assert.equal(privateCase.stderr, '[hidden]');
  // 판정과 계측값은 가리지 않는다. 학생이 어느 케이스에서 틀렸는지는 알아야 한다.
  assert.equal(privateCase.index, 1);
  assert.equal(privateCase.verdict, 'accepted');
});

test('a program that echoes stdin cannot leak a private test case', async () => {
  const response = await request('POST', '/judge', {
    body: judgePayload({
      sourceCode: echoInputSource,
      testCases: [
        { input: 'public\n', output: 'public\n' },
        { input: 'SECRET-INPUT\n', output: 'SECRET-INPUT\n' },
      ],
      publicTestCaseCount: 1,
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(response.body), /SECRET-INPUT/u, '프라이빗 입력이 응답에 남아 있다');
});

test('private test case values stay hidden on compile and internal errors', async () => {
  const compileError = await request('POST', '/judge', {
    body: judgePayload({ sourceCode: compileErrorSource, publicTestCaseCount: 1 }),
  });
  assert.equal(compileError.body.verdict, 'compilation_error');
  assert.equal(compileError.body.results[0].input, '1 2\n');
  assert.equal(compileError.body.results[1].hidden, true);
  assert.equal(compileError.body.results[1].input, '[hidden]');
  assert.equal(compileError.body.results[1].expectedOutput, '[hidden]');
  // 컴파일러 메시지는 케이스별 값이 아니므로 가리지 않는다.
  assert.ok(compileError.body.results[1].compileOutput.length > 0);

  const { formatJudgeResponse } = require('../src/app');
  const internalError = formatJudgeResponse(
    {
      problemId: 1000,
      publicTestCaseCount: 1,
      testCases: [
        { input: '1 2\n', output: '3\n' },
        { input: 'SECRET\n', output: 'SECRET\n' },
      ],
    },
    { verdict: 'IE', cases: [] },
  );
  assert.equal(internalError.results[1].hidden, true);
  assert.doesNotMatch(JSON.stringify(internalError), /SECRET/u);
});

test('requests without publicTestCaseCount keep every case public', async () => {
  const response = await request('POST', '/judge', { body: judgePayload() });
  assert.equal(response.body.results.length, 2);
  assert.equal(response.body.results[0].hidden, false);
  assert.equal(response.body.results[1].hidden, false);
  assert.equal(response.body.results[1].input, '10 -4\n');
});

test('publicTestCaseCount must be a non-negative integer', async () => {
  const response = await request('POST', '/judge', {
    body: judgePayload({ publicTestCaseCount: -1 }),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, 'publicTestCaseCount must be a non-negative integer');

  const fractional = await request('POST', '/judge', {
    body: judgePayload({ publicTestCaseCount: 1.5 }),
  });
  assert.equal(fractional.statusCode, 400);

  // 케이스 수보다 크면 전부 공개로 본다. 제출을 거절할 일은 아니다.
  const tooLarge = await request('POST', '/judge', {
    body: judgePayload({ publicTestCaseCount: 99 }),
  });
  assert.equal(tooLarge.statusCode, 200);
  assert.equal(tooLarge.body.results[1].hidden, false);
});
