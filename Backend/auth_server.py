import os
import json
import hashlib
import base64
import logging
import math
import re
import ssl
import time
import secrets
import smtplib
import copy
from contextlib import asynccontextmanager
from dataclasses import dataclass
from io import BytesIO
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Union, Optional, List, Dict
from urllib.parse import parse_qs, quote

import qrcode
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import is_checksum_address
from eth_keys import keys
from dotenv import load_dotenv

from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

import psycopg
from psycopg.rows import dict_row

logger = logging.getLogger("ticketpro.auth")
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name, str(default)).strip().lower()
    if value not in {"true", "false", "1", "0"}:
        raise ValueError(f"{name}: true 또는 false를 설정하세요.")
    return value in {"true", "1"}


def validate_service_key(key: str) -> None:
    if len(key) < 32 or not key.isascii() or any(char.isspace() for char in key):
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
        return cls(key=key, internal_only=internal_only)

    def accepts(self, supplied: Optional[str]) -> bool:
        return bool(
            self.key
            and isinstance(supplied, str)
            and supplied.isascii()
            and secrets.compare_digest(self.key, supplied)
        )


def expiry_timestamp(value: str) -> Optional[float]:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        timestamp = parsed.timestamp()
        return timestamp if math.isfinite(timestamp) else None
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def inspect_session(connection_factory, token: str, now: float) -> dict:
    with connection_factory() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    COALESCE(sessions.subject_wallet_address, sessions.wallet_address) AS wallet_address,
                    sessions.wallet_address AS signer_wallet_address,
                    sessions.expires_at,
                    COALESCE(credentials.expires_at, parent.expires_at) AS vc_expires_at,
                    mobile.expires_at AS mobile_expires_at
                FROM user_login_sessions AS sessions
                LEFT JOIN issued_vcs AS credentials
                  ON LOWER(credentials.wallet_address) = LOWER(sessions.wallet_address)
                LEFT JOIN mobile_credentials AS mobile
                  ON LOWER(mobile.wallet_address) = LOWER(sessions.wallet_address)
                LEFT JOIN issued_vcs AS parent
                  ON parent.ci_hash = mobile.ci_hash
                 AND LOWER(parent.wallet_address) = LOWER(mobile.parent_wallet_address)
                LEFT JOIN revoked_vcs AS credential_revoked
                  ON LOWER(credential_revoked.wallet_address) = LOWER(credentials.wallet_address)
                LEFT JOIN revoked_vcs AS parent_revoked
                  ON LOWER(parent_revoked.wallet_address) = LOWER(parent.wallet_address)
                WHERE sessions.token_hash = %s
                  AND sessions.expires_at > %s
                  AND sessions.revoked_at IS NULL
                  AND (
                    (credentials.wallet_address IS NOT NULL AND credential_revoked.wallet_address IS NULL)
                    OR
                    (mobile.wallet_address IS NOT NULL AND mobile.revoked_at IS NULL
                     AND parent.wallet_address IS NOT NULL AND parent_revoked.wallet_address IS NULL)
                  )
                """,
                (_token_hash(token), now),
            )
            row = cur.fetchone()

    if not row:
        return {"active": False}

    vc_expires_at = expiry_timestamp(row["vc_expires_at"])
    if vc_expires_at is None or vc_expires_at <= now:
        return {"active": False}
    mobile_expires_at = expiry_timestamp(row["mobile_expires_at"])
    if row["mobile_expires_at"] is not None and (
        mobile_expires_at is None or mobile_expires_at <= now
    ):
        return {"active": False}

    return {
        "active": True,
        "wallet_address": row["wallet_address"],
        "signer_wallet_address": row["signer_wallet_address"],
        "expires_at": row["expires_at"],
        "vc_expires_at": vc_expires_at,
    }


def inspect_credential(connection_factory, address: str, now: float) -> dict:
    with connection_factory() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT expires_at, revoked_at, reason, parent_expires_at, is_mobile
                FROM (
                    SELECT credentials.expires_at, revoked.revoked_at, revoked.reason,
                           NULL::TEXT AS parent_expires_at, FALSE AS is_mobile
                    FROM issued_vcs AS credentials
                    LEFT JOIN revoked_vcs AS revoked
                      ON LOWER(revoked.wallet_address) = LOWER(credentials.wallet_address)
                    WHERE LOWER(credentials.wallet_address) = LOWER(%s)
                    UNION ALL
                    SELECT mobile.expires_at,
                           COALESCE(mobile.revoked_at, parent_revoked.revoked_at) AS revoked_at,
                           COALESCE(mobile.revoked_reason, parent_revoked.reason) AS reason,
                           parent.expires_at AS parent_expires_at, TRUE AS is_mobile
                    FROM mobile_credentials AS mobile
                    LEFT JOIN issued_vcs AS parent
                      ON parent.ci_hash = mobile.ci_hash
                     AND LOWER(parent.wallet_address) = LOWER(mobile.parent_wallet_address)
                    LEFT JOIN revoked_vcs AS parent_revoked
                      ON LOWER(parent_revoked.wallet_address) = LOWER(parent.wallet_address)
                    WHERE LOWER(mobile.wallet_address) = LOWER(%s)
                ) AS available_credentials
                LIMIT 1
                """,
                (address, address),
            )
            row = cur.fetchone()

    if not row:
        return {"valid": False, "reason_code": "NOT_ISSUED"}
    if row["revoked_at"] is not None:
        return {
            "valid": False,
            "reason_code": "REVOKED",
            "revoked_at": row["revoked_at"],
            "reason": row["reason"],
        }

    expires_at = expiry_timestamp(row["expires_at"])
    if expires_at is None or expires_at <= now:
        return {"valid": False, "reason_code": "EXPIRED"}
    if row["is_mobile"]:
        parent_expires_at = expiry_timestamp(row["parent_expires_at"])
        if parent_expires_at is None or parent_expires_at <= now:
            return {"valid": False, "reason_code": "EXPIRED"}
    return {"valid": True, "reason_code": "ACTIVE", "expires_at": expires_at}


class ServiceGuardMiddleware:
    def __init__(self, app, settings: ServiceSettings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        protected = self.settings.internal_only or scope.get("path", "").startswith(
            "/internal/"
        )
        headers = dict(scope.get("headers", []))
        supplied_bytes = headers.get(b"x-service-key")
        supplied = (
            supplied_bytes.decode("ascii", errors="ignore")
            if supplied_bytes is not None
            else None
        )
        if protected and not self.settings.accepts(supplied):
            code = (
                "AUTH_SERVICE_UNAUTHORIZED"
                if self.settings.key
                else "AUTH_SERVICE_NOT_CONFIGURED"
            )
            response = JSONResponse(
                status_code=401 if self.settings.key else 503,
                content={
                    "detail": {
                        "code": code,
                        "message": "서버 간 인증이 필요합니다.",
                    }
                },
                headers={"Cache-Control": "no-store"},
            )
            await response(scope, receive, send)
            return

        async def send_no_store(message):
            if message["type"] == "http.response.start":
                response_headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"cache-control"
                ]
                response_headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": response_headers}
            await send(message)

        await self.app(scope, receive, send_no_store)


def install_internal_auth_routes(app: FastAPI, connection_factory) -> None:
    @app.post("/internal/sessions/introspect", include_in_schema=False)
    async def introspect(payload: dict = Body(...)):
        token = payload.get("token")
        if not isinstance(token, str) or not 1 <= len(token) <= 4096:
            raise HTTPException(status_code=422, detail="token 형식을 확인하세요.")
        try:
            return inspect_session(connection_factory, token, time.time())
        except Exception:
            logger.exception("내부 로그인 세션 조회 실패")
            raise HTTPException(
                status_code=503,
                detail="인증 저장소를 이용할 수 없습니다.",
            ) from None

    @app.post("/internal/credentials/check", include_in_schema=False)
    async def credential_check(payload: dict = Body(...)):
        address = payload.get("wallet_address")
        if not isinstance(address, str) or not ADDRESS.fullmatch(address):
            raise HTTPException(
                status_code=422,
                detail="wallet_address 형식을 확인하세요.",
            )
        try:
            return inspect_credential(connection_factory, address, time.time())
        except Exception:
            logger.exception("내부 Credential 상태 조회 실패")
            raise HTTPException(
                status_code=503,
                detail="인증 저장소를 이용할 수 없습니다.",
            ) from None

# ──────────────────────────────────────────────
# 1. 환경 변수 로드 및 Web3 설정
# ──────────────────────────────────────────────
RPC_URL = os.getenv("RPC_URL", "https://polygon-rpc.com")
DID_CHAIN_ID = int(os.getenv("DID_CHAIN_ID", "137"))
w3 = Web3(Web3.HTTPProvider(RPC_URL))
w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("❌ .env에 DATABASE_URL(PostgreSQL 주소)이 없습니다.")

DID_CONTRACT_ADDRESS = os.getenv("DID_CONTRACT_ADDRESS")
DID_CONTRACT_ABI = None
try:
    with open(os.path.join(BASE_DIR, "DID_ABI.json"), "r", encoding="utf-8") as f:
        DID_CONTRACT_ABI = json.load(f)
except FileNotFoundError:
    print("⚠️ DID_ABI.json 파일을 찾을 수 없습니다. 파일명과 위치를 확인해 주세요.")

if DID_CONTRACT_ADDRESS and DID_CONTRACT_ABI:
    did_registry_contract = w3.eth.contract(address=w3.to_checksum_address(DID_CONTRACT_ADDRESS), abi=DID_CONTRACT_ABI)
    print(f"✅ DID Web3 연결 완료 / Contract: {DID_CONTRACT_ADDRESS}")
else:
    did_registry_contract = None
    print("⚠️ 컨트랙트 주소 또는 ABI가 없어 온체인 기록이 생략됩니다.")

CI_SALT = os.getenv("CI_SALT")
if not CI_SALT:
    raise RuntimeError("❌ .env에 CI_SALT가 없습니다.")

ISSUER_KEY = os.getenv("ISSUER_PRIVATE_KEY")
ENV = os.getenv("ENV", "development").strip().lower()
if ENV not in {"development", "test", "production"}:
    raise RuntimeError("ENV는 development, test, production 중 하나여야 합니다.")

DEV_EMAIL_AUTH_BYPASS = (
    ENV != "production"
    and env_bool("DEV_EMAIL_AUTH_BYPASS")
)
SYNC_MAIN_USERS = env_bool("SYNC_MAIN_USERS", ENV == "production")

if not ISSUER_KEY:
    if ENV == "production":
        raise RuntimeError("❌ 운영 환경에서는 ISSUER_PRIVATE_KEY가 반드시 .env에 고정되어야 합니다.")
    issuer_account = Account.create()
    ISSUER_KEY = issuer_account.key.hex()
    print("⚠️ 개발 환경: 프로세스 수명 동안 사용할 임시 Issuer 키를 생성했습니다.")
else:
    issuer_account = Account.from_key(ISSUER_KEY)

ISSUER_ADDRESS = issuer_account.address
ISSUER_DID     = f"did:pknu:{ISSUER_ADDRESS}"
ISSUER_KEY_ID  = f"{ISSUER_DID}#keys-1"
EXPECTED_DOMAIN = os.getenv("DOMAIN", "ticketpro.pknu.ac.kr")

_pk_bytes         = bytes.fromhex(ISSUER_KEY.replace("0x", ""))
_issuer_priv_key  = keys.PrivateKey(_pk_bytes)
ISSUER_PUBLIC_KEY_HEX = _issuer_priv_key.public_key.to_hex()

SERVER_BASE_URL = os.getenv("SERVER_BASE_URL", "http://localhost:8001").rstrip("/")

