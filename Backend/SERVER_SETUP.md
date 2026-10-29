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
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python run_server.py auth
```

Windows PowerShell:

```powershell
cd Backend
Copy-Item .env.auth.example .env
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python run_server.py auth
```

인증 서버 소스가 별도 폴더에 있다면 해당 폴더에서 실행한다. 기존 설정을 유지하면서
공개 주소 등을 바꿀 때는 `.env.auth.runtime`을 사용할 수 있다. 이 파일도 서버별
개인 설정이므로 Git에는 포함하지 않는다.

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

이미 생성된 가상환경을 사용하는 서버에서는 실제 프로젝트 폴더로 이동해 실행한다.

```bash
cd /path/to/checkout/Backend
./venv/bin/python run_server.py backend
```

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
- `run_server.py`, 이 문서: 가능
- 실제 `.env`, `.env.auth.runtime`, `.env.backend.runtime`: 금지
- DB 비밀번호, Issuer/Ticket 개인키, Gmail 앱 비밀번호, `AUTH_SERVICE_KEY`: 금지

이미 실제 비밀값이 Git에 커밋된 적이 있다면 파일을 삭제하는 것만으로 충분하지 않다.
해당 비밀값을 모두 교체하고 필요하면 Git 기록에서도 제거해야 한다.

공유 작업 시 저장소 루트의 README에 있는 `.env.auth`, `.env.backend` 분리 실행 방식도
사용할 수 있다. Linux 배포 경로와 Windows 개발 경로가 같을 필요는 없다.
