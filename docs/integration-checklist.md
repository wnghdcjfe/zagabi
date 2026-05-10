# Integration checklist

Use this checklist when integrating the worker-owned lanes into one local C++ judge API.

## Server/API lane

- [ ] `package.json` has `start`, `check`, `test`, and smoke commands.
- [ ] `src/server.js` starts a local HTTP server and validates `PORT`.
- [ ] `src/app.js` exposes `GET /health` and `POST /judge`.
- [ ] Requests larger than the configured JSON body limit return JSON errors.
- [ ] Invalid JSON, wrong content type, unknown route, and wrong method return structured JSON errors.
- [ ] `POST /judge` passes `{ sourceCode, problem, dataPath }` or equivalent to the judge module.

## Data and comparison lane

- [ ] `data.json` compatibility is preserved: `problemId`, `sourceCode`, `testCases`, `timeLimit`, and `memoryLimit`.
- [ ] Korean time limits such as `1 초` parse to milliseconds.
- [ ] Memory limits such as `128 MB` parse to MB/bytes.
- [ ] Output comparison normalizes line endings and trailing whitespace.
- [ ] Raw expected and actual output are still returned in debug details.

## Judge engine lane

- [ ] The judge module is CommonJS and can be loaded by `src/app.js`.
- [ ] Accepted exports include at least one of: module function, `judge`, `judgeSubmission`, or `runJudge`.
- [ ] C++ source is compiled in a disposable temporary directory.
- [ ] Compile failures produce top-level `CE` with compiler stdout/stderr.
- [ ] Each test case runs with the parsed time limit.
- [ ] TLE processes are terminated and reported as `TLE`.
- [ ] Non-zero runtime exits are reported as `RE` with stderr and exit code.
- [ ] Output mismatches are reported as `WA` with expected/actual/debug details.
- [ ] All passing cases produce top-level `AC`.
- [ ] Temporary source files, binaries, and directories are removed after judging.

## Response contract

Successful `POST /judge` responses should include:

- [ ] `ok: true`
- [ ] `verdict`: `AC`, `WA`, `CE`, `RE`, or `TLE`
- [ ] `problemId`
- [ ] `summary.total` and `summary.passed`
- [ ] `compile.exitCode`, `compile.stdout`, and `compile.stderr`
- [ ] `cases[]` entries with `index`, `status`, `input`, `expected`, `actual`, `stderr`, `runtimeMs`, and `exitCode`

Error responses should include:

- [ ] `ok: false`
- [ ] `error.code`
- [ ] `error.message`
- [ ] Optional `error.details` for actionable debug information

## Verification commands

Run these after integrating all lanes:

```bash
npm run check
npm test
npm run smoke
```

Then perform endpoint checks against a running server:

```bash
curl -sS http://127.0.0.1:3000/health
curl -sS http://127.0.0.1:3000/judge \
  -H 'content-type: application/json' \
  -d '{"sourceCode":"#include <bits/stdc++.h>\nint main(){return 0;}\n"}'
```

## Known assumptions

- The demo remains API-only and local-only.
- No auth, database, queue, UI, or submission history is required.
- Local C++ execution is trusted; process timeout and temp directory cleanup are reliability measures, not a complete security boundary.
- `data.json` remains the single problem fixture for this milestone.
