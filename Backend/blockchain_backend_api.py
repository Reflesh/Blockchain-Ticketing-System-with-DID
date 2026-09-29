import logging


logger = logging.getLogger(__name__)


try:
    from .blockchain_backend import (
        AdminLoginRequest, Depends, EVENT_STATUSES, EventCreateRequest,
        EventUpdateRequest, HTTPException, LoginRequest, PRIVATE_KEY, Query,
        Request, SEAT_STATUSES, SESSION_STATUSES, SeatBulkCreateRequest,
        SeatUpdateRequest, SessionCreateRequest, SessionUpdateRequest,
        CheckoutPrepareRequest, CheckoutReleaseRequest, SignUpRequest, TicketRequest, TransferChallengeRequest, TransferRequest, UserProfileResponse, VerifyRequest,
        WishlistRequest, app, blank_to_none, cancel_portone_v2_payment,
        contract, count_rows, create_admin_token, encode_defunct,
        event_to_ticket, fetch_one_or_404, format_price_display,
        format_session_response, get_db_connection, get_event_log_snapshot,
        get_portone_v1_access_token, get_portone_v2_payment, get_request_ip,
        get_required_event_snapshot, get_required_seat_snapshot,
        get_required_session_snapshot, get_seat_log_snapshot,
        get_session_log_snapshot, hash_identifier, json, log_admin_action,
        next_table_id, parse_price_input, psycopg, requests, asyncio,
        require_active_vc_holder, require_admin, require_matching_wallet,
        require_user_session, resolve_user, seat_to_dict, server_account,
        EXPECTED_CHAIN_ID, JSONResponse, TimeExhausted, TransactionNotFound, serialized_server_transaction,
        time, uuid, validate_choice, web3,
    )
except ImportError:
    from blockchain_backend import (
        AdminLoginRequest, Depends, EVENT_STATUSES, EventCreateRequest,
        EventUpdateRequest, HTTPException, LoginRequest, PRIVATE_KEY, Query,
        Request, SEAT_STATUSES, SESSION_STATUSES, SeatBulkCreateRequest,
        SeatUpdateRequest, SessionCreateRequest, SessionUpdateRequest,
        CheckoutPrepareRequest, CheckoutReleaseRequest, SignUpRequest, TicketRequest, TransferChallengeRequest, TransferRequest, UserProfileResponse, VerifyRequest,
        WishlistRequest, app, blank_to_none, cancel_portone_v2_payment,
        contract, count_rows, create_admin_token, encode_defunct,
        event_to_ticket, fetch_one_or_404, format_price_display,
        format_session_response, get_db_connection, get_event_log_snapshot,
        get_portone_v1_access_token, get_portone_v2_payment, get_request_ip,
        get_required_event_snapshot, get_required_seat_snapshot,
        get_required_session_snapshot, get_seat_log_snapshot,
        get_session_log_snapshot, hash_identifier, json, log_admin_action,
        next_table_id, parse_price_input, psycopg, requests, asyncio,
        require_active_vc_holder, require_admin, require_matching_wallet,
        require_user_session, resolve_user, seat_to_dict, server_account,
        EXPECTED_CHAIN_ID, JSONResponse, TimeExhausted, TransactionNotFound, serialized_server_transaction,
        time, uuid, validate_choice, web3,
    )


