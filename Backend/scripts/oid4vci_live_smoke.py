#!/usr/bin/env python3
"""Run the complete OpenID4VCI flow against a running issuer over HTTP(S)."""

import argparse
import base64
import hashlib
import json
import os
import time
import uuid
from urllib.parse import parse_qs, urlparse

import httpx
from eth_keys import keys


GRANT_TYPE = "urn:ietf:params:oauth:grant-type:pre-authorized_code"


def base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def decode_base64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def json_base64url(value: dict) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return base64url(encoded)


def public_jwk(private_key: keys.PrivateKey) -> dict:
    public_key = private_key.public_key.to_bytes()
    return {
        "kty": "EC",
        "crv": "secp256k1",
        "x": base64url(public_key[:32]),
        "y": base64url(public_key[32:]),
    }


def proof_jwt(private_key: keys.PrivateKey, issuer: str, nonce: str) -> str:
    header = {
        "alg": "ES256K",
        "typ": "openid4vci-proof+jwt",
        "jwk": public_jwk(private_key),
    }
    payload = {"aud": issuer, "iat": int(time.time()), "nonce": nonce}
    encoded_header = json_base64url(header)
    encoded_payload = json_base64url(payload)
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = private_key.sign_msg_hash(hashlib.sha256(signing_input).digest())
    jose_signature = signature.r.to_bytes(32, "big") + signature.s.to_bytes(32, "big")
    return f"{encoded_header}.{encoded_payload}.{base64url(jose_signature)}"


def checked_json(response: httpx.Response) -> dict:
    response.raise_for_status()
    return response.json()


def verify_credential(credential: str, issuer_jwk: dict) -> dict:
    encoded_header, encoded_payload, encoded_signature = credential.split(".")
    header = json.loads(decode_base64url(encoded_header))
    if header.get("alg") != "ES256K" or header.get("typ") != "JWT":
        raise AssertionError("지원하지 않는 Credential JWT 헤더입니다.")
    if header.get("kid") != issuer_jwk.get("kid"):
        raise AssertionError("Credential kid와 공개 JWKS가 일치하지 않습니다.")

    signature = keys.NonRecoverableSignature(decode_base64url(encoded_signature))
    public_key_bytes = decode_base64url(issuer_jwk["x"]) + decode_base64url(
        issuer_jwk["y"]
    )
    issuer_public_key = keys.PublicKey(public_key_bytes)
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    if not signature.verify_msg_hash(
        hashlib.sha256(signing_input).digest(),
        issuer_public_key,
    ):
        raise AssertionError("Credential 발급자 서명 검증에 실패했습니다.")
    return json.loads(decode_base64url(encoded_payload))


def run(issuer: str, timeout: float) -> None:
    issuer = issuer.rstrip("/")
    email = f"oid4vci-live-{uuid.uuid4().hex[:12]}@pukyong.ac.kr"
    holder_key = keys.PrivateKey(os.urandom(32))
    holder_jwk = public_jwk(holder_key)

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        metadata = checked_json(
            client.get(f"{issuer}/.well-known/openid-credential-issuer")
        )
        assert metadata["credential_issuer"] == issuer

        auth = checked_json(
            client.post(
                f"{issuer}/api/request-email-auth",
                json={"email": email, "is_recovery": False},
            )
        )
        verification_code = auth.get("dev_verification_code")
        if not verification_code:
            raise AssertionError(
                "개발용 인증번호가 없습니다. DEV_EMAIL_AUTH_BYPASS=true인지 확인하세요."
            )

        created = checked_json(
            client.post(
                f"{issuer}/api/oid4vci/credential-offers",
                json={"email": email, "code": verification_code},
            )
        )
        offer_uri_query = parse_qs(urlparse(created["offer_uri"]).query)
        offer_url = offer_uri_query["credential_offer_uri"][0]
        offer = checked_json(client.get(offer_url))

        qr = client.get(created["qr_png_url"])
        qr.raise_for_status()
        assert qr.content.startswith(b"\x89PNG\r\n\x1a\n")

        grant = offer["grants"][GRANT_TYPE]
        authorization_server = metadata.get("authorization_servers", [issuer])[0]
        authorization_metadata = checked_json(
            client.get(f"{authorization_server}/.well-known/oauth-authorization-server")
        )
        issuer_jwks = checked_json(client.get(authorization_metadata["jwks_uri"]))
        issuer_jwk = issuer_jwks["keys"][0]
        token = checked_json(
            client.post(
                authorization_metadata["token_endpoint"],
                data={
                    "grant_type": GRANT_TYPE,
                    "pre-authorized_code": grant["pre-authorized_code"],
                    "tx_code": created["dev_tx_code"],
                },
            )
        )
        credential_identifier = token["authorization_details"][0][
            "credential_identifiers"
        ][0]

        nonce = checked_json(client.post(metadata["nonce_endpoint"]))["c_nonce"]
        proof = proof_jwt(holder_key, issuer, nonce)
        credential_response = checked_json(
            client.post(
                metadata["credential_endpoint"],
                headers={"Authorization": f"Bearer {token['access_token']}"},
                json={
                    "credential_identifier": credential_identifier,
                    "proofs": {"jwt": [proof]},
                },
            )
        )
        credential = credential_response["credentials"][0]["credential"]
        payload = verify_credential(credential, issuer_jwk)

        assert payload["iss"] == issuer
        assert payload["cnf"]["jwk"] == holder_jwk
        assert payload["sub"].startswith("did:pknu:0x")
        credential_subject = payload["vc"]["credentialSubject"]
        assert credential_subject["university"] == "부경대학교"
        assert credential_subject["isStudent"] is True

    print("OpenID4VCI live smoke test: PASS")
    print(f"issuer={issuer}")
    print(f"subject={payload['sub']}")
    print(f"credential_id={payload['jti']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--issuer", required=True, help="Issuer base URL")
    parser.add_argument("--timeout", type=float, default=120.0)
    args = parser.parse_args()
    run(args.issuer, args.timeout)


if __name__ == "__main__":
    main()
