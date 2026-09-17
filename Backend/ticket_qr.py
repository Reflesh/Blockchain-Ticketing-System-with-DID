"""사용자 티켓의 단기 QR 서명 challenge 발급 API."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
from fastapi import Depends, HTTPException, Path, Response


QR_FORMAT_VERSION = 1
QR_CHALLENGE_TTL_SECONDS = 20
QR_CHALLENGE_MIN_INTERVAL_SECONDS = 2
QR_SIGNING_DOMAIN = "ticketpro"
QR_SIGNING_PURPOSE = "ticket_entry"
MAX_TOKEN_ID = (10 ** 78) - 1

logger = logging.getLogger(__name__)


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


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
    return json.dumps(
        payload,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


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


def install_ticket_qr_routes(app, connection_factory, identity_dependency):
    """기존 FastAPI app에 QR challenge endpoint를 한 번만 등록한다."""
    if getattr(app.state, "ticket_qr_routes_installed", False):
        return
    app.state.ticket_qr_routes_installed = True

    @app.post(
        "/api/tickets/{token_id}/qr-challenge",
        summary="사용자 티켓 QR challenge 발급",
    )
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
                               b.booking_status, b.payment_status, b.blockchain_status
                        FROM booking_items bi
                        JOIN bookings b ON b.id = bi.booking_id
                        WHERE bi.token_id = %s
                        FOR UPDATE OF bi
                        """,
                        (token_id,),
                    )
                    ticket = cursor.fetchone()

                    if not ticket or (
                        ticket["owner_wallet_address"] or ""
                    ).lower() != identity.account_wallet_address.lower():
                        raise HTTPException(
                            status_code=404,
                            detail="QR을 발급할 수 있는 티켓을 찾을 수 없습니다.",
                        )
                    if (
                        ticket["ticket_status"] != "minted"
                        or ticket["booking_status"] != "minted"
                        or ticket["payment_status"] != "paid"
                        or ticket["blockchain_status"] != "confirmed"
                    ):
                        raise HTTPException(
                            status_code=409,
                            detail="결제와 민팅이 완료된 티켓만 QR을 발급할 수 있습니다.",
                        )

                    cursor.execute(
                        """
                        SELECT 1
                        FROM ticket_qr_challenges
                        WHERE booking_item_id = %s
                          AND created_at > %s - (%s * INTERVAL '1 second')
                        LIMIT 1
                        """,
                        (
                            ticket["id"],
                            challenge["issued_at"],
                            QR_CHALLENGE_MIN_INTERVAL_SECONDS,
                        ),
                    )
                    if cursor.fetchone():
                        raise HTTPException(
                            status_code=429,
                            detail="QR challenge 요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.",
                            headers={"Retry-After": str(QR_CHALLENGE_MIN_INTERVAL_SECONDS)},
                        )

                    # consumed_at은 실제 입장 검증에만 사용한다. 자동 갱신으로 폐기되는
                    # 직전 미사용 QR은 삭제하여 새 QR 발급 즉시 재사용할 수 없게 한다.
                    cursor.execute(
                        """
                        DELETE FROM ticket_qr_challenges
                        WHERE booking_item_id = %s
                          AND consumed_at IS NULL
                        """,
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
                            challenge["challenge_id"],
                            QR_FORMAT_VERSION,
                            token_id,
                            ticket["id"],
                            identity.account_wallet_address,
                            identity.signer_wallet_address,
                            challenge["nonce_hash"],
                            challenge["issued_at"],
                            challenge["expires_at"],
                        ),
                    )
                conn.commit()
        except HTTPException:
            raise
        except psycopg.Error:
            logger.exception("티켓 QR challenge DB 처리 실패")
            raise HTTPException(
                status_code=503,
                detail="QR challenge를 발급할 수 없습니다. 잠시 후 다시 시도해주세요.",
            ) from None

        return {
            "status": "success",
            "data": {
                **challenge["payload"],
                "signing_message": challenge["signing_message"],
            },
        }
