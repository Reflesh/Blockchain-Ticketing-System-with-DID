from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
from web3 import Web3
from web3.exceptions import ContractLogicError
from web3.middleware import ExtraDataToPOAMiddleware
from psycopg.rows import dict_row
from eth_account.messages import encode_defunct
import asyncio
import hashlib
import hmac
import json
import os
import psycopg
import requests
import time
import uuid
import base64
from datetime import datetime, timezone
from dotenv import load_dotenv
try:
    from .auth_s2s import ADDRESS, AuthGateway, AuthServiceUnavailable, SessionIdentity
    from .auth_routes import install_gateway_routes
except ImportError:
    from auth_s2s import ADDRESS, AuthGateway, AuthServiceUnavailable, SessionIdentity
    from auth_routes import install_gateway_routes

# =================================================================
# 1. 환경 변수 및 Web3 초기 세팅
# =================================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(BASE_DIR, ".env")

if not os.path.exists(ENV_PATH):
    raise Exception("❌ blockchain_backend/.env 파일을 찾을 수 없습니다.")

load_dotenv(ENV_PATH)

# 기존 세션/VC SQL 검증을 기본값으로 유지하고 배포 설정으로 내부 API에 전환한다.
AUTH_VALIDATION_MODE = os.getenv("AUTH_VALIDATION_MODE", "db").strip().lower()
if AUTH_VALIDATION_MODE not in {"db", "internal"}:
    raise RuntimeError("AUTH_VALIDATION_MODE는 db 또는 internal이어야 합니다.")
AUTH_GATEWAY = AuthGateway.from_env()
if AUTH_VALIDATION_MODE == "internal" and not AUTH_GATEWAY.base_url:
    raise RuntimeError("internal 모드에서는 AUTH_INTERNAL_BASE_URL과 AUTH_SERVICE_KEY가 필요합니다.")
RPC_URL = os.getenv("RPC_URL")
PRIVATE_KEY = os.getenv("TICKET_PRIVATE_KEY", os.getenv("PRIVATE_KEY"))
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS")
PORTONE_API_KEY = os.getenv("PORTONE_API_KEY")       # V1 하위호환용 (본인인증에 사용)
PORTONE_API_SECRET = os.getenv("PORTONE_API_SECRET") # V1 하위호환용 (본인인증에 사용)
PORTONE_V2_SECRET = os.getenv("PORTONE_V2_SECRET")   # V2 결제 검증용 시크릿 키
DATABASE_URL = os.getenv("DATABASE_URL")
ADMIN_TOKEN_SECRET = os.getenv("ADMIN_TOKEN_SECRET")
ADMIN_TOKEN_TTL_SECONDS = int(os.getenv("ADMIN_TOKEN_TTL_SECONDS", "7200"))

if not RPC_URL or not PRIVATE_KEY or not CONTRACT_ADDRESS:
    raise Exception("❌ .env 파일에서 블록체인 정보를 불러오지 못했습니다. 변수명이나 파일 위치를 확인하세요.")

if not DATABASE_URL:
    raise Exception("❌ .env 파일에서 DATABASE_URL을 불러오지 못했습니다. RDS PostgreSQL 연결 정보를 확인하세요.")

if not ADMIN_TOKEN_SECRET:
    raise Exception("❌ .env 파일에서 ADMIN_TOKEN_SECRET을 불러오지 못했습니다. 관리자 토큰 서명 키를 확인하세요.")

web3 = Web3(Web3.HTTPProvider(RPC_URL))
web3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

if not web3.is_connected():
    raise Exception("❌ 블록체인 네트워크에 연결할 수 없습니다. RPC_URL을 확인하세요.")

server_account = web3.eth.account.from_key(PRIVATE_KEY)
print(f"✅ 서버 지갑 연결 완료: {server_account.address}")

try:
    with open(os.path.join(BASE_DIR, "TicketABI.json"), "r", encoding="utf-8") as f:
        CONTRACT_ABI = json.load(f)
except FileNotFoundError:
    raise Exception("❌ TicketABI.json 파일을 찾을 수 없습니다.")

