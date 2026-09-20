DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM payments
        WHERE imp_uid IS NOT NULL
        GROUP BY imp_uid
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'payments.imp_uid 중복 데이터가 있어 고유 인덱스를 만들 수 없습니다.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_imp_uid_nonnull
    ON payments (imp_uid)
    WHERE imp_uid IS NOT NULL;