@app.post("/api/login", summary="사용자 로그인")
async def login_api(request: LoginRequest):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT username, wallet_address
                    FROM users
                    WHERE username = %s AND password_hash = %s AND status = 'active'
                    """,
                    (request.username, request.password)
                )
                result = cursor.fetchone()

        if result:
            print(f"🔓 로그인 성공: {request.username}")
            return {
                "status": "success",
                "message": "로그인에 성공했습니다.",
                "username": result["username"],
                "wallet_address": result["wallet_address"]
            }
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")

    except HTTPException:
        raise
    except Exception as e:
        print(f"로그인 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="서버 내부 에러 발생")

@app.post("/api/signup", summary="회원가입 및 지갑 자동 생성")
async def signup_api(request: SignUpRequest):
    try:
        new_account = web3.eth.account.create()
        new_wallet_address = new_account.address
        new_private_key = new_account.key.hex()

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT id FROM users WHERE username = %s", (request.username,))
                if cursor.fetchone():
                    raise HTTPException(status_code=400, detail="이미 존재하는 아이디입니다.")

                cursor.execute(
                    """
                    INSERT INTO users (username, password_hash, wallet_address, private_key_encrypted, auth_provider, verification_status)
                    VALUES (%s, %s, %s, %s, 'local', 'unverified')
                    """,
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

@app.get("/api/events", summary="공연 목록 조회")
async def list_events_api():
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, title, venue, display_time_text, period_text, age_rating,
                           price_amount, price_display, poster_url, category, status
                    FROM events
                    WHERE status IN ('active', 'paused')
                    ORDER BY display_order ASC, start_at ASC, id ASC
                    """
                )
                rows = cursor.fetchall()
        return {"status": "success", "data": [event_to_ticket(row) for row in rows]}
    except Exception as e:
        print(f"공연 목록 조회 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="공연 목록을 불러오지 못했습니다.")

@app.get("/api/events/{event_id}", summary="공연 상세 조회")
async def event_detail_api(event_id: int):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, title, venue, display_time_text, period_text, age_rating,
                           price_amount, price_display, poster_url, category, status
                    FROM events
                    WHERE id = %s
                    """,
                    (event_id,)
                )
                row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="공연 정보를 찾을 수 없습니다.")
        return {"status": "success", "data": event_to_ticket(row)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"공연 상세 조회 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="공연 정보를 불러오지 못했습니다.")

@app.get("/api/events/{event_id}/sessions", summary="공연 회차 조회")
async def event_sessions_api(event_id: int):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, event_id, session_name, session_start_at, session_end_at, sale_status
                    FROM event_sessions
                    WHERE event_id = %s
                    ORDER BY session_start_at ASC, id ASC
                    """,
                    (event_id,)
                )
                rows = cursor.fetchall()
        return {
            "status": "success",
            "data": [format_session_response(row) for row in rows]
        }
    except Exception as e:
        print(f"공연 회차 조회 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="공연 회차를 불러오지 못했습니다.")

@app.get("/api/sessions/{session_id}/seats", summary="회차 좌석 조회")
async def session_seats_api(session_id: int):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, event_session_id, seat_code, section_name, row_label, seat_number, grade, price_amount, status
                    FROM seats
                    WHERE event_session_id = %s
                    ORDER BY row_label ASC, seat_number::integer ASC
                    """,
                    (session_id,)
                )
                rows = cursor.fetchall()
        return {"status": "success", "data": [seat_to_dict(row) for row in rows]}
    except Exception as e:
        print(f"좌석 조회 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="좌석 정보를 불러오지 못했습니다.")

@app.post("/api/verify-user", summary="포트원 본인인증 정보 검증 및 식별값 추출")
async def verify_user_api(request: VerifyRequest):
    try:
        access_token = get_portone_v1_access_token()

        cert_res = requests.get(
            f"https://api.iamport.kr/certifications/{request.imp_uid}",
            headers={"Authorization": access_token}
        )
        cert_data = cert_res.json()

        if cert_data["code"] != 0:
            raise HTTPException(status_code=400, detail="유효하지 않은 인증 정보입니다.")

        user_info = cert_data["response"]
        real_name = user_info.get("name")
        unique_key = user_info.get("unique_key")
        unique_in_site = user_info.get("unique_in_site")

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                user_id = None
                if request.wallet_address:
                    cursor.execute("SELECT id FROM users WHERE wallet_address = %s", (request.wallet_address,))
                    user_row = cursor.fetchone()
                    user_id = user_row["id"] if user_row else None

                cursor.execute(
                    """
                    INSERT INTO identity_verifications (
                        user_id, imp_uid, real_name, ci_hash, di_hash, provider, verification_status, raw_response
                    ) VALUES (%s, %s, %s, %s, %s, 'portone', 'verified', %s::jsonb)
                    ON CONFLICT (imp_uid) DO UPDATE SET
                        user_id = EXCLUDED.user_id,
                        real_name = EXCLUDED.real_name,
                        ci_hash = EXCLUDED.ci_hash,
                        di_hash = EXCLUDED.di_hash,
                        raw_response = EXCLUDED.raw_response
                    """,
                    (
                        user_id,
                        request.imp_uid,
                        real_name,
                        hash_identifier(unique_key),
                        hash_identifier(unique_in_site),
                        json.dumps(cert_data.get("response", {}), ensure_ascii=False),
                    )
                )
            conn.commit()

        print(f"✅ 포트원 본인인증 완료: 이름={real_name}, CI 저장 완료")
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

@app.get("/api/users/{wallet_address}/bookings", summary="사용자 예매 내역 조회")
async def user_bookings_api(wallet_address: str, session_wallet=Depends(require_user_session)):
    try:
        require_matching_wallet(session_wallet, wallet_address)
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        b.id, b.booking_no, b.total_amount, b.booking_status, b.payment_status,
                        b.blockchain_status, b.created_at,
                        e.title, e.venue, e.display_time_text, e.poster_url, e.price_display,
                        s.session_name, s.session_start_at,
                        bt.tx_hash,
                        COALESCE(
                            json_agg(
                                json_build_object(
                                    'booking_item_id', bi.id,
                                    'seat_code', bi.seat_code,
                                    'owner_wallet_address', bi.owner_wallet_address,
                                    'companion_wallet_address', bi.companion_wallet_address,
                                    -- JavaScript의 Number 안전 범위를 넘는 token ID도 정확히 전달한다.
                                    'token_id', bi.token_id::text,
                                    'is_transferred', bi.is_transferred,
                                    'ticket_status', bi.ticket_status,
                                    'unit_price', bi.unit_price
                                )
                                ORDER BY bi.seat_code
                            ) FILTER (WHERE bi.id IS NOT NULL AND (
                                -- 💡 양도받은 사람은 자신이 소유한 좌석만 배열에 담겨서 보입니다.
                                LOWER(b.buyer_wallet_address) = LOWER(%s) OR LOWER(bi.owner_wallet_address) = LOWER(%s)
                            )),
                            '[]'::json
                        ) AS items
                    FROM bookings b
                    JOIN events e ON e.id = b.event_id
                    JOIN event_sessions s ON s.id = b.event_session_id
                    LEFT JOIN booking_items bi ON bi.booking_id = b.id
                    LEFT JOIN blockchain_transactions bt ON bt.booking_id = b.id AND bt.tx_type = 'ticket_purchase'
                    WHERE b.booking_status != 'failed'
                      AND (
                          -- 💡 핵심: 조회하는 사람이 '원래 구매자'이거나, '티켓을 양도받은 소유자'일 경우 조회 허용
                          LOWER(b.buyer_wallet_address) = LOWER(%s)
                          OR b.id IN (
                              SELECT booking_id FROM booking_items WHERE LOWER(owner_wallet_address) = LOWER(%s)
                          )
                      )
                    GROUP BY b.id, e.id, s.id, bt.tx_hash
                    ORDER BY b.created_at DESC
                    """,
                    (wallet_address, wallet_address, wallet_address, wallet_address) # %s가 4개 들어가므로 4번 매핑
                )
                rows = cursor.fetchall()

        # 배열(items)이 비어있는 예매 건은 필터링 (양도 후 자신의 좌석이 없는 경우 방지)
        filtered_data = [row for row in rows if len(row["items"]) > 0]

        return {
            "status": "success",
            "data": [
                {
                    "id": row["id"],
                    "booking_no": row["booking_no"],
                    "name": row["title"],
                    "location": row["venue"],
                    "time": row["display_time_text"],
                    "session_name": row["session_name"],
                    "session_start_at": row["session_start_at"].isoformat() if row["session_start_at"] else None,
                    "image": row["poster_url"],
                    "price": format_price_display(row["price_display"], row["total_amount"]),
                    "total_amount": int(row["total_amount"] or 0),
                    "booking_status": row["booking_status"],
                    "payment_status": row["payment_status"],
                    "blockchain_status": row["blockchain_status"],
                    "txHash": row["tx_hash"],
                    "items": row["items"],
                    "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                }
                for row in filtered_data
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"예매 내역 조회 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="예매 내역을 불러오지 못했습니다.")

@app.get(
    "/api/users/{wallet_address}/profile",
    summary="사용자 프로필 조회",
    response_model=UserProfileResponse,
)
async def user_profile_api(wallet_address: str, session_wallet=Depends(require_user_session)):
    try:
        require_matching_wallet(session_wallet, wallet_address)
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT username, auth_provider, verification_status
                    FROM users
                    WHERE LOWER(wallet_address) = LOWER(%s)
                    """,
                    (wallet_address,),
                )
                user = cursor.fetchone()

        return {
            "status": "success",
            "data": {
                "wallet_address": wallet_address,
                "display_name": (user or {}).get("username") or "TicketPro 회원",
                "auth_provider": (user or {}).get("auth_provider") or "did_keystore",
                "verification_status": (user or {}).get("verification_status") or "verified",
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"사용자 프로필 조회 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="사용자 프로필을 불러오지 못했습니다.")

@app.get("/api/users/{wallet_address}/wishlist", summary="사용자 찜 목록 조회")
async def user_wishlist_api(wallet_address: str, session_wallet=Depends(require_user_session)):
    try:
        require_matching_wallet(session_wallet, wallet_address)
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT e.id, e.title, e.venue, e.display_time_text, e.period_text, e.age_rating,
                           e.price_amount, e.price_display, e.poster_url, e.category, e.status
                    FROM wishlist w
                    JOIN events e ON e.id = w.event_id
                    WHERE w.wallet_address = %s
                    ORDER BY w.created_at DESC
                    """,
                    (wallet_address,)
                )
                rows = cursor.fetchall()
        return {"status": "success", "data": [event_to_ticket(row) for row in rows]}
    except HTTPException:
        raise
    except Exception as e:
        print(f"찜 목록 조회 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="찜 목록을 불러오지 못했습니다.")

@app.post("/api/wishlist", summary="찜 추가")
async def add_wishlist_api(request: WishlistRequest, session_wallet=Depends(require_user_session)):
    try:
        require_matching_wallet(session_wallet, request.wallet_address)
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO wishlist (wallet_address, event_id)
                    VALUES (%s, %s)
                    ON CONFLICT (wallet_address, event_id) DO NOTHING
                    """,
                    (request.wallet_address, request.event_id)
                )
            conn.commit()
        return {"status": "success", "message": "찜 목록에 추가하였습니다."}
    except HTTPException:
        raise
    except Exception as e:
        print(f"찜 추가 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="찜 목록에 추가하지 못했습니다.")

@app.delete("/api/wishlist/{event_id}", summary="찜 삭제")
async def remove_wishlist_api(event_id: int, wallet_address: str = Query(...), session_wallet=Depends(require_user_session)):
    try:
        require_matching_wallet(session_wallet, wallet_address)
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM wishlist WHERE wallet_address = %s AND event_id = %s",
                    (wallet_address, event_id)
                )
            conn.commit()
        return {"status": "success", "message": "찜 목록에서 삭제되었습니다."}
    except HTTPException:
        raise
    except Exception as e:
        print(f"찜 삭제 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="찜 목록에서 삭제하지 못했습니다.")

CHECKOUT_HOLD_TTL_SECONDS = 600


def _purchase_payload(request):
    return json.dumps({
        "wallet_address": request.wallet_address,
        "event_id": request.event_id,
        "event_session_id": request.event_session_id,
        "seat_ids": request.seat_ids,
        "payment_id": request.payment_id,
    }, separators=(",", ":"))


def _validate_purchase_request(request, session_wallet):
    require_matching_wallet(session_wallet, request.wallet_address)
    if not request.payment_id or not request.payment_id.startswith("ticket_"):
        raise HTTPException(status_code=400, detail="결제 정보(payment_id)가 올바르지 않습니다.")
    payment_suffix = request.payment_id.removeprefix("ticket_").replace("-", "")
    if len(payment_suffix) < 16 or not payment_suffix.isalnum():
        raise HTTPException(status_code=400, detail="결제 정보(payment_id)가 올바르지 않습니다.")
    if not request.seat_ids:
        raise HTTPException(status_code=400, detail="예매할 좌석을 한 석 이상 선택해야 합니다.")
    if len(request.seat_ids) > 4:
        raise HTTPException(status_code=400, detail="한 번에 최대 4석까지만 예매할 수 있습니다.")
    if len(set(request.seat_ids)) != len(request.seat_ids):
        raise HTTPException(status_code=400, detail="중복된 좌석이 포함되어 있습니다.")

    recovered_address = web3.eth.account.recover_message(
        encode_defunct(text=_purchase_payload(request)), signature=request.signature
    )
    if recovered_address.lower() != request.wallet_address.lower():
        raise HTTPException(status_code=401, detail="DID 서명 검증 실패.")


def _release_checkout_order(cursor, payment_id, next_status):
    cursor.execute(
        """
        SELECT item.seat_id
        FROM checkout_order_items item
        WHERE item.payment_id = %s AND item.released_at IS NULL
        ORDER BY item.seat_id
        FOR UPDATE
        """,
        (payment_id,),
    )
    seat_ids = [row["seat_id"] for row in cursor.fetchall()]
    if seat_ids:
        cursor.execute(
            "UPDATE seats SET status = 'available', hold_expires_at = NULL WHERE id = ANY(%s) AND status = 'holding'",
            (seat_ids,),
        )
        cursor.execute(
            "UPDATE checkout_order_items SET released_at = NOW() WHERE payment_id = %s AND released_at IS NULL",
            (payment_id,),
        )
    cursor.execute(
        "UPDATE checkout_orders SET status = %s, updated_at = NOW() WHERE payment_id = %s",
        (next_status, payment_id),
    )
    return seat_ids


def expire_checkout_holds(limit=200):
    """만료 선점을 반환하되, 결제 완료 건은 먼저 전액 환불한다."""
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT payment_id
                FROM checkout_orders
                WHERE status = 'pending_payment' AND expires_at <= NOW()
                ORDER BY expires_at
                LIMIT %s
                """,
                (limit,),
            )
            candidates = [row["payment_id"] for row in cursor.fetchall()]

    released = 0
    for payment_id in candidates:
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        SELECT status, expires_at
                        FROM checkout_orders
                        WHERE payment_id = %s
                        FOR UPDATE
                        """,
                        (payment_id,),
                    )
                    order = cursor.fetchone()
                    cursor.execute("SELECT NOW() AS now")
                    db_now = cursor.fetchone()["now"]
                    if not order or order["status"] != "pending_payment" or order["expires_at"] > db_now:
                        continue

                    payment_info = get_portone_v2_payment(payment_id, allow_not_found=True)
                    if payment_info and payment_info.get("status") == "PAID":
                        paid_amount = int(payment_info.get("amount", {}).get("total", 0))
                        refund_succeeded = paid_amount > 0 and cancel_portone_v2_payment(
                            payment_id,
                            "좌석 선점 만료 후 예매 미완료 자동 환불",
                            paid_amount,
                        )
                        if not refund_succeeded:
                            cursor.execute(
                                """
                                UPDATE checkout_orders
                                SET status = 'refund_failed', updated_at = NOW()
                                WHERE payment_id = %s
                                """,
                                (payment_id,),
                            )
                            conn.commit()
                            continue
                        _release_checkout_order(cursor, payment_id, "refunded")
                    else:
                        _release_checkout_order(cursor, payment_id, "expired")
                    conn.commit()
                    released += 1
        except HTTPException as exc:
            # 결제사 조회가 불확실하면 좌석을 다른 사용자에게 넘기지 않고 다음 주기에 재시도한다.
            print(f"⚠️ 만료 선점 결제 상태 확인 보류 ({payment_id}): {exc.status_code}")
    return released


@app.post("/api/checkout/prepare", summary="결제 전 좌석 원자적 선점")
async def prepare_checkout_api(request: CheckoutPrepareRequest, session_wallet=Depends(require_user_session)):
    _validate_purchase_request(request, session_wallet)
    await asyncio.to_thread(expire_checkout_holds)

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM checkout_orders WHERE payment_id = %s FOR UPDATE",
                    (request.payment_id,),
                )
                existing = cursor.fetchone()
                if existing:
                    same_order = (
                        existing["buyer_wallet_address"].lower() == request.wallet_address.lower()
                        and existing["event_id"] == request.event_id
                        and existing["event_session_id"] == request.event_session_id
                        and existing["status"] == "pending_payment"
                    )
                    if not same_order:
                        raise HTTPException(status_code=409, detail="이미 사용된 결제 ID입니다.")
                    cursor.execute(
                        """
                        SELECT seat_id FROM checkout_order_items
                        WHERE payment_id = %s AND released_at IS NULL
                        ORDER BY seat_id
                        """,
                        (request.payment_id,),
                    )
                    existing_seats = [row["seat_id"] for row in cursor.fetchall()]
                    if sorted(existing_seats) != sorted(request.seat_ids):
                        raise HTTPException(status_code=409, detail="결제 ID에 연결된 좌석 정보가 다릅니다.")
                    return {
                        "status": "success",
                        "data": {
                            "payment_id": request.payment_id,
                            "total_amount": int(existing["total_amount"]),
                            "expires_at": existing["expires_at"].isoformat(),
                        },
                    }

                cursor.execute(
                    "SELECT event_id, sale_status FROM event_sessions WHERE id = %s",
                    (request.event_session_id,),
                )
                session_row = cursor.fetchone()
                if not session_row or session_row["event_id"] != request.event_id:
                    raise HTTPException(status_code=400, detail="선택한 공연 회차가 올바르지 않습니다.")
                if session_row["sale_status"] != "open":
                    raise HTTPException(status_code=409, detail="현재 예매할 수 없는 공연 회차입니다.")

                cursor.execute(
                    """
                    SELECT id, event_session_id, seat_code, price_amount, status
                    FROM seats
                    WHERE id = ANY(%s)
                    ORDER BY id
                    FOR UPDATE
                    """,
                    (request.seat_ids,),
                )
                seat_rows = cursor.fetchall()
                if len(seat_rows) != len(request.seat_ids):
                    raise HTTPException(status_code=400, detail="일부 좌석 정보를 찾을 수 없습니다.")
                if any(row["event_session_id"] != request.event_session_id for row in seat_rows):
                    raise HTTPException(status_code=400, detail="선택한 회차에 속하지 않는 좌석이 포함되어 있습니다.")
                unavailable = [row["seat_code"] for row in seat_rows if row["status"] != "available"]
                if unavailable:
                    raise HTTPException(status_code=409, detail=f"이미 선점된 좌석입니다: {', '.join(unavailable)}")

                # 좌석 상태가 잘못 available로 복구됐더라도 활성 예매 항목이 있으면
                # 결제를 시작하기 전에 차단한다. 실패·취소 이력은 재예매를 막지 않는다.
                cursor.execute(
                    """
                    SELECT s.seat_code
                    FROM booking_items bi
                    JOIN seats s ON s.id = bi.seat_id
                    WHERE bi.seat_id = ANY(%s)
                      AND bi.ticket_status NOT IN ('failed', 'cancelled')
                    ORDER BY bi.seat_id
                    """,
                    (request.seat_ids,),
                )
                active_booking_seats = [row["seat_code"] for row in cursor.fetchall()]
                if active_booking_seats:
                    raise HTTPException(
                        status_code=409,
                        detail=f"이미 유효한 티켓이 발급된 좌석입니다: {', '.join(active_booking_seats)}",
                    )

                total_amount = sum(int(row["price_amount"] or 0) for row in seat_rows)
                cursor.execute(
                    """
                    INSERT INTO checkout_orders (
                        payment_id, buyer_wallet_address, event_id, event_session_id,
                        total_amount, status, expires_at
                    ) VALUES (%s, %s, %s, %s, %s, 'pending_payment',
                              NOW() + (%s * INTERVAL '1 second'))
                    RETURNING expires_at
                    """,
                    (
                        request.payment_id, request.wallet_address, request.event_id,
                        request.event_session_id, total_amount, CHECKOUT_HOLD_TTL_SECONDS,
                    ),
                )
                expires_at = cursor.fetchone()["expires_at"]
                for seat in seat_rows:
                    cursor.execute(
                        """
                        INSERT INTO checkout_order_items (payment_id, seat_id, unit_price)
                        VALUES (%s, %s, %s)
                        """,
                        (request.payment_id, seat["id"], seat["price_amount"]),
                    )
                cursor.execute(
                    """
                    UPDATE seats
                    SET status = 'holding', hold_expires_at = %s
                    WHERE id = ANY(%s) AND status = 'available'
                    """,
                    (expires_at, request.seat_ids),
                )
                if cursor.rowcount != len(request.seat_ids):
                    raise HTTPException(status_code=409, detail="좌석 선점 중 상태가 변경되었습니다. 다시 선택해주세요.")
            conn.commit()
        return {
            "status": "success",
            "data": {
                "payment_id": request.payment_id,
                "total_amount": total_amount,
                "expires_at": expires_at.isoformat(),
            },
        }
    except HTTPException:
        raise
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="선택한 좌석이 다른 결제에서 이미 선점되었습니다.") from None
    except psycopg.Error:
        raise HTTPException(status_code=503, detail="좌석을 선점할 수 없습니다. 잠시 후 다시 시도해주세요.") from None


@app.post("/api/checkout/release", summary="결제 취소 좌석 선점 해제")
async def release_checkout_api(request: CheckoutReleaseRequest, session_wallet=Depends(require_user_session)):
    require_matching_wallet(session_wallet, request.wallet_address)
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT buyer_wallet_address, status FROM checkout_orders WHERE payment_id = %s FOR UPDATE",
                (request.payment_id,),
            )
            order = cursor.fetchone()
            if not order:
                return {"status": "success", "message": "이미 해제된 좌석입니다."}
            if order["buyer_wallet_address"].lower() != request.wallet_address.lower():
                raise HTTPException(status_code=403, detail="본인의 결제 선점만 해제할 수 있습니다.")
            if order["status"] == "pending_payment":
                _release_checkout_order(cursor, request.payment_id, "cancelled")
        conn.commit()
    return {"status": "success", "message": "좌석 선점이 해제되었습니다."}


@app.post("/api/buy-tickets", summary="스마트 티켓 예매 (결제 검증 + 가스비 대납 + SBT 발행)")
async def buy_tickets_api(request: TicketRequest, session_wallet=Depends(require_user_session)):
    """
    [Web 2.5 결제 흐름 - 포트원 V2]
    1. 프론트엔드에서 포트원 V2 SDK로 결제 완료 후 payment_id(merchant_uid)와 서명 전달
    2. DID 전자서명 검증
    3. 포트원 V2 API로 결제 위변조(금액 일치 여부) 검증
    4. 단일 트랜잭션 내에서: 좌석 FOR UPDATE 잠금 → 예매/결제/좌석 기록 확정
    5. 서버 지갑(가스비 대납)으로 스마트 컨트랙트 Mint 실행
    6. 트랜잭션 실패(Revert) 시, 포트원 V2 API로 자동 환불
    """
    booking_id = None
    locked_seat_ids = []
    total_amount = 0
    paid_amount = 0
    payment_confirmed = False
    refund_attempted = False
    buyer_address = None
    tx_hash_hex = None
    tx_submission_attempted = False
    chain_failure_confirmed = False

    def mark_booking_failed(reason, trigger_refund=False):
        nonlocal refund_attempted
        refund_succeeded = None
        if trigger_refund and payment_confirmed and paid_amount > 0 and request.payment_id and not refund_attempted:
            refund_attempted = True
            print(f"🔄 블록체인 실패. 자동 환불 시도: {request.payment_id}")
            refund_succeeded = cancel_portone_v2_payment(request.payment_id, f"발급 실패: {reason}", paid_amount)
        if not booking_id and not payment_confirmed:
            return refund_succeeded
        if refund_succeeded is True:
            payment_status = "refunded"
        elif trigger_refund and paid_amount > 0:
            payment_status = "refund_failed"
        else:
            payment_status = "failed"
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    if booking_id:
                        cursor.execute(
                            "UPDATE bookings SET booking_status = 'failed', payment_status = %s, blockchain_status = 'failed' WHERE id = %s",
                            (payment_status, booking_id),
                        )
                        cursor.execute("UPDATE payments SET payment_status = %s, failure_reason = %s WHERE booking_id = %s", (payment_status, reason[:1000], booking_id))
                        cursor.execute("UPDATE booking_items SET ticket_status = 'failed' WHERE booking_id = %s", (booking_id,))
                    if locked_seat_ids:
                        cursor.execute(
                            "UPDATE seats SET status = 'available', hold_expires_at = NULL WHERE id = ANY(%s)",
                            (locked_seat_ids,),
                        )
                    cursor.execute(
                        "SELECT status FROM checkout_orders WHERE payment_id = %s FOR UPDATE",
                        (request.payment_id,),
                    )
                    if cursor.fetchone():
                        _release_checkout_order(cursor, request.payment_id, payment_status)
                    if tx_hash_hex:
                        cursor.execute(
                            "UPDATE blockchain_transactions SET tx_status = 'failed', error_message = %s WHERE tx_hash = %s",
                            (reason[:1000], tx_hash_hex),
                        )
                conn.commit()
        except Exception as update_error:
            print(f"🚨 실패 상태 기록 오류: {update_error}")
        return refund_succeeded

    def mark_booking_chain_pending(reason):
        if not booking_id:
            return
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        "UPDATE bookings SET booking_status = 'mint_pending', blockchain_status = 'pending' WHERE id = %s",
                        (booking_id,),
                    )
                    cursor.execute(
                        "UPDATE checkout_orders SET status = 'mint_pending', updated_at = NOW() WHERE booking_id = %s",
                        (booking_id,),
                    )
                    if tx_hash_hex:
                        cursor.execute(
                            "UPDATE blockchain_transactions SET tx_status = 'pending', error_message = %s WHERE tx_hash = %s",
                            (reason[:1000], tx_hash_hex),
                        )
                conn.commit()
        except Exception as update_error:
            print(f"🚨 블록체인 대기 상태 기록 오류: {update_error}")

    try:
        # 1. 기본 입력값 검증 및 DID 서명 검증
        _validate_purchase_request(request, session_wallet)
        buyer_address = request.wallet_address

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1 FROM payments WHERE imp_uid = %s LIMIT 1", (request.payment_id,))
                if cursor.fetchone():
                    raise HTTPException(status_code=409, detail="이미 처리된 결제 ID입니다.")

        # 2. 선점 행을 잠근 상태에서 결제 검증 후 DB 기록을 확정한다.
        booking_no = f"BK-{uuid.uuid4().hex[:12].upper()}"
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (request.payment_id,))
                cursor.execute("SELECT 1 FROM payments WHERE imp_uid = %s LIMIT 1", (request.payment_id,))
                if cursor.fetchone():
                    payment_confirmed = False
                    raise HTTPException(status_code=409, detail="이미 처리된 결제 ID입니다.")
                cursor.execute(
                    "SELECT * FROM checkout_orders WHERE payment_id = %s FOR UPDATE",
                    (request.payment_id,),
                )
                checkout_order = cursor.fetchone()
                if not checkout_order:
                    raise HTTPException(status_code=409, detail="결제 전에 좌석을 먼저 선점해야 합니다.")
                if checkout_order["buyer_wallet_address"].lower() != buyer_address.lower():
                    raise HTTPException(status_code=403, detail="결제 선점 사용자와 로그인 사용자가 일치하지 않습니다.")
                if checkout_order["status"] != "pending_payment":
                    raise HTTPException(status_code=409, detail="이미 종료되었거나 처리 중인 결제 선점입니다.")
                if checkout_order["expires_at"] <= cursor.execute("SELECT NOW() AS now").fetchone()["now"]:
                    raise HTTPException(status_code=409, detail="좌석 선점 시간이 만료되었습니다. 결제 상태 확인 후 자동 환불됩니다.")

                payment_info = get_portone_v2_payment(request.payment_id)
                if payment_info.get("status") != "PAID":
                    raise HTTPException(status_code=400, detail="결제가 완료되지 않았습니다.")
                paid_amount = int(payment_info.get("amount", {}).get("total", 0))
                payment_confirmed = True

                cursor.execute(
                    "SELECT event_id, sale_status FROM event_sessions WHERE id = %s",
                    (request.event_session_id,)
                )
                session_row = cursor.fetchone()
                if not session_row:
                    raise HTTPException(status_code=400, detail="선택한 공연 회차를 찾을 수 없습니다.")
                if session_row["event_id"] != request.event_id:
                    raise HTTPException(status_code=400, detail="선택한 회차가 해당 공연에 속하지 않습니다.")
                if session_row["sale_status"] != "open":
                    raise HTTPException(status_code=409, detail="현재 예매할 수 없는 공연 회차입니다.")

                cursor.execute(
                    """
                    SELECT s.id, s.event_session_id, s.seat_code, s.price_amount, s.status
                    FROM checkout_order_items item
                    JOIN seats s ON s.id = item.seat_id
                    WHERE item.payment_id = %s AND item.released_at IS NULL
                    ORDER BY s.id
                    FOR UPDATE OF item, s
                    """,
                    (request.payment_id,)
                )
                seat_rows = cursor.fetchall()

                if len(seat_rows) != len(request.seat_ids) or sorted(row["id"] for row in seat_rows) != sorted(request.seat_ids):
                    raise HTTPException(status_code=409, detail="결제 선점 좌석과 요청 좌석이 일치하지 않습니다.")
                invalid_session_seats = [s["seat_code"] for s in seat_rows if s["event_session_id"] != request.event_session_id]
                if invalid_session_seats:
                    raise HTTPException(status_code=400, detail=f"선택한 회차에 속하지 않는 좌석이 포함되어 있습니다: {', '.join(invalid_session_seats)}")
                unavailable = [s["seat_code"] for s in seat_rows if s["status"] != "holding"]
                if unavailable:
                    raise HTTPException(status_code=409, detail=f"이미 선점된 좌석입니다: {', '.join(unavailable)}")

                total_amount = sum(int(seat["price_amount"] or 0) for seat in seat_rows)
                locked_seat_ids = list(request.seat_ids)

                if paid_amount != total_amount:
                    raise HTTPException(status_code=403, detail="결제 금액이 일치하지 않습니다.")
                if int(checkout_order["total_amount"]) != total_amount:
                    raise HTTPException(status_code=409, detail="선점 당시 좌석 금액과 현재 금액이 일치하지 않습니다.")

                cursor.execute(
                    """
                    INSERT INTO bookings (booking_no, buyer_wallet_address, event_id, event_session_id, total_amount, booking_status, payment_status, blockchain_status)
                    VALUES (%s, %s, %s, %s, %s, 'mint_pending', 'paid', 'pending') RETURNING id
                    """,
                    (booking_no, buyer_address, request.event_id, request.event_session_id, total_amount)
                )
                booking_id = cursor.fetchone()["id"]

                cursor.execute("INSERT INTO payments (booking_id, imp_uid, amount, payment_status, paid_at) VALUES (%s, %s, %s, 'paid', NOW())", (booking_id, request.payment_id, total_amount))

                for seat in seat_rows:
                    cursor.execute(
                        """
                        INSERT INTO booking_items (booking_id, seat_id, seat_code, owner_wallet_address, unit_price, ticket_status)
                        VALUES (%s, %s, %s, %s, %s, 'mint_pending')
                        """,
                        (booking_id, seat["id"], seat["seat_code"], buyer_address, seat["price_amount"])
                    )

                cursor.execute(
                    "UPDATE seats SET status = 'locked', hold_expires_at = NULL WHERE id = ANY(%s)",
                    (request.seat_ids,),
                )
                cursor.execute(
                    "UPDATE checkout_order_items SET released_at = NOW() WHERE payment_id = %s AND released_at IS NULL",
                    (request.payment_id,),
                )
                cursor.execute(
                    """
                    UPDATE checkout_orders
                    SET status = 'booking_created', booking_id = %s, updated_at = NOW()
                    WHERE payment_id = %s
                    """,
                    (booking_id, request.payment_id),
                )
            conn.commit()

        # 4. 블록체인에 다중 민팅 요청 (가스 대납)
        print(f"🚀 [{buyer_address}] 스마트 컨트랙트 일괄 민팅 요청 중...")
        mint_call = contract.functions.buyTicketsFor(
            web3.to_checksum_address(buyer_address),
            request.event_id,
            len(request.seat_ids)
        )
        with serialized_server_transaction():
            gas_estimate = mint_call.estimate_gas({"from": server_account.address})
            gas_price = int(web3.eth.gas_price * 1.5)
            nonce = web3.eth.get_transaction_count(server_account.address, "pending")
            txn = mint_call.build_transaction({
                "chainId": EXPECTED_CHAIN_ID,
                "gas": int(gas_estimate * 1.2),
                "gasPrice": gas_price,
                "nonce": nonce,
            })
            signed_txn = web3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
            tx_hash_hex = web3.to_hex(web3.keccak(signed_txn.raw_transaction))
            # 프로세스가 전송 직후 종료되어도 복구할 수 있도록 해시를 먼저 기록한다.
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO blockchain_transactions (
                            booking_id, tx_hash, tx_type, tx_status, chain_id,
                            contract_address, buyer_wallet_address, gas_price_wei
                        ) VALUES (%s, %s, 'ticket_purchase', 'pending', %s, %s, %s, %s)
                        """,
                        (booking_id, tx_hash_hex, EXPECTED_CHAIN_ID, contract.address, buyer_address, gas_price),
                    )
                conn.commit()
            tx_submission_attempted = True
            tx_hash = web3.eth.send_raw_transaction(signed_txn.raw_transaction)
            if web3.to_hex(tx_hash).lower() != tx_hash_hex.lower():
                raise RuntimeError("서명한 트랜잭션과 제출된 트랜잭션 해시가 일치하지 않습니다.")

        try:
            tx_receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=120, poll_latency=2)
        except TimeExhausted:
            mark_booking_chain_pending("영수증 확인 시간 초과")
            return JSONResponse(
                status_code=202,
                content={
                    "status": "pending",
                    "message": "블록체인 트랜잭션이 제출되었으며 확인을 기다리고 있습니다.",
                    "booking_no": booking_no,
                    "transaction_hash": tx_hash_hex,
                },
            )
        if tx_receipt.status != 1:
            chain_failure_confirmed = True
            raise Exception("블록체인 스마트 컨트랙트 실행 중 Revert 되었습니다.")

        # 5. 발급된 토큰 ID 파싱 및 DB 기록
        transfer_events = contract.events.Transfer().process_receipt(tx_receipt)
        zero_address = "0x0000000000000000000000000000000000000000"
        minted_token_ids = sorted(int(evt["args"]["tokenId"]) for evt in transfer_events if evt["args"]["from"] == zero_address)

        if len(minted_token_ids) != len(request.seat_ids):
            raise Exception("발행된 토큰 수와 요청된 좌석 수가 일치하지 않습니다.")

        seat_to_token = {seat_id: minted_token_ids[idx] for idx, seat_id in enumerate(request.seat_ids)}

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("UPDATE bookings SET booking_status = 'minted', blockchain_status = 'confirmed' WHERE id = %s", (booking_id,))
                for seat_id in request.seat_ids:
                    cursor.execute(
                        "UPDATE booking_items SET ticket_status = 'minted', token_id = %s WHERE booking_id = %s AND seat_id = %s",
                        (seat_to_token[seat_id], booking_id, seat_id)
                    )
                cursor.execute("UPDATE seats SET status = 'booked' WHERE id = ANY(%s)", (request.seat_ids,))
                cursor.execute(
                    """
                    UPDATE blockchain_transactions
                    SET tx_status = 'confirmed', gas_used = %s, block_number = %s,
                        confirmed_at = NOW(), error_message = NULL
                    WHERE tx_hash = %s
                    """,
                    (tx_receipt.gasUsed, tx_receipt.blockNumber, tx_hash_hex),
                )
                cursor.execute(
                    "UPDATE checkout_orders SET status = 'completed', updated_at = NOW() WHERE booking_id = %s",
                    (booking_id,),
                )
            conn.commit()

        return {"status": "success", "message": "티켓이 성공적으로 발급되었습니다.", "booking_no": booking_no, "transaction_hash": tx_hash_hex}

    except HTTPException as e:
        if tx_submission_attempted and not chain_failure_confirmed:
            mark_booking_chain_pending(str(e.detail))
            raise HTTPException(status_code=503, detail=f"블록체인 제출 후 처리가 완료되지 않았습니다. 트랜잭션을 확인해주세요: {tx_hash_hex}")
        mark_booking_failed(str(e.detail), trigger_refund=payment_confirmed)
        raise
    except Exception as e:
        error_msg = str(e)
        logger.exception(
            "티켓 구매 처리 실패: payment_id=%s booking_id=%s tx_hash=%s",
            request.payment_id,
            booking_id,
            tx_hash_hex,
        )
        if tx_submission_attempted and not chain_failure_confirmed:
            mark_booking_chain_pending(error_msg)
            raise HTTPException(status_code=503, detail=f"블록체인 제출 후 처리가 완료되지 않았습니다. 트랜잭션을 확인해주세요: {tx_hash_hex}")
        refund_succeeded = mark_booking_failed(error_msg, trigger_refund=payment_confirmed)
        if refund_succeeded is False:
            raise HTTPException(status_code=500, detail="티켓 발급에 실패했고 자동 환불도 완료되지 않았습니다. 관리자 확인이 필요합니다.")
        raise HTTPException(status_code=500, detail="티켓 발급에 실패하여 결제를 환불 처리했습니다.")