contract = web3.eth.contract(address=web3.to_checksum_address(CONTRACT_ADDRESS), abi=CONTRACT_ABI)

# =================================================================
# 2. PostgreSQL(RDS) 연결 확인 및 변환 헬퍼
# =================================================================
def get_db_connection():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)

def init_db():
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1")
                required_tables = [
                    "users",
                    "identity_verifications",
                    "events",
                    "event_sessions",
                    "seats",
                    "wishlist",
                    "admins",
                    "admin_logs",
                    "bookings",
                    "booking_items",
                    "payments",
                    "blockchain_transactions",
                    "ticket_qr_challenges",
                ]
                if AUTH_VALIDATION_MODE == "db":
                    required_tables.extend(["issued_vcs", "revoked_vcs", "user_login_sessions"])
                cursor.execute(
                    """
                    SELECT table_name
                    FROM unnest(%s::text[]) AS required(table_name)
                    WHERE to_regclass('public.' || table_name) IS NULL
                    """,
                    (required_tables,)
                )
                missing_tables = [row["table_name"] for row in cursor.fetchall()]
                if missing_tables:
                    raise Exception(f"필수 테이블이 없습니다: {', '.join(missing_tables)}")

                required_admin_log_columns = [
                    "admin_id",
                    "action",
                    "target_table",
                    "target_id",
                    "before_data",
                    "after_data",
                    "ip_address",
                    "user_agent",
                ]
                cursor.execute(
                    """
                    SELECT column_name
                    FROM unnest(%s::text[]) AS required(column_name)
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'admin_logs'
                          AND column_name = required.column_name
                    )
                    """,
                    (required_admin_log_columns,)
                )
                missing_columns = [row["column_name"] for row in cursor.fetchall()]
                if missing_columns:
                    raise Exception(f"admin_logs 필수 컬럼이 없습니다: {', '.join(missing_columns)}")

        print("✅ 데이터베이스(PostgreSQL/RDS) 연결 확인 완료!")
    except Exception as e:
        raise Exception(f"❌ 데이터베이스(PostgreSQL/RDS)에 연결할 수 없습니다: {str(e)}")

init_db()

def format_price_display(price_display, price_amount):
    if price_display:
        return price_display
    amount = int(price_amount or 0)
    return "무료" if amount == 0 else f"{amount:,}"

def parse_price_input(price):
    price_str = price.replace(",", "").replace("원", "").strip()
    if price_str == "무료":
        return 0, "무료"
    price_amount = int(price_str)
    return price_amount, f"{price_amount:,}"

EVENT_STATUSES = {"draft", "active", "paused", "ended", "hidden"}
SESSION_STATUSES = {"ready", "open", "sold_out", "paused", "closed"}
SEAT_STATUSES = {"available", "holding", "booked", "locked", "invited", "disabled"}
EVENT_LOG_COLUMNS = """
    id, title, venue, display_time_text, period_text, start_at, end_at,
    age_rating, price_amount, price_display, poster_url, category,
    display_order, is_featured, status
"""
SESSION_LOG_COLUMNS = """
    id, event_id, session_name, session_start_at, session_end_at,
    booking_open_at, booking_close_at, sale_status
"""
SEAT_LOG_COLUMNS = """
    id, event_session_id, seat_code, section_name, row_label,
    seat_number, grade, price_amount, status
"""

def validate_choice(value, allowed_values, label):
    if value not in allowed_values:
        raise HTTPException(status_code=400, detail=f"{label}이 올바르지 않습니다.")

def blank_to_none(value):
    if isinstance(value, str) and not value.strip():
        return None
    return value

def to_jsonb_param(value):
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, default=str)

def get_request_ip(request: Request):
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else None

def log_admin_action(cursor, admin, action, target_table, target_id, before_data=None, after_data=None, request: Optional[Request] = None):
    ip_address = get_request_ip(request) if request else None
    user_agent = request.headers.get("user-agent") if request else None
    cursor.execute(
        """
        INSERT INTO admin_logs (
            admin_id, action, target_table, target_id, before_data, after_data, ip_address, user_agent
        ) VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
        """,
        (
            admin["id"],
            action,
            target_table,
            str(target_id) if target_id is not None else None,
            to_jsonb_param(before_data),
            to_jsonb_param(after_data),
            ip_address,
            user_agent,
        )
    )

