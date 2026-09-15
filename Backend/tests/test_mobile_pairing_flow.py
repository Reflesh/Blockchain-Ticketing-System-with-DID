import base64
import hashlib
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_keys import keys


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL이 없어 PostgreSQL 통합 테스트를 건너뜁니다.", allow_module_level=True)

os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("CI_SALT", "mobile-pairing-integration-test-salt")
os.environ.setdefault(
    "ISSUER_PRIVATE_KEY",
    "0x" + os.urandom(32).hex(),
)
os.environ.setdefault("ENV", "development")
os.environ.setdefault("OID4VCI_ISSUER_BASE_URL", "http://localhost:8001")
os.environ.setdefault("SYNC_MAIN_USERS", "false")
os.environ.setdefault("AUTH_SERVICE_KEY", "integration-test-service-key-0123456789")

from fastapi.testclient import TestClient

import auth_server


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _holder_jwk(private_key: keys.PrivateKey) -> dict:
    raw = private_key.public_key.to_bytes()
    return {
        "kty": "EC",
        "crv": "secp256k1",
        "x": _base64url(raw[:32]),
        "y": _base64url(raw[32:]),
    }


def _signed_challenge(client: TestClient, private_key: keys.PrivateKey, headers: dict) -> dict:
    address = private_key.public_key.to_checksum_address()
    challenge_response = client.post(
        "/api/login-challenge",
        headers=headers,
        json={"wallet_address": address},
    )
    assert challenge_response.status_code == 200, challenge_response.text
    challenge = challenge_response.json()
    signature = Account.from_key(private_key.to_bytes()).sign_message(
        encode_defunct(text=challenge["message"])
    ).signature.hex()
    return {
        "wallet_address": address,
        "nonce": challenge["nonce"],
        "message": challenge["message"],
        "signature": signature,
    }