def validate_transfer_item(item, wallet_address):
    if not item:
        raise HTTPException(status_code=404, detail="해당 티켓을 찾을 수 없습니다.")
    if item["ticket_status"] != "minted" or item["token_id"] is None:
        raise HTTPException(status_code=400, detail="발행이 완료되지 않은 티켓은 양도할 수 없습니다.")
    if (item["owner_wallet_address"] or "").lower() != wallet_address.lower():
        raise HTTPException(status_code=403, detail="본인이 소유한 티켓만 양도할 수 있습니다.")
    if item["is_transferred"]:
        raise HTTPException(status_code=400, detail="이미 양도된 티켓입니다. 재양도는 불가능합니다.")


async def load_transfer_context(request):
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id, booking_id, owner_wallet_address, token_id, is_transferred, ticket_status FROM booking_items WHERE id = %s",
                (request.booking_item_id,),
            )
            item = cursor.fetchone()
            validate_transfer_item(item, request.wallet_address)
            try:
                comp_row = resolve_user(cursor, request.companion_username)
            except HTTPException as exc:
                raise HTTPException(status_code=404, detail=f"양도할 대상 '{request.companion_username}' 을(를) 찾을 수 없습니다.") from exc
            if not comp_row or not comp_row.get("wallet_address"):
                raise HTTPException(status_code=404, detail="양도할 대상의 지갑 정보를 찾을 수 없습니다.")
            recipient = web3.to_checksum_address(comp_row["wallet_address"])
            if recipient.lower() == request.wallet_address.lower():
                raise HTTPException(status_code=400, detail="본인에게는 양도할 수 없습니다.")
            await require_active_vc_holder(cursor, recipient, "양도 수령인")
    sender = web3.to_checksum_address(request.wallet_address)
    token_id = int(item["token_id"])
    if contract.functions.ownerOf(token_id).call().lower() != sender.lower():
        raise HTTPException(status_code=409, detail="DB와 블록체인의 티켓 소유자가 일치하지 않습니다.")
    if contract.functions.hasBeenTransferred(token_id).call():
        raise HTTPException(status_code=409, detail="블록체인에서 이미 양도된 티켓입니다.")
    return item, sender, recipient, token_id


