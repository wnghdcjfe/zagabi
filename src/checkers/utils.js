'use strict';

// 체커가 공유하는 파싱/판정 도우미.
//
// reason 문구 규칙: 입력이나 기대 출력의 "값" 을 절대 담지 않는다. 프라이빗 케이스의 판정
// 사유도 학생에게 그대로 내려가므로, 값을 적으면 숨긴 테스트케이스가 새어 나간다.
// 위치(몇 번째)와 개수만 적는다.

function pass() {
  return { ok: true };
}

function fail(code, reason) {
  return { ok: false, code, reason };
}

function tokenize(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/u);
}

const INTEGER_RE = /^[+-]?\d+$/u;

function toInteger(token) {
  if (typeof token !== 'string' || !INTEGER_RE.test(token)) return null;
  const value = Number(token);
  return Number.isSafeInteger(value) ? value : null;
}

// 토큰 전부를 정수로 바꾼다. 하나라도 정수가 아니면 그 위치(1-based)를 돌려준다.
function toIntegers(tokens) {
  const values = new Array(tokens.length);
  for (let index = 0; index < tokens.length; index += 1) {
    const value = toInteger(tokens[index]);
    if (value === null) {
      return { values: null, badIndex: index + 1 };
    }
    values[index] = value;
  }
  return { values, badIndex: -1 };
}

// 기대 출력의 첫 토큰은 "유일하게 결정되는 값"(최소 횟수, 최소 시간, LIS 길이)이라 오라클로 쓴다.
function readExpectedInteger(expectedOutput) {
  const value = toInteger(tokenize(expectedOutput)[0]);
  if (value === null) {
    throw new Error('expected output must start with an integer');
  }
  return value;
}

module.exports = {
  pass,
  fail,
  tokenize,
  toInteger,
  toIntegers,
  readExpectedInteger,
};
