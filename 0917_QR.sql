\set ON_ERROR_STOP on

BEGIN;

-- ================================================================
-- TicketPro PostgreSQL schema v5 - QR Challenge migration
-- 기준: Capstone/PostgreSQL_ver4.sql, Capstone/260916 Backend
-- 적용 방식: 기존 데이터와 테이블을 유지하고 QR Challenge 테이블만 추가합니다.
-- 실행 예시:
-- psql "host=$RDSHOST port=5432 dbname=ticketpro user=Capstone2026 sslmode=verify-full sslrootcert=./global-bundle.pem" -f PostgreSQL_ver5_QR.sql
--
-- 변경 이력:
-- 2026-09-17 / ticket_qr_challenges / 20초 동적 QR Challenge 저장 테이블 추가
-- 이유: 서버 발급 nonce, account/signer 분리, 만료 및 재사용 여부를 안전하게 관리.
-- 2026-09-17 / 전체 migration / ON_ERROR_STOP 및 선행 테이블 검증 추가
-- 이유: 일부 SQL만 적용된 불완전한 migration을 방지하고 기존 데이터를 보존.
--
-- 주의:
-- 1. 이 파일은 PostgreSQL_ver4.sql과 달리 기존 테이블을 DROP하지 않습니다.
-- 2. nonce 원문은 저장하지 않고 애플리케이션에서 SHA-256 hex로 변환한
--    nonce_hash만 저장해야 합니다.
-- 3. 관리자 스캔, 입장 승인 및 중복 입장 기록 테이블은 이번 범위에 포함하지 않습니다.
-- ================================================================

-- QR Challenge가 참조할 기존 예매 항목 테이블과 핵심 컬럼을 먼저 확인합니다.
DO $$
DECLARE
    missing_columns TEXT;
BEGIN
    IF to_regclass('public.booking_items') IS NULL THEN
        RAISE EXCEPTION '필수 테이블 booking_items가 없습니다. PostgreSQL_ver4.sql 또는 최신 기본 스키마를 먼저 적용해야 합니다.';
    END IF;

    SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
      INTO missing_columns
      FROM (VALUES
          ('id'),
          ('token_id'),
          ('owner_wallet_address'),
          ('ticket_status')
      ) AS required(column_name)
     WHERE NOT EXISTS (
         SELECT 1
           FROM information_schema.columns existing
          WHERE existing.table_schema = 'public'
            AND existing.table_name = 'booking_items'
            AND existing.column_name = required.column_name
     );

    IF missing_columns IS NOT NULL THEN
        RAISE EXCEPTION 'booking_items 필수 컬럼이 없습니다: %', missing_columns;
    END IF;
END;
$$;

-- ================================================================
-- 1. 사용자 티켓 QR Challenge
-- 서버가 인증된 사용자에게 발급한 20초 유효 nonce의 상태만 저장합니다.
-- 동일 티켓도 갱신할 때마다 새 Challenge를 발급하므로 token_id는 UNIQUE가 아닙니다.
-- ================================================================

-- 하나의 블록체인 token ID가 둘 이상의 예매 항목에 연결되지 않도록 보장합니다.
-- 기존 데이터에 중복 token ID가 있으면 migration을 중단하여 먼저 정리하게 합니다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_items_token_id
    ON booking_items(token_id)
    WHERE token_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ticket_qr_challenges (
    challenge_id UUID PRIMARY KEY,
    format_version SMALLINT NOT NULL DEFAULT 1
        CHECK (format_version = 1),
    token_id NUMERIC(78,0) NOT NULL
        CHECK (token_id > 0),
    booking_item_id BIGINT NOT NULL
        REFERENCES booking_items(id) ON DELETE CASCADE,
    account_wallet_address VARCHAR(100) NOT NULL,
    signer_wallet_address VARCHAR(100) NOT NULL,
    nonce_hash VARCHAR(64) NOT NULL UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_ticket_qr_account_wallet_address
        CHECK (account_wallet_address ~ '^0x[0-9A-Fa-f]{40}$'),
    CONSTRAINT chk_ticket_qr_signer_wallet_address
        CHECK (signer_wallet_address ~ '^0x[0-9A-Fa-f]{40}$'),
    CONSTRAINT chk_ticket_qr_nonce_hash
        CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_ticket_qr_validity_window
        CHECK (
            expires_at > issued_at
            AND expires_at <= issued_at + INTERVAL '20 seconds'
        ),
    CONSTRAINT chk_ticket_qr_consumed_at
        CHECK (
            consumed_at IS NULL
            OR (consumed_at >= issued_at AND consumed_at <= expires_at)
        )
);

