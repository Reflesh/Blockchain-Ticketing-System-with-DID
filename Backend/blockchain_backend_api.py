try:
    from .blockchain_backend import (
        AdminLoginRequest, Depends, EVENT_STATUSES, EventCreateRequest,
        EventUpdateRequest, HTTPException, LoginRequest, PRIVATE_KEY, Query,
        Request, SEAT_STATUSES, SESSION_STATUSES, SeatBulkCreateRequest,
        SeatUpdateRequest, SessionCreateRequest, SessionUpdateRequest,
        SignUpRequest, TicketRequest, TransferRequest, UserProfileResponse, VerifyRequest,
        WishlistRequest, app, blank_to_none, cancel_portone_v2_payment,
        contract, count_rows, create_admin_token, encode_defunct,
        event_to_ticket, fetch_one_or_404, format_price_display,
        format_session_response, get_db_connection, get_event_log_snapshot,
        get_portone_v1_access_token, get_portone_v2_payment, get_request_ip,
        get_required_event_snapshot, get_required_seat_snapshot,
        get_required_session_snapshot, get_seat_log_snapshot,
        get_session_log_snapshot, hash_identifier, json, log_admin_action,
        next_table_id, parse_price_input, psycopg, requests,
        require_active_vc_holder, require_admin, require_matching_wallet,
        require_user_session, resolve_user, seat_to_dict, server_account,
        uuid, validate_choice, web3,
    )
