import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from eth_account import Account
from eth_account.messages import encode_defunct

from ticket_qr import (
    QR_CHALLENGE_TTL_SECONDS,
    build_ticket_qr_signing_message,
    create_ticket_qr_payload,
    parse_ticket_qr_data,
)


class TicketQrSecurityTests(unittest.TestCase):
    def setUp(self):
        self.signer = Account.create()
        self.account = Account.create()
        self.identity = SimpleNamespace(
            account_wallet_address=self.account.address,
            signer_wallet_address=self.signer.address,
        )
        self.challenge = create_ticket_qr_payload(
            self.identity,
            42,
            datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc),
        )

    def signed_qr(self, payload=None):
        payload = payload or self.challenge["payload"]
        message = build_ticket_qr_signing_message(payload)
        signature = Account.sign_message(
            encode_defunct(text=message),
            self.signer.key,
        ).signature.hex()
        if not signature.startswith("0x"):
            signature = "0x" + signature
        return json.dumps({"payload": payload, "signature": signature})

    def test_valid_server_challenge_round_trip(self):
        parsed = parse_ticket_qr_data(self.signed_qr())
        self.assertEqual(parsed["token_id"], 42)
        self.assertEqual(parsed["challenge_id"], self.challenge["challenge_id"])
        recovered = Account.recover_message(
            encode_defunct(text=parsed["signing_message"]),
            signature=parsed["signature"],
        )
        self.assertEqual(recovered.lower(), self.signer.address.lower())
        self.assertEqual(
            parsed["payload"]["expires_at"] - parsed["payload"]["issued_at"],
            QR_CHALLENGE_TTL_SECONDS,
        )

    def test_unknown_payload_field_is_rejected(self):
        payload = {**self.challenge["payload"], "admin": True}
        with self.assertRaisesRegex(ValueError, "payload 필드"):
            parse_ticket_qr_data(json.dumps({"payload": payload, "signature": "0x" + "00" * 65}))

    def test_wrong_domain_is_rejected(self):
        payload = {**self.challenge["payload"], "domain": "attacker"}
        with self.assertRaisesRegex(ValueError, "다른 서비스"):
            parse_ticket_qr_data(self.signed_qr(payload))

    def test_oversized_validity_window_is_rejected(self):
        payload = {
            **self.challenge["payload"],
            "expires_at": self.challenge["payload"]["issued_at"] + 60,
        }
        with self.assertRaisesRegex(ValueError, "유효시간"):
            parse_ticket_qr_data(self.signed_qr(payload))

    def test_noncanonical_token_id_is_rejected(self):
        payload = {**self.challenge["payload"], "token_id": "0042"}
        with self.assertRaisesRegex(ValueError, "토큰 ID 범위"):
            parse_ticket_qr_data(self.signed_qr(payload))

    def test_fake_signature_shape_is_rejected(self):
        raw = json.dumps({"payload": self.challenge["payload"], "signature": "mock-dev-signature"})
        with self.assertRaisesRegex(ValueError, "Wallet 서명 형식"):
            parse_ticket_qr_data(raw)


if __name__ == "__main__":
    unittest.main()
