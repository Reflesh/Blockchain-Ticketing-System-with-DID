-- TicketPro 2026-09-19: one-time ticket check-in migration
-- Apply after 0917_QR.sql and before starting the 0919 backend.

BEGIN;

CREATE TABLE IF NOT EXISTS ticket_checkins (
    id BIGSERIAL PRIMARY KEY,
    booking_item_id BIGINT NOT NULL UNIQUE
        REFERENCES booking_items(id) ON DELETE RESTRICT,
    token_id NUMERIC(78,0) NOT NULL UNIQUE
        CHECK (token_id > 0),
    challenge_id UUID NOT NULL UNIQUE
        REFERENCES ticket_qr_challenges(challenge_id) ON DELETE RESTRICT,
    admin_id BIGINT NOT NULL
        REFERENCES admins(id) ON DELETE RESTRICT,
    account_wallet_address VARCHAR(100) NOT NULL,
    signer_wallet_address VARCHAR(100) NOT NULL,
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_ticket_checkin_account_wallet
        CHECK (account_wallet_address ~ '^0x[0-9A-Fa-f]{40}$'),
    CONSTRAINT chk_ticket_checkin_signer_wallet
        CHECK (signer_wallet_address ~ '^0x[0-9A-Fa-f]{40}$')
);

CREATE INDEX IF NOT EXISTS idx_ticket_checkins_checked_in_at
    ON ticket_checkins(checked_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_checkins_admin_id
    ON ticket_checkins(admin_id, checked_in_at DESC);

COMMENT ON TABLE ticket_checkins IS
    '관리자 검표에서 성공한 티켓별 1회 입장 기록';
COMMENT ON COLUMN ticket_checkins.booking_item_id IS
    'UNIQUE 제약으로 같은 티켓의 재입장을 차단';
COMMENT ON COLUMN ticket_checkins.challenge_id IS
    '검증에 성공해 소비된 서버 발급 QR challenge';

COMMIT;
