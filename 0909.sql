BEGIN;

-- ================================================================
-- TicketPro PostgreSQL schema v4
-- 기준: Capstone/260905 Backend
-- 주의: 기존 TicketPro 테이블과 데이터를 삭제한 뒤 초기 상태로 재생성합니다.
-- PostgreSQL_ver3.sql의 관리자·공연·회차·좌석 초기 데이터를 포함합니다.
--
-- 변경 이력:
-- 2026-09-09 / 전체 스키마 / 의존성 역순 DROP TABLE ... CASCADE 적용
-- 이유: 사용자의 요청에 따라 기존 데이터를 삭제하고 일관된 초기 상태로 재생성.
-- 2026-09-09 / booking_items / 양도 관련 컬럼 3개 및 인덱스 추가
-- 이유: blockchain_backend.py의 조회·양도 처리와 스키마 일치.
-- 2026-09-09 / blockchain_transactions / ticket_transfer 유형 허용
-- 이유: 티켓 양도 트랜잭션 기록 시 CHECK 제약조건 오류 방지.
-- 2026-09-09 / 초기 데이터 / PostgreSQL_ver3.sql의 초기 데이터 복원
-- 이유: 행사·회차·좌석을 포함한 기존 시연 데이터 반영 요청.
-- 2026-09-09 / 초기 데이터 / 명시적 ID 삽입 후 시퀀스 동기화
-- 이유: 이후 공연·회차 등록 시 BIGSERIAL 기본키 중복 오류 방지.
-- ================================================================

DROP TABLE IF EXISTS login_audit_logs CASCADE;
DROP TABLE IF EXISTS user_login_sessions CASCADE;
DROP TABLE IF EXISTS login_nonces CASCADE;
DROP TABLE IF EXISTS auth_nonces CASCADE;
DROP TABLE IF EXISTS auth_sessions CASCADE;
DROP TABLE IF EXISTS revoked_vcs CASCADE;
DROP TABLE IF EXISTS issued_vcs CASCADE;
DROP TABLE IF EXISTS admin_logs CASCADE;
DROP TABLE IF EXISTS blockchain_transactions CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS booking_items CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS wishlist CASCADE;
DROP TABLE IF EXISTS seats CASCADE;
DROP TABLE IF EXISTS event_sessions CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS identity_verifications CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS admins CASCADE;

DROP FUNCTION IF EXISTS set_updated_at();

CREATE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 1. 관리자 계정 및 감사 로그
-- ================================================================

CREATE TABLE IF NOT EXISTS admins (
    id BIGSERIAL PRIMARY KEY,
    login_id VARCHAR(100) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'operator'
        CHECK (role IN ('super_admin', 'event_manager', 'cs_manager', 'settlement_manager', 'operator')),
    status VARCHAR(30) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_admins_updated_at ON admins;
CREATE TRIGGER trg_admins_updated_at
BEFORE UPDATE ON admins
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- 2. 사용자, 지갑, 본인인증
-- ================================================================

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE,
    password_hash TEXT,
    real_name VARCHAR(100),
    wallet_address VARCHAR(100) NOT NULL UNIQUE,
    private_key_encrypted TEXT,
    auth_provider VARCHAR(30) NOT NULL DEFAULT 'local'
        CHECK (auth_provider IN ('local', 'did_keystore', 'metamask')),
    verification_status VARCHAR(30) NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'verified', 'failed')),
    status VARCHAR(30) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'restricted', 'withdrawn', 'blocked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS identity_verifications (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    imp_uid VARCHAR(100) NOT NULL UNIQUE,
    real_name VARCHAR(100),
    ci_hash TEXT,
    di_hash TEXT,
    provider VARCHAR(50) NOT NULL DEFAULT 'portone',
    verification_status VARCHAR(30) NOT NULL DEFAULT 'verified'
        CHECK (verification_status IN ('verified', 'failed')),
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_response JSONB
);

CREATE INDEX IF NOT EXISTS idx_identity_verifications_user_id ON identity_verifications(user_id);

-- ================================================================
-- 3. 공연 및 회차
-- ================================================================

CREATE TABLE IF NOT EXISTS events (
    id BIGINT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    venue VARCHAR(255) NOT NULL,
    display_time_text VARCHAR(50) NOT NULL,
    period_text VARCHAR(100) NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ,
    booking_open_at TIMESTAMPTZ,
    booking_close_at TIMESTAMPTZ,
    age_rating VARCHAR(100),
    price_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    price_display VARCHAR(50) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'KRW',
    poster_url TEXT,
    category VARCHAR(50),
    display_order INTEGER NOT NULL DEFAULT 0,
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(30) NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'paused', 'ended', 'hidden')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_events_display_order ON events(display_order);

DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
CREATE TRIGGER trg_events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS event_sessions (
    id BIGINT PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    session_name VARCHAR(100) NOT NULL,
    session_start_at TIMESTAMPTZ NOT NULL,
    session_end_at TIMESTAMPTZ,
    booking_open_at TIMESTAMPTZ,
    booking_close_at TIMESTAMPTZ,
    sale_status VARCHAR(30) NOT NULL DEFAULT 'open'
        CHECK (sale_status IN ('ready', 'open', 'sold_out', 'paused', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_sessions_event_id ON event_sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_event_sessions_start_at ON event_sessions(session_start_at);
CREATE INDEX IF NOT EXISTS idx_event_sessions_sale_status ON event_sessions(sale_status);

DROP TRIGGER IF EXISTS trg_event_sessions_updated_at ON event_sessions;
CREATE TRIGGER trg_event_sessions_updated_at
BEFORE UPDATE ON event_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- 4. 좌석 및 재고
-- ================================================================

CREATE TABLE IF NOT EXISTS seats (
    id BIGSERIAL PRIMARY KEY,
    event_session_id BIGINT NOT NULL REFERENCES event_sessions(id) ON DELETE CASCADE,
    seat_code VARCHAR(30) NOT NULL,
    section_name VARCHAR(100) NOT NULL DEFAULT 'STANDARD',
    row_label VARCHAR(20),
    seat_number VARCHAR(20),
    grade VARCHAR(50),
    price_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'holding', 'booked', 'locked', 'invited', 'disabled')),
    hold_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_session_id, seat_code)
);

CREATE INDEX IF NOT EXISTS idx_seats_event_session_id ON seats(event_session_id);
CREATE INDEX IF NOT EXISTS idx_seats_status ON seats(status);

DROP TRIGGER IF EXISTS trg_seats_updated_at ON seats;
CREATE TRIGGER trg_seats_updated_at
BEFORE UPDATE ON seats
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- 5. 찜, 예매, 결제
-- ================================================================

