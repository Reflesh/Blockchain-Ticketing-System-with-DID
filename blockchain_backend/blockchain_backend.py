from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from web3 import Web3
from web3.exceptions import ContractLogicError
from web3.middleware import ExtraDataToPOAMiddleware
import os
import json
import sqlite3
import requests
from dotenv import load_dotenv

# =================================================================
# 1. 환경 변수 및 Web3 초기 세팅
# =================================================================
load_dotenv()
RPC_URL = os.getenv("RPC_URL")
PRIVATE_KEY = os.getenv("PRIVATE_KEY")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS")
PORTONE_API_KEY = os.getenv("PORTONE_API_KEY")
PORTONE_API_SECRET = os.getenv("PORTONE_API_SECRET")

if not RPC_URL or not PRIVATE_KEY or not CONTRACT_ADDRESS:
    raise Exception("❌ .env 파일에서 정보를 불러오지 못했습니다. 변수명이나 파일 위치를 확인하세요.")

web3 = Web3(Web3.HTTPProvider(RPC_URL))
web3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

if not web3.is_connected():
    raise Exception("❌ 블록체인 네트워크에 연결할 수 없습니다. RPC_URL을 확인하세요.")

server_account = web3.eth.account.from_key(PRIVATE_KEY)
print(f"✅ 서버 지갑 연결 완료: {server_account.address}")

try:
    with open("TicketABI.json", "r", encoding="utf-8") as f:
        CONTRACT_ABI = json.load(f)
except FileNotFoundError:
    raise Exception("❌ TicketABI.json 파일을 찾을 수 없습니다.")

contract = web3.eth.contract(address=web3.to_checksum_address(CONTRACT_ADDRESS), abi=CONTRACT_ABI)

# =================================================================
# 2. SQLite 데이터베이스 초기화
# =================================================================
def init_db():
    conn = sqlite3.connect("ticket_database.db")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            wallet_address TEXT NOT NULL,
            private_key TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()
    print("✅ 데이터베이스(SQLite) 초기화 완료!")

init_db()

# =================================================================
# 3. FastAPI 앱 생성 및 설정
# =================================================================
app = FastAPI(title="Polygon Ticket Booking API")

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

class TicketRequest(BaseModel):
    username: str              # 지갑 주소 대신 사용자의 아이디만 받습니다!
    companions: list[str]      