def fetch_one_or_404(cursor, query, params, detail):
    cursor.execute(query, params)
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=detail)
    return row

def count_rows(cursor, query, params):
    cursor.execute(query, params)
    return cursor.fetchone()["count"]

def next_table_id(cursor, table_name):
    cursor.execute(f"SELECT COALESCE(MAX(id), 0) + 1 AS id FROM {table_name}")
    return cursor.fetchone()["id"]

def get_log_snapshot(cursor, table_name, columns, row_id):
    cursor.execute(f"SELECT {columns} FROM {table_name} WHERE id = %s", (row_id,))
    return cursor.fetchone()

def get_required_log_snapshot(cursor, table_name, columns, row_id, detail):
    row = get_log_snapshot(cursor, table_name, columns, row_id)
    if not row:
        raise HTTPException(status_code=404, detail=detail)
    return row

def get_event_log_snapshot(cursor, event_id):
    return get_log_snapshot(cursor, "events", EVENT_LOG_COLUMNS, event_id)

def get_session_log_snapshot(cursor, session_id):
    return get_log_snapshot(cursor, "event_sessions", SESSION_LOG_COLUMNS, session_id)

def get_seat_log_snapshot(cursor, seat_id):
    return get_log_snapshot(cursor, "seats", SEAT_LOG_COLUMNS, seat_id)

def get_required_event_snapshot(cursor, event_id):
    return get_required_log_snapshot(cursor, "events", EVENT_LOG_COLUMNS, event_id, "해당 공연을 찾을 수 없습니다.")

def get_required_session_snapshot(cursor, session_id):
    return get_required_log_snapshot(cursor, "event_sessions", SESSION_LOG_COLUMNS, session_id, "해당 회차를 찾을 수 없습니다.")

def get_required_seat_snapshot(cursor, seat_id):
    return get_required_log_snapshot(cursor, "seats", SEAT_LOG_COLUMNS, seat_id, "해당 좌석을 찾을 수 없습니다.")

def format_session_response(session):
    return {
        "id": session["id"],
        "event_id": session["event_id"],
        "session_name": session["session_name"],
        "session_start_at": session["session_start_at"].isoformat() if session["session_start_at"] else None,
        "session_end_at": session["session_end_at"].isoformat() if session["session_end_at"] else None,
        "sale_status": session["sale_status"],
    }

def encode_token_part(value):
    raw = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")

def decode_token_part(value):
    padded = value + ("=" * (-len(value) % 4))
    return json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))

