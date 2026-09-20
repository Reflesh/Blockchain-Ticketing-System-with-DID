from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
from eth_account.messages import encode_defunct
from fastapi import Depends, HTTPException, Path, Request, Response
from pydantic import BaseModel, Field


QR_FORMAT_VERSION = 1
QR_CHALLENGE_TTL_SECONDS = 20
QR_CHALLENGE_MIN_INTERVAL_SECONDS = 2
QR_SIGNING_DOMAIN = "ticketpro"
QR_SIGNING_PURPOSE = "ticket_entry"
MAX_TOKEN_ID = (10 ** 78) - 1
MAX_QR_DATA_LENGTH = 4096

WALLET_ADDRESS = re.compile(r"^0x[0-9a-f]{40}$")
NONCE = re.compile(r"^[A-Za-z0-9_-]{43}$")
ETHEREUM_SIGNATURE = re.compile(r"^0x[0-9A-Fa-f]{130}$")

logger = logging.getLogger(__name__)


class TicketCheckinRequest(BaseModel):
    qr_data: str = Field(min_length=1, max_length=MAX_QR_DATA_LENGTH)


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _base64url_decode(value: str) -> bytes:
    try:
        decoded = base64.b64decode(
            value.replace("-", "+").replace("_", "/") + "=" * (-len(value) % 4),
            validate=True,
        )
    except (binascii.Error, ValueError) as exc:
        raise ValueError("QR nonce 형식이 올바르지 않습니다.") from exc
    if len(decoded) != 32:
        raise ValueError("QR nonce 길이가 올바르지 않습니다.")
    return decoded


def build_ticket_qr_signing_message(payload: dict) -> str:
    """모바일과 검증 서버가 동일하게 사용할 canonical JSON 문자열을 만든다."""
    expected_fields = {
        "v",
        "domain",
        "purpose",
        "challenge_id",
        "token_id",
        "nonce",
        "issued_at",
        "expires_at",
        "account",
        "signer",
    }
    if set(payload) != expected_fields:
        raise ValueError("QR 서명 payload 필드가 올바르지 않습니다.")
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def create_ticket_qr_payload(identity, token_id: int, now: datetime | None = None):
    issued_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    issued_at = issued_at.replace(microsecond=0)
    expires_at = issued_at + timedelta(seconds=QR_CHALLENGE_TTL_SECONDS)
    nonce_bytes = secrets.token_bytes(32)
    challenge_id = uuid.uuid4()
    payload = {
        "v": QR_FORMAT_VERSION,
        "domain": QR_SIGNING_DOMAIN,
        "purpose": QR_SIGNING_PURPOSE,
        "challenge_id": str(challenge_id),
        "token_id": str(token_id),
        "nonce": _base64url_encode(nonce_bytes),
        "issued_at": int(issued_at.timestamp()),
        "expires_at": int(expires_at.timestamp()),
        "account": identity.account_wallet_address.lower(),
        "signer": identity.signer_wallet_address.lower(),
    }
    return {
        "challenge_id": challenge_id,
        "issued_at": issued_at,
        "expires_at": expires_at,
        "nonce_hash": hashlib.sha256(nonce_bytes).hexdigest(),
        "payload": payload,
        "signing_message": build_ticket_qr_signing_message(payload),
    }


