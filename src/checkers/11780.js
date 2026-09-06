'use strict';

// 11780 플로이드 2 — 최소 비용 경로는 여러 개일 수 있다.
//
// 비용 행렬은 유일하므로 기대 출력과 그대로 비교하고, 그 뒤에 오는 n x n 개의 경로는
// "실제로 존재하는 간선을 따라가고, 총 비용이 최소 비용과 같은가" 로 직접 검증한다.
// (동점 경로가 있을 때 어떤 것을 고르는지는 구현마다 다르다.)
//
// 검사 항목
//   1. 앞의 n x n 개 숫자(비용 행렬)가 기대 출력과 정확히 같은가
//   2. 각 경로 줄의 첫 수 k 가 뒤따르는 도시 개수와 맞는가
//   3. 비용이 0(자기 자신이거나 도달 불가)인 칸은 k=0 인가
//   4. 경로가 i 에서 시작해 j 에서 끝나는가
//   5. 이웃한 두 도시 사이에 실제 간선이 있는가
//   6. 경로 비용의 합이 최소 비용과 같은가

const { fail, pass, tokenize, toIntegers } = require('./utils');

function parseInput(input) {
  const { values } = toIntegers(tokenize(input));
  if (values === null || values.length < 2) {
    throw new Error('11780 input must be a list of integers');
  }
  const n = values[0];
  const m = values[1];
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(m) || m < 0) {
    throw new Error('11780 input must start with n and m');
  }
  if (values.length < 2 + m * 3) {
    throw new Error('11780 input must contain m bus lines');
  }
  // 같은 도시 쌍에 노선이 여러 개일 수 있으므로 가장 싼 것만 남긴다.
  const edge = new Map();
  for (let index = 0; index < m; index += 1) {
    const a = values[2 + index * 3];
    const b = values[3 + index * 3];
    const c = values[4 + index * 3];
    const key = a * (n + 1) + b;
    const previous = edge.get(key);
    if (previous === undefined || c < previous) {
      edge.set(key, c);
    }
  }
  return { n, edge };
}

function check({ input, stdout, expectedOutput }) {
  const { n, edge } = parseInput(input);

  const expected = toIntegers(tokenize(expectedOutput)).values;
  if (expected === null || expected.length < n * n) {
    throw new Error('11780 expected output must start with the n x n cost matrix');
  }

  const actualTokens = tokenize(stdout);
  const { values: actual, badIndex } = toIntegers(actualTokens);
  if (actual === null) {
    return fail('not_integer', `${badIndex}번째 값이 정수가 아닙니다.`);
  }
  if (actual.length < n * n) {
    return fail('too_short', `비용 행렬만으로도 ${n * n}개의 수가 필요한데 ${actual.length}개뿐입니다.`);
  }

  // 1. 비용 행렬은 유일하므로 그대로 비교한다.
  const cost = new Array(n * n);
  for (let index = 0; index < n * n; index += 1) {
    if (actual[index] !== expected[index]) {
      return fail('cost_mismatch', `비용 행렬의 ${index + 1}번째 값이 기대 출력과 다릅니다.`);
    }
    cost[index] = expected[index];
  }

  // 2. 경로 검증
  let cursor = n * n;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const minimum = cost[(i - 1) * n + (j - 1)];
      if (cursor >= actual.length) {
        return fail('too_short', `경로 줄이 ${n * n}개 필요한데 중간에서 끊겼습니다.`);
      }
      const k = actual[cursor];
      cursor += 1;

      if (minimum === 0) {
        if (k !== 0) {
          return fail('expected_zero', `${i}번에서 ${j}번으로 가는 줄은 0 이어야 합니다.`);
        }
        continue;
      }
      if (k < 2) {
        return fail('path_too_short', `${i}번에서 ${j}번으로 가는 경로의 도시 개수가 너무 적습니다.`);
      }
      if (cursor + k > actual.length) {
        return fail('too_short', `${i}번에서 ${j}번으로 가는 경로의 도시가 모자랍니다.`);
      }

      const path = actual.slice(cursor, cursor + k);
      cursor += k;

      if (path[0] !== i || path[k - 1] !== j) {
        return fail('bad_endpoints', `${i}번에서 ${j}번으로 가는 경로의 양 끝이 맞지 않습니다.`);
      }

      let total = 0;
      for (let step = 0; step + 1 < k; step += 1) {
        const from = path[step];
        const to = path[step + 1];
        if (from < 1 || from > n || to < 1 || to > n) {
          return fail('city_out_of_range', `${i}번에서 ${j}번으로 가는 경로에 없는 도시 번호가 있습니다.`);
        }
        const weight = edge.get(from * (n + 1) + to);
        if (weight === undefined) {
          return fail('no_such_edge', `${i}번에서 ${j}번으로 가는 경로의 ${step + 1}번째 구간에 노선이 없습니다.`);
        }
        total += weight;
      }

      if (total !== minimum) {
        return fail('not_minimal', `${i}번에서 ${j}번으로 가는 경로의 비용이 최솟값이 아닙니다.`);
      }
    }
  }

  if (cursor !== actual.length) {
    return fail('too_long', `출력에 남는 값이 ${actual.length - cursor}개 있습니다.`);
  }

  return pass();
}

module.exports = { check };