@app.post("/api/transfer-ticket/challenge", summary="티켓 양도 EIP-712 서명 요청")
async def transfer_ticket_challenge_api(request: TransferChallengeRequest, session_wallet=Depends(require_user_session)):
    require_matching_wallet(session_wallet, request.wallet_address)
    item, sender, recipient, token_id = await load_transfer_context(request)
    nonce = int(contract.functions.transferNonces(token_id).call())
    deadline = int(time.time()) + 300
    return {
        "status": "success",
        "data": {
            "domain": {
                "name": "PolygonConcertTicket",
                "version": "1",
                "chainId": EXPECTED_CHAIN_ID,
                "verifyingContract": contract.address,
            },
            "types": {
                "TransferTicket": [
                    {"name": "from", "type": "address"},
                    {"name": "to", "type": "address"},
                    {"name": "tokenId", "type": "uint256"},
                    {"name": "nonce", "type": "uint256"},
                    {"name": "deadline", "type": "uint256"},
                ]
            },
            "message": {
                "from": sender,
                "to": recipient,
                "tokenId": token_id,
                "nonce": nonce,
                "deadline": deadline,
            },
        },
    }


@app.post("/api/transfer-ticket", summary="EIP-712 서명 기반 서버 가스 대납 양도")
async def transfer_ticket_api(request: TransferRequest, session_wallet=Depends(require_user_session)):
    tx_hash_hex = None
    tx_submission_attempted = False
    receipt_confirmed = False
    try:
        require_matching_wallet(session_wallet, request.wallet_address)
        now = int(time.time())
        if request.deadline <= now or request.deadline > now + 600:
            raise HTTPException(status_code=400, detail="양도 서명 요청이 만료되었거나 유효기간이 너무 깁니다.")
        try:
            signature = web3.to_bytes(hexstr=request.signature)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="EIP-712 서명 형식이 올바르지 않습니다.") from exc
        if len(signature) != 65:
            raise HTTPException(status_code=400, detail="EIP-712 서명 길이가 올바르지 않습니다.")

        item, sender, recipient, token_id = await load_transfer_context(request)
        chain_nonce = int(contract.functions.transferNonces(token_id).call())
        if request.nonce != chain_nonce:
            raise HTTPException(status_code=409, detail="양도 서명 nonce가 만료되었습니다. 다시 서명해주세요.")

        transfer_call = contract.functions.transferTicket(
            sender, recipient, token_id, request.deadline, signature
        )
        with serialized_server_transaction():
            gas_estimate = transfer_call.estimate_gas({"from": server_account.address})
            gas_price = int(web3.eth.gas_price * 1.5)
            server_nonce = web3.eth.get_transaction_count(server_account.address, "pending")
            txn = transfer_call.build_transaction({
                "chainId": EXPECTED_CHAIN_ID,
                "gas": int(gas_estimate * 1.2),
                "gasPrice": gas_price,
                "nonce": server_nonce,
            })
            signed_txn = web3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
            tx_hash_hex = web3.to_hex(web3.keccak(signed_txn.raw_transaction))
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        INSERT INTO blockchain_transactions (
                            booking_id, tx_hash, tx_type, tx_status, chain_id,
                            contract_address, buyer_wallet_address, gas_price_wei
                        ) VALUES (%s, %s, 'ticket_transfer', 'pending', %s, %s, %s, %s)
                        """,
                        (item["booking_id"], tx_hash_hex, EXPECTED_CHAIN_ID, contract.address, sender, gas_price),
                    )
                conn.commit()
            tx_submission_attempted = True
            tx_hash = web3.eth.send_raw_transaction(signed_txn.raw_transaction)
            if web3.to_hex(tx_hash).lower() != tx_hash_hex.lower():
                raise RuntimeError("서명한 트랜잭션과 제출된 트랜잭션 해시가 일치하지 않습니다.")

        try:
            tx_receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=120, poll_latency=2)
        except TimeExhausted:
            return JSONResponse(
                status_code=202,
                content={
                    "status": "pending",
                    "message": "양도 트랜잭션이 제출되었으며 확인을 기다리고 있습니다.",
                    "transaction_hash": tx_hash_hex,
                },
            )
        if tx_receipt.status != 1:
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("UPDATE blockchain_transactions SET tx_status = 'failed', error_message = 'reverted' WHERE tx_hash = %s", (tx_hash_hex,))
                conn.commit()
            raise HTTPException(status_code=500, detail="양도 트랜잭션이 블록체인에서 실패했습니다.")
        receipt_confirmed = True

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT id FROM booking_items WHERE id = %s FOR UPDATE", (request.booking_item_id,))
                if not cursor.fetchone():
                    raise RuntimeError("양도 후 DB 티켓 정보를 찾을 수 없습니다.")
                cursor.execute(
                    """
                    UPDATE booking_items
                    SET owner_wallet_address = %s, companion_wallet_address = %s,
                        is_transferred = TRUE, transferred_at = NOW()
                    WHERE id = %s
                    """,
                    (recipient, recipient, request.booking_item_id),
                )
                cursor.execute(
                    """
                    UPDATE blockchain_transactions
                    SET tx_status = 'confirmed', gas_used = %s, block_number = %s,
                        confirmed_at = NOW(), error_message = NULL
                    WHERE tx_hash = %s
                    """,
                    (tx_receipt.gasUsed, tx_receipt.blockNumber, tx_hash_hex),
                )
            conn.commit()

        return {"status": "success", "message": "티켓이 성공적으로 양도되었습니다.", "transaction_hash": tx_hash_hex, "recipient": recipient, "token_id": token_id}
    except HTTPException:
        raise
    except Exception as e:
        print(f"🚨 티켓 양도 중 오류 발생: {str(e)}")
        if tx_submission_attempted and not receipt_confirmed:
            raise HTTPException(status_code=503, detail=f"양도 트랜잭션 제출 후 확인이 필요합니다: {tx_hash_hex}")
        if tx_hash_hex and receipt_confirmed:
            raise HTTPException(status_code=503, detail=f"온체인 양도는 성공했지만 DB 반영 확인이 필요합니다: {tx_hash_hex}")
        raise HTTPException(status_code=500, detail="티켓 양도 처리 중 문제가 발생했습니다.")


def _try_lock_pending_transaction(cursor, tx_hash):
    cursor.execute(
        "SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0)) AS acquired",
        (tx_hash,),
    )
    if not cursor.fetchone()["acquired"]:
        return False
    cursor.execute(
        "SELECT tx_status FROM blockchain_transactions WHERE tx_hash = %s FOR UPDATE",
        (tx_hash,),
    )
    row = cursor.fetchone()
    return bool(row and row["tx_status"] == "pending")


def _reconcile_confirmed_purchase(tx_row, receipt):
    zero_address = "0x0000000000000000000000000000000000000000"
    transfer_events = contract.events.Transfer().process_receipt(receipt)
    token_ids = sorted(
        int(event["args"]["tokenId"])
        for event in transfer_events
        if event["args"]["from"].lower() == zero_address
    )
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            if not _try_lock_pending_transaction(cursor, tx_row["tx_hash"]):
                return False
            cursor.execute(
                "SELECT id, seat_id FROM booking_items WHERE booking_id = %s ORDER BY id FOR UPDATE",
                (tx_row["booking_id"],),
            )
            items = cursor.fetchall()
            if not items or len(items) != len(token_ids):
                raise RuntimeError("발행 토큰 수와 예매 좌석 수가 일치하지 않습니다.")
            for item, token_id in zip(items, token_ids):
                cursor.execute(
                    "UPDATE booking_items SET ticket_status = 'minted', token_id = %s WHERE id = %s",
                    (token_id, item["id"]),
                )
            seat_ids = [item["seat_id"] for item in items]
            cursor.execute("UPDATE seats SET status = 'booked' WHERE id = ANY(%s)", (seat_ids,))
            cursor.execute(
                "UPDATE bookings SET booking_status = 'minted', blockchain_status = 'confirmed' WHERE id = %s",
                (tx_row["booking_id"],),
            )
            cursor.execute(
                "UPDATE checkout_orders SET status = 'completed', updated_at = NOW() WHERE booking_id = %s",
                (tx_row["booking_id"],),
            )
            cursor.execute(
                """
                UPDATE blockchain_transactions
                SET tx_status = 'confirmed', gas_used = %s, block_number = %s,
                    confirmed_at = NOW(), error_message = NULL
                WHERE tx_hash = %s
                """,
                (receipt.gasUsed, receipt.blockNumber, tx_row["tx_hash"]),
            )
        conn.commit()
    return True


def _reconcile_confirmed_transfer(tx_row, receipt):
    zero_address = "0x0000000000000000000000000000000000000000"
    transfer_events = [
        event
        for event in contract.events.Transfer().process_receipt(receipt)
        if event["args"]["from"].lower() != zero_address
    ]
    if len(transfer_events) != 1:
        raise RuntimeError("양도 Transfer 이벤트가 정확히 하나가 아닙니다.")
    token_id = int(transfer_events[0]["args"]["tokenId"])
    recipient = web3.to_checksum_address(transfer_events[0]["args"]["to"])
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            if not _try_lock_pending_transaction(cursor, tx_row["tx_hash"]):
                return False
            cursor.execute(
                """
                SELECT id FROM booking_items
                WHERE booking_id = %s AND token_id = %s
                FOR UPDATE
                """,
                (tx_row["booking_id"], token_id),
            )
            item = cursor.fetchone()
            if not item:
                raise RuntimeError("양도된 토큰에 대응하는 예매 좌석을 찾을 수 없습니다.")
            cursor.execute(
                """
                UPDATE booking_items
                SET owner_wallet_address = %s, companion_wallet_address = %s,
                    is_transferred = TRUE, transferred_at = COALESCE(transferred_at, NOW())
                WHERE id = %s
                """,
                (recipient, recipient, item["id"]),
            )
            cursor.execute(
                """
                UPDATE blockchain_transactions
                SET tx_status = 'confirmed', gas_used = %s, block_number = %s,
                    confirmed_at = NOW(), error_message = NULL
                WHERE tx_hash = %s
                """,
                (receipt.gasUsed, receipt.blockNumber, tx_row["tx_hash"]),
            )
        conn.commit()
    return True


def _reconcile_reverted_transaction(tx_row, receipt):
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            if not _try_lock_pending_transaction(cursor, tx_row["tx_hash"]):
                return False
            if tx_row["tx_type"] == "ticket_purchase":
                cursor.execute(
                    "SELECT imp_uid, amount FROM payments WHERE booking_id = %s FOR UPDATE",
                    (tx_row["booking_id"],),
                )
                payment = cursor.fetchone()
                amount = int(payment["amount"] or 0) if payment else 0
                refund_succeeded = amount == 0
                if payment and amount > 0:
                    try:
                        refund_succeeded = bool(cancel_portone_v2_payment(
                            payment["imp_uid"],
                            "블록체인 발급 트랜잭션 실패",
                            amount,
                        ))
                    except Exception:
                        refund_succeeded = False
                payment_status = "refunded" if refund_succeeded and amount > 0 else (
                    "refund_failed" if amount > 0 else "failed"
                )
                cursor.execute(
                    "UPDATE bookings SET booking_status = 'failed', payment_status = %s, blockchain_status = 'failed' WHERE id = %s",
                    (payment_status, tx_row["booking_id"]),
                )
                cursor.execute(
                    "UPDATE payments SET payment_status = %s, failure_reason = %s WHERE booking_id = %s",
                    (payment_status, "블록체인 트랜잭션 revert", tx_row["booking_id"]),
                )
                cursor.execute(
                    "UPDATE booking_items SET ticket_status = 'failed' WHERE booking_id = %s",
                    (tx_row["booking_id"],),
                )
                cursor.execute(
                    "UPDATE checkout_orders SET status = %s, updated_at = NOW() WHERE booking_id = %s",
                    (payment_status, tx_row["booking_id"]),
                )
                cursor.execute(
                    """
                    UPDATE seats SET status = 'available', hold_expires_at = NULL
                    WHERE id IN (SELECT seat_id FROM booking_items WHERE booking_id = %s)
                    """,
                    (tx_row["booking_id"],),
                )
            cursor.execute(
                """
                UPDATE blockchain_transactions
                SET tx_status = 'failed', gas_used = %s, block_number = %s,
                    confirmed_at = NOW(), error_message = 'reverted'
                WHERE tx_hash = %s
                """,
                (receipt.gasUsed, receipt.blockNumber, tx_row["tx_hash"]),
            )
        conn.commit()
    return True


def reconcile_pending_blockchain_transactions(limit=50):
    """Apply final Polygon receipts that arrived after an API timeout/restart."""
    with get_db_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT booking_id, tx_hash, tx_type
                FROM blockchain_transactions
                WHERE tx_status = 'pending'
                  AND tx_type IN ('ticket_purchase', 'ticket_transfer')
                ORDER BY submitted_at ASC
                LIMIT %s
                """,
                (limit,),
            )
            pending_rows = cursor.fetchall()

    reconciled = 0
    for tx_row in pending_rows:
        try:
            receipt = web3.eth.get_transaction_receipt(tx_row["tx_hash"])
        except TransactionNotFound:
            continue
        except Exception as exc:
            print(f"⚠️ 보류 트랜잭션 영수증 조회 실패 ({tx_row['tx_hash']}): {type(exc).__name__}")
            continue
        try:
            if receipt.status != 1:
                changed = _reconcile_reverted_transaction(tx_row, receipt)
            elif tx_row["tx_type"] == "ticket_purchase":
                changed = _reconcile_confirmed_purchase(tx_row, receipt)
            else:
                changed = _reconcile_confirmed_transfer(tx_row, receipt)
            reconciled += int(bool(changed))
        except Exception as exc:
            print(f"⚠️ 보류 트랜잭션 DB 반영 실패 ({tx_row['tx_hash']}): {type(exc).__name__}")
    return {"checked": len(pending_rows), "reconciled": reconciled}


