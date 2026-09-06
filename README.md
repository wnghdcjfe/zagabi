# 코딩살구클럽 전용 로컬 채점 서버
안녕하세요 코살 여러분. 채점서버 레포에 온 것을 환영합니다. 만약 채점이 안될 때 이 프로젝트 git pull 해서 최신 채점서버를 다운받아 실행해보세요 
<img width="2424" height="1442" alt="스크린샷 2026-09-06 오전 6 40 04" src="https://github.com/user-attachments/assets/fef4de00-f8f2-43e7-99f2-6bf3815b325a" />


## WindowOS 빠른 실행

1. [Node.js 18+](https://nodejs.org) 설치
2. MSYS2의 `g++` 설치 → [g++ 설치](#g-설치msys2)
3. 프로젝트 폴더의 **`start-windows.cmd` 더블클릭** (터미널이면 `npm start`) 
  
이후 정상적으로 뜨면 이런 화면입니다.

```text
코딩살구클럽 채점 서버를 시작합니다.
  Node.js  v20.11.1 (win32)
  컴파일러 C:\msys64\ucrt64\bin\g++.exe
           g++.exe (Rev3, Built by MSYS2 project) 14.2.0

  접속 주소
    이 PC        http://127.0.0.1:12014
    같은 네트워크  http://192.168.0.27:12014
    헬스체크      http://127.0.0.1:12014/health

  종료하려면 Ctrl+C
```

### 같은 네트워크 주소가 "없음" 으로 나올 때

```text
    같은 네트워크  없음 — 다른 PC에서 접속할 수 있는 IPv4 주소가 없습니다
                   en0 192.0.0.2 는 IPv6 전용 네트워크의 IPv4 변환용(464XLAT/DS-Lite) 주소
```

이 PC가 붙어 있는 네트워크에 **LAN IPv4 주소 자체가 없다**는 뜻입니다. IPv6 전용 회선이나 휴대폰 테더링에서 주로 나타납니다. 런처는 다른 PC에서 절대 닿을 수 없는 주소(464XLAT/DS-Lite `192.0.0.0/24`, link-local `169.254.0.0/16`, VPN 대역 `198.18/19.x`, 넷마스크가 `/32` 인 주소, `bridge*`·`vmnet*`·`utun*` 같은 가상 어댑터)는 출력하지 않고 이유만 적어 줍니다.

해결책은 둘 중 하나입니다.

- 일반 공유기(IPv4 사설망) Wi-Fi로 옮기면 `192.168.x.x` 주소가 생깁니다.
- 그대로 쓰려면 **학생 PC마다 서버를 띄우고** 각자 `http://127.0.0.1:12014` 를 지정합니다.

### g++ 설치(MSYS2)

Windows에서 C++ 제출을 채점하려면 `g++` 가 필수입니다. 없는 채로 서버가 켜지면 채점 결과의 컴파일 출력이 전부 `C++ compiler not found: g++` 가 됩니다. 제출 코드 문제가 아니라 **채점 서버 PC에 컴파일러가 없다**는 뜻입니다.

1. [MSYS2](https://www.msys2.org/)를 **기본 경로(`C:\msys64`)** 에 설치
2. 시작 메뉴에서 `MSYS2 UCRT64` 터미널 열기
3. 아래 명령 실행

```bash
pacman -Syu
pacman -S --needed mingw-w64-ucrt-x86_64-gcc
```

`pacman -Syu` 도중 터미널을 닫고 다시 열라는 안내가 나오면, `MSYS2 UCRT64` 를 다시 열고 이어서 실행합니다. 끝나면 `start-windows.cmd` 를 다시 실행하세요.

`where g++` 가 실패해도 상관없습니다. 서버는 Windows 사용자 PATH가 아니라 자체 탐색 목록으로 컴파일러를 찾고, `g++` 가 필요로 하는 DLL 경로도 컴파일 프로세스에 자동으로 붙여 줍니다. MSYS2를 **다른 경로**에 설치했을 때만 `JUDGE_CXX` 로 전체 경로를 지정합니다.

```powershell
$env:JUDGE_CXX="D:\tools\msys64\ucrt64\bin\g++.exe"
npm start
```

### 정상 동작 확인

```powershell
Invoke-RestMethod http://127.0.0.1:12014/health    # 서버가 살아 있는지

$env:JUDGE_URL="http://127.0.0.1:12014"
npm run smoke                                      # 컴파일·채점까지 한 번에
```

smoke가 `PASS CORS`, `PASS AC`, `PASS WA`, `PASS CE`, `PASS TLE` 를 출력하면 정상입니다.
   
## MacOS, lunuxOS

### 1. 서버 실행

```bash
npm start                 # 컴파일러·포트 확인 후 접속 주소를 출력하고 기동
PORT=12015 npm start      # 다른 포트로
npm run start:bare        # 사전 점검 없이 서버만
```

```bash
curl http://127.0.0.1:12014/health
# {"ok":true,"service":"judge_server"}
```

### 2. 채점 요청

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

같은 요청 본문을 파일로 저장해 두면 반복 테스트가 편합니다.

```bash
curl -sS -X POST http://127.0.0.1:12014/judge \
  -H 'content-type: application/json' \
  --data-binary @request.json > ret.json
```

### 3. 종료

```bash
# 포어그라운드: Ctrl+C
# 백그라운드:
lsof -tiTCP:12014 -sTCP:LISTEN | xargs kill
```

## 개발 명령어

```bash
npm run check                                    # 문법 체크만
npm test                                         # 문법 체크 + 유닛 테스트
npm run smoke                                    # 서버를 띄워 CORS/AC/WA/CE/TLE 검증
JUDGE_URL=http://127.0.0.1:12014 npm run smoke   # 이미 떠 있는 서버로 검증
```

## CORS 허용 Origin

- `http://127.0.0.1:3100`
- `http://localhost:3100`
- `http://127.0.0.1:3300`
- `http://localhost:3300`
- `https://cosal.aviss.kr`

```bash
curl -i -X OPTIONS http://127.0.0.1:12014/judge \
  -H 'Origin: https://cosal.aviss.kr' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

→ `204 No Content` + `access-control-allow-origin` 헤더가 오면 정상. 허용되지 않은 Origin은 `403`.

### HTTPS 페이지에서 접속할 때

`https://cosal.aviss.kr` 처럼 **HTTPS로 열린 페이지**가 `http://` 주소로 요청하면 브라우저가 혼합 콘텐츠(mixed content)로 차단합니다. 요청이 채점 서버까지 오지도 못하므로, CORS 설정이 아무리 맞아도 "채점 서버에 연결할 수 없습니다" 가 뜹니다.

예외는 `http://127.0.0.1` 과 `http://localhost` 뿐입니다. 브라우저가 이 둘만 안전한 출처로 취급합니다.

- 채점 서버 주소는 **`http://127.0.0.1:12014`** 로 지정하세요.
- LAN IP(`http://192.168.0.27:12014`)를 넣으면 같은 이유로 차단됩니다. 다른 PC에서 쓰려면 **그 PC에도 서버를 띄우고** `127.0.0.1` 을 지정하세요.
- 서버가 살아 있는지는 터미널에서 확인합니다. 브라우저가 막는 것과 서버가 죽은 것은 다릅니다.

```bash
curl http://127.0.0.1:12014/health
# {"ok":true,"service":"judge_server"}
```

## API

한 번의 `POST /judge` 는 이렇게 처리됩니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/judge-pipeline-dark.svg">
  <img alt="POST /judge 처리 흐름: 요청 검증 → g++ 컴파일 1회 → 케이스별 실행·비교 → 첫 실패 케이스의 verdict가 전체 verdict" src="docs/diagrams/judge-pipeline.svg">
</picture>

모든 응답은 `application/json; charset=utf-8` 입니다.

### `GET /`

```json
{ "ok": true, "service": "judge_server", "endpoints": { "health": "/health", "judge": "/judge" } }
```

### `GET /health`

```json
{ "ok": true, "service": "judge_server" }
```

### `POST /judge`

요청 필드 (예시는 [채점 요청](#2-채점-요청) 참고):

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `problemId` | O | 양의 정수 |
| `sourceCode` | O | 비어 있지 않은 문자열. `code`, `source_code` 도 같은 뜻 |
| `testCases` | O | 비어 있지 않은 배열. `[{ "input": "...", "output": "..." }]`, 둘 다 문자열(빈 문자열 허용). `samples` 로 보내도 됨 |
| `publicTestCaseCount` | X | 앞에서 몇 개가 공개 샘플인지. 그 뒤 케이스는 프라이빗으로 보고 응답에서 값을 가립니다. 없으면 전부 공개 |
| `language` | X | 기본 `gnu++17`. `C++20`/`gnu++20` 계열이면 `-std=gnu++20`. C++ 외 언어는 400 |
| `timeLimit` | X | 예: `"1 초"`, `"2 초 (추가 시간 없음)"` |
| `memoryLimit` | X | 예: `"128 MB"` |

응답:

```json
{
  "ok": true,
  "verdict": "accepted",
  "problemId": 1000,
  "summary": { "total": 1, "passed": 1, "failed": 0, "firstFailedIndex": null },
  "results": [
    {
      "index": 0,
      "input": "1 2\n",
      "expectedOutput": "3\n",
      "ok": true,
      "passed": true,
      "verdict": "accepted",
      "status": { "id": 3, "description": "Accepted" },
      "stdout": "3\n",
      "stderr": "",
      "compileOutput": "",
      "message": "",
      "time": "0.012",
      "memory": null,
      "hidden": false
    }
  ]
}
```

- `summary.firstFailedIndex`: 실패한 첫 케이스의 0-기반 인덱스. 전부 통과면 `null`.
- `time`: 실행 시간(초, 소수 3자리 문자열). 측정 불가면 `null`.
- `memory`: 피크 메모리(MB, 소수 3자리 문자열). 계측하지 않는 플랫폼에서는 `null`.
- `message`: [특수 채점](#특수-채점정답이-여러-개인-문제) 문제에서 오답이면 그 사유가 들어갑니다. 그 밖에는 실행 실패 사유이거나 빈 문자열입니다.
- `hidden`: 프라이빗 테스트케이스면 `true`. 이때 `input`·`expectedOutput`·`stdout`·`stderr` 는 `[hidden]` 으로 내려갑니다. 입력을 그대로 찍는 코드를 내면 `stdout` 만으로 숨긴 입력이 새어 나가므로 제출 프로그램의 출력도 함께 가립니다. `index`·`verdict`·`time`·`memory` 와 특수 채점 사유는 그대로 보여 줍니다.
- 컴파일 에러면 모든 케이스가 `compilation_error` 가 되고 `compileOutput` 에 컴파일러 메시지가 담깁니다.

### 에러 응답

에러 본문의 `error` 는 객체가 아니라 **문자열**입니다.

```json
{ "ok": false, "error": "problemId must be a positive integer" }
```

| 상태 코드 | 예시 |
| --- | --- |
| `400` | `problemId must be a positive integer`, `testCases must be a non-empty array`, `only C++ submissions are supported` |
| `403` | `origin not allowed` |
| `404` | `not found` |
| `405` | `method not allowed` |
| `413` | 요청 본문이 10MB 초과 |
| `503` | `judge service unavailable` |

## Verdict

| `verdict` | `status.id` | `status.description` |
| --- | --- | --- |
| `accepted` | 3 | Accepted |
| `wrong_answer` | 4 | Wrong Answer |
| `time_limit_exceeded` | 5 | Time Limit Exceeded |
| `compilation_error` | 6 | Compilation Error |
| `memory_limit_exceeded` | 7 | Memory Limit Exceeded |
| `runtime_error` | 11 | Runtime Error |
| `internal_error` | 13 | Internal Error |

`memory_limit_exceeded` 는 기본적으로 Linux에서만 판정합니다.

## 특수 채점(정답이 여러 개인 문제)

정답이 유일하지 않은 문제는 문자열 비교로 채점하면 **올바른 풀이가 오답**이 됩니다. 실수 출력은 자릿수가 자유롭고(`1.5` 와 `1.500000000` 은 같은 답), 경로·수열·조작열을 묻는 문제는 지문 스스로 "정답이 여러 가지인 경우에는 아무거나 출력한다" 고 적습니다. 이런 문제는 `src/checkers/registry.json` 에 등재하고, 체커가 출력이 조건을 만족하는지 직접 검사합니다.

| 모드 | 대상 문제 | 판정 방법 |
| --- | --- | --- |
| `float` | 1007 1064 1069 1198 1340 1344 1546 | 토큰 수가 같아야 하고, 숫자는 문제별 허용 오차(`1e-6`·`1e-9`·`1e-2`) 안이면 정답. 숫자가 아닌 토큰은 그대로 일치해야 합니다 |
| `custom` | 2467 2470 2816 11780 12852 13913 14002 14003 | `src/checkers/{problemId}.js` 가 조건을 검증합니다. 유일하게 결정되는 값(최소 횟수·최소 비용·비용 행렬·LIS 길이)만 기대 출력을 오라클로 씁니다 |

- 등재되지 않은 문제는 기존대로 엄격 비교입니다.
- 오답 사유는 응답의 `message` 에 담깁니다. 프라이빗 테스트케이스의 사유도 학생에게 그대로 내려가므로 **값이 아니라 위치와 개수만** 적습니다.
- 체커가 예외를 던지면 `wrong_answer` 가 아니라 `internal_error` 입니다. 서버 버그를 학생의 오답으로 둔갑시키지 않기 위해서입니다.
- 제출 출력이 기대 출력과 글자까지 같으면 체커를 부르기 전에 통과합니다. 체커에 버그가 생겨도 기준 정답은 막히지 않습니다.

문제를 추가하려면 `registry.json` 에 한 줄 더하고(`float` 이면 `epsilon` 까지), `custom` 이면 체커 파일을 만듭니다. 체커 파일만 있고 표에 없으면 서버가 부팅할 때 멈춥니다.

```bash
npm test    # 체커 회귀 테스트 포함 (test/checkers.test.js)
```

`test/fixtures/` 에는 지문 샘플과 "정답이지만 기준 출력과 글자가 다른 출력" 15개가 들어 있습니다. 프라이빗 테스트케이스는 학생이 이 저장소를 클론하므로 넣지 않습니다.