CREATE TABLE IF NOT EXISTS wishlist (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    wallet_address VARCHAR(100),
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (user_id IS NOT NULL OR wallet_address IS NOT NULL),
    UNIQUE (user_id, event_id),
    UNIQUE (wallet_address, event_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_user_id ON wishlist(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_wallet_address ON wishlist(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wishlist_event_id ON wishlist(event_id);

CREATE TABLE IF NOT EXISTS bookings (
    id BIGSERIAL PRIMARY KEY,
    booking_no VARCHAR(50) NOT NULL UNIQUE,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    buyer_wallet_address VARCHAR(100) NOT NULL,
    event_id BIGINT NOT NULL REFERENCES events(id),
    event_session_id BIGINT NOT NULL REFERENCES event_sessions(id),
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'KRW',
    booking_status VARCHAR(30) NOT NULL DEFAULT 'reserved'
        CHECK (booking_status IN ('reserved', 'payment_pending', 'paid', 'mint_pending', 'minted', 'cancel_requested', 'cancelled', 'failed')),
    payment_status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
    blockchain_status VARCHAR(30) NOT NULL DEFAULT 'not_submitted'
        CHECK (blockchain_status IN ('not_submitted', 'pending', 'confirmed', 'failed')),
    admin_memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_buyer_wallet_address ON bookings(buyer_wallet_address);
CREATE INDEX IF NOT EXISTS idx_bookings_event_session_id ON bookings(event_session_id);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_status ON bookings(booking_status);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_blockchain_status ON bookings(blockchain_status);

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON bookings;
CREATE TRIGGER trg_bookings_updated_at
BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS booking_items (
    id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    seat_id BIGINT NOT NULL REFERENCES seats(id),
    seat_code VARCHAR(30) NOT NULL,
    owner_wallet_address VARCHAR(100) NOT NULL,
    companion_wallet_address VARCHAR(100),
    is_transferred BOOLEAN NOT NULL DEFAULT FALSE,
    transferred_at TIMESTAMPTZ,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    ticket_status VARCHAR(30) NOT NULL DEFAULT 'booked'
        CHECK (ticket_status IN ('booked', 'mint_pending', 'minted', 'used', 'cancelled', 'failed')),
    token_id NUMERIC(78,0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_items_booking_id ON booking_items(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_items_owner_wallet_address ON booking_items(owner_wallet_address);
CREATE INDEX IF NOT EXISTS idx_booking_items_companion_wallet_address ON booking_items(companion_wallet_address);
CREATE INDEX IF NOT EXISTS idx_booking_items_ticket_status ON booking_items(ticket_status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_items_active_seat
    ON booking_items(seat_id)
    WHERE ticket_status NOT IN ('failed', 'cancelled');

DROP TRIGGER IF EXISTS trg_booking_items_updated_at ON booking_items;
CREATE TRIGGER trg_booking_items_updated_at
BEFORE UPDATE ON booking_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payments (
    id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL DEFAULT 'portone',
    imp_uid VARCHAR(100),
    merchant_uid VARCHAR(100),
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'KRW',
    payment_method VARCHAR(50),
    payment_status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
    paid_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    failure_reason TEXT,
    raw_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_status ON payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_imp_uid ON payments(imp_uid);
CREATE INDEX IF NOT EXISTS idx_payments_merchant_uid ON payments(merchant_uid);

DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;
CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ================================================================
-- 6. 블록체인 트랜잭션
-- ================================================================

CREATE TABLE IF NOT EXISTS blockchain_transactions (
    id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT REFERENCES bookings(id) ON DELETE SET NULL,
    chain_id BIGINT NOT NULL DEFAULT 137,
    contract_address VARCHAR(100),
    tx_hash VARCHAR(255) NOT NULL UNIQUE,
    tx_type VARCHAR(50) NOT NULL DEFAULT 'ticket_purchase'
        CHECK (tx_type IN ('ticket_purchase', 'ticket_transfer', 'ticket_cancel', 'withdraw', 'admin')),
    tx_status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (tx_status IN ('pending', 'confirmed', 'failed')),
    buyer_wallet_address VARCHAR(100),
    companion_wallet_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
    gas_price_wei NUMERIC(78,0),
    gas_used NUMERIC(78,0),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    block_number BIGINT,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_blockchain_transactions_booking_id ON blockchain_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_transactions_tx_status ON blockchain_transactions(tx_status);
CREATE INDEX IF NOT EXISTS idx_blockchain_transactions_buyer_wallet_address ON blockchain_transactions(buyer_wallet_address);

-- ================================================================
-- 7. 관리자 작업 로그
-- ================================================================

CREATE TABLE IF NOT EXISTS admin_logs (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT REFERENCES admins(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_table VARCHAR(100),
    target_id VARCHAR(100),
    before_data JSONB,
    after_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON admin_logs(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at);

-- ================================================================
-- 8. DID 발급, 폐기 및 이메일 인증
-- auth_server.py가 사용하는 테이블입니다.
-- expires_at은 현재 Python 코드가 ISO 8601 문자열 또는 Unix timestamp로 처리하므로
-- 코드와의 호환성을 위해 각각 TEXT와 DOUBLE PRECISION을 유지합니다.
-- ================================================================

CREATE TABLE IF NOT EXISTS issued_vcs (
    ci_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL UNIQUE,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issued_vcs_wallet_address ON issued_vcs(wallet_address);
CREATE INDEX IF NOT EXISTS idx_issued_vcs_email ON issued_vcs(email);

CREATE TABLE IF NOT EXISTS revoked_vcs (
    wallet_address TEXT PRIMARY KEY,
    revoked_at TEXT NOT NULL,
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_revoked_vcs_revoked_at ON revoked_vcs(revoked_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
    email TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at DOUBLE PRECISION NOT NULL,
    cooldown_until DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_nonces (
    nonce TEXT PRIMARY KEY,
    expires_at DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires_at ON auth_nonces(expires_at);

CREATE TABLE IF NOT EXISTS login_nonces (
    nonce TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    message TEXT NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL,
    used_at DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_login_nonces_expires_at ON login_nonces(expires_at);

CREATE TABLE IF NOT EXISTS user_login_sessions (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    issued_at DOUBLE PRECISION NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL,
    revoked_at DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_user_login_sessions_wallet_address ON user_login_sessions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_user_login_sessions_email ON user_login_sessions(email);
CREATE INDEX IF NOT EXISTS idx_user_login_sessions_expires_at ON user_login_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    email TEXT,
    wallet_address TEXT,
    action TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_audit_logs_wallet_address ON login_audit_logs(wallet_address);
CREATE INDEX IF NOT EXISTS idx_login_audit_logs_email ON login_audit_logs(email);
CREATE INDEX IF NOT EXISTS idx_login_audit_logs_created_at ON login_audit_logs(created_at);

-- ================================================================
-- 9. PostgreSQL_ver3 초기 관리자 및 공연 데이터
-- 전체 초기화 후 개발/시연용 초기 데이터를 삽입합니다.
-- ================================================================

-- 개발/시연용 관리자 계정입니다.
-- login_id: admin / password: admin123!
INSERT INTO admins (login_id, password_hash, display_name, role, status)
VALUES ('admin', 'admin123!', 'TicketPro 관리자', 'super_admin', 'active')
ON CONFLICT (login_id) DO NOTHING;

INSERT INTO events (
    id, title, description, venue, display_time_text, period_text, start_at, end_at,
    booking_open_at, booking_close_at, age_rating, price_amount, price_display,
    currency, poster_url, category, display_order, is_featured, status
) VALUES
    (1, '아이유 콘서트 : The Golden Hour', NULL, '상암 월드컵 경기장', '2026.09.15 19:00', '2026.09.15 - 2026.09.16', '2026-09-15 19:00:00+09', '2026-09-16 23:59:59+09', NULL, NULL, '전체관람가', 165000, '165,000', 'KRW', '/posters/iu.png', 'concert', 1, TRUE, 'active'),
    (2, '뮤지컬 <레미제라블>', NULL, '블루스퀘어 신한카드홀', '2026.10.10 14:00', '2026.10.10 - 2027.01.31', '2026-10-10 14:00:00+09', '2027-01-31 23:59:59+09', NULL, NULL, '8세 이상 관람가', 170000, '170,000', 'KRW', '/posters/lesmiserables.png', 'musical', 2, TRUE, 'active'),
    (3, '흠뻑쇼 2026 REBOOT', NULL, '잠실 올림픽 주경기장', '2026.08.01 18:00', '2026.08.01 - 2026.08.03', '2026-08-01 18:00:00+09', '2026-08-03 23:59:59+09', NULL, NULL, '만 15세 이상', 143000, '143,000', 'KRW', '/posters/psy.png', 'concert', 3, TRUE, 'active'),
    (4, 'Aimer 라이브 투어 2026', NULL, 'KSPODOME', '2026.11.20 19:00', '2026.11.20 - 2026.11.21', '2026-11-20 19:00:00+09', '2026-11-21 23:59:59+09', NULL, NULL, '만 12세 이상', 132000, '132,000', 'KRW', '/posters/aimer.png', 'concert', 4, TRUE, 'active'),
    (5, '하스스톤 전장 e스포츠 챔피언십', NULL, '벡스코 제1전시장', '2026.12.05 13:00', '2026.12.05 - 2026.12.06', '2026-12-05 13:00:00+09', '2026-12-06 23:59:59+09', NULL, NULL, '전체관람가', 50000, '50,000', 'KRW', '/posters/hearthstone.png', 'esports', 5, TRUE, 'active'),
    (6, 'AWS Summit Busan 2026', NULL, '벡스코 오디토리움', '2026.07.12 10:00', '2026.07.12 - 2026.07.13', '2026-07-12 10:00:00+09', '2026-07-13 23:59:59+09', NULL, NULL, '전체관람가', 0, '무료', 'KRW', '/posters/aws.png', 'conference', 6, TRUE, 'active'),
    (7, '뮤지컬 <오페라의 유령>', NULL, '샤롯데씨어터', '2026.12.24 19:30', '2026.12.24 - 2027.03.01', '2026-12-24 19:30:00+09', '2027-03-01 23:59:59+09', NULL, NULL, '만 7세 이상', 190000, '190,000', 'KRW', '/posters/theopera.png', 'musical', 7, TRUE, 'active'),
    (8, '태양의 서커스 <루치아>', NULL, '잠실 종합운동장 내 빅탑', '2026.09.30 20:00', '2026.09.30 - 2026.11.15', '2026-09-30 20:00:00+09', '2026-11-15 23:59:59+09', NULL, NULL, '전체관람가', 180000, '180,000', 'KRW', '/posters/ruchia.png', 'show', 8, TRUE, 'active'),
    (9, '글로벌 블록체인 위크 2026', NULL, '코엑스 그랜드볼룸', '2026.10.20 09:00', '2026.10.20 - 2026.10.22', '2026-10-20 09:00:00+09', '2026-10-22 23:59:59+09', NULL, NULL, '만 18세 이상', 120000, '120,000', 'KRW', '/posters/blockchainweek.jpg', 'conference', 9, TRUE, 'active'),
    (10, '잔나비 전국투어 콘서트', NULL, '수원 실내체육관', '2026.11.05 18:00', '2026.11.05 - 2026.11.06', '2026-11-05 18:00:00+09', '2026-11-06 23:59:59+09', NULL, NULL, '만 12세 이상', 143000, '143,000', 'KRW', '/posters/nabi.png', 'concert', 10, TRUE, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_sessions (
    id, event_id, session_name, session_start_at, session_end_at, sale_status
) VALUES
    (101, 1, '1회차 19:00', '2026-09-15 19:00:00+09', '2026-09-15 21:30:00+09', 'open'),
    (102, 1, '2회차 19:00', '2026-09-16 19:00:00+09', '2026-09-16 21:30:00+09', 'open'),
    (201, 2, '1회차 14:00', '2026-10-10 14:00:00+09', '2026-10-10 16:30:00+09', 'open'),
    (202, 2, '2회차 14:00', '2026-10-11 14:00:00+09', '2026-10-11 16:30:00+09', 'open'),
    (301, 3, '1회차 18:00', '2026-08-01 18:00:00+09', '2026-08-01 20:30:00+09', 'open'),
    (302, 3, '2회차 18:00', '2026-08-02 18:00:00+09', '2026-08-02 20:30:00+09', 'open'),
    (401, 4, '1회차 19:00', '2026-11-20 19:00:00+09', '2026-11-20 21:30:00+09', 'open'),
    (402, 4, '2회차 19:00', '2026-11-21 19:00:00+09', '2026-11-21 21:30:00+09', 'open'),
    (501, 5, '1회차 13:00', '2026-12-05 13:00:00+09', '2026-12-05 15:30:00+09', 'open'),
    (502, 5, '2회차 13:00', '2026-12-06 13:00:00+09', '2026-12-06 15:30:00+09', 'open'),
    (601, 6, '1회차 10:00', '2026-07-12 10:00:00+09', '2026-07-12 12:30:00+09', 'open'),
    (602, 6, '2회차 10:00', '2026-07-13 10:00:00+09', '2026-07-13 12:30:00+09', 'open'),
    (701, 7, '1회차 19:30', '2026-12-24 19:30:00+09', '2026-12-24 22:00:00+09', 'open'),
    (702, 7, '2회차 19:30', '2026-12-25 19:30:00+09', '2026-12-25 22:00:00+09', 'open'),
    (801, 8, '1회차 20:00', '2026-09-30 20:00:00+09', '2026-09-30 22:30:00+09', 'open'),
    (802, 8, '2회차 20:00', '2026-10-01 20:00:00+09', '2026-10-01 22:30:00+09', 'open'),
    (901, 9, '1회차 09:00', '2026-10-20 09:00:00+09', '2026-10-20 11:30:00+09', 'open'),
    (902, 9, '2회차 09:00', '2026-10-21 09:00:00+09', '2026-10-21 11:30:00+09', 'open'),
    (1001, 10, '1회차 18:00', '2026-11-05 18:00:00+09', '2026-11-05 20:30:00+09', 'open'),
    (1002, 10, '2회차 18:00', '2026-11-06 18:00:00+09', '2026-11-06 20:30:00+09', 'open')
ON CONFLICT (id) DO NOTHING;

INSERT INTO seats (
    event_session_id, seat_code, section_name, row_label, seat_number, grade, price_amount, status
)
SELECT
    s.id,
    chr(64 + row_no)::text || '-' || seat_no::text,
    'STANDARD',
    chr(64 + row_no)::text,
    seat_no::text,
    CASE
        WHEN row_no <= 2 THEN 'R'
        WHEN row_no <= 4 THEN 'S'
        ELSE 'A'
    END,
    e.price_amount,
    'available'
FROM event_sessions s
JOIN events e ON e.id = s.event_id
CROSS JOIN generate_series(1, 5) AS row_no
CROSS JOIN generate_series(1, 8) AS seat_no
ON CONFLICT (event_session_id, seat_code) DO NOTHING;

-- 명시적으로 삽입한 공연·회차 ID 다음 값부터 자동 발급되도록 조정합니다.
SELECT setval(pg_get_serial_sequence('events', 'id'), (SELECT MAX(id) FROM events), TRUE);
SELECT setval(pg_get_serial_sequence('event_sessions', 'id'), (SELECT MAX(id) FROM event_sessions), TRUE);

COMMIT;
