# TicketPro 서버 실행

서버별 실제 설정은 `Backend/.env`에 저장한다. `.env`에는 DB 비밀번호, 개인키,
서비스 키 등이 포함되므로 Git에 커밋하지 않는다. 저장소에는 필요한 변수의 이름만
담은 `.env.auth.example`과 `.env.backend.example`을 커밋한다.

이미 운영 중인 `.env`를 수정할 수 없는 서버에서는 `.env.auth.runtime` 또는
`.env.backend.runtime`을 추가할 수 있다. 실행 도우미가 이 파일을 자동으로 읽으며,
기존 `.env`의 내용은 변경하지 않는다. 터미널이나 systemd에서 직접 지정한 값은
runtime 파일보다 우선한다.

## Auth 서버 최초 설정

Linux/macOS:

```bash
cd Backend
cp .env.auth.example .env
./venv/bin/python run_server.py auth
```

Windows PowerShell:

```powershell
cd Backend
Copy-Item .env.auth.example .env
.\venv\Scripts\python.exe run_server.py auth
```

현재 AWS Auth 서버처럼 소스가 `/home/admin`에 있다면 실행 명령은 다음 한 줄이다.

```bash
cd /home/admin
./venv/bin/python run_server.py auth
```

현재 AWS Auth 서버에는 기존 `.env`를 보존하기 위해 비밀값이 없는
`.env.auth.runtime`을 별도로 둔다. 따라서 위 명령만 입력하면 기존의 긴 환경변수
목록이 자동 적용된다.

## Main Backend 최초 설정

Linux/macOS:

```bash
cd Backend
cp .env.backend.example .env
./venv/bin/python run_server.py backend
```

Windows PowerShell:

```powershell
cd Backend
Copy-Item .env.backend.example .env
.\venv\Scripts\python.exe run_server.py backend
```

현재 AWS Main 서버에서는 다음과 같이 실행한다.

```bash
cd /home/admin/file0911/Backend
./venv/bin/python run_server.py backend
```

Main과 Auth가 별도 서버에 있는 배포에서는
`.env.backend.runtime.example`을 `.env.backend.runtime`으로 복사하고 Auth의 사설 IP를
입력한다. `AUTH_SERVICE_KEY`는 기존 `.env`의 값을 그대로 사용한다.

## 설정 우선순위와 다른 설정 파일 사용

터미널 또는 systemd에서 주입한 환경변수가 `.env`보다 우선한다. 한 컴퓨터에서 두
서버를 함께 실행하면서 설정 파일을 분리하고 싶다면 다음과 같이 지정할 수 있다.

```bash
./venv/bin/python run_server.py auth --env-file .env.auth
./venv/bin/python run_server.py backend --env-file .env.backend
```

기존 `.env`에 손대지 않고 실행 시에만 값을 덮어쓰려면 다음 옵션을 사용할 수 있다.

```bash
./venv/bin/python run_server.py auth --runtime-env-file .env.auth.runtime
```

기본 파일명인 `.env.auth.runtime`은 옵션을 생략해도 자동으로 적용된다.

개발 중 자동 재시작이 필요할 때만 `--reload`를 추가한다. 운영 서버에서는 사용하지
않는다.

## Git에 올려도 되는 항목

- `.env.auth.example`, `.env.backend.example`: 가능
- `.env.auth.runtime.example`: 가능
- `.env.backend.runtime.example`: 가능
- `run_server.py`, 이 문서: 가능
- 실제 `.env`, `.env.auth.runtime`, `.env.backend.runtime`: 금지
- DB 비밀번호, Issuer/Ticket 개인키, Gmail 앱 비밀번호, `AUTH_SERVICE_KEY`: 금지

이미 실제 비밀값이 Git에 커밋된 적이 있다면 파일을 삭제하는 것만으로 충분하지 않다.
해당 비밀값을 모두 교체하고 필요하면 Git 기록에서도 제거해야 한다.
