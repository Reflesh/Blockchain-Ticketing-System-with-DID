# TicketPro

DID/VC 인증, Polygon NFT 티켓 예매·1회 양도, 모바일 QR 입장 검증을 구현한 졸업 작품입니다.
현재 시연 주소는 https://ticketpro.duckdns.org 이며 앱 설치 페이지는 `/downloads/`입니다.
이 공개 주소는 비밀값이 아니며, 각 환경의 설정으로 다른 서버를 지정할 수 있습니다.

## 개발 환경

- Python 3.10 이상, Node.js 22 LTS, npm, PostgreSQL
- Polygon RPC와 배포한 TicketPro 컨트랙트, 해당 operator 지갑
- 이메일 인증용 SMTP 계정, 결제 테스트용 PortOne 설정
- 모바일 개발: Android Studio/Expo Go. 독립 APK 빌드: Linux 또는 WSL, JDK 21, Android SDK

저장소를 어느 폴더에 clone해도 됩니다. 본인 PC의 디렉터리명이나 시연 서버의
`1029`라는 폴더명에 맞출 필요는 없습니다. API/Auth는 각각 실행하며 동일 PC에서도 가능합니다.

## API 및 인증 서버

자세한 설정은 [Backend/SERVER_SETUP.md](Backend/SERVER_SETUP.md)를 참고하세요.

```bash
cd Backend
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

`.env.backend.example`, `.env.auth.example`을 각각 `.env.backend`, `.env.auth`로 복사해
실제 값을 채우세요. 두 파일은 Git에서 제외됩니다. 기존 DB를 연결하거나 프로젝트의
테이블 초기화가 완료된 PostgreSQL을 준비해야 합니다. 컨트랙트 주소·ABI·operator 키는
서로 일치해야 합니다. DB 인증서 경로가 필요하다면 실행하는 환경의 경로를 지정하세요.

서로 다른 터미널에서 실행합니다.

```bash
python run_server.py auth --env-file .env.auth
python run_server.py backend --env-file .env.backend
```

`AUTH_SERVICE_KEY`는 두 설정에서 일치해야 하며, 메일 비밀번호·개인키·DB 접속 문자열은
각자 안전한 경로로 전달받아 설정합니다. `python -c "import secrets; print(secrets.token_urlsafe(32))"`로
새 서비스 키와 관리자 토큰 비밀값을 생성할 수 있습니다. 개인키는 별도로 생성·관리하세요.
시연 환경의 운영 키를 소스 파일에 적지 마세요.

## 웹

```bash
cd Frontend
npm ci
# .env.example을 .env.local로 복사하고 공개 설정만 입력
npm run dev
```

HTTPS 배포 시 API를 같은 origin의 `/api`로 연결할 수 있습니다. 다른 주소가 필요하면
`VITE_TICKET_API_URL`, `VITE_AUTH_API_URL`을 지정합니다. `VITE_*`와 `EXPO_PUBLIC_*`는
브라우저/APK에 포함되는 공개 값이며 비밀값을 넣으면 안 됩니다. 결제 ID는 본인의
PortOne 공개 store/channel 설정을 사용하세요.

## 모바일

`Mobile/user-app`, `Mobile/admin-app`에서 각각 `npm ci` 후 `.env.example`을 `.env`로
복사해 공개 API 주소를 설정하고 `npx expo start`를 실행합니다. 실제 휴대폰에서 개발
서버에 연결할 때는 PC의 LAN 주소나 접근 가능한 HTTPS origin을 사용합니다.
APK에 포함된 서버 주소를 바꾸려면 다시 빌드해야 합니다.

[HTTPS 및 APK 배포 안내](Backend/deploy/HTTPS_AND_APK.md)에 독립 앱 빌드와 게시 절차가 있습니다.
앱 서명 키는 저장소 밖에서 보관하고, 업데이트할 때 같은 서명 키를 유지하세요.

## 검사

```bash
python -m pip install -r Backend/requirements-dev.txt
python -m pytest Backend/tests
# Frontend: npm run build, npm run lint
# 각 Mobile 앱: npx tsc --noEmit
# Mobile/user-app: node tests/session-regression.cjs
```

실제 DB·RPC·SMTP·결제 기능 검증에는 별도의 테스트 환경이 필요합니다. 사용 완료 티켓이나
실제 계정의 변경을 일반 단위 테스트에서 수행하지 마세요.

## 공유 제외 파일

실제 `.env*`, DB 접속 정보, 개인키, APK 서명 키, 로그, 백업 폴더, `venv`, `node_modules`,
생성된 native 프로젝트 및 빌드 결과물은 Git에 올리지 않습니다. `.env*.example`에는
변수명과 공개 예제만 유지합니다. 서버 폴더 이름 변경은 Git 저장소 이름 변경과 별개입니다.
