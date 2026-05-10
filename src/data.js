'use strict';

const fs = require('fs');
const path = require('path');
const { parseTimeLimit, parseMemoryLimit } = require('./limits');

const DEFAULT_DATA_PATH = path.join(__dirname, '..', 'data.json');

function assertPlainObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
}

function assertString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
}

function validateTestCase(testCase, index) {
  const fieldName = `testCases[${index}]`;
  assertPlainObject(testCase, fieldName);
  assertString(testCase.input, `${fieldName}.input`);
  assertString(testCase.output, `${fieldName}.output`);
  return {
    input: testCase.input,
    output: testCase.output,
  };
}

/**
 * Validate the repository data.json contract and attach normalized limit fields.
 * The original Korean strings are preserved for API/debug responses.
 */
function validateProblemData(raw) {
  assertPlainObject(raw, 'data');

  if (!Number.isInteger(raw.problemId) || raw.problemId <= 0) {
    throw new Error('problemId must be a positive integer');
  }
  assertString(raw.sourceCode, 'sourceCode');
  assertString(raw.timeLimit, 'timeLimit');
  assertString(raw.memoryLimit, 'memoryLimit');

  if (!Array.isArray(raw.testCases) || raw.testCases.length === 0) {
    throw new Error('testCases must be a non-empty array');
  }

  const testCases = raw.testCases.map(validateTestCase);
  const timeLimitMs = parseTimeLimit(raw.timeLimit);
  const memoryLimitMb = parseMemoryLimit(raw.memoryLimit);

  return {
    problemId: raw.problemId,
    sourceCode: raw.sourceCode,
    testCases,
    timeLimit: raw.timeLimit,
    memoryLimit: raw.memoryLimit,
    limits: {
      timeLimitMs,
      memoryLimitMb,
    },
  };
}

function readJsonFile(filePath) {
  const rawText = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${filePath}: ${error.message}`);
  }
}

/**
 * Load and validate problem data. Defaults to the project-root data.json file.
 */
function loadProblemData(filePath = DEFAULT_DATA_PATH) {
  return validateProblemData(readJsonFile(filePath));
}

module.exports = {
  DEFAULT_DATA_PATH,
  loadProblemData,
  validateProblemData,
};
