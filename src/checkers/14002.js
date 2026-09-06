'use strict';

// 14002 가장 긴 증가하는 부분 수열 4 — "그러한 수열이 여러가지인 경우 아무거나 출력한다".
// 판정 로직은 14003 과 같아 lis.js 에 둔다.
const { createLisChecker } = require('./lis');

module.exports = { check: createLisChecker(14002) };
