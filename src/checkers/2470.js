'use strict';

// 2470 두 용액 — 특성값이 정렬돼 있지 않은 버전. 판정 조건은 2467 과 같다.
const { createSolutionPairChecker } = require('./solution-pair');

module.exports = { check: createSolutionPairChecker(2470) };
