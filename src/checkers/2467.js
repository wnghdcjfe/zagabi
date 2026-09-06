'use strict';

// 2467 용액 — 특성값이 오름차순으로 주어지는 버전. 판정 조건은 2470 과 같다.
const { createSolutionPairChecker } = require('./solution-pair');

module.exports = { check: createSolutionPairChecker(2467) };