except ImportError:
    from blockchain_backend import (
        AdminLoginRequest, Depends, EVENT_STATUSES, EventCreateRequest,
        EventUpdateRequest, HTTPException, LoginRequest, PRIVATE_KEY, Query,
        Request, SEAT_STATUSES, SESSION_STATUSES, SeatBulkCreateRequest,
        SeatUpdateRequest, SessionCreateRequest, SessionUpdateRequest,
        SignUpRequest, TicketRequest, TransferRequest, UserProfileResponse, VerifyRequest,
        WishlistRequest, app, blank_to_none, cancel_portone_v2_payment,
        contract, count_rows, create_admin_token, encode_defunct,
        event_to_ticket, fetch_one_or_404, format_price_display,
        format_session_response, get_db_connection, get_event_log_snapshot,
        get_portone_v1_access_token, get_portone_v2_payment, get_request_ip,
        get_required_event_snapshot, get_required_seat_snapshot,
        get_required_session_snapshot, get_seat_log_snapshot,
        get_session_log_snapshot, hash_identifier, json, log_admin_action,
        next_table_id, parse_price_input, psycopg, requests,
        require_active_vc_holder, require_admin, require_matching_wallet,
        require_user_session, resolve_user, seat_to_dict, server_account,
        uuid, validate_choice, web3,
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

    def mark_booking_failed(reason, trigger_refund=False):
        nonlocal refund_attempted
        if trigger_refund and payment_confirmed and paid_amount > 0 and request.payment_id and not refund_attempted:
            refund_attempted = True
            print(f"🔄 블록체인 실패. 자동 환불 시도: {request.payment_id}")
            cancel_portone_v2_payment(request.payment_id, f"발급 실패: {reason}", paid_amount)
        if not booking_id: return
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("UPDATE bookings SET booking_status = 'failed', payment_status = 'refunded' WHERE id = %s", (booking_id,))
                    cursor.execute("UPDATE payments SET payment_status = 'refunded' WHERE booking_id = %s", (booking_id,))
                    cursor.execute("UPDATE booking_items SET ticket_status = 'failed' WHERE booking_id = %s", (booking_id,))
                    if locked_seat_ids:
                        cursor.execute("UPDATE seats SET status = 'available' WHERE id = ANY(%s)", (locked_seat_ids,))
                conn.commit()
        except Exception: pass

    try:
        # 1. 기본 입력값 검증 및 DID 서명 검증
        require_matching_wallet(session_wallet, request.wallet_address)
        if not request.payment_id:
            raise HTTPException(status_code=400, detail="결제 정보(payment_id)가 누락되었습니다.")

        if not request.seat_ids:
            raise HTTPException(status_code=400, detail="예매할 좌석을 한 석 이상 선택해야 합니다.")

        if len(request.seat_ids) > 4:
            raise HTTPException(status_code=400, detail="한 번에 최대 4석까지만 예매할 수 있습니다.")

        if len(set(request.seat_ids)) != len(request.seat_ids):
            raise HTTPException(status_code=400, detail="중복된 좌석이 포함되어 있습니다.")

        payload_str = json.dumps({
            "wallet_address": request.wallet_address,
            "event_id": request.event_id,
            "event_session_id": request.event_session_id,
            "seat_ids": request.seat_ids,
            "payment_id": request.payment_id
        }, separators=(",", ":"))

        recovered_address = web3.eth.account.recover_message(encode_defunct(text=payload_str), signature=request.signature)
        if recovered_address.lower() != request.wallet_address.lower():
            raise HTTPException(status_code=401, detail="DID 서명 검증 실패.")
        buyer_address = request.wallet_address

        # 2. PG사 결제 내역 조회 및 금액 검증
        payment_info = get_portone_v2_payment(request.payment_id)
        if payment_info.get("status") != "PAID":
            raise HTTPException(status_code=400, detail="결제가 완료되지 않았습니다.")
        paid_amount = int(payment_info.get("amount", {}).get("total", 0))
        payment_confirmed = True

        # 3. DB 기록 및 상태 업데이트
        booking_no = f"BK-{uuid.uuid4().hex[:12].upper()}"
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
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
                    "SELECT id, event_session_id, seat_code, price_amount, status FROM seats WHERE id = ANY(%s) FOR UPDATE",
                    (request.seat_ids,)
                )
                seat_rows = cursor.fetchall()

                if len(seat_rows) != len(request.seat_ids):
                    raise HTTPException(status_code=400, detail="일부 좌석 정보를 찾을 수 없습니다.")
                invalid_session_seats = [s["seat_code"] for s in seat_rows if s["event_session_id"] != request.event_session_id]
                if invalid_session_seats:
                    raise HTTPException(status_code=400, detail=f"선택한 회차에 속하지 않는 좌석이 포함되어 있습니다: {', '.join(invalid_session_seats)}")
                unavailable = [s["seat_code"] for s in seat_rows if s["status"] != "available"]
                if unavailable:
                    raise HTTPException(status_code=409, detail=f"이미 선점된 좌석입니다: {', '.join(unavailable)}")

                total_amount = sum(int(seat["price_amount"] or 0) for seat in seat_rows)
                locked_seat_ids = list(request.seat_ids)

                if paid_amount != total_amount:
                    raise HTTPException(status_code=403, detail="결제 금액이 일치하지 않습니다.")

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

                cursor.execute("UPDATE seats SET status = 'locked' WHERE id = ANY(%s)", (request.seat_ids,))
            conn.commit()

        # 4. 블록체인에 다중 민팅 요청 (가스 대납)
        nonce = web3.eth.get_transaction_count(server_account.address, "pending")
        print(f"🚀 [{buyer_address}] 스마트 컨트랙트 일괄 민팅 요청 중...")

        txn = contract.functions.buyTicketsFor(
            web3.to_checksum_address(buyer_address),
            request.event_id,
            len(request.seat_ids)
        ).build_transaction({
            "chainId": 137,
            "gas": 800000,
            "gasPrice": int(web3.eth.gas_price * 1.5),
            "nonce": nonce
        })

        signed_txn = web3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
        tx_hash = web3.eth.send_raw_transaction(signed_txn.raw_transaction)
        tx_hash_hex = web3.to_hex(tx_hash)

        tx_receipt = web3.eth.wait_for_transaction_receipt(tx_hash)
        if tx_receipt.status != 1:
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
                cursor.execute("INSERT INTO blockchain_transactions (booking_id, tx_hash, tx_type, tx_status, gas_used) VALUES (%s, %s, 'ticket_purchase', 'confirmed', %s)", (booking_id, tx_hash_hex, tx_receipt.gasUsed))
            conn.commit()

        return {"status": "success", "message": "티켓이 성공적으로 발급되었습니다.", "booking_no": booking_no, "transaction_hash": tx_hash_hex}

    except HTTPException as e:
        mark_booking_failed(str(e.detail), trigger_refund=payment_confirmed)
        raise
    except Exception as e:
        error_msg = str(e)
        mark_booking_failed(error_msg, trigger_refund=payment_confirmed)
        raise HTTPException(status_code=500, detail=f"예매 처리 중 문제가 발생하여 결제가 안전하게 환불 처리되었습니다: {error_msg}")

