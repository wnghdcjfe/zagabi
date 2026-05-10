# 코딩살구클럽 전용 로컬 채점 서버
로컬 C++ 채점 서버. `data.json` 기반의 JSON HTTP API.

## 요구사항

- Node.js 18+
- npm
- `g++` (C++ 컴파일러)

## 실행법

### 1. 설치

```bash
npm install
```

### 2. 서버 실행

```bash
HOST=0.0.0.0 PORT=12014 npm start
```

- 로컬: `http://127.0.0.1:12014`
- 헬스체크: `GET /health`

```bash
curl http://127.0.0.1:12014/health
# {"ok":true,"service":"judge_server"}
```

### 3. 채점 요청

```bash
curl -sS -X POST http://127.0.0.1:12014/judge \
  -H 'content-type: application/json' \
  --data-binary @- <<'JSON'
{
  "problemId": 1000,
  "sourceCode": "#include <bits/stdc++.h>\nusing namespace std;\nint main(){ long long a,b; cin>>a>>b; cout << a+b << \"\\n\"; }\n",
  "testCases": [
    { "input": "1 2\n", "output": "3\n" }
  ],
  "timeLimit": "1 초",
  "memoryLimit": "128 MB"
}
JSON
```

### 4. `data.json`으로 테스트 → `ret.json` 저장

```bash
curl -sS -X POST http://127.0.0.1:12014/judge \
  -H 'content-type: application/json' \
  --data-binary @data.json > ret.json
```

### 5. 종료

```bash
# 포어그라운드: Ctrl+C
# 백그라운드:
lsof -tiTCP:12014 -sTCP:LISTEN | xargs kill
```

## 개발 명령어

```bash
npm test                                    # 문법 체크
npm run smoke                               # /health 검증
JUDGE_URL=http://127.0.0.1:12014 npm run smoke
```

## CORS 허용 Origin

- `http://127.0.0.1:3100`
- `http://localhost:3100`
- `https://cosal.aviss.kr`

Preflight 확인:

```bash
curl -i -X OPTIONS http://127.0.0.1:12014/judge \
  -H 'Origin: https://cosal.aviss.kr' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

→ `204 No Content` + `access-control-allow-origin` 헤더 반환되면 정상.

## API

### `GET /health`

```json
{ "ok": true, "status": "ok", "service": "judge04", "problemId": 2468, "testCount": 8 }
```

### `POST /judge`

요청:

```json
{ "sourceCode": "#include <bits/stdc++.h>\nint main(){return 0;}\n" }
```

`sourceCode` 생략 시 `data.json.sourceCode` 사용.

응답:

```json
{
  "ok": true,
  "verdict": "AC",
  "problemId": 2468,
  "summary": { "passed": 8, "total": 8 },
  "compile": { "exitCode": 0, "stdout": "", "stderr": "" },
  "cases": [
    {
      "index": 1,
      "status": "AC",
      "input": "...",
      "expected": "...",
      "actual": "...",
      "stderr": "",
      "runtimeMs": 12,
      "exitCode": 0
    }
  ]
}
```

에러:

```json
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```

## Verdict

| 코드 | 의미 |
| --- | --- |
| `AC` | Accepted |
| `WA` | Wrong Answer |
| `CE` | Compile Error |
| `RE` | Runtime Error |
| `TLE` | Time Limit Exceeded |
 