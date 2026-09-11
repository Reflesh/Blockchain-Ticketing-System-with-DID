import json
import math
import os
import re
import secrets
import socket
from dataclasses import dataclass
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
MAX_RESPONSE_BYTES = 1024 * 1024


def env_bool(name, default=False):
    value = os.getenv(name, str(default)).strip().lower()
    if value not in {"true", "false", "1", "0"}:
        raise ValueError(f"{name}: true 또는 false를 설정하세요.")
    return value in {"true", "1"}


def validate_service_key(key):
    if len(key) < 32 or not key.isascii() or any(c.isspace() for c in key):
        raise ValueError("AUTH_SERVICE_KEY는 공백 없는 32자 이상의 ASCII 난수여야 합니다.")


@dataclass(frozen=True)
class ServiceSettings:
    key: str = ""
    internal_only: bool = False

    @classmethod
    def from_env(cls):
        key = os.getenv("AUTH_SERVICE_KEY", "")
        internal_only = env_bool("AUTH_INTERNAL_ONLY")
        if key or internal_only:
            validate_service_key(key)
        return cls(key, internal_only)

    def accepts(self, supplied):
        return bool(self.key and isinstance(supplied, str) and supplied.isascii()
                    and secrets.compare_digest(self.key, supplied))


class AuthServiceUnavailable(Exception):
    """내부 세부 정보 없이 외부 503으로 변환하는 예외."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass(frozen=True)
class AuthReply:
    status: int
    body: object
    retry_after: str = ""


class AuthGateway:
    def __init__(self, base_url="", key="", timeout=5.0, opener=None):
        self.base_url = base_url.rstrip("/")
        self.key = key
        self.timeout = timeout
        if not math.isfinite(timeout) or not 0 < timeout <= 30:
            raise ValueError("AUTH_HTTP_TIMEOUT_SECONDS는 0초 초과 30초 이하로 설정하세요.")
        if base_url:
            parsed = urlsplit(base_url)
            if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                    or parsed.username or parsed.password or parsed.query or parsed.fragment
                    or parsed.path not in {"", "/"}):
                raise ValueError("AUTH_INTERNAL_BASE_URL에는 인증 서버의 origin만 지정하세요(/api 제외).")
            validate_service_key(key)
        # 환경 프록시로 키를 보내거나 3xx의 다른 서버로 따라가지 않는다.
        self.opener = opener or build_opener(ProxyHandler({}), NoRedirect())

    @classmethod
    def from_env(cls):
        return cls(os.getenv("AUTH_INTERNAL_BASE_URL", ""),
                   os.getenv("AUTH_SERVICE_KEY", ""),
                   float(os.getenv("AUTH_HTTP_TIMEOUT_SECONDS", "5")))

    def call(self, method, path, payload=None):
        if not self.base_url:
            raise AuthServiceUnavailable("인증 중계 주소가 설정되지 않았습니다.")
        if not path.startswith(("/api/", "/internal/")) or "://" in path or ".." in path:
            raise AuthServiceUnavailable("허용되지 않은 내부 경로입니다.")
        raw = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = Request(self.base_url + path, data=raw, method=method,
                      headers={"X-Service-Key": self.key, "Accept": "application/json",
                               "Content-Type": "application/json"})
        try:
            try:
                response = self.opener.open(req, timeout=self.timeout)
            except HTTPError as error:
                response = error
            with response:
                status = response.code
                content = response.read(MAX_RESPONSE_BYTES + 1)
                retry_after = response.headers.get("Retry-After", "")
            if len(content) > MAX_RESPONSE_BYTES:
                raise AuthServiceUnavailable("인증 서버 응답을 처리할 수 없습니다.")
            body = json.loads(content)
            if not isinstance(body, dict):
                raise AuthServiceUnavailable("인증 서버 응답을 처리할 수 없습니다.")
            detail = body.get("detail")
            service_rejection = isinstance(detail, dict) and detail.get("code") in {
                "AUTH_SERVICE_UNAUTHORIZED", "AUTH_SERVICE_NOT_CONFIGURED"}
            if status >= 500 or 300 <= status < 400 or service_rejection:
                raise AuthServiceUnavailable("인증 서비스를 일시적으로 이용할 수 없습니다.")
            # 사용자 오류 4xx는 원래 detail을 유지한다. 자동 재시도 없음.
            return AuthReply(status, body, retry_after if retry_after.isdigit() else "")
        except AuthServiceUnavailable:
            raise
        except (URLError, socket.timeout, TimeoutError, OSError, ValueError, UnicodeError):
            raise AuthServiceUnavailable("인증 서비스를 일시적으로 이용할 수 없습니다.") from None

    def session_wallet(self, token):
        result = self.call("POST", "/internal/sessions/introspect", {"token": token})
        if result.status != 200 or type(result.body.get("active")) is not bool:
            raise AuthServiceUnavailable("인증 서버 응답을 처리할 수 없습니다.")
        if not result.body["active"]:
            return None
        address = result.body.get("wallet_address")
        if not isinstance(address, str) or not ADDRESS.fullmatch(address):
            raise AuthServiceUnavailable("인증 서버 응답을 처리할 수 없습니다.")
        return address

    def credential_valid(self, address):
        result = self.call("POST", "/internal/credentials/check", {"wallet_address": address})
        if result.status != 200 or type(result.body.get("valid")) is not bool:
            raise AuthServiceUnavailable("인증 서버 응답을 처리할 수 없습니다.")
        return result.body["valid"]


def expiry_timestamp(value):
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if date.tzinfo is None:
            return None
        timestamp = date.timestamp()
        return timestamp if math.isfinite(timestamp) else None
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def inspect_session(connection_factory, token, now):
    """현재 티켓 백엔드의 세션·VC 판정 조건을 인증 서버에서 수행."""
    import hashlib
    with connection_factory() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT s.wallet_address, s.expires_at,
                          v.expires_at AS vc_expires_at
                   FROM user_login_sessions s
                   JOIN issued_vcs v ON LOWER(v.wallet_address) = LOWER(s.wallet_address)
                   LEFT JOIN revoked_vcs r ON LOWER(r.wallet_address) = LOWER(s.wallet_address)
                   WHERE s.token_hash = %s AND s.expires_at > %s
                     AND s.revoked_at IS NULL AND r.wallet_address IS NULL""",
                (hashlib.sha256(token.encode("utf-8")).hexdigest(), now))
            row = cursor.fetchone()
    if not row:
        return {"active": False}
    expiry = expiry_timestamp(row["vc_expires_at"])
    if expiry is None or expiry <= now:
        return {"active": False}
    return {"active": True, "wallet_address": row["wallet_address"],
            "expires_at": row["expires_at"], "vc_expires_at": expiry}


def inspect_credential(connection_factory, address, now):
    with connection_factory() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT v.expires_at, r.revoked_at
                   FROM issued_vcs v
                   LEFT JOIN revoked_vcs r ON LOWER(r.wallet_address) = LOWER(v.wallet_address)
                   WHERE LOWER(v.wallet_address) = LOWER(%s)""", (address,))
            row = cursor.fetchone()
    if not row:
        return {"valid": False, "reason_code": "NOT_ISSUED"}
    if row["revoked_at"] is not None:
        return {"valid": False, "reason_code": "REVOKED"}
    expiry = expiry_timestamp(row["expires_at"])
    if expiry is None or expiry <= now:
        return {"valid": False, "reason_code": "EXPIRED"}
    return {"valid": True, "reason_code": "ACTIVE", "expires_at": expiry}