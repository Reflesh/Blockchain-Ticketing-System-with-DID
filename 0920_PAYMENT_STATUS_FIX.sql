\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE bookings
    DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
ALTER TABLE bookings
    ADD CONSTRAINT bookings_payment_status_check
    CHECK (payment_status IN (
        'pending', 'paid', 'failed', 'cancelled', 'refunded', 'refund_failed'
    ));

ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_payment_status_check;
ALTER TABLE payments
    ADD CONSTRAINT payments_payment_status_check
    CHECK (payment_status IN (
        'pending', 'paid', 'failed', 'cancelled', 'refunded', 'refund_failed'
    ));

COMMIT;

\echo 'TicketPro refund_failed status migration completed.'