def parse_ticket_qr_data(raw_qr_data: str) -> dict:
    """QR을 엄격히 파싱한다. 알 수 없는 필드와 느슨한 타입 변환은 허용하지 않는다."""
    if len(raw_qr_data.encode("utf-8")) > MAX_QR_DATA_LENGTH:
        raise ValueError("QR 데이터가 너무 큽니다.")
    try:
        envelope = json.loads(raw_qr_data)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ValueError("TicketPro 티켓 QR 형식이 아닙니다.") from exc
    if not isinstance(envelope, dict) or set(envelope) != {"payload", "signature"}:
        raise ValueError("QR envelope 필드가 올바르지 않습니다.")

    payload = envelope["payload"]
    signature = envelope["signature"]
    if not isinstance(payload, dict):
        raise ValueError("QR payload 형식이 올바르지 않습니다.")
    signing_message = build_ticket_qr_signing_message(payload)

    if type(payload["v"]) is not int or payload["v"] != QR_FORMAT_VERSION:
        raise ValueError("지원하지 않는 QR 버전입니다.")
    if payload["domain"] != QR_SIGNING_DOMAIN or payload["purpose"] != QR_SIGNING_PURPOSE:
        raise ValueError("다른 서비스 또는 용도의 QR입니다.")
    if type(payload["issued_at"]) is not int or type(payload["expires_at"]) is not int:
        raise ValueError("QR 유효시간 형식이 올바르지 않습니다.")
    lifetime = payload["expires_at"] - payload["issued_at"]
    if lifetime <= 0 or lifetime > QR_CHALLENGE_TTL_SECONDS:
        raise ValueError("QR 유효시간 범위가 올바르지 않습니다.")

    try:
        challenge_id = uuid.UUID(payload["challenge_id"], version=4)
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError("QR challenge ID 형식이 올바르지 않습니다.") from exc
    if str(challenge_id) != payload["challenge_id"]:
        raise ValueError("QR challenge ID가 canonical 형식이 아닙니다.")

    token_text = payload["token_id"]
    if not isinstance(token_text, str) or not token_text.isascii() or not token_text.isdigit():
        raise ValueError("티켓 토큰 ID 형식이 올바르지 않습니다.")
    token_id = int(token_text)
    if token_id < 1 or token_id > MAX_TOKEN_ID or str(token_id) != token_text:
        raise ValueError("티켓 토큰 ID 범위가 올바르지 않습니다.")

    if not isinstance(payload["nonce"], str) or not NONCE.fullmatch(payload["nonce"]):
        raise ValueError("QR nonce 형식이 올바르지 않습니다.")
    nonce_bytes = _base64url_decode(payload["nonce"])
    if not isinstance(payload["account"], str) or not WALLET_ADDRESS.fullmatch(payload["account"]):
        raise ValueError("티켓 계정 Wallet 주소 형식이 올바르지 않습니다.")
    if not isinstance(payload["signer"], str) or not WALLET_ADDRESS.fullmatch(payload["signer"]):
        raise ValueError("QR 서명 Wallet 주소 형식이 올바르지 않습니다.")
    if not isinstance(signature, str) or not ETHEREUM_SIGNATURE.fullmatch(signature):
        raise ValueError("QR Wallet 서명 형식이 올바르지 않습니다.")
    return {
        "payload": payload,
        "signature": signature,
        "signing_message": signing_message,
        "challenge_id": challenge_id,
        "token_id": token_id,
        "nonce_hash": hashlib.sha256(nonce_bytes).hexdigest(),
    }


def _same_address(left: str | None, right: str | None) -> bool:
    return bool(left and right and hmac.compare_digest(left.lower(), right.lower()))