# 🚨 변경 사항 적용됨: 서버 주도 동반인 양도 API
@app.post("/api/transfer-ticket", summary="서버 주도 동반인 양도 (가스비 대납)")
async def transfer_ticket_api(request: TransferRequest, session_wallet=Depends(require_user_session)):
    try:
        require_matching_wallet(session_wallet, request.wallet_address)
        if not request.signature or not request.wallet_address:
            raise HTTPException(status_code=401, detail="DID 서명과 지갑 주소가 필요합니다.")

        # 1. 서명 검증 (누구에게 양도하는지도 서명에 포함)
        payload_str = json.dumps({
            "wallet_address": request.wallet_address,
            "booking_item_id": request.booking_item_id,
            "companion_username": request.companion_username
        }, separators=(",", ":"))

        recovered_address = web3.eth.account.recover_message(encode_defunct(text=payload_str), signature=request.signature)
        if recovered_address.lower() != request.wallet_address.lower():
            raise HTTPException(status_code=401, detail="DID 서명 검증 실패.")

        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                # 2. 티켓 정보 조회 및 권한/상태 검증
                cursor.execute(
                    "SELECT id, booking_id, owner_wallet_address, token_id, is_transferred, ticket_status FROM booking_items WHERE id = %s FOR UPDATE",
                    (request.booking_item_id,)
                )
                item = cursor.fetchone()

                if not item:
                    raise HTTPException(status_code=404, detail="해당 티켓을 찾을 수 없습니다.")
                if item["ticket_status"] != "minted" or item["token_id"] is None:
                    raise HTTPException(status_code=400, detail="발행이 완료되지 않은 티켓은 양도할 수 없습니다.")
                if (item["owner_wallet_address"] or "").lower() != request.wallet_address.lower():
                    raise HTTPException(status_code=403, detail="본인이 소유한 티켓만 양도할 수 있습니다.")
                if item["is_transferred"]:
                    raise HTTPException(status_code=400, detail="이미 양도된 티켓입니다. 재양도는 불가능합니다.")

                token_id = int(item["token_id"])
                booking_id = item["booking_id"]

                # 3. 양도 대상 닉네임으로 지갑 주소 조회
                try:
                    comp_row = resolve_user(cursor, request.companion_username)
                except HTTPException as he:
                    raise HTTPException(status_code=404, detail=f"양도할 대상 '{request.companion_username}' 을(를) 찾을 수 없습니다. 가입된 닉네임을 정확히 입력해주세요.") from he

                if not comp_row or not comp_row.get("wallet_address"):
                    raise HTTPException(status_code=404, detail="양도할 대상의 지갑 정보를 찾을 수 없습니다.")

                recipient = web3.to_checksum_address(comp_row["wallet_address"])
                if recipient.lower() == request.wallet_address.lower():
                    raise HTTPException(status_code=400, detail="본인에게는 양도할 수 없습니다.")
                await require_active_vc_holder(cursor, recipient, "양도 수령인")

            # 4. 온체인 트랜잭션 전송 (사용자의 키가 아닌 서버의 키로 대리 실행)
            sender = web3.to_checksum_address(request.wallet_address)
            nonce = web3.eth.get_transaction_count(server_account.address, "pending")
            print(f"🚀 [{sender}] → [{recipient}] 토큰 #{token_id} 양도 트랜잭션 요청 중...")

            txn = contract.functions.transferTicket(sender, recipient, token_id).build_transaction({
                "chainId": 137,
                "gas": 300000,
                "gasPrice": int(web3.eth.gas_price * 1.5),
                "nonce": nonce,
            })

            signed_txn = web3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY) # 서버 개인키로 서명
            tx_hash = web3.eth.send_raw_transaction(signed_txn.raw_transaction)
            tx_hash_hex = web3.to_hex(tx_hash)

            tx_receipt = web3.eth.wait_for_transaction_receipt(tx_hash)
            if tx_receipt.status != 1:
                raise Exception("양도 트랜잭션이 Revert 되었습니다.")

            # 5. 양도 완료 후 DB 업데이트
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE booking_items
                    SET owner_wallet_address = %s,
                        companion_wallet_address = %s,
                        is_transferred = TRUE,
                        transferred_at = NOW()
                    WHERE id = %s
                    """,
                    (recipient, recipient, request.booking_item_id)
                )
                cursor.execute(
                    "INSERT INTO blockchain_transactions (booking_id, tx_hash, tx_type, tx_status, gas_used) VALUES (%s, %s, 'ticket_transfer', 'confirmed', %s)",
                    (booking_id, tx_hash_hex, tx_receipt.gasUsed)
                )
            conn.commit()

        return {"status": "success", "message": "티켓이 성공적으로 양도되었습니다.", "transaction_hash": tx_hash_hex, "recipient": recipient, "token_id": token_id}

    except HTTPException: raise
    except Exception as e:
        print(f"🚨 티켓 양도 중 오류 발생: {str(e)}")
        raise HTTPException(status_code=500, detail=f"티켓 양도 처리 중 문제가 발생했습니다: {str(e)}")

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
