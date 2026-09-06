#!/usr/bin/env node
'use strict';

// npm run check — src/ 와 scripts/ 의 모든 .js 를 node --check 로 훑고, 서버가 부팅 때 읽는
// JSON 이 파싱되는지 본다. 파일 목록을 손으로 적어 두면 새 체커가 조용히 빠지므로 걷는다.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['src', 'scripts'];
const JSON_FILES = ['src/checkers/registry.json'];

function collectScripts(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectScripts(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      found.push(fullPath);
    }
  }
  return found.sort();
}

const failures = [];

for (const directory of SOURCE_DIRS) {
  for (const file of collectScripts(path.join(ROOT, directory))) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push(`${path.relative(ROOT, file)}\n${(result.stderr || '').trim()}`);
    }
  }
}

for (const file of JSON_FILES) {
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  } catch (error) {
    failures.push(`${file}\n${error.message}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}

const checked = SOURCE_DIRS.reduce((total, directory) => total + collectScripts(path.join(ROOT, directory)).length, 0);
console.log(`checked ${checked} scripts and ${JSON_FILES.length} json file(s)`);