OID4VCI_ISSUER_BASE_URL = os.getenv(
    "OID4VCI_ISSUER_BASE_URL",
    SERVER_BASE_URL,
).rstrip("/")
AUTH_PUBLIC_BASE_URL = os.getenv(
    "AUTH_PUBLIC_BASE_URL",
    OID4VCI_ISSUER_BASE_URL,
).rstrip("/")
AUTH_SERVICE_SETTINGS = ServiceSettings.from_env()
OID4VCI_OFFER_TTL = int(os.getenv("OID4VCI_OFFER_TTL_SECONDS", "300"))
OID4VCI_ACCESS_TOKEN_TTL = int(
    os.getenv("OID4VCI_ACCESS_TOKEN_TTL_SECONDS", "600")
)
OID4VCI_NONCE_TTL = int(os.getenv("OID4VCI_NONCE_TTL_SECONDS", "300"))
OID4VCI_PROOF_IAT_LEEWAY = int(
    os.getenv("OID4VCI_PROOF_IAT_LEEWAY_SECONDS", "300")
)
OID4VCI_CREDENTIAL_CONFIGURATION_ID = "PukyongStudentCredential"
OID4VCI_ISSUER_KEY_ID = f"{OID4VCI_ISSUER_BASE_URL}/.well-known/jwks.json#issuer-key-1"
OID4VCI_PRE_AUTHORIZED_GRANT_TYPE = (
    "urn:ietf:params:oauth:grant-type:pre-authorized_code"
)

if ENV == "production":
    if not OID4VCI_ISSUER_BASE_URL.startswith("https://"):
        raise RuntimeError("운영 환경의 OID4VCI_ISSUER_BASE_URL은 HTTPS여야 합니다.")
    if not AUTH_PUBLIC_BASE_URL.startswith("https://"):
        raise RuntimeError("운영 환경의 AUTH_PUBLIC_BASE_URL은 HTTPS여야 합니다.")
    if not AUTH_SERVICE_SETTINGS.key:
        raise RuntimeError("운영 환경에서는 AUTH_SERVICE_KEY가 반드시 필요합니다.")
    if not os.getenv("GMAIL_ID") or not os.getenv("GMAIL_APP_PASSWORD"):
        raise RuntimeError("운영 환경에서는 Gmail 인증 메일 설정이 반드시 필요합니다.")

# ──────────────────────────────────────────────
# 2. 세션 및 보안 설정 상수
# ──────────────────────────────────────────────
SESSION_TTL  = 180   # 인증번호 유효시간 (초) - 3분
COOLDOWN_TTL = 30    # 재요청 쿨다운 (초) - 30초
MAX_ATTEMPTS = 5     # 최대 인증 시도 가능 횟수
LOCKOUT_TTL  = 600   # 5회 실패 시 잠금 지속 시간 (초) - 10분
NONCE_TTL    = 300   # VP/Revoke 서명용 Nonce 유효기간 (5분)
LOGIN_NONCE_TTL = 180
LOGIN_SESSION_TTL = int(os.getenv("LOGIN_SESSION_TTL_SECONDS", "3600"))
MOBILE_PAIRING_TTL = int(os.getenv("MOBILE_PAIRING_TTL_SECONDS", "120"))
MOBILE_CREDENTIAL_TTL = int(os.getenv("MOBILE_CREDENTIAL_TTL_SECONDS", str(365 * 24 * 60 * 60)))

# ──────────────────────────────────────────────
# 3. PostgreSQL DB 초기화 및 헬퍼
# ──────────────────────────────────────────────
def get_db_connection():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)