def sign_admin_payload(payload_part):
    return hmac.new(
        ADMIN_TOKEN_SECRET.encode("utf-8"),
        payload_part.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

def hash_user_session_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def require_user_identity(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="DID 로그인 세션 토큰이 필요합니다.")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="DID 로그인 세션 토큰이 필요합니다.")

    if AUTH_VALIDATION_MODE == "internal":
        try:
            identity = AUTH_GATEWAY.session_identity(token)
        except AuthServiceUnavailable:
            raise HTTPException(status_code=503, detail="인증 서비스를 일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해주세요.") from None
        if identity is None:
            raise HTTPException(status_code=401, detail="DID 로그인 세션이 만료되었거나 유효하지 않습니다.")
        return identity

    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT COALESCE(s.subject_wallet_address, s.wallet_address) AS account_wallet_address,
                       s.wallet_address AS signer_wallet_address,
                       principal.expires_at AS vc_expires_at,
                       mobile.expires_at AS mobile_expires_at
                FROM user_login_sessions s
                LEFT JOIN issued_vcs direct
                  ON LOWER(direct.wallet_address) = LOWER(s.wallet_address)
                LEFT JOIN mobile_credentials mobile
                  ON LOWER(mobile.wallet_address) = LOWER(s.wallet_address)
                JOIN issued_vcs principal
                  ON LOWER(principal.wallet_address) = LOWER(COALESCE(s.subject_wallet_address, s.wallet_address))
                LEFT JOIN revoked_vcs r
                  ON LOWER(r.wallet_address) = LOWER(principal.wallet_address)
                WHERE s.token_hash = %s
                  AND s.expires_at > %s
                  AND s.revoked_at IS NULL
                  AND r.wallet_address IS NULL
                  AND (direct.wallet_address IS NOT NULL OR
                       (mobile.wallet_address IS NOT NULL AND mobile.revoked_at IS NULL))
                """,
                (hash_user_session_token(token), time.time())
            )
            session = cursor.fetchone()

    if not session:
        raise HTTPException(status_code=401, detail="DID 로그인 세션이 만료되었거나 유효하지 않습니다.")
    try:
        vc_expires_at = datetime.fromisoformat(session["vc_expires_at"].replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        raise HTTPException(status_code=401, detail="DID 인증서 만료 정보를 확인할 수 없습니다.")
    if datetime.now(timezone.utc) > vc_expires_at:
        raise HTTPException(status_code=401, detail="DID 인증서가 만료되었습니다.")
    if session.get("mobile_expires_at"):
        try:
            mobile_expires_at = datetime.fromisoformat(session["mobile_expires_at"].replace("Z", "+00:00"))
        except (AttributeError, ValueError):
            raise HTTPException(status_code=401, detail="모바일 인증서 만료 정보를 확인할 수 없습니다.")
        if datetime.now(timezone.utc) > mobile_expires_at:
            raise HTTPException(status_code=401, detail="모바일 인증서가 만료되었습니다.")
    account_address = session["account_wallet_address"]
    signer_address = session["signer_wallet_address"]
    if not ADDRESS.fullmatch(account_address or "") or not ADDRESS.fullmatch(signer_address or ""):
        raise HTTPException(status_code=401, detail="로그인 세션의 지갑 주소를 확인할 수 없습니다.")
    return SessionIdentity(account_address, signer_address)

def require_user_session(authorization: Optional[str] = Header(default=None)):
    """기존 API 호환을 위해 부모 계정 Wallet 주소만 반환한다."""
    return require_user_identity(authorization).account_wallet_address

def require_matching_wallet(session_wallet, requested_wallet):
    if session_wallet.lower() != requested_wallet.lower():
        raise HTTPException(status_code=403, detail="로그인한 지갑과 요청한 지갑 주소가 일치하지 않습니다.")

async def require_active_vc_holder(cursor, wallet_address, label="사용자"):
    if AUTH_VALIDATION_MODE == "internal":
        try:
            valid = await asyncio.to_thread(AUTH_GATEWAY.credential_valid, wallet_address)
        except AuthServiceUnavailable:
            raise HTTPException(status_code=503, detail="인증 서비스를 일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해주세요.") from None
        if not valid:
            raise HTTPException(status_code=403, detail=f"{label}은(는) 유효한 VC 보유자가 아닙니다.")
        return

    cursor.execute(
        """
        SELECT v.expires_at
        FROM issued_vcs v
        LEFT JOIN revoked_vcs r ON LOWER(r.wallet_address) = LOWER(v.wallet_address)
        WHERE LOWER(v.wallet_address) = LOWER(%s)
          AND r.wallet_address IS NULL
        """,
        (wallet_address,)
    )
    vc = cursor.fetchone()
    if not vc:
        raise HTTPException(status_code=403, detail=f"{label}은(는) 유효한 VC 보유자가 아닙니다.")

    try:
        vc_expires_at = datetime.fromisoformat(vc["expires_at"].replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        raise HTTPException(status_code=403, detail=f"{label}의 VC 만료 정보를 확인할 수 없습니다.")

    if datetime.now(timezone.utc) > vc_expires_at:
        raise HTTPException(status_code=403, detail=f"{label}의 VC가 만료되었습니다.")

def create_admin_token(admin):
    payload = {
        "admin_id": admin["id"],
        "login_id": admin["login_id"],
        "role": admin["role"],
        "exp": int(time.time()) + ADMIN_TOKEN_TTL_SECONDS,
    }
    payload_part = encode_token_part(payload)
    return f"{payload_part}.{sign_admin_payload(payload_part)}"

def require_admin(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="관리자 인증 토큰이 필요합니다.")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload_part, signature = token.split(".", 1)
    except ValueError:
        raise HTTPException(status_code=401, detail="관리자 인증 토큰 형식이 올바르지 않습니다.")

    expected_signature = sign_admin_payload(payload_part)
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=401, detail="관리자 인증 토큰이 유효하지 않습니다.")

    try:
        payload = decode_token_part(payload_part)
    except Exception:
        raise HTTPException(status_code=401, detail="관리자 인증 토큰을 해석할 수 없습니다.")

    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=401, detail="관리자 인증 토큰이 만료되었습니다.")

    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, login_id, display_name, role
                FROM admins
                WHERE id = %s AND login_id = %s AND status = 'active'
                """,
                (payload.get("admin_id"), payload.get("login_id"))
            )
            admin = cursor.fetchone()

    if not admin:
        raise HTTPException(status_code=401, detail="관리자 계정이 유효하지 않습니다.")

    return admin