async def _pending_transaction_reconciliation_worker():
    await asyncio.sleep(5)
    while True:
        try:
            result = await asyncio.to_thread(reconcile_pending_blockchain_transactions)
            if result["reconciled"]:
                print(f"✅ 보류 블록체인 트랜잭션 {result['reconciled']}건 반영 완료")
        except Exception as exc:
            print(f"⚠️ 보류 트랜잭션 자동 확인 실패: {type(exc).__name__}")
        await asyncio.sleep(30)


@app.on_event("startup")
async def start_pending_transaction_reconciliation():
    app.state.pending_transaction_worker = asyncio.create_task(
        _pending_transaction_reconciliation_worker()
    )


@app.on_event("shutdown")
async def stop_pending_transaction_reconciliation():
    worker = getattr(app.state, "pending_transaction_worker", None)
    if worker:
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass


async def _checkout_hold_cleanup_worker():
    await asyncio.sleep(2)
    while True:
        try:
            expired_count = await asyncio.to_thread(expire_checkout_holds)
            if expired_count:
                print(f"✅ 만료된 좌석 선점 {expired_count}건 반환 완료")
        except Exception as exc:
            print(f"⚠️ 만료 좌석 선점 정리 실패: {type(exc).__name__}")
        await asyncio.sleep(15)