def init_db():
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS issued_vcs (
                        ci_hash        TEXT PRIMARY KEY,
                        email          TEXT UNIQUE NOT NULL,
                        wallet_address TEXT UNIQUE NOT NULL,
                        issued_at      TEXT NOT NULL,
                        expires_at     TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS revoked_vcs (
                        wallet_address TEXT PRIMARY KEY,
                        revoked_at     TEXT NOT NULL,
                        reason         TEXT
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS auth_sessions (
                        email          TEXT PRIMARY KEY,
                        code           TEXT NOT NULL,
                        attempts       INTEGER DEFAULT 0,
                        expires_at     DOUBLE PRECISION NOT NULL,
                        cooldown_until DOUBLE PRECISION DEFAULT 0
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS auth_nonces (
                        nonce      TEXT PRIMARY KEY,
                        expires_at DOUBLE PRECISION NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS login_nonces (
                        nonce          TEXT PRIMARY KEY,
                        wallet_address TEXT NOT NULL,
                        message        TEXT NOT NULL,
                        expires_at     DOUBLE PRECISION NOT NULL,
                        used_at        DOUBLE PRECISION
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS user_login_sessions (
                        token_hash     TEXT PRIMARY KEY,
                        email          TEXT NOT NULL,
                        wallet_address TEXT NOT NULL,
                        issued_at      DOUBLE PRECISION NOT NULL,
                        expires_at     DOUBLE PRECISION NOT NULL,
                        revoked_at     DOUBLE PRECISION
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS mobile_credentials (
                        wallet_address        TEXT PRIMARY KEY,
                        ci_hash               TEXT NOT NULL,
                        email                 TEXT NOT NULL,
                        parent_wallet_address TEXT NOT NULL,
                        credential_id         TEXT UNIQUE NOT NULL,
                        credential_jwt        TEXT NOT NULL,
                        device_name           TEXT NOT NULL,
                        issued_at             TEXT NOT NULL,
                        expires_at            TEXT NOT NULL,
                        revoked_at            TEXT,
                        revoked_reason        TEXT
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS mobile_pairing_sessions (
                        pairing_id            TEXT PRIMARY KEY,
                        token_hash            TEXT UNIQUE NOT NULL,
                        ci_hash               TEXT NOT NULL,
                        email                 TEXT NOT NULL,
                        parent_wallet_address TEXT NOT NULL,
                        created_at            DOUBLE PRECISION NOT NULL,
                        expires_at            DOUBLE PRECISION NOT NULL,
                        used_at               DOUBLE PRECISION,
                        mobile_wallet_address TEXT
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS login_audit_logs (
                        id             BIGSERIAL PRIMARY KEY,
                        email          TEXT,
                        wallet_address TEXT,
                        action         TEXT NOT NULL,
                        success        BOOLEAN NOT NULL,
                        reason         TEXT,
                        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS oid4vci_credential_offers (
                        offer_id                    TEXT PRIMARY KEY,
                        email                       TEXT NOT NULL,
                        ci_hash                     TEXT NOT NULL,
                        pre_authorized_code         TEXT UNIQUE NOT NULL,
                        tx_code_hash                TEXT NOT NULL,
                        credential_configuration_id TEXT NOT NULL,
                        created_at                  DOUBLE PRECISION NOT NULL,
                        expires_at                  DOUBLE PRECISION NOT NULL,
                        used_at                     DOUBLE PRECISION,
                        token_attempts               INTEGER NOT NULL DEFAULT 0
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS oid4vci_access_tokens (
                        token_hash                  TEXT PRIMARY KEY,
                        offer_id                    TEXT UNIQUE NOT NULL,
                        email                       TEXT NOT NULL,
                        ci_hash                     TEXT NOT NULL,
                        credential_configuration_id TEXT NOT NULL,
                        credential_identifier       TEXT UNIQUE NOT NULL,
                        issued_at                   DOUBLE PRECISION NOT NULL,
                        expires_at                  DOUBLE PRECISION NOT NULL,
                        used_at                     DOUBLE PRECISION
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS oid4vci_nonces (
                        nonce_hash TEXT PRIMARY KEY,
                        created_at DOUBLE PRECISION NOT NULL,
                        expires_at DOUBLE PRECISION NOT NULL,
                        used_at    DOUBLE PRECISION
                    )
                """)
                cur.execute(
                    """
                    ALTER TABLE oid4vci_credential_offers
                    ADD COLUMN IF NOT EXISTS token_attempts INTEGER NOT NULL DEFAULT 0
                    """
                )
                cur.execute("ALTER TABLE issued_vcs ADD COLUMN IF NOT EXISTS email TEXT")
                cur.execute("ALTER TABLE user_login_sessions ADD COLUMN IF NOT EXISTS email TEXT")
                cur.execute("ALTER TABLE user_login_sessions ADD COLUMN IF NOT EXISTS subject_wallet_address TEXT")
                cur.execute("ALTER TABLE login_audit_logs ADD COLUMN IF NOT EXISTS email TEXT")
                if SYNC_MAIN_USERS:
                    cur.execute(
                        """
                        SELECT required.column_name
                        FROM unnest(%s::text[]) AS required(column_name)
                        WHERE NOT EXISTS (
                            SELECT 1
                            FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name = 'users'
                              AND column_name = required.column_name
                        )
                        """,
                        (["wallet_address", "auth_provider", "verification_status", "status"],),
                    )
                    missing_columns = [row["column_name"] for row in cur.fetchall()]
                    if missing_columns:
                        raise RuntimeError(
                            "Main users 테이블 또는 필수 컬럼이 없습니다: "
                            + ", ".join(missing_columns)
                        )
            conn.commit()
        print("✅ DID 레지스트리 PostgreSQL DB 초기화 완료")
    except Exception as e:
        if ENV == "production":
            raise RuntimeError("운영 데이터베이스 초기화에 실패했습니다.") from e
        logger.exception("개발 데이터베이스 초기화 실패")

init_db()

def cleanup_sessions():
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM auth_sessions WHERE expires_at < %s", (time.time(),))
            cur.execute("DELETE FROM auth_nonces WHERE expires_at < %s", (time.time(),))
            cur.execute("DELETE FROM login_nonces WHERE expires_at < %s", (time.time(),))
            cur.execute("DELETE FROM user_login_sessions WHERE expires_at < %s", (time.time(),))
            cur.execute("DELETE FROM oid4vci_credential_offers WHERE expires_at < %s", (time.time(),))
            cur.execute("DELETE FROM oid4vci_access_tokens WHERE expires_at < %s", (time.time(),))
            cur.execute("DELETE FROM oid4vci_nonces WHERE expires_at < %s", (time.time(),))
            cur.execute(
                "DELETE FROM mobile_pairing_sessions WHERE expires_at < %s",
                (time.time() - 86400,),
            )
        conn.commit()

def get_session(email: str) -> Optional[dict]:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT code, attempts, expires_at, cooldown_until FROM auth_sessions WHERE email = %s", (email,))
            row = cur.fetchone()
    if not row:
        return None
    if time.time() > row['expires_at']:
        delete_session(email)
        return None
    return row

def set_session(email: str, code: str):
    now = time.time()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO auth_sessions (email, code, attempts, expires_at, cooldown_until)
                VALUES (%s, %s, 0, %s, %s)
                ON CONFLICT(email) DO UPDATE SET
                    code           = EXCLUDED.code,
                    attempts       = 0,
                    expires_at     = EXCLUDED.expires_at,
                    cooldown_until = EXCLUDED.cooldown_until
            """, (email, code, now + SESSION_TTL, now + COOLDOWN_TTL))
        conn.commit()

def delete_session(email: str):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM auth_sessions WHERE email = %s", (email,))
        conn.commit()

def is_on_cooldown(email: str) -> int:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT cooldown_until FROM auth_sessions WHERE email = %s", (email,))
            row = cur.fetchone()
    if not row:
        return 0
    return max(0, int(row['cooldown_until'] - time.time()))

def increment_attempts(email: str) -> int:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE auth_sessions SET attempts = attempts + 1 WHERE email = %s RETURNING attempts", (email,))
            row = cur.fetchone()
        conn.commit()
    return row['attempts'] if row else 0

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")

def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)

def _json_base64url(value: dict) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return _base64url_encode(encoded)

def _sign_es256k_jwt(header: dict, payload: dict) -> str:
    encoded_header = _json_base64url(header)
    encoded_payload = _json_base64url(payload)
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    digest = hashlib.sha256(signing_input).digest()
    signature = _issuer_priv_key.sign_msg_hash(digest)
    jose_signature = signature.r.to_bytes(32, "big") + signature.s.to_bytes(32, "big")
    return f"{encoded_header}.{encoded_payload}.{_base64url_encode(jose_signature)}"


def _issuer_public_jwk() -> dict:
    public_key = _issuer_priv_key.public_key.to_bytes()
    return {
        "kty": "EC",
        "crv": "secp256k1",
        "x": _base64url_encode(public_key[:32]),
        "y": _base64url_encode(public_key[32:]),
        "use": "sig",
        "alg": "ES256K",
        "kid": OID4VCI_ISSUER_KEY_ID,
    }

def _oauth_error(error: str, description: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": error, "error_description": description},
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )

def _extract_bearer_token(request: Request) -> Optional[str]:
    authorization = request.headers.get("authorization", "")
    scheme, separator, token = authorization.partition(" ")
    if separator and scheme.lower() == "bearer" and token.strip():
        return token.strip()
    return None

def _verify_oid4vci_jwt_proof(proof_jwt: str) -> dict:
    try:
        encoded_header, encoded_payload, encoded_signature = proof_jwt.split(".")
        header = json.loads(_base64url_decode(encoded_header))
        payload = json.loads(_base64url_decode(encoded_payload))
        signature_bytes = _base64url_decode(encoded_signature)
    except Exception as exc:
        raise ValueError("JWT proof 형식이 올바르지 않습니다.") from exc

    if header.get("typ") != "openid4vci-proof+jwt":
        raise ValueError("JWT proof의 typ이 올바르지 않습니다.")
    if header.get("alg") != "ES256K":
        raise ValueError("지원하지 않는 JWT proof 서명 알고리즘입니다.")
    if any(name in header for name in ("kid", "x5c")):
        raise ValueError("현재 발급 흐름은 jwk 기반 proof만 지원합니다.")

    jwk = header.get("jwk")
    if not isinstance(jwk, dict):
        raise ValueError("JWT proof 헤더에 공개 JWK가 없습니다.")
    if "d" in jwk:
        raise ValueError("JWT proof에 개인 키를 포함할 수 없습니다.")
    if jwk.get("kty") != "EC" or jwk.get("crv") != "secp256k1":
        raise ValueError("secp256k1 EC 공개 키만 지원합니다.")

    try:
        x = _base64url_decode(jwk["x"])
        y = _base64url_decode(jwk["y"])
        if len(x) != 32 or len(y) != 32 or len(signature_bytes) != 64:
            raise ValueError
        public_key = keys.PublicKey(x + y)
        signature = keys.NonRecoverableSignature(signature_bytes)
    except Exception as exc:
        raise ValueError("JWT proof 공개 키 또는 서명 길이가 올바르지 않습니다.") from exc

    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    digest = hashlib.sha256(signing_input).digest()
    if not signature.verify_msg_hash(digest, public_key):
        raise ValueError("JWT proof 서명 검증에 실패했습니다.")

    audience = payload.get("aud")
    valid_audience = (
        audience == OID4VCI_ISSUER_BASE_URL
        or isinstance(audience, list) and OID4VCI_ISSUER_BASE_URL in audience
    )
    if not valid_audience:
        raise ValueError("JWT proof의 aud가 Credential Issuer와 일치하지 않습니다.")

    issued_at = payload.get("iat")
    if not isinstance(issued_at, (int, float)):
        raise ValueError("JWT proof에 유효한 iat가 없습니다.")
    if abs(time.time() - issued_at) > OID4VCI_PROOF_IAT_LEEWAY:
        raise ValueError("JWT proof의 iat 허용 시간을 벗어났습니다.")

    nonce = payload.get("nonce")
    if not isinstance(nonce, str) or not nonce:
        raise ValueError("JWT proof에 c_nonce가 없습니다.")

    return {
        "jwk": {"kty": "EC", "crv": "secp256k1", "x": jwk["x"], "y": jwk["y"]},
        "public_key": public_key,
        "nonce": nonce,
    }

def _consume_oid4vci_nonce(nonce: str) -> bool:
    now = time.time()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE oid4vci_nonces
                SET used_at = %s
                WHERE nonce_hash = %s
                  AND used_at IS NULL
                  AND expires_at >= %s
                RETURNING nonce_hash
                """,
                (now, _token_hash(nonce), now),
            )
            consumed = cur.fetchone()
        conn.commit()
    return consumed is not None

def _verify_email_code_for_oid4vci(email: str, code: str) -> str:
    email = email.strip().lower()
    code = code.strip()

    if not email.endswith("@pukyong.ac.kr"):
        raise HTTPException(
            status_code=400,
            detail="부경대학교 이메일(@pukyong.ac.kr)만 가능합니다.",
        )

    session = get_session(email)
    if not session:
        raise HTTPException(
            status_code=400,
            detail="인증 요청 내역이 없거나 만료되었습니다.",
        )

    if session["code"] == "LOCKED":
        remaining = max(0, int(session["cooldown_until"] - time.time()))
        raise HTTPException(
            status_code=429,
            detail=f"인증 시도 횟수를 초과했습니다. {remaining}초 후 다시 시도해주세요.",
        )

    if not secrets.compare_digest(session["code"], code):
        attempts = increment_attempts(email)

        if attempts >= MAX_ATTEMPTS:
            lock_time = time.time() + LOCKOUT_TTL
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE auth_sessions
                        SET code = 'LOCKED', expires_at = %s, cooldown_until = %s
                        WHERE email = %s
                        """,
                        (lock_time, lock_time, email),
                    )
                conn.commit()

            raise HTTPException(
                status_code=429,
                detail="인증번호를 너무 많이 틀렸습니다. 10분 후 다시 시도해주세요.",
            )

        raise HTTPException(
            status_code=400,
            detail=f"인증번호가 올바르지 않습니다. ({attempts}/{MAX_ATTEMPTS})",
        )

    return email

def _build_credential_offer_url(offer_id: str) -> str:
    return f"{OID4VCI_ISSUER_BASE_URL}/oid4vci/credential-offer/{offer_id}"

def _build_credential_offer_uri(offer_id: str) -> str:
    offer_url = _build_credential_offer_url(offer_id)
    return (
        "openid-credential-offer://?"
        f"credential_offer_uri={quote(offer_url, safe='')}"
    )

def _get_active_oid4vci_offer(offer_id: str) -> dict:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    pre_authorized_code,
                    credential_configuration_id,
                    expires_at,
                    used_at
                FROM oid4vci_credential_offers
                WHERE offer_id = %s
                """,
                (offer_id,),
            )
            offer = cur.fetchone()

    if not offer:
        raise HTTPException(status_code=404, detail="Credential Offer를 찾을 수 없습니다.")
    if offer["used_at"] is not None:
        raise HTTPException(status_code=410, detail="이미 사용된 Credential Offer입니다.")
    if time.time() > offer["expires_at"]:
        raise HTTPException(status_code=410, detail="Credential Offer가 만료되었습니다.")

    return offer


def _send_oid4vci_tx_code(email: str, tx_code: str) -> None:
    sender_email = os.getenv("GMAIL_ID")
    sender_password = os.getenv("GMAIL_APP_PASSWORD")
    if not sender_email or not sender_password:
        raise RuntimeError("메일 발송 설정이 없습니다.")

    message = MIMEMultipart()
    message["From"] = sender_email
    message["To"] = email
    message["Subject"] = "[TicketPro] 학생 인증서 Wallet 발급 코드"
    message.attach(
        MIMEText(
            f"Wallet에서 입력할 6자리 발급 코드: [{tx_code}]\n"
            "보안을 위해 Credential Offer 유효시간 안에 입력해 주세요.",
            "plain",
        )
    )

    with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        smtp.login(sender_email, sender_password)
        smtp.send_message(message)

def _record_login_audit(wallet_address: Optional[str], action: str, success: bool, reason: Optional[str] = None, email: Optional[str] = None):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO login_audit_logs (email, wallet_address, action, success, reason) VALUES (%s, %s, %s, %s, %s)",
                (email, wallet_address, action, success, reason)
            )
        conn.commit()

# ──────────────────────────────────────────────
# 4. 암호학 및 온체인 트랜잭션 헬퍼
# ──────────────────────────────────────────────
def _get_payload_hash(payload_dict: dict) -> bytes:
    payload_str = json.dumps(payload_dict, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload_str.encode("utf-8")).digest()

def _eth_sign_vc(payload_dict: dict) -> str:
    msg_hash  = _get_payload_hash(payload_dict)
    signature = _issuer_priv_key.sign_msg_hash(msg_hash)
    return signature.to_hex()

def _eth_verify_signature(payload_dict: dict, signature_hex: str, expected_address: str) -> bool:
    try:
        msg_hash  = _get_payload_hash(payload_dict)
        sig_bytes = bytes.fromhex(signature_hex.replace("0x", ""))
        sig       = keys.Signature(sig_bytes)
        recovered = sig.recover_public_key_from_msg_hash(msg_hash)
        return recovered.to_checksum_address().lower() == expected_address.lower()
    except Exception as e:
        print(f"Signature Verification Error: {e}")
        return False

def _send_did_onchain_transaction(contract_function):
    if not did_registry_contract:
        return
    try:
        nonce = w3.eth.get_transaction_count(ISSUER_ADDRESS)
        tx = contract_function.build_transaction({
            'chainId': DID_CHAIN_ID,
            'gas': 150000,
            'maxFeePerGas': int(w3.eth.gas_price * 1.5), 
            'maxPriorityFeePerGas': w3.to_wei('35', 'gwei'),
            'nonce': nonce,
        })
        signed_tx = w3.eth.account.sign_transaction(tx, private_key=ISSUER_KEY)
        raw_transaction = getattr(signed_tx, "raw_transaction", None)
        if raw_transaction is None:
            raw_transaction = signed_tx.rawTransaction
        tx_hash = w3.eth.send_raw_transaction(raw_transaction)
        print(f"🚀 온체인 기록 전송 완료 (Background): {tx_hash.hex()}")
        
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        if receipt.status != 1:
            print("❌ 트랜잭션이 Revert 되었습니다.")
    except Exception as e:
        print(f"❌ 온체인 트랜잭션 에러 (Background): {e}")

# ──────────────────────────────────────────────
# 5. DID Document 빌더
# ──────────────────────────────────────────────
def _build_did_document(address: str) -> dict:
    did    = f"did:pknu:{address}"
    key_id = f"{did}#keys-1"
    return {
        "@context": [
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/suites/secp256k1recovery-2020/v2" 
        ],
        "id": did,
        "verificationMethod": [{
            "id": key_id,
            "type": "EcdsaSecp256k1RecoveryMethod2020",
            "controller": did,
            "blockchainAccountId": f"eip155:{DID_CHAIN_ID}:{address}"
        }],
        "authentication": [key_id],
        "assertionMethod": [key_id],
    }

# ──────────────────────────────────────────────
# 6. FastAPI 앱 및 라우터 설정
# ──────────────────────────────────────────────
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:5173",
    ).split(",")
    if origin.strip()
]
if ENV == "production" and (
    not ALLOWED_ORIGINS
    or "*" in ALLOWED_ORIGINS
    or any(not origin.startswith("https://") for origin in ALLOWED_ORIGINS)
):
    raise RuntimeError("운영 환경의 ALLOWED_ORIGINS에는 허용할 HTTPS origin을 명시해야 합니다.")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    cleanup_sessions()
    logger.info("만료 세션 및 Nonce 정리 완료")
    yield


app = FastAPI(title="PKNU DID Issuer Server", lifespan=lifespan)

if not AUTH_SERVICE_SETTINGS.internal_only:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

install_internal_auth_routes(app, get_db_connection)
app.add_middleware(ServiceGuardMiddleware, settings=AUTH_SERVICE_SETTINGS)


@app.get("/health/live", include_in_schema=False)
async def health_live():
    return {"status": "ok"}


@app.get("/health/ready", include_in_schema=False)
async def health_ready():
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ready")
                cur.fetchone()
        return {"status": "ready"}
    except Exception:
        logger.exception("데이터베이스 readiness 확인 실패")
        raise HTTPException(status_code=503, detail="데이터베이스 연결을 확인하세요.") from None

class EmailRequest(BaseModel):
    email: str
    is_recovery: bool = False

class VerifyRequest(BaseModel):
    email: str
    code: str
    wallet_address: str

    @field_validator("wallet_address")
    @classmethod
    def validate_wallet(cls, v: str) -> str:
        if not is_checksum_address(v):
            raise ValueError("유효하지 않은 지갑 주소입니다. EIP-55 체크섬 형식으로 입력해주세요.")
        return v

class RevokeRequest(BaseModel):
    wallet_address: str
    reason: str = "사용자 요청"
    nonce: str
    signature: str

class VPVerifyRequest(BaseModel):
    verifiable_presentation: dict

class LoginChallengeRequest(BaseModel):
    wallet_address: str

    @field_validator("wallet_address")
    @classmethod
    def validate_wallet(cls, v: str) -> str:
        if not is_checksum_address(v):
            raise ValueError("유효하지 않은 지갑 주소입니다. EIP-55 체크섬 형식으로 입력해주세요.")
        return v

class LoginVerifyRequest(LoginChallengeRequest):
    nonce: str
    message: str
    signature: str

class LogoutRequest(BaseModel):
    access_token: str

class OID4VCIOfferRequest(BaseModel):
    email: str
    code: str

class OID4VCICredentialRequest(BaseModel):
    credential_configuration_id: Optional[str] = None
    credential_identifier: Optional[str] = None
    proofs: Dict[str, List[str]]

class MobilePairingCompleteRequest(LoginVerifyRequest):
    pairing_token: str = Field(min_length=32, max_length=256)
    holder_jwk: Dict[str, str]
    device_name: str = Field(default="Android Wallet", min_length=1, max_length=80)

class MobileDeviceRevokeRequest(BaseModel):
    reason: str = Field(default="웹 마이페이지에서 연결 해제", min_length=1, max_length=200)


def _public_key_from_holder_jwk(jwk: dict) -> keys.PublicKey:
    if set(jwk) != {"kty", "crv", "x", "y"}:
        raise HTTPException(status_code=400, detail="모바일 Wallet 공개키 형식이 올바르지 않습니다.")
    if jwk.get("kty") != "EC" or jwk.get("crv") != "secp256k1":
        raise HTTPException(status_code=400, detail="secp256k1 모바일 Wallet만 지원합니다.")
    try:
        x = _base64url_decode(jwk["x"])
        y = _base64url_decode(jwk["y"])
        if len(x) != 32 or len(y) != 32:
            raise ValueError
        return keys.PublicKey(x + y)
    except Exception:
        raise HTTPException(status_code=400, detail="모바일 Wallet 공개키를 확인할 수 없습니다.") from None


def _consume_login_challenge(request: LoginVerifyRequest) -> None:
    now = time.time()
    try:
        recovered_address = Account.recover_message(
            encode_defunct(text=request.message),
            signature=request.signature,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="로그인 서명을 확인할 수 없습니다.") from None

    if recovered_address.lower() != request.wallet_address.lower():
        raise HTTPException(status_code=401, detail="로그인 서명이 Wallet 주소와 일치하지 않습니다.")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT wallet_address, message, expires_at, used_at FROM login_nonces WHERE nonce = %s FOR UPDATE",
                (request.nonce,),
            )
            challenge = cur.fetchone()
            if not challenge:
                failure = "로그인 Challenge가 유효하지 않습니다."
            elif challenge["used_at"] is not None or now > challenge["expires_at"]:
                failure = "로그인 Challenge가 사용되었거나 만료되었습니다."
            elif (
                challenge["wallet_address"].lower() != request.wallet_address.lower()
                or challenge["message"] != request.message
            ):
                failure = "로그인 Challenge 정보가 일치하지 않습니다."
            else:
                failure = None

            if not failure:
                cur.execute(
                    """
                    UPDATE login_nonces
                    SET used_at = %s
                    WHERE nonce = %s AND used_at IS NULL AND expires_at >= %s
                    RETURNING nonce
                    """,
                    (now, request.nonce, now),
                )
                if not cur.fetchone():
                    failure = "로그인 Challenge가 이미 사용되었습니다."
        conn.commit()

    if failure:
        raise HTTPException(status_code=401, detail=failure)


def _require_primary_web_session(http_request: Request) -> dict:
    token = _extract_bearer_token(http_request)
    if not token:
        raise HTTPException(status_code=401, detail="웹 로그인 세션이 필요합니다.")
    session = inspect_session(get_db_connection, token, time.time())
    if not session.get("active"):
        raise HTTPException(status_code=401, detail="웹 로그인 세션이 만료되었거나 유효하지 않습니다.")
    signer = session["signer_wallet_address"]
    account = session["wallet_address"]
    if signer.lower() != account.lower():
        raise HTTPException(status_code=403, detail="모바일 세션에서는 새 기기를 연결할 수 없습니다.")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT credentials.ci_hash, credentials.email, credentials.wallet_address,
                       credentials.expires_at, revoked.wallet_address AS revoked_wallet
                FROM issued_vcs AS credentials
                LEFT JOIN revoked_vcs AS revoked
                  ON LOWER(revoked.wallet_address) = LOWER(credentials.wallet_address)
                WHERE LOWER(credentials.wallet_address) = LOWER(%s)
                """,
                (account,),
            )
            credential = cur.fetchone()
    expires_at = expiry_timestamp(credential["expires_at"]) if credential else None
    if not credential or credential["revoked_wallet"] or expires_at is None or expires_at <= time.time():
        raise HTTPException(status_code=403, detail="유효한 웹 DID/VC가 필요합니다.")
    return credential


def _pairing_qr_base64(pairing_uri: str) -> str:
    qr = qrcode.QRCode(version=None, box_size=8, border=4)
    qr.add_data(pairing_uri)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")
    output = BytesIO()
    image.save(output, format="PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


@app.post("/api/mobile-pairings", summary="로그인한 웹 사용자의 모바일 연결 QR 생성")
async def create_mobile_pairing(http_request: Request):
    credential = _require_primary_web_session(http_request)
    now = time.time()
    pairing_id = secrets.token_urlsafe(18)
    pairing_token = secrets.token_urlsafe(40)
    expires_at = now + MOBILE_PAIRING_TTL
    pairing_uri = f"ticketprouserapp://mobile-pairing?token={quote(pairing_token, safe='')}"
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO mobile_pairing_sessions (
                    pairing_id, token_hash, ci_hash, email, parent_wallet_address,
                    created_at, expires_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    pairing_id,
                    _token_hash(pairing_token),
                    credential["ci_hash"],
                    credential["email"],
                    credential["wallet_address"],
                    now,
                    expires_at,
                ),
            )
        conn.commit()
    return {
        "status": "pending",
        "pairing_id": pairing_id,
        "pairing_uri": pairing_uri,
        "qr_png_base64": _pairing_qr_base64(pairing_uri),
        "expires_in": MOBILE_PAIRING_TTL,
    }


@app.get("/api/mobile-pairings/{pairing_id}", summary="모바일 연결 상태 조회")
async def get_mobile_pairing(pairing_id: str, http_request: Request):
    credential = _require_primary_web_session(http_request)
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT expires_at, used_at, mobile_wallet_address
                FROM mobile_pairing_sessions
                WHERE pairing_id = %s AND ci_hash = %s
                """,
                (pairing_id, credential["ci_hash"]),
            )
            pairing = cur.fetchone()
    if not pairing:
        raise HTTPException(status_code=404, detail="모바일 연결 요청을 찾을 수 없습니다.")
    if pairing["used_at"] is not None:
        return {
            "status": "completed",
            "mobile_wallet_address": pairing["mobile_wallet_address"],
        }
    if time.time() > pairing["expires_at"]:
        return {"status": "expired"}
    return {"status": "pending", "expires_in": max(0, int(pairing["expires_at"] - time.time()))}


@app.get("/api/mobile-devices", summary="웹 계정에 연결된 모바일 기기 조회")
async def list_mobile_devices(http_request: Request):
    credential = _require_primary_web_session(http_request)
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT wallet_address, device_name, issued_at, expires_at, revoked_at, revoked_reason
                FROM mobile_credentials
                WHERE ci_hash = %s
                ORDER BY issued_at DESC
                """,
                (credential["ci_hash"],),
            )
            devices = cur.fetchall()
    return {"data": devices}


@app.post("/api/mobile-devices/{wallet_address}/revoke", summary="모바일 기기 연결 해제")
async def revoke_mobile_device(
    wallet_address: str,
    request: MobileDeviceRevokeRequest,
    http_request: Request,
):
    if not ADDRESS.fullmatch(wallet_address):
        raise HTTPException(status_code=400, detail="모바일 Wallet 주소 형식이 올바르지 않습니다.")
    credential = _require_primary_web_session(http_request)
    revoked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE mobile_credentials
                SET revoked_at = %s, revoked_reason = %s
                WHERE LOWER(wallet_address) = LOWER(%s)
                  AND ci_hash = %s
                  AND revoked_at IS NULL
                RETURNING wallet_address
                """,
                (revoked_at, request.reason, wallet_address, credential["ci_hash"]),
            )
            revoked = cur.fetchone()
            if revoked:
                cur.execute(
                    """
                    UPDATE user_login_sessions
                    SET revoked_at = %s
                    WHERE LOWER(wallet_address) = LOWER(%s) AND revoked_at IS NULL
                    """,
                    (time.time(), wallet_address),
                )
        conn.commit()
    if not revoked:
        raise HTTPException(status_code=404, detail="연결된 활성 모바일 기기를 찾을 수 없습니다.")
    return {"status": "success", "message": "모바일 기기 연결을 해제했습니다."}


@app.post("/api/mobile-pairings/complete", summary="모바일 Wallet 연결 및 보조 VC 발급")
async def complete_mobile_pairing(request: MobilePairingCompleteRequest):
    public_key = _public_key_from_holder_jwk(request.holder_jwk)
    if public_key.to_checksum_address().lower() != request.wallet_address.lower():
        raise HTTPException(status_code=400, detail="모바일 Wallet 공개키와 주소가 일치하지 않습니다.")
    _consume_login_challenge(request)

    now = time.time()
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(seconds=MOBILE_CREDENTIAL_TTL)
    issued_str = issued_at.isoformat().replace("+00:00", "Z")
    expires_str = expires_at.isoformat().replace("+00:00", "Z")
    credential_id = f"urn:uuid:{secrets.token_hex(16)}"
    access_token = secrets.token_urlsafe(32)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pairing_id, ci_hash, email, parent_wallet_address, expires_at, used_at
                FROM mobile_pairing_sessions
                WHERE token_hash = %s
                FOR UPDATE
                """,
                (_token_hash(request.pairing_token),),
            )
            pairing = cur.fetchone()
            if not pairing:
                raise HTTPException(status_code=404, detail="모바일 연결 QR이 유효하지 않습니다.")
            if pairing["used_at"] is not None:
                raise HTTPException(status_code=409, detail="이미 사용된 모바일 연결 QR입니다.")
            if now > pairing["expires_at"]:
                raise HTTPException(status_code=410, detail="모바일 연결 QR이 만료되었습니다.")

            cur.execute(
                """
                SELECT credentials.expires_at, revoked.wallet_address AS revoked_wallet
                FROM issued_vcs AS credentials
                LEFT JOIN revoked_vcs AS revoked
                  ON LOWER(revoked.wallet_address) = LOWER(credentials.wallet_address)
                WHERE credentials.ci_hash = %s
                  AND LOWER(credentials.wallet_address) = LOWER(%s)
                """,
                (pairing["ci_hash"], pairing["parent_wallet_address"]),
            )
            parent = cur.fetchone()
            parent_expiry = expiry_timestamp(parent["expires_at"]) if parent else None
            if not parent or parent["revoked_wallet"] or parent_expiry is None or parent_expiry <= now:
                raise HTTPException(status_code=403, detail="웹 DID/VC가 더 이상 유효하지 않습니다.")

            cur.execute(
                "SELECT ci_hash FROM mobile_credentials WHERE LOWER(wallet_address) = LOWER(%s)",
                (request.wallet_address,),
            )
            existing = cur.fetchone()
            if existing and existing["ci_hash"] != pairing["ci_hash"]:
                raise HTTPException(status_code=409, detail="이 모바일 Wallet은 다른 계정에 연결되어 있습니다.")

            subject_did = f"did:pknu:{request.wallet_address}"
            account_did = f"did:pknu:{pairing['parent_wallet_address']}"
            normalized_jwk = {
                "kty": "EC",
                "crv": "secp256k1",
                "x": request.holder_jwk["x"],
                "y": request.holder_jwk["y"],
            }
            credential_payload = {
                "iss": OID4VCI_ISSUER_BASE_URL,
                "sub": subject_did,
                "iat": int(issued_at.timestamp()),
                "nbf": int(issued_at.timestamp()),
                "exp": int(expires_at.timestamp()),
                "jti": credential_id,
                "cnf": {"jwk": normalized_jwk},
                "vc": {
                    "@context": ["https://www.w3.org/2018/credentials/v1"],
                    "id": credential_id,
                    "type": ["VerifiableCredential", "TicketProMobileCredential"],
                    "issuer": OID4VCI_ISSUER_BASE_URL,
                    "issuanceDate": issued_str,
                    "expirationDate": expires_str,
                    "credentialSubject": {
                        "id": subject_did,
                        "account": account_did,
                        "authorization": "mobile_login",
                    },
                },
            }
            credential_jwt = _sign_es256k_jwt(
                {"alg": "ES256K", "typ": "JWT", "kid": OID4VCI_ISSUER_KEY_ID},
                credential_payload,
            )

            cur.execute(
                """
                INSERT INTO mobile_credentials (
                    wallet_address, ci_hash, email, parent_wallet_address,
                    credential_id, credential_jwt, device_name, issued_at, expires_at,
                    revoked_at, revoked_reason
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NULL, NULL)
                ON CONFLICT (wallet_address) DO UPDATE SET
                    credential_id = EXCLUDED.credential_id,
                    credential_jwt = EXCLUDED.credential_jwt,
                    device_name = EXCLUDED.device_name,
                    issued_at = EXCLUDED.issued_at,
                    expires_at = EXCLUDED.expires_at,
                    revoked_at = NULL,
                    revoked_reason = NULL
                """,
                (
                    request.wallet_address,
                    pairing["ci_hash"],
                    pairing["email"],
                    pairing["parent_wallet_address"],
                    credential_id,
                    credential_jwt,
                    request.device_name.strip(),
                    issued_str,
                    expires_str,
                ),
            )
            cur.execute(
                """
                UPDATE mobile_pairing_sessions
                SET used_at = %s, mobile_wallet_address = %s
                WHERE pairing_id = %s AND used_at IS NULL
                RETURNING pairing_id
                """,
                (now, request.wallet_address, pairing["pairing_id"]),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=409, detail="모바일 연결 QR이 동시에 사용되었습니다.")
            cur.execute(
                """
                INSERT INTO user_login_sessions (
                    token_hash, email, wallet_address, subject_wallet_address,
                    issued_at, expires_at
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    _token_hash(access_token),
                    pairing["email"],
                    request.wallet_address,
                    pairing["parent_wallet_address"],
                    now,
                    now + LOGIN_SESSION_TTL,
                ),
            )
        conn.commit()

    _record_login_audit(
        request.wallet_address,
        "mobile_pairing",
        True,
        email=pairing["email"],
    )
    return {
        "status": "success",
        "message": "모바일 Wallet 연결과 로그인을 완료했습니다.",
        "wallet_address": request.wallet_address,
        "account_wallet_address": pairing["parent_wallet_address"],
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": LOGIN_SESSION_TTL,
        "credential": credential_jwt,
        "credential_id": credential_id,
        "credential_expires_at": int(expires_at.timestamp()),
        "issuer": OID4VCI_ISSUER_BASE_URL,
        "jwks_uri": f"{OID4VCI_ISSUER_BASE_URL}/.well-known/jwks.json",
    }

# ──────────────────────────────────────────────
# 7. API 엔드포인트
# ──────────────────────────────────────────────
@app.post(
    "/api/oid4vci/credential-offers",
    summary="OpenID4VCI Credential Offer 생성",
)
async def create_oid4vci_credential_offer(request: OID4VCIOfferRequest):
    email = _verify_email_code_for_oid4vci(request.email, request.code)
    now = time.time()
    offer_id = secrets.token_urlsafe(18)
    pre_authorized_code = secrets.token_urlsafe(32)
    tx_code = str(secrets.randbelow(1_000_000)).zfill(6)
    ci_hash = hashlib.sha256(f"{email}_{CI_SALT}".encode()).hexdigest()
    expires_at = now + OID4VCI_OFFER_TTL

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO oid4vci_credential_offers (
                    offer_id,
                    email,
                    ci_hash,
                    pre_authorized_code,
                    tx_code_hash,
                    credential_configuration_id,
                    created_at,
                    expires_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    offer_id,
                    email,
                    ci_hash,
                    pre_authorized_code,
                    _token_hash(tx_code),
                    OID4VCI_CREDENTIAL_CONFIGURATION_ID,
                    now,
                    expires_at,
                ),
            )
        conn.commit()

    if ENV == "production":
        try:
            _send_oid4vci_tx_code(email, tx_code)
        except Exception:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM oid4vci_credential_offers WHERE offer_id = %s",
                        (offer_id,),
                    )
                conn.commit()
            logger.exception("OpenID4VCI tx_code 메일 발송 실패")
            raise HTTPException(
                status_code=502,
                detail="Wallet 발급 코드 메일 전송에 실패했습니다. 다시 시도해주세요.",
            ) from None

    # 인증 코드는 Credential Offer 하나를 만드는 데 한 번만 사용한다.
    delete_session(email)

    result = {
        "status": "success",
        "offer_id": offer_id,
        "offer_uri": _build_credential_offer_uri(offer_id),
        "qr_png_url": f"{_build_credential_offer_url(offer_id)}/qr",
        "expires_in": OID4VCI_OFFER_TTL,
    }
    if ENV != "production":
        result["dev_tx_code"] = tx_code
    else:
        result["tx_code_delivery"] = "email"

    return JSONResponse(content=result, headers={"Cache-Control": "no-store"})

@app.get(
    "/oid4vci/credential-offer/{offer_id}",
    summary="OpenID4VCI Credential Offer 조회",
)
async def get_oid4vci_credential_offer(offer_id: str):
    offer = _get_active_oid4vci_offer(offer_id)
    credential_offer = {
        "credential_issuer": OID4VCI_ISSUER_BASE_URL,
        "credential_configuration_ids": [offer["credential_configuration_id"]],
        "grants": {
            "urn:ietf:params:oauth:grant-type:pre-authorized_code": {
                "pre-authorized_code": offer["pre_authorized_code"],
                "tx_code": {
                    "input_mode": "numeric",
                    "length": 6,
                    "description": "TicketPro에서 발급한 6자리 코드를 입력하세요.",
                },
            }
        },
    }
    return JSONResponse(
        content=credential_offer,
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )

@app.get(
    "/oid4vci/credential-offer/{offer_id}/qr",
    summary="OpenID4VCI Credential Offer QR",
)
async def get_oid4vci_credential_offer_qr(offer_id: str):
    _get_active_oid4vci_offer(offer_id)
    offer_uri = _build_credential_offer_uri(offer_id)

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(offer_uri)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="image/png",
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )

@app.post("/oid4vci/token", summary="OpenID4VCI Pre-Authorized Code Token 교환")
async def oid4vci_token(request: Request):
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if content_type != "application/x-www-form-urlencoded":
        return _oauth_error(
            "invalid_request",
            "Token Request는 application/x-www-form-urlencoded 형식이어야 합니다.",
        )

    try:
        form = parse_qs((await request.body()).decode("utf-8"), keep_blank_values=True)
        grant_type = form.get("grant_type", [""])[0]
        pre_authorized_code = form.get("pre-authorized_code", [""])[0]
        tx_code = form.get("tx_code", [""])[0]
    except Exception:
        return _oauth_error("invalid_request", "Token Request 본문을 해석할 수 없습니다.")

    if grant_type != OID4VCI_PRE_AUTHORIZED_GRANT_TYPE:
        return _oauth_error("unsupported_grant_type", "지원하지 않는 grant_type입니다.")
    if not pre_authorized_code or not tx_code:
        return _oauth_error(
            "invalid_request",
            "pre-authorized_code와 tx_code가 모두 필요합니다.",
        )

    now = time.time()
    access_token = secrets.token_urlsafe(32)
    credential_identifier = secrets.token_urlsafe(18)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    offer_id,
                    email,
                    ci_hash,
                    tx_code_hash,
                    credential_configuration_id,
                    expires_at,
                    used_at,
                    token_attempts
                FROM oid4vci_credential_offers
                WHERE pre_authorized_code = %s
                FOR UPDATE
                """,
                (pre_authorized_code,),
            )
            offer = cur.fetchone()

            if not offer or offer["used_at"] is not None or now > offer["expires_at"]:
                return _oauth_error(
                    "invalid_grant",
                    "Pre-Authorized Code가 유효하지 않거나 만료되었습니다.",
                )

            if offer["token_attempts"] >= MAX_ATTEMPTS:
                return _oauth_error(
                    "invalid_grant",
                    "tx_code 검증 시도 횟수를 초과했습니다.",
                )

            if not secrets.compare_digest(offer["tx_code_hash"], _token_hash(tx_code)):
                attempts = offer["token_attempts"] + 1
                cur.execute(
                    """
                    UPDATE oid4vci_credential_offers
                    SET token_attempts = %s,
                        used_at = CASE WHEN %s >= %s THEN %s ELSE used_at END
                    WHERE offer_id = %s
                    """,
                    (attempts, attempts, MAX_ATTEMPTS, now, offer["offer_id"]),
                )
                conn.commit()
                return _oauth_error("invalid_grant", "tx_code가 올바르지 않습니다.")

            cur.execute(
                """
                INSERT INTO oid4vci_access_tokens (
                    token_hash,
                    offer_id,
                    email,
                    ci_hash,
                    credential_configuration_id,
                    credential_identifier,
                    issued_at,
                    expires_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    _token_hash(access_token),
                    offer["offer_id"],
                    offer["email"],
                    offer["ci_hash"],
                    offer["credential_configuration_id"],
                    credential_identifier,
                    now,
                    now + OID4VCI_ACCESS_TOKEN_TTL,
                ),
            )
            cur.execute(
                "UPDATE oid4vci_credential_offers SET used_at = %s WHERE offer_id = %s",
                (now, offer["offer_id"]),
            )
        conn.commit()

    return JSONResponse(
        content={
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": OID4VCI_ACCESS_TOKEN_TTL,
            "authorization_details": [
                {
                    "type": "openid_credential",
                    "credential_configuration_id": offer["credential_configuration_id"],
                    "credential_identifiers": [credential_identifier],
                }
            ],
        },
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )

@app.post("/oid4vci/nonce", summary="OpenID4VCI c_nonce 발급")
async def oid4vci_nonce():
    nonce = secrets.token_urlsafe(24)
    now = time.time()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO oid4vci_nonces (nonce_hash, created_at, expires_at)
                VALUES (%s, %s, %s)
                """,
                (_token_hash(nonce), now, now + OID4VCI_NONCE_TTL),
            )
        conn.commit()
    return JSONResponse(
        content={"c_nonce": nonce},
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )

@app.post("/oid4vci/credential", summary="OpenID4VCI 학생 VC 발급")
async def oid4vci_credential(
    credential_request: OID4VCICredentialRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    access_token = _extract_bearer_token(request)
    if not access_token:
        return _oauth_error("invalid_token", "Bearer Access Token이 필요합니다.", 401)

    now = time.time()
    previous_wallet = None
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    email,
                    ci_hash,
                    credential_configuration_id,
                    credential_identifier,
                    expires_at,
                    used_at
                FROM oid4vci_access_tokens
                WHERE token_hash = %s
                """,
                (_token_hash(access_token),),
            )
            token_record = cur.fetchone()

    if (
        not token_record
        or token_record["used_at"] is not None
        or now > token_record["expires_at"]
    ):
        return _oauth_error("invalid_token", "Access Token이 유효하지 않거나 만료되었습니다.", 401)

    if credential_request.credential_configuration_id is not None:
        return _oauth_error(
            "invalid_credential_request",
            "Token Response가 credential_identifier를 제공했으므로 이를 사용해야 합니다.",
        )
    if credential_request.credential_identifier != token_record["credential_identifier"]:
        return _oauth_error(
            "invalid_credential_request",
            "credential_identifier가 Access Token의 발급 권한과 일치하지 않습니다.",
        )

    jwt_proofs = credential_request.proofs.get("jwt")
    if set(credential_request.proofs) != {"jwt"} or not isinstance(jwt_proofs, list):
        return _oauth_error("invalid_proof", "JWT proof가 필요합니다.")
    if len(jwt_proofs) != 1 or not isinstance(jwt_proofs[0], str):
        return _oauth_error("invalid_proof", "현재는 JWT proof 하나만 지원합니다.")

    try:
        proof = _verify_oid4vci_jwt_proof(jwt_proofs[0])
    except ValueError as exc:
        return _oauth_error("invalid_proof", str(exc))

    if not _consume_oid4vci_nonce(proof["nonce"]):
        return _oauth_error("invalid_proof", "c_nonce가 유효하지 않거나 이미 사용되었습니다.")

    holder_address = proof["public_key"].to_checksum_address()
    subject_did = f"did:pknu:{holder_address}"
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(days=365)
    issued_str = issued_at.isoformat().replace("+00:00", "Z")
    expires_str = expires_at.isoformat().replace("+00:00", "Z")
    credential_id = f"urn:uuid:{secrets.token_hex(16)}"

    vc_payload = {
        "iss": OID4VCI_ISSUER_BASE_URL,
        "sub": subject_did,
        "iat": int(issued_at.timestamp()),
        "nbf": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": credential_id,
        "cnf": {"jwk": proof["jwk"]},
        "vc": {
            "@context": ["https://www.w3.org/2018/credentials/v1"],
            "id": credential_id,
            "type": ["VerifiableCredential", "PukyongStudentCredential"],
            "issuer": OID4VCI_ISSUER_BASE_URL,
            "issuanceDate": issued_str,
            "expirationDate": expires_str,
            "credentialStatus": {
                "id": f"{OID4VCI_ISSUER_BASE_URL}/api/status/{holder_address}",
                "type": "TicketProCredentialStatus",
            },
            "credentialSubject": {
                "id": subject_did,
                "university": "부경대학교",
                "isStudent": True,
            },
        },
    }
    credential_jwt = _sign_es256k_jwt(
        {"alg": "ES256K", "typ": "JWT", "kid": OID4VCI_ISSUER_KEY_ID},
        vc_payload,
    )

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ci_hash
                FROM issued_vcs
                WHERE LOWER(wallet_address) = LOWER(%s) AND ci_hash != %s
                """,
                (holder_address, token_record["ci_hash"]),
            )
            if cur.fetchone():
                return _oauth_error(
                    "invalid_credential_request",
                    "이 Wallet 키는 다른 학생 계정에서 이미 사용 중입니다.",
                )

            cur.execute(
                "SELECT wallet_address FROM issued_vcs WHERE ci_hash = %s",
                (token_record["ci_hash"],),
            )
            previous = cur.fetchone()
            if previous and previous["wallet_address"].lower() != holder_address.lower():
                previous_wallet = previous["wallet_address"]
                cur.execute(
                    """
                    INSERT INTO revoked_vcs (wallet_address, revoked_at, reason)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (wallet_address) DO NOTHING
                    """,
                    (
                        previous_wallet,
                        issued_str,
                        "OpenID4VCI를 통한 새로운 Wallet 키로 재발급",
                    ),
                )
                if SYNC_MAIN_USERS:
                    cur.execute(
                        """
                        UPDATE users
                        SET verification_status = 'failed', status = 'restricted'
                        WHERE LOWER(wallet_address) = LOWER(%s)
                        """,
                        (previous_wallet,),
                    )
                cur.execute(
                    """
                    UPDATE user_login_sessions
                    SET revoked_at = %s
                    WHERE LOWER(wallet_address) = LOWER(%s) AND revoked_at IS NULL
                    """,
                    (now, previous_wallet),
                )

            cur.execute(
                """
                INSERT INTO issued_vcs (ci_hash, email, wallet_address, issued_at, expires_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (ci_hash) DO UPDATE SET
                    email = EXCLUDED.email,
                    wallet_address = EXCLUDED.wallet_address,
                    issued_at = EXCLUDED.issued_at,
                    expires_at = EXCLUDED.expires_at
                """,
                (
                    token_record["ci_hash"],
                    token_record["email"],
                    holder_address,
                    issued_str,
                    expires_str,
                ),
            )
            if SYNC_MAIN_USERS:
                cur.execute(
                    """
                    INSERT INTO users (wallet_address, auth_provider, verification_status)
                    VALUES (%s, 'did_keystore', 'verified')
                    ON CONFLICT (wallet_address) DO UPDATE SET
                        auth_provider = EXCLUDED.auth_provider,
                        verification_status = EXCLUDED.verification_status,
                        status = 'active'
                    """,
                    (holder_address,),
                )
            cur.execute(
                """
                UPDATE oid4vci_access_tokens
                SET used_at = %s
                WHERE token_hash = %s AND used_at IS NULL
                RETURNING token_hash
                """,
                (now, _token_hash(access_token)),
            )
            if not cur.fetchone():
                conn.rollback()
                return _oauth_error("invalid_token", "이미 사용된 Access Token입니다.", 401)
        conn.commit()

    if did_registry_contract:
        if previous_wallet:
            background_tasks.add_task(
                _send_did_onchain_transaction,
                did_registry_contract.functions.revokeCredential(
                    w3.to_checksum_address(previous_wallet),
                    "OpenID4VCI 재발급으로 인한 폐기",
                ),
            )
        background_tasks.add_task(
            _send_did_onchain_transaction,
            did_registry_contract.functions.issueCredential(
                w3.to_checksum_address(holder_address),
                int(expires_at.timestamp()),
            ),
        )

    return JSONResponse(
        content={"credentials": [{"credential": credential_jwt}]},
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )

@app.get(
    "/.well-known/oauth-authorization-server",
    summary="OpenID4VCI OAuth Authorization Server Metadata",
)
async def oid4vci_authorization_server_metadata():
    return {
        "issuer": OID4VCI_ISSUER_BASE_URL,
        "token_endpoint": f"{OID4VCI_ISSUER_BASE_URL}/oid4vci/token",
        "jwks_uri": f"{OID4VCI_ISSUER_BASE_URL}/.well-known/jwks.json",
        "grant_types_supported": [OID4VCI_PRE_AUTHORIZED_GRANT_TYPE],
        "token_endpoint_auth_methods_supported": ["none"],
        "pre-authorized_grant_anonymous_access_supported": True,
    }

@app.get(
    "/.well-known/openid-credential-issuer",
    summary="OpenID4VCI Credential Issuer Metadata",
)
async def oid4vci_issuer_metadata():
    return {
        "credential_issuer": OID4VCI_ISSUER_BASE_URL,
        "authorization_servers": [OID4VCI_ISSUER_BASE_URL],
        "credential_endpoint": f"{OID4VCI_ISSUER_BASE_URL}/oid4vci/credential",
        "nonce_endpoint": f"{OID4VCI_ISSUER_BASE_URL}/oid4vci/nonce",
        "display": [{"name": "TicketPro PKNU Issuer", "locale": "ko-KR"}],
        "credential_configurations_supported": {
            OID4VCI_CREDENTIAL_CONFIGURATION_ID: {
                "format": "jwt_vc_json",
                "cryptographic_binding_methods_supported": ["jwk"],
                "credential_signing_alg_values_supported": ["ES256K"],
                "proof_types_supported": {
                    "jwt": {
                        "proof_signing_alg_values_supported": ["ES256K"]
                    }
                },
                "credential_definition": {
                    "type": [
                        "VerifiableCredential",
                        "PukyongStudentCredential",
                    ],
                },
                "credential_metadata": {
                    "display": [
                        {"name": "부경대학교 학생 인증서", "locale": "ko-KR"}
                    ],
                    "claims": [
                        {
                            "path": ["credentialSubject", "university"],
                            "mandatory": True,
                            "display": [
                                {"name": "대학교", "locale": "ko-KR"}
                            ],
                        },
                        {
                            "path": ["credentialSubject", "isStudent"],
                            "mandatory": True,
                            "display": [
                                {"name": "학생 여부", "locale": "ko-KR"}
                            ],
                        },
                    ],
                },
            }
        },
    }


@app.get("/.well-known/jwks.json", summary="Issuer JWT 검증 공개키")
async def oid4vci_jwks():
    return {"keys": [_issuer_public_jwk()]}

@app.get("/api/issuer-info", summary="Issuer DID 공개 정보 조회")
async def get_issuer_info():
    return {
        "issuer_did": ISSUER_DID,
        "issuer_address": ISSUER_ADDRESS,
        "key_id": ISSUER_KEY_ID,
        "public_key_hex": ISSUER_PUBLIC_KEY_HEX,
    }

@app.get("/api/auth-challenge", summary="VP/Revoke 서명용 Nonce 발급")
async def get_auth_challenge():
    nonce = secrets.token_hex(16)
    expires_at = time.time() + NONCE_TTL
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO auth_nonces (nonce, expires_at) VALUES (%s, %s)", (nonce, expires_at))
        conn.commit()
    return {"nonce": nonce, "domain": EXPECTED_DOMAIN, "expires_in": NONCE_TTL}

@app.post("/api/login-challenge", summary="DID 키 파일 로그인용 일회성 Challenge 발급")
async def create_login_challenge(request: LoginChallengeRequest):
    now = time.time()
    nonce = secrets.token_hex(16)
    expires_at = now + LOGIN_NONCE_TTL
    message = json.dumps({
        "action": "ticketpro_login",
        "wallet_address": request.wallet_address,
        "nonce": nonce,
        "domain": EXPECTED_DOMAIN,
        "issued_at": int(now),
        "expires_at": int(expires_at),
    }, separators=(",", ":"), ensure_ascii=False)

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO login_nonces (nonce, wallet_address, message, expires_at) VALUES (%s, %s, %s, %s)",
                (nonce, request.wallet_address, message, expires_at)
            )
        conn.commit()

    return {
        "nonce": nonce,
        "message": message,
        "expires_in": LOGIN_NONCE_TTL,
    }

@app.post("/api/login-verify", summary="DID 키 파일 로그인 서명 검증 및 세션 발급")
async def verify_login_challenge(request: LoginVerifyRequest):
    now = time.time()
    try:
        _consume_login_challenge(request)
    except HTTPException as error:
        _record_login_audit(request.wallet_address, "login", False, str(error.detail))
        raise

    credential_failure = None
    email = None
    token = None
    account_wallet_address = request.wallet_address
    auth_provider = "did_keystore"
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT email, expires_at FROM issued_vcs WHERE wallet_address = %s",
                (request.wallet_address,)
            )
            issued_vc = cur.fetchone()
            if not issued_vc:
                cur.execute(
                    """
                    SELECT mobile.email, mobile.expires_at, mobile.revoked_at,
                           mobile.parent_wallet_address, parent.expires_at AS parent_expires_at,
                           parent_revoked.wallet_address AS parent_revoked_wallet
                    FROM mobile_credentials AS mobile
                    JOIN issued_vcs AS parent
                      ON parent.ci_hash = mobile.ci_hash
                     AND LOWER(parent.wallet_address) = LOWER(mobile.parent_wallet_address)
                    LEFT JOIN revoked_vcs AS parent_revoked
                      ON LOWER(parent_revoked.wallet_address) = LOWER(parent.wallet_address)
                    WHERE LOWER(mobile.wallet_address) = LOWER(%s)
                    """,
                    (request.wallet_address,),
                )
                mobile_vc = cur.fetchone()
                if not mobile_vc:
                    credential_failure = (
                        "등록되지 않은 DID",
                        "웹 계정에 연결된 모바일 Wallet이 아닙니다.",
                    )
                else:
                    issued_vc = mobile_vc
                    email = mobile_vc["email"]
                    account_wallet_address = mobile_vc["parent_wallet_address"]
                    auth_provider = "mobile_did"
                    parent_expiry = expiry_timestamp(mobile_vc["parent_expires_at"])
                    if mobile_vc["revoked_at"] is not None:
                        credential_failure = ("해제된 모바일 기기", "웹에서 연결 해제된 모바일 Wallet입니다.")
                    elif mobile_vc["parent_revoked_wallet"] is not None:
                        credential_failure = ("폐기된 웹 VC", "연결된 웹 DID/VC가 폐기되었습니다.")
                    elif parent_expiry is None or parent_expiry <= now:
                        credential_failure = ("만료된 웹 VC", "연결된 웹 DID/VC가 만료되었습니다.")
            else:
                email = issued_vc["email"]

            if issued_vc and not credential_failure:
                vc_expires_at = expiry_timestamp(issued_vc["expires_at"])
                if vc_expires_at is None or vc_expires_at <= now:
                    credential_failure = ("만료된 VC", "DID 인증서가 만료되었습니다.")

            if not credential_failure and auth_provider == "did_keystore":
                cur.execute(
                    "SELECT revoked_at FROM revoked_vcs WHERE LOWER(wallet_address) = LOWER(%s)",
                    (request.wallet_address,),
                )
                if cur.fetchone():
                    credential_failure = (
                        "폐기된 VC",
                        "폐기된 DID 키 파일입니다. 재발급을 진행해주세요.",
                    )

            if not credential_failure:
                if SYNC_MAIN_USERS and auth_provider == "did_keystore":
                    cur.execute(
                        """
                        INSERT INTO users (wallet_address, auth_provider, verification_status)
                        VALUES (%s, 'did_keystore', 'verified')
                        ON CONFLICT (wallet_address) DO UPDATE SET
                            auth_provider = EXCLUDED.auth_provider,
                            verification_status = EXCLUDED.verification_status,
                            status = 'active'
                        """,
                        (request.wallet_address,),
                    )

                token = secrets.token_urlsafe(32)
                session_expires_at = now + LOGIN_SESSION_TTL
                cur.execute(
                    """
                    INSERT INTO user_login_sessions (
                        token_hash, email, wallet_address, subject_wallet_address,
                        issued_at, expires_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        _token_hash(token),
                        email,
                        request.wallet_address,
                        account_wallet_address,
                        now,
                        session_expires_at,
                    ),
                )
        conn.commit()

    if credential_failure:
        _record_login_audit(
            request.wallet_address,
            "login",
            False,
            credential_failure[0],
            email=email,
        )
        raise HTTPException(status_code=403, detail=credential_failure[1])

    _record_login_audit(request.wallet_address, "login", True, email=email)
    return {
        "status": "success",
        "message": "DID 로그인 검증이 완료되었습니다.",
        "wallet_address": request.wallet_address,
        "account_wallet_address": account_wallet_address,
        "auth_provider": auth_provider,
        "access_token": token,
        "token_type": "bearer",
        "expires_in": LOGIN_SESSION_TTL,
    }

@app.post("/api/logout", summary="DID 로그인 세션 폐기")
async def logout(request: LogoutRequest):
    now = time.time()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE user_login_sessions
                SET revoked_at = %s
                WHERE token_hash = %s AND revoked_at IS NULL
                RETURNING email, wallet_address
                """,
                (now, _token_hash(request.access_token))
            )
            session = cur.fetchone()
        conn.commit()

    if session:
        _record_login_audit(session["wallet_address"], "logout", True, email=session["email"])
    return {"status": "success", "message": "로그아웃되었습니다."}
    
@app.get("/api/did/{address}", summary="DID Document Resolve")
async def resolve_did(address: str):
    if not is_checksum_address(address):
        raise HTTPException(status_code=400, detail="유효하지 않은 주소 형식입니다. EIP-55를 준수해주세요.")

    if address.lower() == ISSUER_ADDRESS.lower():
        return {
            "didDocument": _build_did_document(ISSUER_ADDRESS),
            "didDocumentMetadata": {"created": None, "updated": None, "deactivated": False}
        }

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT issued_at, expires_at FROM issued_vcs WHERE wallet_address = %s", (address,))
            row = cur.fetchone()
            cur.execute("SELECT revoked_at FROM revoked_vcs WHERE wallet_address = %s", (address,))
            revoked = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="등록되지 않은 DID입니다.")

    issued_at = row['issued_at']
    return {
        "didDocument": _build_did_document(address),
        "didDocumentMetadata": {"created": issued_at, "updated": issued_at, "deactivated": revoked is not None}
    }

@app.get("/api/status/{wallet_address}", summary="VC Revocation 상태 조회")
async def get_vc_status(wallet_address: str):
    if not ADDRESS.fullmatch(wallet_address):
        raise HTTPException(status_code=400, detail="유효하지 않은 지갑 주소입니다.")

    credential = inspect_credential(get_db_connection, wallet_address, time.time())
    status_by_reason = {
        "NOT_ISSUED": "not_issued",
        "REVOKED": "revoked",
        "EXPIRED": "expired",
        "ACTIVE": "active",
    }
    return {
        "status": status_by_reason[credential["reason_code"]],
        **(
            {"expires_at": credential["expires_at"]}
            if credential["valid"]
            else {
                key: credential[key]
                for key in ("revoked_at", "reason")
                if key in credential
            }
        ),
    }

@app.post("/api/request-email-auth", summary="1단계: 학교 이메일 인증번호 발송")
async def request_email_auth(request: EmailRequest):
    email = request.email.strip().lower()
    if not email.endswith("@pukyong.ac.kr"):
        raise HTTPException(status_code=400, detail="부경대학교 이메일(@pukyong.ac.kr)만 가능합니다.")

    ci_hash = hashlib.sha256(f"{email}_{CI_SALT}".encode()).hexdigest()
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT expires_at FROM issued_vcs WHERE ci_hash = %s", (ci_hash,))
            existing_vc = cur.fetchone()

    if existing_vc and not request.is_recovery:
        expires_at = datetime.fromisoformat(existing_vc['expires_at'].replace("Z", "+00:00"))
        if expires_at > datetime.now(timezone.utc) + timedelta(days=30):
            raise HTTPException(status_code=400, detail="이미 유효한 DID가 존재합니다. 키를 분실하신 경우 '재발급/복구' 옵션을 사용해주세요.")

    if request.is_recovery and not existing_vc:
        raise HTTPException(status_code=404, detail="복구할 기존 신원 인증 내역이 없습니다. 일반 발급을 이용해주세요.")

    remaining = is_on_cooldown(email)
    if remaining > 0:
        # 💡 메시지 개선: 잠금(10분)과 스팸방지(30초)를 아우르는 친절한 안내
        raise HTTPException(status_code=429, detail=f"요청이 제한되었습니다. {remaining}초 후에 다시 시도해주세요.")

    verification_code = str(secrets.randbelow(900000) + 100000)
    set_session(email, verification_code)

    sender_email = os.getenv("GMAIL_ID")
    sender_password = os.getenv("GMAIL_APP_PASSWORD")

    if not sender_email or not sender_password:
        if DEV_EMAIL_AUTH_BYPASS:
            return JSONResponse(
                content={
                    "status": "success",
                    "message": "개발 환경용 인증번호가 생성되었습니다.",
                    "dev_verification_code": verification_code,
                },
                headers={"Cache-Control": "no-store"},
            )
        delete_session(email)
        raise HTTPException(status_code=500, detail="메일 발송 설정이 없습니다.")

    mail_subject = "[TicketPro] 부경대학교 DID 신원 인증 (재발급/복구)" if request.is_recovery else "[TicketPro] 부경대학교 DID 신원 인증"

    msg = MIMEMultipart()
    msg["From"] = sender_email
    msg["To"] = email
    msg["Subject"] = mail_subject
    msg.attach(MIMEText(f"신원 인증번호: [{verification_code}]\n보안을 위해 3분 이내에 입력해 주세요.", "plain"))

    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=15) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(sender_email, sender_password)
            smtp.send_message(msg)
        return {"status": "success", "message": "인증 메일이 발송되었습니다. (3분 유효)"}
    except Exception:
        delete_session(email)
        raise HTTPException(status_code=500, detail="메일 발송에 실패했습니다.")

@app.post("/api/verify-email-auth", summary="2단계: 인증번호 확인 및 VC 발급")
async def verify_email_auth(request: VerifyRequest, background_tasks: BackgroundTasks):
    email = request.email.strip().lower()
    session = get_session(email)

    if not session:
        raise HTTPException(status_code=400, detail="인증 요청 내역이 없거나 만료되었습니다.")

    # 💡 이미 잠긴(LOCKED) 상태인지 체크하여 검증 자체를 차단
    if session['code'] == 'LOCKED':
        remaining = max(0, int(session['cooldown_until'] - time.time()))
        raise HTTPException(status_code=403, detail=f"인증이 차단된 상태입니다. {remaining}초 후에 새 인증번호를 발급받아주세요.")

    if not secrets.compare_digest(session['code'], request.code.strip()):
        attempts = increment_attempts(email)
        
        # 💡 5회 실패 시 삭제 대신 10분 잠금 처리 로직 적용
        if attempts >= MAX_ATTEMPTS:
            lock_time = time.time() + LOCKOUT_TTL
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    # 코드를 'LOCKED'로 바꾸고, 쿨다운과 만료시간을 모두 10분 뒤로 설정
                    cur.execute("""
                        UPDATE auth_sessions 
                        SET code = 'LOCKED', cooldown_until = %s, expires_at = %s 
                        WHERE email = %s
                    """, (lock_time, lock_time, email))
                conn.commit()
            raise HTTPException(status_code=403, detail="인증 번호 5회 오류로 인해 10분간 인증이 차단됩니다.")
            
        remaining = MAX_ATTEMPTS - attempts
        raise HTTPException(status_code=400, detail=f"인증 번호가 틀렸습니다. (남은 기회: {remaining}번)")

    ci_hash = hashlib.sha256(f"{email}_{CI_SALT}".encode()).hexdigest()

    try:
        # DB 작업
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT ci_hash FROM issued_vcs WHERE wallet_address = %s AND ci_hash != %s", (request.wallet_address, ci_hash))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="다른 계정에서 이미 사용 중인 지갑 주소입니다.")
                
                cur.execute("SELECT wallet_address FROM issued_vcs WHERE ci_hash = %s", (ci_hash,))
                old_record = cur.fetchone()
                
                if old_record and old_record['wallet_address'].lower() != request.wallet_address.lower():
                    old_wallet = old_record['wallet_address']
                    revoked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                    cur.execute(
                        "INSERT INTO revoked_vcs (wallet_address, revoked_at, reason) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                        (old_wallet, revoked_at, "새로운 VC 발급(갱신)으로 인한 자동 폐기")
                    )
                    if SYNC_MAIN_USERS:
                        cur.execute(
                            "UPDATE users SET verification_status = 'failed', status = 'restricted' WHERE LOWER(wallet_address) = LOWER(%s)",
                            (old_wallet,)
                        )
                    cur.execute(
                        "UPDATE user_login_sessions SET revoked_at = %s WHERE LOWER(wallet_address) = LOWER(%s) AND revoked_at IS NULL",
                        (time.time(), old_wallet)
                    )
                    if did_registry_contract:
                        old_holder_checksum = w3.to_checksum_address(old_wallet)
                        background_tasks.add_task(
                            _send_did_onchain_transaction,
                            did_registry_contract.functions.revokeCredential(old_holder_checksum, "키 분실 및 재발급으로 인한 폐기")
                        )

                now = datetime.now(timezone.utc)
                issued_str = now.isoformat().replace("+00:00", "Z")
                expires_str = (now + timedelta(days=365)).isoformat().replace("+00:00", "Z")

                cur.execute("""
                    INSERT INTO issued_vcs (ci_hash, email, wallet_address, issued_at, expires_at)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT(ci_hash) DO UPDATE SET
                        email          = EXCLUDED.email,
                        wallet_address = EXCLUDED.wallet_address,
                        issued_at      = EXCLUDED.issued_at,
                        expires_at     = EXCLUDED.expires_at
                """, (ci_hash, email, request.wallet_address, issued_str, expires_str))
                if SYNC_MAIN_USERS:
                    cur.execute(
                        """
                        INSERT INTO users (wallet_address, auth_provider, verification_status)
                        VALUES (%s, 'did_keystore', 'verified')
                        ON CONFLICT (wallet_address) DO UPDATE SET
                            auth_provider = EXCLUDED.auth_provider,
                            verification_status = EXCLUDED.verification_status,
                            status = 'active'
                        """,
                        (request.wallet_address,)
                    )
            conn.commit()
            
        delete_session(email)

        # 신규 온체인 기록을 BackgroundTask로 전송
        if did_registry_contract:
            expires_timestamp = int((now + timedelta(days=365)).timestamp())
            holder_checksum = w3.to_checksum_address(request.wallet_address)
            background_tasks.add_task(
                _send_did_onchain_transaction,
                did_registry_contract.functions.issueCredential(holder_checksum, expires_timestamp)
            )

        # VC 생성
        subject_did = f"did:pknu:{request.wallet_address}"
        vc_payload = {
            "@context": ["https://www.w3.org/2018/credentials/v1", "https://w3id.org/security/suites/secp256k1recovery-2020/v2"],
            "type": ["VerifiableCredential", "PukyongStudentCredential"],
            "issuer": ISSUER_DID,
            "issuanceDate": issued_str,
            "expirationDate": expires_str,
            "credentialStatus": {
                "id": f"{AUTH_PUBLIC_BASE_URL}/api/status/{request.wallet_address}",
                "type": "TicketProCredentialStatus",
            },
            "credentialSubject": {"id": subject_did, "university": "부경대학교", "isStudent": True}
        }

        signature_hex = _eth_sign_vc(vc_payload)
        vc_payload["proof"] = {
            "type": "EcdsaSecp256k1RecoverySignature2020",
            "created": issued_str,
            "verificationMethod": ISSUER_KEY_ID,
            "proofPurpose": "assertionMethod",
            "proofValue": signature_hex
        }

        return {
            "status": "success",
            "message": "부경대 학생 인증 및 VC 발급이 완료되었습니다.",
            "verifiable_credential": vc_payload
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("이메일 인증 기반 VC 발급 실패")
        raise HTTPException(status_code=500, detail="VC 발급 처리에 실패했습니다.") from None

@app.post("/api/revoke-vc", summary="VC 폐기 (Revocation)")
async def revoke_vc(request: RevokeRequest, background_tasks: BackgroundTasks):
    payload_to_sign = {
        "action": "revoke_vc",
        "wallet_address": request.wallet_address,
        "reason": request.reason,
        "nonce": request.nonce,
    }

    if not _eth_verify_signature(payload_to_sign, request.signature, request.wallet_address):
        raise HTTPException(status_code=401, detail="권한 없음: 본인의 지갑으로 서명된 요청만 폐기 가능합니다.")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT expires_at FROM auth_nonces WHERE nonce = %s", (request.nonce,))
                nonce_row = cur.fetchone()
                if not nonce_row or time.time() > nonce_row['expires_at']:
                    raise HTTPException(status_code=400, detail="유효하지 않거나 만료된 Nonce입니다.")

                cur.execute("SELECT wallet_address FROM issued_vcs WHERE wallet_address = %s", (request.wallet_address,))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="등록된 VC가 없습니다.")

                cur.execute("SELECT wallet_address FROM revoked_vcs WHERE wallet_address = %s", (request.wallet_address,))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="이미 폐기된 VC입니다.")

                revoked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

                cur.execute("DELETE FROM auth_nonces WHERE nonce = %s", (request.nonce,))
                cur.execute("INSERT INTO revoked_vcs (wallet_address, revoked_at, reason) VALUES (%s, %s, %s)", (request.wallet_address, revoked_at, request.reason))
                if SYNC_MAIN_USERS:
                    cur.execute(
                        "UPDATE users SET verification_status = 'failed', status = 'restricted' WHERE LOWER(wallet_address) = LOWER(%s)",
                        (request.wallet_address,)
                    )
                cur.execute(
                    "UPDATE user_login_sessions SET revoked_at = %s WHERE LOWER(wallet_address) = LOWER(%s) AND revoked_at IS NULL",
                    (time.time(), request.wallet_address)
                )
            conn.commit()

        if did_registry_contract:
            holder_checksum = w3.to_checksum_address(request.wallet_address)
            background_tasks.add_task(
                _send_did_onchain_transaction,
                did_registry_contract.functions.revokeCredential(holder_checksum, request.reason)
            )

        return {"status": "success", "message": "VC가 폐기되었습니다.", "revoked_at": revoked_at}

    except HTTPException:
        raise
    except Exception:
        logger.exception("VC 폐기 실패")
        raise HTTPException(status_code=500, detail="VC 폐기 처리에 실패했습니다.") from None