def test_web_to_mobile_pairing_and_revoke():
    unique = uuid.uuid4().hex
    primary_key = keys.PrivateKey(os.urandom(32))
    mobile_key = keys.PrivateKey(os.urandom(32))
    primary_address = primary_key.public_key.to_checksum_address()
    mobile_address = mobile_key.public_key.to_checksum_address()
    email = f"mobile-pairing-{unique[:12]}@pukyong.ac.kr"
    ci_hash = hashlib.sha256(f"{email}-{unique}".encode()).hexdigest()
    web_token = f"web-{uuid.uuid4().hex}"
    service_headers = {"X-Service-Key": os.environ["AUTH_SERVICE_KEY"]}
    web_headers = {
        **service_headers,
        "Authorization": f"Bearer {web_token}",
    }
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(days=30)

    with auth_server.get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO issued_vcs (ci_hash, email, wallet_address, issued_at, expires_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    ci_hash,
                    email,
                    primary_address,
                    issued_at.isoformat().replace("+00:00", "Z"),
                    expires_at.isoformat().replace("+00:00", "Z"),
                ),
            )
            now = time.time()
            cur.execute(
                """
                INSERT INTO user_login_sessions (
                    token_hash, email, wallet_address, subject_wallet_address,
                    issued_at, expires_at
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    auth_server._token_hash(web_token),
                    email,
                    primary_address,
                    primary_address,
                    now,
                    now + 600,
                ),
            )
        conn.commit()

    try:
        with TestClient(auth_server.app) as client:
            pairing_response = client.post("/api/mobile-pairings", headers=web_headers, json={})
            assert pairing_response.status_code == 200, pairing_response.text
            pairing = pairing_response.json()
            assert pairing["status"] == "pending"
            assert base64.b64decode(pairing["qr_png_base64"]).startswith(b"\x89PNG\r\n\x1a\n")
            pairing_token = parse_qs(urlparse(pairing["pairing_uri"]).query)["token"][0]

            mobile_proof = _signed_challenge(client, mobile_key, service_headers)
            completion_response = client.post(
                "/api/mobile-pairings/complete",
                headers=service_headers,
                json={
                    **mobile_proof,
                    "pairing_token": pairing_token,
                    "holder_jwk": _holder_jwk(mobile_key),
                    "device_name": "Integration Android",
                },
            )
            assert completion_response.status_code == 200, completion_response.text
            completed = completion_response.json()
            assert completed["account_wallet_address"].lower() == primary_address.lower()
            assert completed["wallet_address"].lower() == mobile_address.lower()

            jwt_parts = completed["credential"].split(".")
            assert len(jwt_parts) == 3
            payload = json.loads(auth_server._base64url_decode(jwt_parts[1]))
            assert "TicketProMobileCredential" in payload["vc"]["type"]
            assert payload["cnf"]["jwk"] == _holder_jwk(mobile_key)
            assert payload["vc"]["credentialSubject"]["account"] == f"did:pknu:{primary_address}"

            pairing_status = client.get(
                f"/api/mobile-pairings/{pairing['pairing_id']}",
                headers=web_headers,
            )
            assert pairing_status.status_code == 200
            assert pairing_status.json()["status"] == "completed"

            devices_response = client.get("/api/mobile-devices", headers=web_headers)
            assert devices_response.status_code == 200
            devices = devices_response.json()["data"]
            assert any(row["wallet_address"].lower() == mobile_address.lower() for row in devices)

            paired_introspection = client.post(
                "/internal/sessions/introspect",
                headers=service_headers,
                json={"token": completed["access_token"]},
            )
            assert paired_introspection.status_code == 200
            assert paired_introspection.json()["active"] is True
            assert paired_introspection.json()["wallet_address"].lower() == primary_address.lower()
            assert paired_introspection.json()["signer_wallet_address"].lower() == mobile_address.lower()

            login_proof = _signed_challenge(client, mobile_key, service_headers)
            login_response = client.post(
                "/api/login-verify",
                headers=service_headers,
                json=login_proof,
            )
            assert login_response.status_code == 200, login_response.text
            assert login_response.json()["auth_provider"] == "mobile_did"
            assert login_response.json()["account_wallet_address"].lower() == primary_address.lower()

            replay_proof = _signed_challenge(client, mobile_key, service_headers)
            replay_response = client.post(
                "/api/mobile-pairings/complete",
                headers=service_headers,
                json={
                    **replay_proof,
                    "pairing_token": pairing_token,
                    "holder_jwk": _holder_jwk(mobile_key),
                    "device_name": "Replay Android",
                },
            )
            assert replay_response.status_code == 409

            revoke_response = client.post(
                f"/api/mobile-devices/{mobile_address}/revoke",
                headers=web_headers,
                json={"reason": "integration_test"},
            )
            assert revoke_response.status_code == 200, revoke_response.text

            revoked_introspection = client.post(
                "/internal/sessions/introspect",
                headers=service_headers,
                json={"token": login_response.json()["access_token"]},
            )
            assert revoked_introspection.status_code == 200
            assert revoked_introspection.json()["active"] is False

            with auth_server.get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT wallet_address FROM issued_vcs WHERE ci_hash = %s", (ci_hash,))
                    primary = cur.fetchone()
            assert primary["wallet_address"].lower() == primary_address.lower()
    finally:
        with auth_server.get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM user_login_sessions WHERE email = %s", (email,))
                cur.execute(
                    "DELETE FROM login_nonces WHERE LOWER(wallet_address) IN (LOWER(%s), LOWER(%s))",
                    (primary_address, mobile_address),
                )
                cur.execute(
                    "DELETE FROM login_audit_logs WHERE LOWER(wallet_address) IN (LOWER(%s), LOWER(%s))",
                    (primary_address, mobile_address),
                )
                cur.execute("DELETE FROM mobile_pairing_sessions WHERE ci_hash = %s", (ci_hash,))
                cur.execute("DELETE FROM mobile_credentials WHERE ci_hash = %s", (ci_hash,))
                cur.execute("DELETE FROM issued_vcs WHERE ci_hash = %s", (ci_hash,))
            conn.commit()
