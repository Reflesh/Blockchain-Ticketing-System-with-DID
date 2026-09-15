import base64
import hashlib
import json
import os
import time
import uuid

import pytest
from eth_keys import keys
from eth_account import Account
from eth_account.messages import encode_defunct


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL이 없어 PostgreSQL 통합 테스트를 건너뜁니다.", allow_module_level=True)

os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("CI_SALT", "oid4vci-integration-test-salt")
os.environ.setdefault(
    "ISSUER_PRIVATE_KEY",
    "0x" + os.urandom(32).hex(),
)
os.environ.setdefault("ENV", "development")
os.environ.setdefault("OID4VCI_ISSUER_BASE_URL", "http://localhost:8001")
os.environ.setdefault("SYNC_MAIN_USERS", "false")
os.environ.setdefault(
    "AUTH_SERVICE_KEY",
    "integration-test-service-key-0123456789",
)

from fastapi.testclient import TestClient

import auth_server


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _proof_jwt(private_key: keys.PrivateKey, nonce: str) -> str:
    public_key = private_key.public_key.to_bytes()
    header = {
        "alg": "ES256K",
        "typ": "openid4vci-proof+jwt",
        "jwk": {
            "kty": "EC",
            "crv": "secp256k1",
            "x": _base64url(public_key[:32]),
            "y": _base64url(public_key[32:]),
        },
    }
    payload = {
        "aud": auth_server.OID4VCI_ISSUER_BASE_URL,
        "iat": int(time.time()),
        "nonce": nonce,
    }
    encoded_header = auth_server._json_base64url(header)
    encoded_payload = auth_server._json_base64url(payload)
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = private_key.sign_msg_hash(hashlib.sha256(signing_input).digest())
    jose_signature = signature.r.to_bytes(32, "big") + signature.s.to_bytes(32, "big")
    return f"{encoded_header}.{encoded_payload}.{_base64url(jose_signature)}"


def _decode_and_verify_credential(credential: str) -> dict:
    encoded_header, encoded_payload, encoded_signature = credential.split(".")
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = keys.NonRecoverableSignature(
        auth_server._base64url_decode(encoded_signature)
    )
    assert signature.verify_msg_hash(
        hashlib.sha256(signing_input).digest(),
        auth_server._issuer_priv_key.public_key,
    )
    return json.loads(auth_server._base64url_decode(encoded_payload))