@app.post("/api/verify-vp", summary="VP(Verifiable Presentation) 검증")
async def verify_vp(request: VPVerifyRequest):
    vp = copy.deepcopy(request.verifiable_presentation)
    errors = []

    try:
        holder_did = vp.get("holder", "")
        holder_address = holder_did.replace("did:pknu:", "")
        if not is_checksum_address(holder_address):
            raise HTTPException(status_code=400, detail="유효하지 않은 Holder 주소입니다. EIP-55 체크섬 형식이어야 합니다.")

        vp_proof = vp.pop("proof", None)
        if not vp_proof:
            raise HTTPException(status_code=400, detail="VP 자체에 대한 Holder의 서명(proof)이 없습니다.")
        
        domain = vp_proof.get("domain")
        if domain != EXPECTED_DOMAIN:
            errors.append(f"VP 도메인이 일치하지 않습니다. (기대값: {EXPECTED_DOMAIN}, 실제값: {domain})")

        nonce = vp_proof.get("challenge")
        if not nonce:
            errors.append("VP 서명에 challenge(nonce)가 없습니다.")
        else:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT expires_at FROM auth_nonces WHERE nonce = %s", (nonce,))
                    nonce_row = cur.fetchone()
                    if not nonce_row or time.time() > nonce_row['expires_at']:
                        errors.append("유효하지 않거나 만료된 Nonce입니다. 재전송 공격이 의심됩니다.")

        if errors:
            return {"valid": False, "errors": errors}

        if not _eth_verify_signature(vp, vp_proof.get("proofValue", ""), holder_address):
            errors.append("VP 서명(Holder) 검증에 실패했습니다. 타인의 VC를 도용했을 수 있습니다.")

        if "verifiableCredential" not in vp or not vp["verifiableCredential"]:
            raise HTTPException(status_code=400, detail="VP에 VC가 없습니다.")

        vc = vp["verifiableCredential"][0]
        vc_subject = vc.get("credentialSubject", {}).get("id", "")
        if vc_subject != holder_did:
            errors.append("VC의 소유자(Subject)와 VP의 제출자(Holder)가 일치하지 않습니다. 도용이 의심됩니다.")

        vc_proof = vc.pop("proof", None)
        if not vc_proof:
            raise HTTPException(status_code=400, detail="VC에 proof가 없습니다.")

        expires_at = vc.get("expirationDate")
        if expires_at:
            exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > exp:
                errors.append("VC가 만료되었습니다.")

        if not _eth_verify_signature(vc, vc_proof.get("proofValue", ""), ISSUER_ADDRESS):
            errors.append("VC 서명(Issuer) 검증에 실패했습니다.")

        wallet_address = vc_subject.replace("did:pknu:", "")
        credential_state = inspect_credential(
            get_db_connection,
            wallet_address,
            time.time(),
        )
        if credential_state["reason_code"] == "NOT_ISSUED":
            errors.append("발급 기록이 없는 VC입니다.")
        elif credential_state["reason_code"] == "REVOKED":
            errors.append("폐기된 VC입니다.")
        elif credential_state["reason_code"] == "EXPIRED":
            errors.append("서버 발급 기록상 만료된 VC입니다.")

        if errors:
            return {"valid": False, "errors": errors}

        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM auth_nonces
                    WHERE nonce = %s AND expires_at >= %s
                    RETURNING nonce
                    """,
                    (nonce, time.time()),
                )
                consumed_nonce = cur.fetchone()
            conn.commit()

        if not consumed_nonce:
            return {
                "valid": False,
                "errors": ["Nonce가 이미 사용되었거나 만료되었습니다."],
            }

        return {
            "valid": True,
            "subject": vc.get("credentialSubject"),
            "issuer": vc.get("issuer"),
            "expires": expires_at,
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("VP 검증 실패")
        raise HTTPException(status_code=500, detail="VP 검증 처리에 실패했습니다.") from None