@app.on_event("startup")
async def start_checkout_hold_cleanup():
    app.state.checkout_hold_cleanup_worker = asyncio.create_task(
        _checkout_hold_cleanup_worker()
    )


@app.on_event("shutdown")
async def stop_checkout_hold_cleanup():
    worker = getattr(app.state, "checkout_hold_cleanup_worker", None)
    if worker:
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass


@app.post("/api/admin/blockchain/reconcile", summary="보류 블록체인 트랜잭션 즉시 확인")
async def reconcile_blockchain_transactions_api(admin=Depends(require_admin)):
    result = await asyncio.to_thread(reconcile_pending_blockchain_transactions)
    return {"status": "success", "data": result}

# =================================================================
# 관리자(Admin) API 로직 모음
# =================================================================
@app.post("/api/admin/login", summary="관리자 로그인")
async def admin_login_api(request: AdminLoginRequest, http_request: Request):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, login_id, display_name, role
                    FROM admins
                    WHERE login_id = %s AND password_hash = %s AND status = 'active'
                    """,
                    (request.login_id, request.password)
                )
                admin = cursor.fetchone()
                if not admin:
                    raise HTTPException(status_code=401, detail="관리자 인증에 실패했습니다.")

                cursor.execute("UPDATE admins SET last_login_at = NOW() WHERE id = %s", (admin["id"],))
                cursor.execute(
                    """
                    INSERT INTO admin_logs (admin_id, action, target_table, target_id, ip_address, user_agent)
                    VALUES (%s, 'admin_login', 'admins', %s, %s, %s)
                    """,
                    (
                        admin["id"],
                        str(admin["id"]),
                        get_request_ip(http_request),
                        http_request.headers.get("user-agent"),
                    )
                )
            conn.commit()

        return {
            "status": "success",
            "data": {
                "id": admin["id"],
                "login_id": admin["login_id"],
                "display_name": admin["display_name"],
                "role": admin["role"],
                "token": create_admin_token(admin),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"관리자 로그인 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="관리자 로그인 중 서버 오류가 발생했습니다.")

@app.get("/api/admin/stats", summary="관리자 통계")
async def admin_stats_api(admin=Depends(require_admin)):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                total_bookings = count_rows(cursor, "SELECT COUNT(*) AS count FROM bookings", ())

                cursor.execute("SELECT COALESCE(SUM(amount), 0) AS amount FROM payments WHERE payment_status = 'paid'")
                total_sales = int(cursor.fetchone()["amount"] or 0)

                did_users = count_rows(cursor, "SELECT COUNT(*) AS count FROM users WHERE auth_provider = 'did_keystore' AND status = 'active'", ())
                confirmed_transactions = count_rows(cursor, "SELECT COUNT(*) AS count FROM blockchain_transactions WHERE tx_status = 'confirmed'", ())

        gas_balance = float(web3.from_wei(web3.eth.get_balance(server_account.address), "ether"))
        return {
            "status": "success",
            "data": {
                "total_bookings": total_bookings,
                "total_sales": total_sales,
                "did_users": did_users,
                "confirmed_transactions": confirmed_transactions,
                "gas_balance": round(gas_balance, 4),
            }
        }
    except Exception as e:
        print(f"관리자 통계 조회 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="관리자 통계를 불러오지 못했습니다.")

@app.post("/api/admin/events", summary="관리자 공연 등록")
async def create_event_api(request: EventCreateRequest, http_request: Request, admin=Depends(require_admin)):
    try:
        validate_choice(request.status, EVENT_STATUSES, "공연 상태값")
        price_amount, price_display = parse_price_input(request.price)
        end_at = blank_to_none(request.end_at)
        poster_url = blank_to_none(request.image)
        category = blank_to_none(request.category) or "concert"
        session_end_at = blank_to_none(request.session_end_at) or end_at

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("LOCK TABLE events IN EXCLUSIVE MODE")
                cursor.execute("LOCK TABLE event_sessions IN EXCLUSIVE MODE")

                event_id = next_table_id(cursor, "events")
                session_id = next_table_id(cursor, "event_sessions")
                cursor.execute("SELECT COALESCE(MAX(display_order), 0) + 1 AS display_order FROM events")
                display_order = cursor.fetchone()["display_order"]

                cursor.execute(
                    """
                    INSERT INTO events (
                        id, title, venue, display_time_text, period_text, start_at, end_at,
                        age_rating, price_amount, price_display, currency, poster_url,
                        category, display_order, is_featured, status
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'KRW', %s, %s, %s, FALSE, %s)
                    RETURNING id, title, venue, display_time_text, period_text, age_rating,
                              price_amount, price_display, poster_url, category, status
                    """,
                    (
                        event_id,
                        request.name,
                        request.location,
                        request.time,
                        request.period,
                        request.start_at,
                        end_at,
                        request.age,
                        price_amount,
                        price_display,
                        poster_url,
                        category,
                        display_order,
                        request.status,
                    )
                )
                event = cursor.fetchone()

                cursor.execute(
                    """
                    INSERT INTO event_sessions (
                        id, event_id, session_name, session_start_at, session_end_at, sale_status
                    ) VALUES (%s, %s, %s, %s, %s, 'open')
                    """,
                    (
                        session_id,
                        event_id,
                        request.session_name,
                        request.start_at,
                        session_end_at,
                    )
                )

                for seat_number in range(1, request.seat_count + 1):
                    cursor.execute(
                        """
                        INSERT INTO seats (
                            event_session_id, seat_code, section_name, row_label, seat_number, grade, price_amount, status
                        ) VALUES (%s, %s, 'STANDARD', 'A', %s, '일반석', %s, 'available')
                        """,
                        (session_id, f"A{seat_number}", str(seat_number), price_amount)
                    )
                log_admin_action(
                    cursor,
                    admin,
                    "event_create",
                    "events",
                    event_id,
                    None,
                    {
                        **event,
                        "session_id": session_id,
                        "seat_count": request.seat_count,
                    },
                    request=http_request,
                )
            conn.commit()

        return {
            "status": "success",
            "message": "공연이 데이터베이스에 성공적으로 등록되었습니다.",
            "data": event_to_ticket(event),
        }

    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(status_code=400, detail="가격 또는 날짜 형식이 올바르지 않습니다.")
    except Exception as e:
        print(f"공연 등록 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="공연 등록 중 서버 오류가 발생했습니다.")

@app.put("/api/admin/events/{event_id}", summary="관리자 공연 정보 수정")
async def update_event_api(event_id: int, request: EventUpdateRequest, http_request: Request, admin=Depends(require_admin)):
    try:
        validate_choice(request.status, EVENT_STATUSES, "공연 상태값")
        price_amount, price_display = parse_price_input(request.price)

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                before_event = get_required_event_snapshot(cursor, event_id)

                # 1. events 테이블 업데이트
                cursor.execute(
                    """
                    UPDATE events
                    SET title = %s, venue = %s, price_amount = %s, price_display = %s, status = %s
                    WHERE id = %s
                    """,
                    (request.name, request.location, price_amount, price_display, request.status, event_id)
                )

                # 2. seats 테이블 업데이트
                cursor.execute(
                    """
                    UPDATE seats
                    SET price_amount = %s
                    WHERE event_session_id IN (
                        SELECT id FROM event_sessions WHERE event_id = %s
                    )
                    """,
                    (price_amount, event_id)
                )
                after_event = get_event_log_snapshot(cursor, event_id)
                log_admin_action(
                    cursor,
                    admin,
                    "event_update",
                    "events",
                    event_id,
                    before_event,
                    after_event,
                    request=http_request,
                )

            conn.commit()

        return {"status": "success", "message": "공연 정보가 데이터베이스에 성공적으로 수정되었습니다."}

    except ValueError:
        raise HTTPException(status_code=400, detail="가격 형식이 올바르지 않습니다. 숫자 또는 '무료'로 입력해주세요.")
    except HTTPException:
        raise
    except Exception as e:
        print(f"공연 정보 수정 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="공연 정보 수정 중 서버 오류가 발생했습니다.")

@app.delete("/api/admin/events/{event_id}", summary="관리자 공연 삭제")
async def delete_event_api(event_id: int, http_request: Request, admin=Depends(require_admin)):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                before_event = get_required_event_snapshot(cursor, event_id)

                booking_count = count_rows(cursor, "SELECT COUNT(*) AS count FROM bookings WHERE event_id = %s", (event_id,))

                if booking_count > 0:
                    cursor.execute(
                        """
                        UPDATE events
                        SET status = 'hidden'
                        WHERE id = %s
                        """,
                        (event_id,)
                    )
                    cursor.execute(
                        """
                        UPDATE event_sessions
                        SET sale_status = 'closed'
                        WHERE event_id = %s
                        """,
                        (event_id,)
                    )
                    cursor.execute(
                        """
                        UPDATE seats
                        SET status = 'disabled'
                        WHERE event_session_id IN (
                            SELECT id FROM event_sessions WHERE event_id = %s
                        ) AND status IN ('available', 'holding', 'locked')
                        """,
                        (event_id,)
                    )
                    message = "예매 이력이 있어 공연을 숨김 처리했습니다."
                    after_event = get_event_log_snapshot(cursor, event_id)
                    log_admin_action(
                        cursor,
                        admin,
                        "event_hide",
                        "events",
                        event_id,
                        before_event,
                        after_event,
                        request=http_request,
                    )
                else:
                    cursor.execute("DELETE FROM events WHERE id = %s", (event_id,))
                    message = "공연이 데이터베이스에서 삭제되었습니다."
                    log_admin_action(
                        cursor,
                        admin,
                        "event_delete",
                        "events",
                        event_id,
                        before_event,
                        None,
                        request=http_request,
                    )
            conn.commit()

        return {"status": "success", "message": message}

    except HTTPException:
        raise
    except Exception as e:
        print(f"공연 삭제 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="공연 삭제 중 서버 오류가 발생했습니다.")

@app.get("/api/admin/events/{event_id}/sessions", summary="관리자 공연 회차 목록")
async def admin_event_sessions_api(event_id: int, admin=Depends(require_admin)):
    return await event_sessions_api(event_id)

@app.post("/api/admin/events/{event_id}/sessions", summary="관리자 공연 회차 등록")
async def create_session_api(event_id: int, request: SessionCreateRequest, http_request: Request, admin=Depends(require_admin)):
    try:
        validate_choice(request.sale_status, SESSION_STATUSES, "회차 판매 상태값")
        session_end_at = blank_to_none(request.session_end_at)

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                fetch_one_or_404(cursor, "SELECT id FROM events WHERE id = %s", (event_id,), "해당 공연을 찾을 수 없습니다.")

                cursor.execute("LOCK TABLE event_sessions IN EXCLUSIVE MODE")
                session_id = next_table_id(cursor, "event_sessions")
                cursor.execute(
                    """
                    INSERT INTO event_sessions (
                        id, event_id, session_name, session_start_at, session_end_at, sale_status
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id, event_id, session_name, session_start_at, session_end_at, sale_status
                    """,
                    (
                        session_id,
                        event_id,
                        request.session_name,
                        request.session_start_at,
                        session_end_at,
                        request.sale_status,
                    )
                )
                session = cursor.fetchone()
                log_admin_action(
                    cursor,
                    admin,
                    "session_create",
                    "event_sessions",
                    session_id,
                    None,
                    session,
                    request=http_request,
                )
            conn.commit()

        return {
            "status": "success",
            "message": "회차가 데이터베이스에 등록되었습니다.",
            "data": format_session_response(session),
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"회차 등록 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="회차 등록 중 서버 오류가 발생했습니다.")

@app.put("/api/admin/sessions/{session_id}", summary="관리자 회차 수정")
async def update_session_api(session_id: int, request: SessionUpdateRequest, http_request: Request, admin=Depends(require_admin)):
    try:
        validate_choice(request.sale_status, SESSION_STATUSES, "회차 판매 상태값")
        session_end_at = blank_to_none(request.session_end_at)

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                before_session = get_required_session_snapshot(cursor, session_id)

                cursor.execute(
                    """
                    UPDATE event_sessions
                    SET session_name = %s, session_start_at = %s, session_end_at = %s, sale_status = %s
                    WHERE id = %s
                    """,
                    (
                        request.session_name,
                        request.session_start_at,
                        session_end_at,
                        request.sale_status,
                        session_id,
                    )
                )
                after_session = get_session_log_snapshot(cursor, session_id)
                log_admin_action(
                    cursor,
                    admin,
                    "session_update",
                    "event_sessions",
                    session_id,
                    before_session,
                    after_session,
                    request=http_request,
                )
            conn.commit()

        return {"status": "success", "message": "회차 정보가 데이터베이스에 수정되었습니다."}

    except HTTPException:
        raise
    except Exception as e:
        print(f"회차 수정 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="회차 수정 중 서버 오류가 발생했습니다.")

@app.delete("/api/admin/sessions/{session_id}", summary="관리자 회차 삭제")
async def delete_session_api(session_id: int, http_request: Request, admin=Depends(require_admin)):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                before_session = get_required_session_snapshot(cursor, session_id)

                booking_count = count_rows(cursor, "SELECT COUNT(*) AS count FROM bookings WHERE event_session_id = %s", (session_id,))

                if booking_count > 0:
                    cursor.execute("UPDATE event_sessions SET sale_status = 'closed' WHERE id = %s", (session_id,))
                    cursor.execute(
                        """
                        UPDATE seats
                        SET status = 'disabled'
                        WHERE event_session_id = %s AND status IN ('available', 'holding', 'locked')
                        """,
                        (session_id,)
                    )
                    after_session = get_session_log_snapshot(cursor, session_id)
                    action = "session_close"
                    message = "예매 이력이 있어 회차를 닫힘 처리했습니다."
                else:
                    cursor.execute("DELETE FROM event_sessions WHERE id = %s", (session_id,))
                    after_session = None
                    action = "session_delete"
                    message = "회차가 데이터베이스에서 삭제되었습니다."

                log_admin_action(
                    cursor,
                    admin,
                    action,
                    "event_sessions",
                    session_id,
                    before_session,
                    after_session,
                    request=http_request,
                )
            conn.commit()

        return {"status": "success", "message": message}

    except HTTPException:
        raise
    except Exception as e:
        print(f"회차 삭제 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="회차 삭제 중 서버 오류가 발생했습니다.")

@app.get("/api/admin/sessions/{session_id}/seats", summary="관리자 회차 좌석 목록")
async def admin_session_seats_api(session_id: int, admin=Depends(require_admin)):
    return await session_seats_api(session_id)

@app.post("/api/admin/sessions/{session_id}/seats/bulk", summary="관리자 좌석 일괄 생성")
async def create_seats_bulk_api(session_id: int, request: SeatBulkCreateRequest, http_request: Request, admin=Depends(require_admin)):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT id FROM event_sessions WHERE id = %s", (session_id,))
                if not cursor.fetchone():
                    raise HTTPException(status_code=404, detail="해당 회차를 찾을 수 없습니다.")

                created_seats = []
                for seat_number in range(request.start_number, request.start_number + request.seat_count):
                    seat_code = f"{request.row_label}{seat_number}"
                    cursor.execute(
                        """
                        INSERT INTO seats (
                            event_session_id, seat_code, section_name, row_label, seat_number, grade, price_amount, status
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'available')
                        ON CONFLICT (event_session_id, seat_code) DO NOTHING
                        RETURNING id, event_session_id, seat_code, section_name, row_label, seat_number, grade, price_amount, status
                        """,
                        (
                            session_id,
                            seat_code,
                            request.section_name,
                            request.row_label,
                            str(seat_number),
                            request.grade,
                            request.price_amount,
                        )
                    )
                    row = cursor.fetchone()
                    if row:
                        created_seats.append(seat_to_dict(row))

                log_admin_action(
                    cursor,
                    admin,
                    "seat_bulk_create",
                    "seats",
                    session_id,
                    None,
                    {
                        "event_session_id": session_id,
                        "requested_count": request.seat_count,
                        "created_count": len(created_seats),
                        "row_label": request.row_label,
                        "start_number": request.start_number,
                    },
                    request=http_request,
                )
            conn.commit()

        return {
            "status": "success",
            "message": f"{len(created_seats)}개의 좌석이 데이터베이스에 등록되었습니다.",
            "data": created_seats,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"좌석 일괄 등록 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="좌석 일괄 등록 중 서버 오류가 발생했습니다.")

@app.put("/api/admin/seats/{seat_id}", summary="관리자 좌석 수정")
async def update_seat_api(seat_id: int, request: SeatUpdateRequest, http_request: Request, admin=Depends(require_admin)):
    try:
        validate_choice(request.status, SEAT_STATUSES, "좌석 상태값")

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                before_seat = get_required_seat_snapshot(cursor, seat_id)

                cursor.execute("SELECT id FROM booking_items WHERE seat_id = %s LIMIT 1", (seat_id,))
                if cursor.fetchone() and request.status == "available":
                    raise HTTPException(status_code=400, detail="예매 이력이 있는 좌석은 available 상태로 되돌릴 수 없습니다.")

                cursor.execute(
                    """
                    UPDATE seats
                    SET seat_code = %s, section_name = %s, row_label = %s,
                        seat_number = %s, grade = %s, price_amount = %s, status = %s
                    WHERE id = %s
                    """,
                    (
                        request.seat_code,
                        request.section_name,
                        request.row_label,
                        request.seat_number,
                        request.grade,
                        request.price_amount,
                        request.status,
                        seat_id,
                    )
                )
                after_seat = get_seat_log_snapshot(cursor, seat_id)
                log_admin_action(
                    cursor,
                    admin,
                    "seat_update",
                    "seats",
                    seat_id,
                    before_seat,
                    after_seat,
                    request=http_request,
                )
            conn.commit()

        return {"status": "success", "message": "좌석 정보가 데이터베이스에 수정되었습니다."}

    except HTTPException:
        raise
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="같은 회차에 이미 존재하는 좌석 코드입니다.")
    except Exception as e:
        print(f"좌석 수정 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="좌석 수정 중 서버 오류가 발생했습니다.")

@app.delete("/api/admin/seats/{seat_id}", summary="관리자 좌석 삭제")
async def delete_seat_api(seat_id: int, http_request: Request, admin=Depends(require_admin)):
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                before_seat = get_required_seat_snapshot(cursor, seat_id)

                cursor.execute("SELECT id FROM booking_items WHERE seat_id = %s LIMIT 1", (seat_id,))
                if cursor.fetchone():
                    cursor.execute("UPDATE seats SET status = 'disabled' WHERE id = %s", (seat_id,))
                    after_seat = get_seat_log_snapshot(cursor, seat_id)
                    action = "seat_disable"
                    message = "예매 이력이 있어 좌석을 비활성화했습니다."
                else:
                    cursor.execute("DELETE FROM seats WHERE id = %s", (seat_id,))
                    after_seat = None
                    action = "seat_delete"
                    message = "좌석이 데이터베이스에서 삭제되었습니다."

                log_admin_action(
                    cursor,
                    admin,
                    action,
                    "seats",
                    seat_id,
                    before_seat,
                    after_seat,
                    request=http_request,
                )
            conn.commit()

        return {"status": "success", "message": message}

    except HTTPException:
        raise
    except Exception as e:
        print(f"좌석 삭제 에러: {str(e)}")
        raise HTTPException(status_code=500, detail="좌석 삭제 중 서버 오류가 발생했습니다.")