# =================================================================
# 5. API 엔드포인트
# =================================================================
class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/api/login", summary="사용자 로그인")
async def login_api(request: LoginRequest):
    conn = sqlite3.connect("ticket_database.db")
    cursor = conn.cursor()

    try:
        # DB에서 아이디와 비밀번호가 모두 일치하는 정보를 찾습니다.
        cursor.execute(
            "SELECT wallet_address FROM users WHERE username = ? AND password = ?",
            (request.username, request.password)
        )
        result = cursor.fetchone()

        if result:
            print(f"🔓 로그인 성공: {request.username}")
            return {
                "status": "success",
                "message": "로그인에 성공했습니다.",
                "username": request.username,
                "wallet_address": result[0]
            }
        else:
            # 아이디가 없거나 비밀번호가 틀린 경우 (보안상 뭉뚱그려 알려주는 것이 좋습니다)
            raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")

    except HTTPException:
        raise
    except Exception as e:
        print(f"로그인 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="서버 내부 에러 발생")
    finally:
        conn.close()


# 🟢 [복구됨] 회원가입 및 지갑 자동 생성 API
@app.post("/api/signup", summary="회원가입 및 지갑 자동 생성")
async def signup_api(request: SignUpRequest):
    conn = sqlite3.connect("ticket_database.db")
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT * FROM users WHERE username = ?", (request.username,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="이미 존재하는 아이디입니다.")

        new_account = web3.eth.account.create()
        new_wallet_address = new_account.address
        new_private_key = new_account.key.hex()

        cursor.execute(
            "INSERT INTO users (username, password, wallet_address, private_key) VALUES (?, ?, ?, ?)",
            (request.username, request.password, new_wallet_address, new_private_key)
        )
        conn.commit()

        print(f"🎉 신규 가입: {request.username} (지갑: {new_wallet_address})")

        return {
            "status": "success",
            "message": "회원가입 완료 및 지갑이 안전하게 생성되었습니다.",
            "username": request.username,
            "wallet_address": new_wallet_address
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"회원가입 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="서버 내부 에러 발생")
    finally:
        conn.close()

# 본인인증 검증용 API
class VerifyRequest(BaseModel):
    imp_uid: str

@app.post("/api/verify-user", summary="포트원 본인인증 정보 검증 및 식별값 추출")
async def verify_user_api(request: VerifyRequest):
    try:
        # 1. 포트원 인증 토큰 발급
        token_res = requests.post(
            "https://api.iamport.kr/users/getToken",
            json={
                "imp_key": PORTONE_API_KEY,
                "imp_secret": PORTONE_API_SECRET
            }
        )
        token_data = token_res.json()
        
        if token_data["code"] != 0:
            raise HTTPException(status_code=401, detail="포트원 토큰 발급 실패")
            
        access_token = token_data["response"]["access_token"]

        # 2. imp_uid로 상세 인증 정보 조회
        cert_res = requests.get(
            f"https://api.iamport.kr/certifications/{request.imp_uid}",
            headers={"Authorization": access_token}
        )
        cert_data = cert_res.json()

        if cert_data["code"] != 0:
            raise HTTPException(status_code=400, detail="유효하지 않은 인증 정보입니다.")

        user_info = cert_data["response"]
        
        # 3. 필요한 핵심 데이터 추출
        real_name = user_info.get("name")
        unique_key = user_info.get("unique_key") # CI (연계정보)
        unique_in_site = user_info.get("unique_in_site") # DI (중복가입확인정보)

        print(f"본인인증 완료: 이름={real_name}, CI={unique_key}")

        return {
            "status": "success",
            "message": "인증 정보가 확인되었습니다.",
            "data": {
                "name": real_name,
                "ci": unique_key,
                "di": unique_in_site
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"인증 검증 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="서버 내부 에러 발생")

        
class VerifyRequest(BaseModel):
    imp_uid: str

@app.post("/api/verify-user", summary="포트원 본인인증 정보 검증 및 식별값 추출")
async def verify_user_api(request: VerifyRequest):
    try:
        # 1. 포트원 토큰 발급
        token_res = requests.post(
            "https://api.iamport.kr/users/getToken",
            json={
                "imp_key": PORTONE_API_KEY,
                "imp_secret": PORTONE_API_SECRET
            }
        )
        token_data = token_res.json()
        
        if token_data["code"] != 0:
            raise HTTPException(status_code=401, detail="포트원 토큰 발급 실패")
            
        access_token = token_data["response"]["access_token"]

        # 2. 상세 인증 정보 조회
        cert_res = requests.get(
            f"https://api.iamport.kr/certifications/{request.imp_uid}",
            headers={"Authorization": access_token}
        )
        cert_data = cert_res.json()

        if cert_data["code"] != 0:
            raise HTTPException(status_code=400, detail="유효하지 않은 인증 정보입니다.")

        user_info = cert_data["response"]
        
        # 3. 핵심 식별 데이터 추출
        real_name = user_info.get("name")
        unique_key = user_info.get("unique_key") # CI
        unique_in_site = user_info.get("unique_in_site") # DI

        print(f"✅ 포트원 본인인증 완료: 이름={real_name}, CI={unique_key}")

        # ⚠️ 동료 작업 영역: 이 응답값을 프론트가 받아서 패스키/지갑 매핑을 수행합니다.
        return {
            "status": "success",
            "message": "인증 정보가 확인되었습니다.",
            "data": {
                "name": real_name,
                "ci": unique_key,  
                "di": unique_in_site
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"인증 검증 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="서버 내부 에러 발생")


# 🔵 예매 API (DB 연동 버전)
@app.post("/api/buy-tickets", summary="스마트 티켓 예매 (가스비 대납)")
async def buy_tickets_api(request: TicketRequest):
    conn = sqlite3.connect("ticket_database.db")
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT wallet_address FROM users WHERE username = ?", (request.username,))
        result = cursor.fetchone()
        
        if not result:
            raise HTTPException(status_code=404, detail="가입되지 않은 사용자입니다. 먼저 회원가입을 진행해주세요.")
        
        buyer_address = result[0]
        print(f"🔍 DB 조회 성공: {request.username}님의 지갑 주소는 {buyer_address} 입니다.")

        if not web3.is_address(buyer_address):
            raise HTTPException(status_code=400, detail="DB에 저장된 주소가 유효하지 않습니다.")
        for comp in request.companions:
            if not web3.is_address(comp):
                raise HTTPException(status_code=400, detail=f"유효하지 않은 동반인 주소입니다: {comp}")

        total_tickets = len(request.companions) + 1
        nonce = web3.eth.get_transaction_count(server_account.address, 'pending')
        
        print(f"🚀 [{request.username}] 님의 예매 진행 중... (총 {total_tickets}장)")

        txn = contract.functions.buyTicketsFor(
            web3.to_checksum_address(buyer_address),
            [web3.to_checksum_address(c) for c in request.companions]
        ).build_transaction({
            'chainId': 137,                        
            'gas': 500000,                        
            'gasPrice': int(web3.eth.gas_price * 1.5),        
            'nonce': nonce
        })

        signed_txn = web3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
        tx_hash = web3.eth.send_raw_transaction(signed_txn.raw_transaction)
        tx_hash_hex = web3.to_hex(tx_hash)
        
        print(f"⏳ 트랜잭션 전송 완료! Hash: {tx_hash_hex}")

        tx_receipt = web3.eth.wait_for_transaction_receipt(tx_hash)

        if tx_receipt.status == 1:
            return {
                "status": "success",
                "message": f"성공적으로 {total_tickets}장의 티켓이 예매되었습니다.",
                "transaction_hash": tx_hash_hex,
                "buyer_wallet": buyer_address 
            }
        else:
            raise HTTPException(status_code=500, detail="블록체인 트랜잭션이 실패(Revert)했습니다.")

    except ContractLogicError as e:
        raise HTTPException(status_code=400, detail=f"스마트 컨트랙트 거부: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        print(f"서버 에러: {str(e)}")
        raise HTTPException(status_code=500, detail=f"서버 내부 에러: {str(e)}")
    finally:
        conn.close()