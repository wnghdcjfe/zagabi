'use strict';

process.env.JUDGE_RUNTIME_CALIBRATION = 'off';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

function loadJudge() {
  try {
    const mod = require('../src/judge-java');
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
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('../src/judge-java')) {
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

async function runJavaJudgeCase(t, sourceCode, extra = {}) {
  const { fn, missing, error } = loadJudge();
  if (missing) {
    t.skip(`src/judge-java.js is not available${error ? `: ${error.message}` : ''}`);
    return null;
  }

  return await fn({
    problemId: 'java-contract-smoke',
    sourceCode,
    language: extra.language || 'java',
    timeLimit: extra.timeLimit || '2 초',
    memoryLimit: extra.memoryLimit || '512 MB',
    testCases: extra.testCases || [
      { input: '2 3\n', output: '5\n' },
    ],
  });
}

const javaAccepted = `import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong();
        System.out.println(a + b);
    }
}`;

const javaWrongAnswer = `public class Main {
    public static void main(String[] args) {
        System.out.println(0);
    }
}`;

const javaCompileError = `public class Main {
    public static void main(String[] args) {
        this is not valid Java
    }
}`;

const javaInfiniteLoop = `public class Main {
    public static void main(String[] args) {
        while (true) {}
    }
}`;

const javaRuntimeError = `public class Main {
    public static void main(String[] args) {
        int x = 1 / 0;
    }
}`;

test('Java judge returns AC for matching output', async (t) => {
  const result = await runJavaJudgeCase(t, javaAccepted);
  if (!result) return;

  assert.equal(verdictOf(result), 'AC', JSON.stringify(result, null, 2));
  assert.ok(Array.isArray(result.cases), 'expected per-case details array');
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].status, 'AC');
});

test('Java judge returns WA for mismatched output', async (t) => {
  const result = await runJavaJudgeCase(t, javaWrongAnswer);
  if (!result) return;

  assert.equal(verdictOf(result), 'WA', JSON.stringify(result, null, 2));
  assert.equal(result.cases[0].status, 'WA');
});

test('Java judge returns CE for invalid Java syntax', async (t) => {
  const result = await runJavaJudgeCase(t, javaCompileError);
  if (!result) return;

  assert.equal(verdictOf(result), 'CE', JSON.stringify(result, null, 2));
  assert.ok(result.compileLog || result.stderr, 'CE should include compile output');
});

test('Java judge returns TLE for infinite loop', async (t) => {
  const result = await runJavaJudgeCase(t, javaInfiniteLoop, {
    testCases: [{ input: '', output: 'done\n' }],
    timeLimit: '1 초',
  });
  if (!result) return;

  assert.equal(verdictOf(result), 'TLE', JSON.stringify(result, null, 2));
});

test('Java judge returns RE for arithmetic exception', async (t) => {
  const result = await runJavaJudgeCase(t, javaRuntimeError);
  if (!result) return;

  assert.equal(verdictOf(result), 'RE', JSON.stringify(result, null, 2));
});

test('Java judge strips package declaration', async (t) => {
  const sourceWithPackage = `package com.example;
import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long a = sc.nextLong(), b = sc.nextLong();
        System.out.println(a + b);
    }
}`;
  const result = await runJavaJudgeCase(t, sourceWithPackage);
  if (!result) return;

  assert.equal(verdictOf(result), 'AC', JSON.stringify(result, null, 2));
});

test('Java judge gives CE for wrong public class name', async (t) => {
  const source = `public class Solution {
    public static void main(String[] args) {
        System.out.println(0);
    }
}`;
  const result = await runJavaJudgeCase(t, source);
  if (!result) return;

  assert.equal(verdictOf(result), 'CE', JSON.stringify(result, null, 2));
});

test('Java judge handles multiple test cases', async (t) => {
  const result = await runJavaJudgeCase(t, javaAccepted, {
    testCases: [
      { input: '2 3\n', output: '5\n' },
      { input: '10 -4\n', output: '6\n' },
      { input: '0 0\n', output: '0\n' },
    ],
  });
  if (!result) return;

  assert.equal(verdictOf(result), 'AC');
  assert.equal(result.cases.length, 3);
  for (const c of result.cases) {
    assert.equal(c.status, 'AC');
  }
});

test('Java normalizeJavaLanguage recognizes java identifiers', () => {
  const { normalizeJavaLanguage } = require('../src/judge-java');
  assert.equal(normalizeJavaLanguage('java'), 'java');
  assert.equal(normalizeJavaLanguage('Java'), 'java');
  assert.equal(normalizeJavaLanguage('JAVA'), 'java');
  assert.equal(normalizeJavaLanguage('java17'), 'java17');
  assert.equal(normalizeJavaLanguage('java21'), 'java21');
  assert.equal(normalizeJavaLanguage('python'), null);
  assert.equal(normalizeJavaLanguage(undefined), 'java');
  assert.equal(normalizeJavaLanguage(null), 'java');
  assert.equal(normalizeJavaLanguage(''), 'java');
});

test('Java normalizeJavaSource strips package declarations', () => {
  const { normalizeJavaSource } = require('../src/judge-java');
  const src = 'package com.foo.bar;\npublic class Main { public static void main(String[] args) {} }';
  const normalized = normalizeJavaSource(src);
  assert.ok(!normalized.includes('package'), 'package declaration should be stripped');
  assert.ok(normalized.includes('public class Main'), 'class declaration should remain');
});

test('JVM calibration probe returns startup time', async () => {
  const { warmupJvmCalibration } = require('../src/judge-java');
  const result = await warmupJvmCalibration();
  assert.ok(result, 'calibration should return a result');
  assert.equal(result.ok, true);
  assert.ok(Number.isFinite(result.startupMs), `startupMs should be a number, got ${result.startupMs}`);
  assert.ok(result.startupMs >= 0, 'startupMs should be non-negative');
});
