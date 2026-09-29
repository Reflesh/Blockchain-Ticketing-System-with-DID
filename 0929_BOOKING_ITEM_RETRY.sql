\set ON_ERROR_STOP on

BEGIN;

-- 실패·취소된 예매 이력은 보존하되 같은 좌석을 다시 예매할 수 있게 한다.
-- 유효하거나 이미 사용된 티켓은 계속 좌석당 하나만 허용한다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_items_active_seat
    ON booking_items(seat_id)
    WHERE ticket_status NOT IN ('failed', 'cancelled');

ALTER TABLE booking_items
    DROP CONSTRAINT IF EXISTS booking_items_seat_id_key;

-- QR 검표 완료 상태를 애플리케이션과 DB가 동일하게 허용하도록 맞춘다.
ALTER TABLE booking_items
    DROP CONSTRAINT IF EXISTS booking_items_ticket_status_check;
ALTER TABLE booking_items
    ADD CONSTRAINT booking_items_ticket_status_check
    CHECK (ticket_status IN (
        'booked', 'mint_pending', 'minted', 'used', 'cancelled', 'failed'
    ));

COMMIT;

\echo 'TicketPro booking retry and used-ticket status migration completed.'