def event_to_ticket(row):
    return {
        "id": row["id"],
        "name": row["title"],
        "time": row["display_time_text"],
        "location": row["venue"],
        "image": row["poster_url"],
        "period": row["period_text"],
        "age": row["age_rating"],
        "price": format_price_display(row.get("price_display"), row.get("price_amount")),
        "price_amount": int(row.get("price_amount") or 0),
        "status": row.get("status"),
        "category": row.get("category"),
    }

def seat_to_dict(row):
    return {
        "id": row["id"],
        "event_session_id": row["event_session_id"],
        "seat_code": row["seat_code"],
        "section_name": row["section_name"],
        "row_label": row["row_label"],
        "seat_number": row["seat_number"],
        "grade": row["grade"],
        "price_amount": int(row["price_amount"] or 0),
        "status": row["status"],
    }

def hash_identifier(value):
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def make_booking_no():
    return f"BK-{uuid.uuid4().hex[:12].upper()}"

def resolve_user(cursor, username_or_wallet):
    cursor.execute(
        """
        SELECT id, username, wallet_address
        FROM users
        WHERE username = %s OR wallet_address = %s
        """,
        (username_or_wallet, username_or_wallet)
    )
    result = cursor.fetchone()
    if result:
        return result

    if web3.is_address(username_or_wallet):
        cursor.execute(
            """
            INSERT INTO users (wallet_address, auth_provider, verification_status)
            VALUES (%s, 'did_keystore', 'verified')
            ON CONFLICT (wallet_address) DO UPDATE SET
                wallet_address = EXCLUDED.wallet_address,
                auth_provider = EXCLUDED.auth_provider,
                verification_status = EXCLUDED.verification_status
            RETURNING id, username, wallet_address
            """,
            (username_or_wallet,)
        )
        return cursor.fetchone()

    raise HTTPException(status_code=404, detail="가입되지 않은 사용자입니다. 먼저 회원가입을 진행해주세요.")

# --- 포트원 V2 액세스 토큰 발급 헬퍼 ---
def get_portone_v2_access_token():
    try:
        res = requests.post(
            "https://api.portone.io/login/api-secret",
            json={"apiSecret": PORTONE_V2_SECRET},
            timeout=5
        )
        data = res.json()
        access_token = data.get("accessToken")
        if not access_token:
            raise Exception(data.get("message", "V2 토큰 발급 실패"))
        return access_token
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"포트원 V2 통신 오류: {str(e)}")

# --- 포트원 V2 결제 조회 헬퍼 ---
def get_portone_v2_payment(payment_id: str):
    try:
        access_token = get_portone_v2_access_token()
        res = requests.get(
            f"https://api.portone.io/payments/{payment_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10
        )
        data = res.json()
        if res.status_code != 200:
            raise Exception(data.get("message", "결제 조회 실패"))
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"결제 내역을 조회할 수 없습니다: {str(e)}")

