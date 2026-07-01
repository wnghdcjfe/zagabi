# 코딩살구클럽 전용 로컬 채점 서버
로컬 C++ / Java 채점 서버. JSON HTTP API.

## 요구사항

- Node.js 18+
- npm
- `g++` (C++ 컴파일러)
- `javac` / `java` (Java 컴파일러 및 런타임, 선택사항)

### Java 지원

Java 채점을 사용하려면 JDK 8 이상이 설치되어 있어야 합니다. `JAVA_HOME` 환경변수가 설정되어 있으면 해당 JDK를 사용하고, 없으면 PATH에서 `javac`/`java`를 찾습니다.

지원 언어 식별자:
- `java` — 설치된 JDK 기본 버전
- `java8`, `java11`, `java17`, `java21` — 특정 버전 타겟팅 (`--release N`)

Java 제출 형식 (BOJ 스타일):
```java
import java.util.*;

public class Main {
    public static void main(String[] args) {
        // code
    }
}
```

### Windows C++ 컴파일러

Windows PC에서 C++ 제출을 채점하려면 `g++` 설치가 필수입니다. 서버가 실행 중이어도 Windows에 `g++`가 없으면 제출은 컴파일 에러가 되며, 컴파일 출력에는 보통 아래 메시지가 표시됩니다.

```text
C++ compiler not found: g++
spawn g++ ENOENT
```

이 메시지는 제출 코드 오류가 아니라 채점 서버 PC에 C++ 컴파일러가 없거나, 서버 프로세스가 컴파일러 경로를 모르는 상태라는 뜻입니다.

#### 1. MSYS2와 g++ 설치

윈도우에서는 MinGW-w64/MSYS2의 UCRT64 `g++`를 권장합니다.

1. [MSYS2](https://www.msys2.org/)를 설치합니다.
2. 시작 메뉴에서 `MSYS2 UCRT64` 터미널을 엽니다.
3. 아래 명령으로 패키지 목록을 갱신하고 `g++`를 설치합니다.

```bash
pacman -Syu
pacman -S --needed mingw-w64-ucrt-x86_64-gcc
```

`pacman -Syu` 실행 중 터미널을 닫고 다시 열라는 안내가 나오면, `MSYS2 UCRT64`를 다시 열고 같은 명령을 이어서 실행합니다.

#### 2. g++ 설치 확인

설치 후 PowerShell에서 아래 명령을 실행합니다.

```powershell
& "C:\msys64\ucrt64\bin\g++.exe" --version
```

버전이 출력되면 설치가 된 것입니다. `where g++`가 실패해도 괜찮습니다. 이 서버는 `JUDGE_CXX`로 컴파일러 절대경로를 지정해서 실행할 수 있습니다.

#### 3. 서버 실행 전 npm 패키지 설치

프로젝트 루트에서 한 번 실행합니다.

```powershell
npm install
```

#### 4. JUDGE_CXX를 지정해서 서버 실행

PowerShell에서 서버를 실행할 때는 `JUDGE_CXX`를 `g++.exe`의 전체 경로로 지정합니다.

```powershell
$env:JUDGE_CXX="C:\msys64\ucrt64\bin\g++.exe"
$env:JUDGE_COMPILE_TIMEOUT_MS="30000"
$env:HOST="0.0.0.0"
$env:PORT="12014"
npm start
```

서버가 이미 실행 중이었다면 반드시 종료 후 다시 시작해야 새 `JUDGE_CXX` 설정이 반영됩니다.

```powershell
netstat -ano | Select-String ":12014"
Stop-Process -Id <LISTENING_PID>
```

MSYS2의 `g++`는 내부적으로 `C:\msys64\ucrt64\bin`의 DLL도 필요합니다. 이 서버는 `JUDGE_CXX`가 절대경로이면 해당 `bin` 폴더를 컴파일 프로세스의 `PATH` 앞에 자동으로 추가합니다. 따라서 일반적으로 Windows 사용자 PATH에 MSYS2 경로를 영구 추가하지 않아도 됩니다.

#### 5. 정상 동작 확인

서버가 뜨면 다른 PowerShell 창에서 헬스체크를 확인합니다.

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:12014/health" -UseBasicParsing |
  Select-Object -ExpandProperty Content
```

아래처럼 나오면 서버는 살아 있습니다.

```json
{"ok":true,"service":"judge_server"}
```

C++ 컴파일과 채점까지 확인하려면 smoke 테스트를 실행합니다.

```powershell
$env:JUDGE_URL="http://127.0.0.1:12014"
npm run smoke
```

정상이라면 `PASS CORS`, `PASS AC`, `PASS WA`, `PASS CE`, `PASS TLE`가 출력됩니다.

- Windows 기본 컴파일 제한은 MinGW/MSYS2 지연을 고려해 30초입니다.
- 사용자명/Temp 경로에 한글·공백이 있어 `g++`가 파일을 못 여는 경우, 서버는 자동으로 프로젝트의 `.judge-tmp`를 우선 사용합니다. 필요하면 `$env:JUDGE_TEMP_ROOT="C:\judge-tmp"`처럼 직접 지정할 수 있습니다.
- 복사한 해설 코드에 붙은 Markdown 코드블록 fence, BOM, NBSP 같은 보이지 않는 문자는 컴파일 전 안전하게 정리됩니다.
- `language`가 `C++20`/`gnu++20`이면 `-std=gnu++20`, 기본값은 BOJ와 가까운 `-std=gnu++17`입니다.

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
curl http://127.0.0.1:12014/
# {"ok":true,"service":"judge_server","endpoints":{"health":"/health","judge":"/judge"}}

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

코딩살구 웹 클라이언트 호환을 위해 같은 배열을 `samples` 필드로 보내도 채점합니다.

Java 채점 예시:

```bash
curl -sS -X POST http://127.0.0.1:12014/judge \
  -H 'content-type: application/json' \
  --data-binary @- <<'JSON'
{
  "problemId": 1000,
  "language": "java",
  "sourceCode": "import java.util.Scanner; public class Main { public static void main(String[] args) { Scanner sc = new Scanner(System.in); long a = sc.nextLong(), b = sc.nextLong(); System.out.println(a + b); } }",
  "testCases": [
    { "input": "2 3\n", "output": "5\n" }
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
- `http://127.0.0.1:3300`
- `http://localhost:3300`
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
