# Auth 서버 운영 배포 후보

이 디렉터리의 파일은 예시다. 도메인, 경로, 인증서 위치를 실제 환경에 맞게 바꾼 후 사용한다.

## 현재 후보의 구성

- FastAPI/Uvicorn은 `.env`나 `.env.auth.runtime`의 `AUTH_HOST`, `AUTH_PORT`로 바인딩한다.
- Nginx가 공개 HTTPS와 기본 요청 제한을 담당한다.
- 현재 구조에서 OpenID4VCI Wallet과 모바일 앱은 Main 서버의 공개 주소에 접근하고, Main이 Auth로 중계한다.
- `/internal/*`는 `X-Service-Key`가 있어야 접근할 수 있다.
- Auth 서버가 Main 서버의 공유 `users` 테이블을 사용할 때만 `SYNC_MAIN_USERS=true`로 설정한다.

## 배포 전에 반드시 할 일

1. 기존 `auth_server.py`, `.env`, `DID_ABI.json`과 서비스 설정을 권한이 제한된 백업 디렉터리에 복사한다.
2. `.env.production.example`을 참고하되 실제 비밀값은 저장소에 커밋하지 않는다. 기존 `.env`를 보존해야 하면 비밀값이 없는 `.env.auth.runtime`으로 실행 설정만 덮어쓴다.
3. `.env` 파일 권한을 `600`, 애플리케이션 디렉터리를 `700` 또는 필요한 최소 권한으로 제한한다.
4. `AUTH_SERVICE_KEY`, Issuer 키, CI salt, Gmail 앱 비밀번호를 비밀 관리 도구에서 주입한다.
5. Nginx 인증서 발급 후 예시의 `auth.example.com`을 실제 도메인으로 바꾼다.
6. `nginx -t`와 `systemd-analyze verify`로 설정을 검사한다.
7. `/health/live`, `/health/ready`, Issuer metadata, JWKS, 전체 발급 smoke test를 통과시킨 뒤 트래픽을 전환한다.

`AUTH_INTERNAL_ONLY=true`는 모든 Auth 경로를 서비스 키로 막는다. Main이 Auth API를 중계하는 구조에서는 사용할 수 있지만, Auth 공개 주소를 Wallet에 직접 제공하는 배포에서는 `false`로 유지한다.
