import os
import json
import hashlib
import time
import secrets
import smtplib
import copy
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Union, Optional, List, Dict

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import is_checksum_address
from eth_keys import keys
from dotenv import load_dotenv

from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

import psycopg
from psycopg.rows import dict_row

load_dotenv()

# ──────────────────────────────────────────────
# 1. 환경 변수 로드 및 Web3 설정
# ──────────────────────────────────────────────
RPC_URL = os.getenv("RPC_URL", "https://polygon-rpc.com")
w3 = Web3(Web3.HTTPProvider(RPC_URL))
w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("❌ .env에 DATABASE_URL(PostgreSQL 주소)이 없습니다.")

DID_CONTRACT_ADDRESS = os.getenv("DID_CONTRACT_ADDRESS")
DID_CONTRACT_ABI = None
try:
    with open("DID_ABI.json", "r", encoding="utf-8") as f:
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
ENV = os.getenv("ENV", "development")

if not ISSUER_KEY:
    if ENV == "production":
        raise RuntimeError("❌ 운영 환경에서는 ISSUER_PRIVATE_KEY가 반드시 .env에 고정되어야 합니다.")
    issuer_account = Account.create()
    ISSUER_KEY = issuer_account.key.hex()
    print(f"⚠️ 개발 환경: 임시 Issuer 키 생성됨 → {ISSUER_KEY}")
else:
    issuer_account = Account.from_key(ISSUER_KEY)

ISSUER_ADDRESS = issuer_account.address
ISSUER_DID     = f"did:pknu:{ISSUER_ADDRESS}"
ISSUER_KEY_ID  = f"{ISSUER_DID}#keys-1"
EXPECTED_DOMAIN = os.getenv("DOMAIN", "ticketpro.pknu.ac.kr")

_pk_bytes         = bytes.fromhex(ISSUER_KEY.replace("0x", ""))
_issuer_priv_key  = keys.PrivateKey(_pk_bytes)
ISSUER_PUBLIC_KEY_HEX = _issuer_priv_key.public_key.to_hex()

SERVER_BASE_URL = os.getenv("SERVER_BASE_URL", "http://localhost:8001")

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
                cur.execute("ALTER TABLE issued_vcs ADD COLUMN IF NOT EXISTS email TEXT")
                cur.execute("ALTER TABLE user_login_sessions ADD COLUMN IF NOT EXISTS email TEXT")
                cur.execute("ALTER TABLE login_audit_logs ADD COLUMN IF NOT EXISTS email TEXT")
            conn.commit()
        print("✅ DID 레지스트리 PostgreSQL DB 초기화 완료")
    except Exception as e:
        print(f"❌ DB 초기화 실패: {e}")

init_db()

def cleanup_sessions():
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM auth_sessions WHERE expires_at < %s", (time.time(),))
            cur.execute("DELETE FROM auth_nonces WHERE expires_at < %s", (time.time(),))
            cur.execute("DELETE FROM login_nonces WHERE expires_at < %s", (time.time(),))
            cur.execute("DELETE FROM user_login_sessions WHERE expires_at < %s", (time.time(),))
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
            'chainId': 137, 
            'gas': 150000,
            'maxFeePerGas': int(w3.eth.gas_price * 1.5), 
            'maxPriorityFeePerGas': w3.to_wei('35', 'gwei'),
            'nonce': nonce,
        })
        signed_tx = w3.eth.account.sign_transaction(tx, private_key=ISSUER_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
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
            "blockchainAccountId": f"eip155:137:{address}"
        }],
        "authentication": [key_id],
        "assertionMethod": [key_id],
    }

# ──────────────────────────────────────────────
# 6. FastAPI 앱 및 라우터 설정
# ──────────────────────────────────────────────
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")