def test_pre_authorized_code_issuance_flow():
    unique = uuid.uuid4().hex[:12]
    email = f"oid4vci-{unique}@pukyong.ac.kr"
    verification_code = "123456"
    holder_key = keys.PrivateKey(os.urandom(32))
    holder_address = holder_key.public_key.to_checksum_address()
    offer_id = None

    auth_server.set_session(email, verification_code)

    try:
        with TestClient(auth_server.app) as client:
            metadata_response = client.get(
                "/.well-known/openid-credential-issuer"
            )
            assert metadata_response.status_code == 200
            configuration = metadata_response.json()[
                "credential_configurations_supported"
            ][auth_server.OID4VCI_CREDENTIAL_CONFIGURATION_ID]
            assert configuration["format"] == "jwt_vc_json"
            assert "credential_metadata" in configuration

            jwks_response = client.get("/.well-known/jwks.json")
            assert jwks_response.status_code == 200
            issuer_jwk = jwks_response.json()["keys"][0]
            assert issuer_jwk["kid"] == auth_server.OID4VCI_ISSUER_KEY_ID
            assert issuer_jwk["crv"] == "secp256k1"

            create_response = client.post(
                "/api/oid4vci/credential-offers",
                json={"email": email, "code": verification_code},
            )
            assert create_response.status_code == 200
            created = create_response.json()
            offer_id = created["offer_id"]
            assert created["dev_tx_code"].isdigit()
            assert create_response.headers["cache-control"] == "no-store"

            offer_response = client.get(f"/oid4vci/credential-offer/{offer_id}")
            assert offer_response.status_code == 200
            offer = offer_response.json()
            grant = offer["grants"][auth_server.OID4VCI_PRE_AUTHORIZED_GRANT_TYPE]

            qr_response = client.get(f"/oid4vci/credential-offer/{offer_id}/qr")
            assert qr_response.status_code == 200
            assert qr_response.content.startswith(b"\x89PNG\r\n\x1a\n")

            token_response = client.post(
                "/oid4vci/token",
                data={
                    "grant_type": auth_server.OID4VCI_PRE_AUTHORIZED_GRANT_TYPE,
                    "pre-authorized_code": grant["pre-authorized_code"],
                    "tx_code": created["dev_tx_code"],
                },
            )
            assert token_response.status_code == 200
            token = token_response.json()
            credential_identifier = token["authorization_details"][0][
                "credential_identifiers"
            ][0]

            replay_token_response = client.post(
                "/oid4vci/token",
                data={
                    "grant_type": auth_server.OID4VCI_PRE_AUTHORIZED_GRANT_TYPE,
                    "pre-authorized_code": grant["pre-authorized_code"],
                    "tx_code": created["dev_tx_code"],
                },
            )
            assert replay_token_response.status_code == 400
            assert replay_token_response.json()["error"] == "invalid_grant"

            nonce_response = client.post("/oid4vci/nonce")
            assert nonce_response.status_code == 200
            proof = _proof_jwt(holder_key, nonce_response.json()["c_nonce"])
            credential_request = {
                "credential_identifier": credential_identifier,
                "proofs": {"jwt": [proof]},
            }
            credential_response = client.post(
                "/oid4vci/credential",
                headers={"Authorization": f"Bearer {token['access_token']}"},
                json=credential_request,
            )
            assert credential_response.status_code == 200
            credential = credential_response.json()["credentials"][0]["credential"]
            payload = _decode_and_verify_credential(credential)
            assert payload["sub"] == f"did:pknu:{holder_address}"
            credential_header = json.loads(
                auth_server._base64url_decode(credential.split(".")[0])
            )
            assert credential_header["kid"] == issuer_jwk["kid"]
            assert payload["cnf"]["jwk"] == json.loads(
                auth_server._base64url_decode(proof.split(".")[0])
            )["jwk"]

            replay_credential_response = client.post(
                "/oid4vci/credential",
                headers={"Authorization": f"Bearer {token['access_token']}"},
                json=credential_request,
            )
            assert replay_credential_response.status_code == 401
            assert replay_credential_response.json()["error"] == "invalid_token"

            status_response = client.get(f"/api/status/{holder_address}")
            assert status_response.status_code == 200
            assert status_response.json()["status"] == "active"

            unknown_address = keys.PrivateKey(os.urandom(32)).public_key.to_checksum_address()
            unknown_status = client.get(f"/api/status/{unknown_address}")
            assert unknown_status.status_code == 200
            assert unknown_status.json()["status"] == "not_issued"

            no_service_key = client.post(
                "/internal/credentials/check",
                json={"wallet_address": holder_address},
            )
            assert no_service_key.status_code == 401

            service_headers = {
                "X-Service-Key": os.environ["AUTH_SERVICE_KEY"],
            }
            credential_check = client.post(
                "/internal/credentials/check",
                headers=service_headers,
                json={"wallet_address": holder_address},
            )
            assert credential_check.status_code == 200
            assert credential_check.json()["reason_code"] == "ACTIVE"

            challenge_response = client.post(
                "/api/login-challenge",
                json={"wallet_address": holder_address},
            )
            assert challenge_response.status_code == 200
            challenge = challenge_response.json()

            bad_key = keys.PrivateKey(os.urandom(32))
            bad_signature = Account.from_key(bad_key.to_bytes()).sign_message(
                encode_defunct(text=challenge["message"])
            ).signature.hex()
            invalid_login = client.post(
                "/api/login-verify",
                json={
                    "wallet_address": holder_address,
                    "nonce": challenge["nonce"],
                    "message": challenge["message"],
                    "signature": bad_signature,
                },
            )
            assert invalid_login.status_code == 401

            valid_signature = Account.from_key(holder_key.to_bytes()).sign_message(
                encode_defunct(text=challenge["message"])
            ).signature.hex()
            valid_login = client.post(
                "/api/login-verify",
                json={
                    "wallet_address": holder_address,
                    "nonce": challenge["nonce"],
                    "message": challenge["message"],
                    "signature": valid_signature,
                },
            )
            assert valid_login.status_code == 200
            login_token = valid_login.json()["access_token"]

            introspection = client.post(
                "/internal/sessions/introspect",
                headers=service_headers,
                json={"token": login_token},
            )
            assert introspection.status_code == 200
            assert introspection.json()["active"] is True

            replay_login = client.post(
                "/api/login-verify",
                json={
                    "wallet_address": holder_address,
                    "nonce": challenge["nonce"],
                    "message": challenge["message"],
                    "signature": valid_signature,
                },
            )
            assert replay_login.status_code == 401

            ready_response = client.get("/health/ready")
            assert ready_response.status_code == 200
            assert ready_response.json()["status"] == "ready"
    finally:
        with auth_server.get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM oid4vci_nonces WHERE created_at >= %s",
                    (time.time() - 600,),
                )
                if offer_id:
                    cur.execute(
                        "DELETE FROM oid4vci_access_tokens WHERE offer_id = %s",
                        (offer_id,),
                    )
                    cur.execute(
                        "DELETE FROM oid4vci_credential_offers WHERE offer_id = %s",
                        (offer_id,),
                    )
                cur.execute(
                    "DELETE FROM user_login_sessions WHERE LOWER(wallet_address) = LOWER(%s)",
                    (holder_address,),
                )
                cur.execute(
                    "DELETE FROM login_nonces WHERE LOWER(wallet_address) = LOWER(%s)",
                    (holder_address,),
                )
                cur.execute(
                    "DELETE FROM login_audit_logs WHERE LOWER(wallet_address) = LOWER(%s)",
                    (holder_address,),
                )
                cur.execute("DELETE FROM issued_vcs WHERE email = %s", (email,))
                cur.execute("DELETE FROM auth_sessions WHERE email = %s", (email,))
            conn.commit()