CREATE INDEX IF NOT EXISTS idx_ticket_qr_challenges_token_id
    ON ticket_qr_challenges(token_id);

CREATE INDEX IF NOT EXISTS idx_ticket_qr_challenges_booking_item_id
    ON ticket_qr_challenges(booking_item_id);

CREATE INDEX IF NOT EXISTS idx_ticket_qr_challenges_account_wallet
    ON ticket_qr_challenges(LOWER(account_wallet_address));

CREATE INDEX IF NOT EXISTS idx_ticket_qr_challenges_signer_wallet
    ON ticket_qr_challenges(LOWER(signer_wallet_address));

CREATE INDEX IF NOT EXISTS idx_ticket_qr_challenges_expires_at
    ON ticket_qr_challenges(expires_at);

CREATE INDEX IF NOT EXISTS idx_ticket_qr_challenges_unconsumed
    ON ticket_qr_challenges(expires_at)
    WHERE consumed_at IS NULL;

COMMENT ON TABLE ticket_qr_challenges IS
    '서버가 발급한 20초 유효 사용자 티켓 QR Challenge';
COMMENT ON COLUMN ticket_qr_challenges.challenge_id IS
    '서버가 생성한 UUID Challenge 식별자';
COMMENT ON COLUMN ticket_qr_challenges.format_version IS
    'QR payload 형식 버전';
COMMENT ON COLUMN ticket_qr_challenges.token_id IS
    '블록체인 티켓 token ID';
COMMENT ON COLUMN ticket_qr_challenges.booking_item_id IS
    'Challenge 발급 시 확인한 booking_items 행';
COMMENT ON COLUMN ticket_qr_challenges.account_wallet_address IS
    '티켓 소유권을 가진 부모 웹 계정 Wallet 주소';
COMMENT ON COLUMN ticket_qr_challenges.signer_wallet_address IS
    'QR ECDSA 서명을 생성하는 실제 Wallet 주소';
COMMENT ON COLUMN ticket_qr_challenges.nonce_hash IS
    '원본 nonce를 저장하지 않은 lowercase SHA-256 hex';
COMMENT ON COLUMN ticket_qr_challenges.issued_at IS
    '서버 기준 Challenge 발급 시각';
COMMENT ON COLUMN ticket_qr_challenges.expires_at IS
    '서버 기준 Challenge 만료 시각, issued_at 이후 최대 20초';
COMMENT ON COLUMN ticket_qr_challenges.consumed_at IS
    '관리자 검증에서 Challenge가 소비된 시각';

-- CREATE TABLE IF NOT EXISTS가 기존의 잘못된 동명 테이블을 그대로 통과시키지 않도록
-- migration 후 필요한 컬럼이 모두 존재하는지 한 번 더 확인합니다.
DO $$
DECLARE
    missing_columns TEXT;
BEGIN
    SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
      INTO missing_columns
      FROM (VALUES
          ('challenge_id'),
          ('format_version'),
          ('token_id'),
          ('booking_item_id'),
          ('account_wallet_address'),
          ('signer_wallet_address'),
          ('nonce_hash'),
          ('issued_at'),
          ('expires_at'),
          ('consumed_at'),
          ('created_at')
      ) AS required(column_name)
     WHERE NOT EXISTS (
         SELECT 1
           FROM information_schema.columns existing
          WHERE existing.table_schema = 'public'
            AND existing.table_name = 'ticket_qr_challenges'
            AND existing.column_name = required.column_name
     );

    IF missing_columns IS NOT NULL THEN
        RAISE EXCEPTION 'ticket_qr_challenges 필수 컬럼이 없습니다: %', missing_columns;
    END IF;
END;
$$;

COMMIT;

\echo 'TicketPro PostgreSQL v5 QR Challenge migration completed.'
\echo '기존 데이터는 삭제되지 않았으며 ticket_qr_challenges 테이블만 추가되었습니다.'