# --- 포트원 V2 결제 취소(환불) 헬퍼 ---
def cancel_portone_v2_payment(payment_id: str, reason: str, amount: int):
    try:
        access_token = get_portone_v2_access_token()
        res = requests.post(
            f"https://api.portone.io/payments/{payment_id}/cancel",
            headers={"Authorization": f"Bearer {access_token}"},
            json={
                "reason": reason,
                "amount": amount,
            },
            timeout=10
        )
        data = res.json()
        if res.status_code != 200:
            print(f"🚨 V2 환불 실패 API 응답: {data}")
            return False
        return True
    except Exception as e:
        print(f"🚨 V2 환불 요청 중 예외 발생: {str(e)}")
        return False

# --- 포트원 V1 통합 토큰 발급 헬퍼 (본인인증 전용으로 유지) ---
def get_portone_v1_access_token():
    try:
        res = requests.post(
            "https://api.iamport.kr/users/getToken",
            json={"imp_key": PORTONE_API_KEY, "imp_secret": PORTONE_API_SECRET},
            timeout=5
        )
        data = res.json()
        if data.get("code") != 0:
            raise Exception(data.get("message", "토큰 발급 실패"))
        return data["response"]["access_token"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"포트원 통신 오류: {str(e)}")
    
# =================================================================
# 3. FastAPI 앱 생성 및 설정
# =================================================================
app = FastAPI(title="Polygon Ticket Booking API")
install_gateway_routes(app, AUTH_GATEWAY)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =================================================================
# 4. 데이터 모델 (Pydantic)
# =================================================================
class SignUpRequest(BaseModel):
    username: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class VerifyRequest(BaseModel):
    imp_uid: str
    wallet_address: Optional[str] = None

class WishlistRequest(BaseModel):
    wallet_address: str
    event_id: int

class UserProfileData(BaseModel):
    wallet_address: str
    display_name: str
    auth_provider: str
    verification_status: str

class UserProfileResponse(BaseModel):
    status: str
    data: UserProfileData

class TicketRequest(BaseModel):
    username: Optional[str] = None
    wallet_address: str
    event_id: int
    event_session_id: int
    seat_ids: list[int]
    companions: list[str] = Field(default_factory=list)
    payment_id: str
    signature: str

class TransferRequest(BaseModel):
    wallet_address: str
    booking_item_id: int
    companion_username: str
    signature: str

class AdminLoginRequest(BaseModel):
    login_id: str
    password: str

class EventUpdateRequest(BaseModel):
    name: str
    location: str
    price: str
    status: str

class EventCreateRequest(EventUpdateRequest):
    time: str
    period: str
    start_at: str
    end_at: Optional[str] = None
    age: Optional[str] = "전체관람가"
    image: Optional[str] = ""
    category: Optional[str] = "concert"
    session_name: Optional[str] = "1회차"
    session_end_at: Optional[str] = None
    seat_count: int = Field(default=20, ge=0, le=200)

class SessionCreateRequest(BaseModel):
    session_name: str
    session_start_at: str
    session_end_at: Optional[str] = None
    sale_status: str = "open"

class SessionUpdateRequest(SessionCreateRequest):
    pass

class SeatBulkCreateRequest(BaseModel):
    row_label: str = "A"
    start_number: int = Field(default=1, ge=1)
    seat_count: int = Field(default=20, ge=1, le=500)
    section_name: str = "STANDARD"
    grade: str = "일반석"
    price_amount: int = Field(default=0, ge=0)

class SeatUpdateRequest(BaseModel):
    seat_code: str
    section_name: str = "STANDARD"
    row_label: Optional[str] = None
    seat_number: Optional[str] = None
    grade: Optional[str] = None
    price_amount: int = Field(default=0, ge=0)
    status: str = "available"

# =================================================================
# 5. API 엔드포인트
# =================================================================
def install_api_routes():
    """분리된 API 모듈을 불러와 현재 FastAPI app에 라우트를 등록한다."""
    if __name__ == "__main__":
        import sys
        sys.modules.setdefault("blockchain_backend", sys.modules[__name__])
    try:
        from . import blockchain_backend_api
        from .ticket_qr import install_ticket_qr_routes
    except ImportError:
        import blockchain_backend_api
        from ticket_qr import install_ticket_qr_routes
    install_ticket_qr_routes(app, get_db_connection, require_user_identity)
    return blockchain_backend_api


API_ROUTES = install_api_routes()