def install_ticket_qr_routes(
    app,
    connection_factory,
    identity_dependency,
    admin_dependency,
    admin_logger,
    web3_client,
    ticket_contract,
):
    """서버 발급 QR과 원자적 입장 검증 경로를 등록한다."""
    if getattr(app.state, "ticket_qr_routes_installed", False):
        return
    app.state.ticket_qr_routes_installed = True

    @app.post("/api/tickets/{token_id}/qr-challenge", summary="사용자 티켓 QR challenge 발급")
    async def issue_ticket_qr_challenge(
        response: Response,
        token_id: int = Path(..., ge=1, le=MAX_TOKEN_ID),
        identity=Depends(identity_dependency),
    ):
        response.headers["Cache-Control"] = "no-store"
        challenge = create_ticket_qr_payload(identity, token_id)
        try:
            with connection_factory() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT bi.id, bi.owner_wallet_address, bi.ticket_status,
                               b.booking_status, b.payment_status, b.blockchain_status,
                               tc.checked_in_at
                        FROM booking_items bi
                        JOIN bookings b ON b.id = bi.booking_id
                        LEFT JOIN ticket_checkins tc ON tc.booking_item_id = bi.id
                        WHERE bi.token_id = %s
                        FOR UPDATE OF bi
                        """,
                        (token_id,),
                    )
                    ticket = cursor.fetchone()
                    if not ticket or not _same_address(
                        ticket["owner_wallet_address"], identity.account_wallet_address
                    ):
                        raise HTTPException(status_code=404, detail="QR을 발급할 수 있는 티켓을 찾을 수 없습니다.")
                    if ticket["checked_in_at"] is not None or ticket["ticket_status"] == "used":
                        raise HTTPException(status_code=409, detail="이미 입장 처리된 티켓입니다.")
                    if (
                        ticket["ticket_status"] != "minted"
                        or ticket["booking_status"] != "minted"
                        or ticket["payment_status"] != "paid"
                        or ticket["blockchain_status"] != "confirmed"
                    ):
                        raise HTTPException(status_code=409, detail="결제와 민팅이 완료된 티켓만 QR을 발급할 수 있습니다.")

                    cursor.execute(
                        """
                        SELECT 1 FROM ticket_qr_challenges
                        WHERE booking_item_id = %s
                          AND created_at > %s - (%s * INTERVAL '1 second')
                        LIMIT 1
                        """,
                        (ticket["id"], challenge["issued_at"], QR_CHALLENGE_MIN_INTERVAL_SECONDS),
                    )
                    if cursor.fetchone():
                        raise HTTPException(
                            status_code=429,
                            detail="QR challenge 요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.",
                            headers={"Retry-After": str(QR_CHALLENGE_MIN_INTERVAL_SECONDS)},
                        )

                    # 새 QR 발급 즉시 직전 미사용 QR을 폐기한다.
                    cursor.execute(
                        "DELETE FROM ticket_qr_challenges WHERE booking_item_id = %s AND consumed_at IS NULL",
                        (ticket["id"],),
                    )
                    cursor.execute(
                        """
                        INSERT INTO ticket_qr_challenges (
                            challenge_id, format_version, token_id, booking_item_id,
                            account_wallet_address, signer_wallet_address, nonce_hash,
                            issued_at, expires_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            challenge["challenge_id"], QR_FORMAT_VERSION, token_id, ticket["id"],
                            identity.account_wallet_address, identity.signer_wallet_address,
                            challenge["nonce_hash"], challenge["issued_at"], challenge["expires_at"],
                        ),
                    )
                conn.commit()
        except HTTPException:
            raise
        except psycopg.Error:
            logger.exception("티켓 QR challenge DB 처리 실패")
            raise HTTPException(status_code=503, detail="QR challenge를 발급할 수 없습니다. 잠시 후 다시 시도해주세요.") from None

        return {"status": "success", "data": {**challenge["payload"], "signing_message": challenge["signing_message"]}}

    @app.post("/api/admin/ticket-checkins/verify", summary="관리자 티켓 QR 검증 및 1회 입장 처리")
    async def verify_ticket_checkin(
        body: TicketCheckinRequest,
        http_request: Request,
        response: Response,
        admin=Depends(admin_dependency),
    ):
        response.headers["Cache-Control"] = "no-store"
        try:
            parsed = parse_ticket_qr_data(body.qr_data)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

        try:
            recovered = web3_client.eth.account.recover_message(
                encode_defunct(text=parsed["signing_message"]), signature=parsed["signature"]
            )
        except Exception:
            raise HTTPException(status_code=401, detail="QR Wallet 서명을 확인할 수 없습니다.") from None
        if not _same_address(recovered, parsed["payload"]["signer"]):
            raise HTTPException(status_code=401, detail="QR Wallet 서명이 signer와 일치하지 않습니다.")

        try:
            with connection_factory() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT q.challenge_id, q.format_version, q.token_id,
                               q.booking_item_id, q.account_wallet_address,
                               q.signer_wallet_address, q.nonce_hash,
                               q.issued_at, q.expires_at, q.consumed_at,
                               NOW() AS db_now,
                               bi.owner_wallet_address, bi.ticket_status, bi.seat_code,
                               b.booking_status, b.payment_status, b.blockchain_status,
                               e.title AS event_title, e.venue, e.status AS event_status,
                               s.session_name, s.session_start_at,
                               tc.checked_in_at
                        FROM ticket_qr_challenges q
                        JOIN booking_items bi ON bi.id = q.booking_item_id
                        JOIN bookings b ON b.id = bi.booking_id
                        JOIN events e ON e.id = b.event_id
                        JOIN event_sessions s ON s.id = b.event_session_id
                        LEFT JOIN ticket_checkins tc ON tc.booking_item_id = bi.id
                        WHERE q.challenge_id = %s
                        FOR UPDATE OF q, bi
                        """,
                        (parsed["challenge_id"],),
                    )
                    ticket = cursor.fetchone()
                    if not ticket:
                        raise HTTPException(status_code=404, detail="QR challenge가 없거나 새 QR 발급으로 폐기되었습니다.")
                    if ticket["consumed_at"] is not None:
                        raise HTTPException(status_code=409, detail="이미 사용된 QR입니다.")
                    if ticket["checked_in_at"] is not None or ticket["ticket_status"] == "used":
                        raise HTTPException(status_code=409, detail="이미 입장 처리된 티켓입니다.")
                    if ticket["db_now"] >= ticket["expires_at"]:
                        raise HTTPException(status_code=410, detail="QR이 만료되었습니다. 새 QR을 제시해주세요.")

                    payload = parsed["payload"]
                    record_matches = (
                        int(ticket["format_version"]) == payload["v"]
                        and int(ticket["token_id"]) == parsed["token_id"]
                        and int(ticket["issued_at"].timestamp()) == payload["issued_at"]
                        and int(ticket["expires_at"].timestamp()) == payload["expires_at"]
                        and _same_address(ticket["account_wallet_address"], payload["account"])
                        and _same_address(ticket["signer_wallet_address"], payload["signer"])
                        and hmac.compare_digest(ticket["nonce_hash"], parsed["nonce_hash"])
                    )
                    if not record_matches:
                        raise HTTPException(status_code=401, detail="QR challenge 데이터가 서버 기록과 일치하지 않습니다.")
                    if not _same_address(ticket["owner_wallet_address"], payload["account"]):
                        raise HTTPException(status_code=403, detail="현재 티켓 소유자와 QR 계정이 일치하지 않습니다.")
                    if (
                        ticket["ticket_status"] != "minted"
                        or ticket["booking_status"] != "minted"
                        or ticket["payment_status"] != "paid"
                        or ticket["blockchain_status"] != "confirmed"
                    ):
                        raise HTTPException(status_code=409, detail="유효한 결제·민팅 상태의 티켓이 아닙니다.")
                    if ticket["event_status"] != "active":
                        raise HTTPException(status_code=409, detail="현재 입장 가능한 상태의 공연이 아닙니다.")

                    try:
                        chain_owner = await asyncio.to_thread(
                            ticket_contract.functions.ownerOf(parsed["token_id"]).call
                        )
                    except Exception:
                        logger.exception("티켓 온체인 소유권 조회 실패")
                        raise HTTPException(
                            status_code=503,
                            detail="블록체인 소유권을 확인할 수 없습니다. 입장 처리는 수행되지 않았습니다.",
                        ) from None
                    if not _same_address(chain_owner, ticket["owner_wallet_address"]):
                        raise HTTPException(status_code=409, detail="온체인 티켓 소유권과 서버 기록이 일치하지 않습니다.")

                    cursor.execute(
                        """
                        INSERT INTO ticket_checkins (
                            booking_item_id, token_id, challenge_id, admin_id,
                            account_wallet_address, signer_wallet_address, checked_in_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            ticket["booking_item_id"], parsed["token_id"], parsed["challenge_id"],
                            admin["id"], payload["account"], payload["signer"], ticket["db_now"],
                        ),
                    )
                    cursor.execute(
                        """
                        UPDATE ticket_qr_challenges SET consumed_at = %s
                        WHERE challenge_id = %s AND consumed_at IS NULL
                        RETURNING challenge_id
                        """,
                        (ticket["db_now"], parsed["challenge_id"]),
                    )
                    if not cursor.fetchone():
                        raise HTTPException(status_code=409, detail="다른 검표기에서 이미 사용된 QR입니다.")
                    cursor.execute(
                        """
                        UPDATE booking_items SET ticket_status = 'used', updated_at = NOW()
                        WHERE id = %s AND ticket_status = 'minted'
                        RETURNING id
                        """,
                        (ticket["booking_item_id"],),
                    )
                    if not cursor.fetchone():
                        raise HTTPException(status_code=409, detail="이미 입장 처리됐거나 상태가 변경된 티켓입니다.")
                    admin_logger(
                        cursor, admin, "ticket_checkin", "booking_items", ticket["booking_item_id"],
                        before_data={"ticket_status": "minted"},
                        after_data={
                            "ticket_status": "used", "token_id": parsed["token_id"],
                            "challenge_id": str(parsed["challenge_id"]),
                        },
                        request=http_request,
                    )
                conn.commit()
        except HTTPException:
            raise
        except psycopg.errors.UniqueViolation:
            raise HTTPException(status_code=409, detail="이미 입장 처리된 티켓입니다.") from None
        except psycopg.Error:
            logger.exception("티켓 입장 검증 DB 처리 실패")
            raise HTTPException(status_code=503, detail="입장 검증을 처리할 수 없습니다. 티켓은 소비되지 않았습니다.") from None

        return {
            "status": "success",
            "message": "티켓 검증과 입장 처리가 완료되었습니다.",
            "data": {
                # JavaScript Number 안전 범위를 넘는 ERC-721 token ID도 정확히 전달한다.
                "token_id": str(parsed["token_id"]),
                "event_title": ticket["event_title"],
                "venue": ticket["venue"],
                "session_name": ticket["session_name"],
                "session_start_at": ticket["session_start_at"].isoformat(),
                "seat_code": ticket["seat_code"],
                "checked_in_at": ticket["db_now"].isoformat(),
            },
        }