app = FastAPI(title="PKNU DID Issuer Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def on_startup():
    cleanup_sessions()
    print("✅ 만료 세션 및 Nonce 정리 완료")

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

# ──────────────────────────────────────────────
# 7. API 엔드포인트
# ──────────────────────────────────────────────
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

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT wallet_address, message, expires_at, used_at FROM login_nonces WHERE nonce = %s FOR UPDATE",
                (request.nonce,)
            )
            challenge = cur.fetchone()

            if not challenge:
                failure = ("존재하지 않는 Challenge", "로그인 Challenge가 유효하지 않습니다.")
            elif challenge["used_at"] is not None or now > challenge["expires_at"]:
                failure = ("사용되었거나 만료된 Challenge", "로그인 Challenge가 사용되었거나 만료되었습니다.")
            elif challenge["wallet_address"].lower() != request.wallet_address.lower() or challenge["message"] != request.message:
                failure = ("Challenge 변조", "로그인 Challenge 정보가 일치하지 않습니다.")
            else:
                failure = None

            if not failure:
                cur.execute("UPDATE login_nonces SET used_at = %s WHERE nonce = %s", (now, request.nonce))
        conn.commit()

    if failure:
        _record_login_audit(request.wallet_address, "login", False, failure[0])
        raise HTTPException(status_code=401, detail=failure[1])

    try:
        recovered_address = Account.recover_message(
            encode_defunct(text=request.message),
            signature=request.signature
        )
    except Exception:
        _record_login_audit(request.wallet_address, "login", False, "서명 해석 실패")
        raise HTTPException(status_code=401, detail="로그인 서명을 확인할 수 없습니다.")

    if recovered_address.lower() != request.wallet_address.lower():
        _record_login_audit(request.wallet_address, "login", False, "서명 불일치")
        raise HTTPException(status_code=401, detail="로그인 서명이 지갑 주소와 일치하지 않습니다.")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT email, expires_at FROM issued_vcs WHERE wallet_address = %s",
                (request.wallet_address,)
            )
            issued_vc = cur.fetchone()
            if not issued_vc:
                _record_login_audit(request.wallet_address, "login", False, "등록되지 않은 DID")
                raise HTTPException(status_code=403, detail="부경대학교 인증을 거쳐 발급된 DID가 아닙니다.")
            email = issued_vc["email"]

            vc_expires_at = datetime.fromisoformat(issued_vc["expires_at"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > vc_expires_at:
                _record_login_audit(request.wallet_address, "login", False, "만료된 VC", email=email)
                raise HTTPException(status_code=403, detail="DID 인증서가 만료되었습니다.")

            cur.execute("SELECT revoked_at FROM revoked_vcs WHERE wallet_address = %s", (request.wallet_address,))
            if cur.fetchone():
                _record_login_audit(request.wallet_address, "login", False, "폐기된 VC", email=email)
                raise HTTPException(status_code=403, detail="폐기된 DID 키 파일입니다. 재발급을 진행해주세요.")

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

            token = secrets.token_urlsafe(32)
            session_expires_at = now + LOGIN_SESSION_TTL
            cur.execute(
                """
                INSERT INTO user_login_sessions (token_hash, email, wallet_address, issued_at, expires_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (_token_hash(token), email, request.wallet_address, now, session_expires_at)
            )
        conn.commit()

    _record_login_audit(request.wallet_address, "login", True, email=email)
    return {
        "status": "success",
        "message": "DID 로그인 검증이 완료되었습니다.",
        "wallet_address": request.wallet_address,
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
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT revoked_at, reason FROM revoked_vcs WHERE wallet_address = %s", (wallet_address,))
            row = cur.fetchone()
    if row:
        return {"status": "revoked", "revoked_at": row['revoked_at'], "reason": row['reason']}
    return {"status": "active"}

@app.post("/api/request-email-auth", summary="1단계: 학교 이메일 인증번호 발송")
async def request_email_auth(request: EmailRequest):
    email = request.email
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
        delete_session(email)
        raise HTTPException(status_code=500, detail="메일 발송 설정이 없습니다.")

    mail_subject = "[TicketPro] 부경대학교 DID 신원 인증 (재발급/복구)" if request.is_recovery else "[TicketPro] 부경대학교 DID 신원 인증"

    msg = MIMEMultipart()
    msg["From"] = sender_email
    msg["To"] = email
    msg["Subject"] = mail_subject
    msg.attach(MIMEText(f"신원 인증번호: [{verification_code}]\n보안을 위해 3분 이내에 입력해 주세요.", "plain"))

    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as smtp:
            smtp.starttls()
            smtp.login(sender_email, sender_password)
            smtp.send_message(msg)
        return {"status": "success", "message": "인증 메일이 발송되었습니다. (3분 유효)"}
    except Exception:
        delete_session(email)
        raise HTTPException(status_code=500, detail="메일 발송에 실패했습니다.")

@app.post("/api/verify-email-auth", summary="2단계: 인증번호 확인 및 VC 발급")
async def verify_email_auth(request: VerifyRequest, background_tasks: BackgroundTasks):
    email = request.email
    session = get_session(email)

    if not session:
        raise HTTPException(status_code=400, detail="인증 요청 내역이 없거나 만료되었습니다.")

    # 💡 이미 잠긴(LOCKED) 상태인지 체크하여 검증 자체를 차단
    if session['code'] == 'LOCKED':
        remaining = max(0, int(session['cooldown_until'] - time.time()))
        raise HTTPException(status_code=403, detail=f"인증이 차단된 상태입니다. {remaining}초 후에 새 인증번호를 발급받아주세요.")

    if session['code'] != request.code:
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
            "credentialStatus": {"id": f"{SERVER_BASE_URL}/api/status/{request.wallet_address}", "type": "StatusList2021Entry"},
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
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"서버 내부 에러: {e}")

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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"서버 내부 에러: {e}")

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
                    else:
                        cur.execute("DELETE FROM auth_nonces WHERE nonce = %s", (nonce,))
                conn.commit()

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
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT revoked_at FROM revoked_vcs WHERE wallet_address = %s", (wallet_address,))
                revoked = cur.fetchone()

        if revoked:
            errors.append(f"VC가 폐기되었습니다. (폐기일: {revoked['revoked_at']})")

        if errors:
            return {"valid": False, "errors": errors}

        return {
            "valid": True,
            "subject": vc.get("credentialSubject"),
            "issuer": vc.get("issuer"),
            "expires": expires_at,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"검증 중 오류: {e}")
