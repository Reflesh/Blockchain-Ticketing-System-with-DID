\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS checkout_orders (
    payment_id VARCHAR(100) PRIMARY KEY,
    buyer_wallet_address VARCHAR(100) NOT NULL,
    event_id BIGINT NOT NULL REFERENCES events(id),
    event_session_id BIGINT NOT NULL REFERENCES event_sessions(id),
    total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
    status VARCHAR(30) NOT NULL DEFAULT 'pending_payment',
    expires_at TIMESTAMPTZ NOT NULL,
    booking_id BIGINT REFERENCES bookings(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_checkout_wallet
        CHECK (buyer_wallet_address ~ '^0x[0-9A-Fa-f]{40}$'),
    CONSTRAINT chk_checkout_status
        CHECK (status IN (
            'pending_payment', 'booking_created', 'mint_pending', 'completed',
            'cancelled', 'expired', 'failed', 'refunded', 'refund_failed'
        )),
    CONSTRAINT chk_checkout_expiry CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS checkout_order_items (
    id BIGSERIAL PRIMARY KEY,
    payment_id VARCHAR(100) NOT NULL
        REFERENCES checkout_orders(payment_id) ON DELETE CASCADE,
    seat_id BIGINT NOT NULL REFERENCES seats(id),
    unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (payment_id, seat_id)
);

-- 한 좌석에는 동시에 하나의 살아 있는 결제 선점만 존재할 수 있다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_active_seat_hold
    ON checkout_order_items(seat_id)
    WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_checkout_orders_expiry
    ON checkout_orders(expires_at)
    WHERE status = 'pending_payment';

CREATE INDEX IF NOT EXISTS idx_checkout_orders_booking
    ON checkout_orders(booking_id)
    WHERE booking_id IS NOT NULL;

COMMIT;

\echo 'TicketPro checkout hold migration completed.'
