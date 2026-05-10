#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PORT || 34567);
const BASE_URL = process.env.JUDGE_URL || `http://127.0.0.1:${PORT}`;
const CORS_ORIGIN = 'http://127.0.0.1:3100';

const cases = [
  {
    name: 'AC',
    expected: 'accepted',
    sourceCode: '#include <bits/stdc++.h>\nusing namespace std;\nint main(){ long long a,b; cin>>a>>b; cout << a+b << "\\n"; }\n',
  },
  {
    name: 'WA',
    expected: 'wrong_answer',
    sourceCode: '#include <bits/stdc++.h>\nusing namespace std;\nint main(){ cout << 0 << "\\n"; }\n',
  },
  {
    name: 'CE',
    expected: 'compilation_error',
    sourceCode: '#include <bits/stdc++.h>\nusing namespace std;\nint main(){ invalid C++ }\n',
  },
  {
    name: 'TLE',
    expected: 'time_limit_exceeded',
    sourceCode: '#include <bits/stdc++.h>\nusing namespace std;\nint main(){ volatile int x = 0; while(true){ ++x; } }\n',
    testCases: [{ input: '', output: 'done\n' }],
  },
];

function postJson(path, payload, headers = {}) {
  const body = JSON.stringify(payload);
  const url = new URL(path, BASE_URL);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...headers,
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (error) {
          reject(new Error(`Invalid JSON response (${res.statusCode}): ${data}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

function getHealth() {
  const url = new URL('/health', BASE_URL);
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('timeout', () => req.destroy(new Error('health request timed out')));
    req.on('error', reject);
  });
}

function preflightJudge(origin = CORS_ORIGIN) {
  const url = new URL('/judge', BASE_URL);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method: 'OPTIONS',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
      timeout: 3000,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        allowOrigin: res.headers['access-control-allow-origin'],
        allowMethods: res.headers['access-control-allow-methods'],
        allowHeaders: res.headers['access-control-allow-headers'],
      }));
    });
    req.on('timeout', () => req.destroy(new Error('preflight request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function startServerIfNeeded() {
  if (process.env.JUDGE_URL) return null;
  try {
    require.resolve('../src/server');
  } catch {
    return null;
  }
  const child = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
  return child;
}

function verdictOf(body) {
  return String((body && (body.verdict || body.status || body.result || body.outcome || body.code)) || '');
}

async function waitForHealth() {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await getHealth();
      if (response.statusCode >= 200 && response.statusCode < 500) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error('server did not become healthy');
}

async function main() {
  const server = startServerIfNeeded();
  if (!server && !process.env.JUDGE_URL) {
    console.log('SKIP smoke: src/server.js not available and JUDGE_URL not set');
    return;
  }
  try {
    const health = await waitForHealth();
    assert.equal(health.statusCode, 200, `health expected 200, got ${health.statusCode}`);
    assert.deepEqual(health.body, { ok: true, service: 'judge_server' });
    const preflight = await preflightJudge();
    assert.equal(preflight.statusCode, 204, `preflight expected 204, got ${preflight.statusCode}`);
    assert.equal(preflight.allowOrigin, CORS_ORIGIN, `preflight bad allow-origin: ${preflight.allowOrigin}`);
    assert.match(String(preflight.allowMethods || ''), /\bPOST\b/, 'preflight should allow POST');
    assert.match(String(preflight.allowHeaders || '').toLowerCase(), /content-type/, 'preflight should allow content-type');
    const cosalPreflight = await preflightJudge('https://cosal.aviss.kr');
    assert.equal(cosalPreflight.statusCode, 204, `cosal preflight expected 204, got ${cosalPreflight.statusCode}`);
    assert.equal(cosalPreflight.allowOrigin, 'https://cosal.aviss.kr', `cosal preflight bad allow-origin: ${cosalPreflight.allowOrigin}`);
    console.log('PASS CORS');

    const forbidden = await postJson('/judge', {
      problemId: 1000,
      language: 'cpp',
      sourceCode: cases[0].sourceCode,
      timeLimit: '1 초',
      memoryLimit: '128 MB',
      testCases: [{ input: '2 3\n', output: '5\n' }],
    }, { origin: 'http://evil.example' });
    assert.equal(forbidden.statusCode, 403, `forbidden origin expected 403, got ${forbidden.statusCode}`);
    assert.deepEqual(forbidden.body, { ok: false, error: 'origin not allowed' });
    console.log('PASS CORS forbidden');
    for (const item of cases) {
      const response = await postJson('/judge', {
        problemId: 1000,
        language: 'cpp',
        sourceCode: item.sourceCode,
        timeLimit: '1 초',
        memoryLimit: '128 MB',
        testCases: item.testCases || [{ input: '2 3\n', output: '5\n' }],
      });
      assert.equal(response.statusCode, 200, `${item.name}: expected HTTP 200, got ${response.statusCode}`);
      assert.equal(verdictOf(response.body), item.expected, `${item.name}: ${JSON.stringify(response.body, null, 2)}`);
      assert.equal(response.body.ok, item.expected === 'accepted', `${item.name}: bad ok flag`);
      assert.equal(response.body.problemId, 1000, `${item.name}: bad problemId`);
      assert.ok(Array.isArray(response.body.results), `${item.name}: results must be an array`);
      assert.equal(response.body.summary.total, response.body.results.length, `${item.name}: summary/results mismatch`);
      console.log(`PASS ${item.name}`);
    }
  } finally {
    if (server) server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
