import asyncio
import re
import time
from urllib.parse import quote
from fastapi import Body, HTTPException, Request
from fastapi.responses import JSONResponse, Response
try:
    from .auth_s2s import ADDRESS, AuthServiceUnavailable, inspect_credential, inspect_session
except ImportError:
    from auth_s2s import ADDRESS, AuthServiceUnavailable, inspect_credential, inspect_session


class ServiceGuardMiddleware:
    def __init__(self, app, settings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        protected = self.settings.internal_only or scope.get("path", "").startswith("/internal/")
        headers = dict(scope.get("headers", []))
        supplied = headers.get(b"x-service-key")
        supplied = supplied.decode("ascii", errors="ignore") if supplied is not None else None
        if protected and not self.settings.accepts(supplied):
            code = "AUTH_SERVICE_UNAUTHORIZED" if self.settings.key else "AUTH_SERVICE_NOT_CONFIGURED"
            response = JSONResponse(status_code=401 if self.settings.key else 503,
                                    content={"detail": {"code": code,
                                                        "message": "서버 간 인증이 필요합니다."}},
                                    headers={"Cache-Control": "no-store"})
            await response(scope, receive, send)
            return

        async def send_no_store(message):
            if message["type"] == "http.response.start":
                response_headers = [(name, value) for name, value in message.get("headers", [])
                                    if name.lower() != b"cache-control"]
                response_headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": response_headers}
            await send(message)

        await self.app(scope, receive, send_no_store)


def install_auth_guard(app, settings):
    app.add_middleware(ServiceGuardMiddleware, settings=settings)


def install_internal_auth_routes(app, connection_factory):
    @app.post("/internal/sessions/introspect", include_in_schema=False)
    async def introspect(payload: dict = Body(...)):
        token = payload.get("token")
        if not isinstance(token, str) or not 1 <= len(token) <= 4096:
            raise HTTPException(status_code=422, detail="token 형식을 확인하세요.")
        try:
            return inspect_session(connection_factory, token, time.time())
        except Exception:
            raise HTTPException(status_code=503, detail="인증 저장소를 이용할 수 없습니다.") from None

    @app.post("/internal/credentials/check", include_in_schema=False)
    async def credential_check(payload: dict = Body(...)):
        address = payload.get("wallet_address")
        if not isinstance(address, str) or not ADDRESS.fullmatch(address):
            raise HTTPException(status_code=422, detail="wallet_address 형식을 확인하세요.")
        try:
            return inspect_credential(connection_factory, address, time.time())
        except Exception:
            raise HTTPException(status_code=503, detail="인증 저장소를 이용할 수 없습니다.") from None


def install_gateway_routes(app, gateway):
    async def relay(method, path, payload=None):
        try:
            # 동기 표준 HTTP 클라이언트는 이벤트 루프 밖에서 실행한다.
            result = await asyncio.to_thread(gateway.call, method, path, payload)
        except AuthServiceUnavailable:
            raise HTTPException(status_code=503,
                                detail="인증 서비스를 일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해주세요.") from None
        headers = {"Cache-Control": "no-store"}
        if result.retry_after:
            headers["Retry-After"] = result.retry_after
        return JSONResponse(status_code=result.status, content=result.body, headers=headers)

    def post_handler(path):
        async def endpoint(payload: dict = Body(...)):
            return await relay("POST", path, payload)
        return endpoint

    def get_handler(path):
        async def endpoint():
            return await relay("GET", path)
        return endpoint

    async def relay_bytes(method, path, body=None, content_type="", authorization=""):
        try:
            result = await asyncio.to_thread(
                gateway.call_bytes, method, path, body, content_type, authorization
            )
        except AuthServiceUnavailable:
            raise HTTPException(status_code=503,
                                detail="인증 서비스를 일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해주세요.") from None
        headers = {"Cache-Control": "no-store", "Content-Type": result.content_type}
        if result.retry_after:
            headers["Retry-After"] = result.retry_after
        return Response(content=result.body, status_code=result.status, headers=headers)

    def get_bytes_handler(path):
        async def endpoint():
            return await relay_bytes("GET", path)
        return endpoint

    for name in ("request-email-auth", "verify-email-auth", "login-challenge",
                 "login-verify", "logout", "revoke-vc", "verify-vp"):
        path = "/api/" + name
        app.add_api_route(path, post_handler(path), methods=["POST"],
                          name="auth_" + name.replace("-", "_"))
    for name in ("issuer-info", "auth-challenge"):
        path = "/api/" + name
        app.add_api_route(path, get_handler(path), methods=["GET"],
                          name="auth_" + name.replace("-", "_"))

    @app.get("/api/did/{address}")
    async def did_document(address: str):
        if not ADDRESS.fullmatch(address):
            raise HTTPException(status_code=400, detail="지갑 주소 형식을 확인하세요.")
        return await relay("GET", "/api/did/" + quote(address, safe=""))

    @app.get("/api/status/{wallet_address}")
    async def vc_status(wallet_address: str):
        if not ADDRESS.fullmatch(wallet_address):
            raise HTTPException(status_code=400, detail="지갑 주소 형식을 확인하세요.")
        return await relay("GET", "/api/status/" + quote(wallet_address, safe=""))

    @app.post("/api/oid4vci/credential-offers")
    async def oid4vci_create_offer(payload: dict = Body(...)):
        return await relay("POST", "/api/oid4vci/credential-offers", payload)

    for metadata_name in ("openid-credential-issuer", "oauth-authorization-server", "jwks.json"):
        path = "/.well-known/" + metadata_name
        app.add_api_route(
            path,
            get_bytes_handler(path),
            methods=["GET"],
            name="oid4vci_" + metadata_name.replace("-", "_").replace(".", "_"),
        )

    offer_id_pattern = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

    @app.get("/oid4vci/credential-offer/{offer_id}")
    async def oid4vci_offer(offer_id: str):
        if not offer_id_pattern.fullmatch(offer_id):
            raise HTTPException(status_code=400, detail="Credential Offer ID 형식을 확인하세요.")
        return await relay_bytes("GET", "/oid4vci/credential-offer/" + quote(offer_id, safe=""))

    @app.get("/oid4vci/credential-offer/{offer_id}/qr")
    async def oid4vci_offer_qr(offer_id: str):
        if not offer_id_pattern.fullmatch(offer_id):
            raise HTTPException(status_code=400, detail="Credential Offer ID 형식을 확인하세요.")
        return await relay_bytes("GET", "/oid4vci/credential-offer/" + quote(offer_id, safe="") + "/qr")

    @app.post("/oid4vci/token")
    async def oid4vci_token(request: Request):
        return await relay_bytes(
            "POST",
            "/oid4vci/token",
            await request.body(),
            request.headers.get("content-type", ""),
        )

    @app.post("/oid4vci/nonce")
    async def oid4vci_nonce():
        return await relay_bytes("POST", "/oid4vci/nonce", b"")

    @app.post("/oid4vci/credential")
    async def oid4vci_credential(request: Request):
        return await relay_bytes(
            "POST",
            "/oid4vci/credential",
            await request.body(),
            request.headers.get("content-type", ""),
            request.headers.get("authorization", ""),
        )

    pairing_id_pattern = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

    @app.post("/api/mobile-pairings")
    async def mobile_pairing_create(request: Request):
        return await relay_bytes(
            "POST",
            "/api/mobile-pairings",
            await request.body(),
            request.headers.get("content-type", "application/json"),
            request.headers.get("authorization", ""),
        )

    @app.get("/api/mobile-pairings/{pairing_id}")
    async def mobile_pairing_status(pairing_id: str, request: Request):
        if not pairing_id_pattern.fullmatch(pairing_id):
            raise HTTPException(status_code=400, detail="모바일 연결 ID 형식을 확인하세요.")
        return await relay_bytes(
            "GET",
            "/api/mobile-pairings/" + quote(pairing_id, safe=""),
            authorization=request.headers.get("authorization", ""),
        )

    @app.get("/api/mobile-devices")
    async def mobile_devices(request: Request):
        return await relay_bytes(
            "GET",
            "/api/mobile-devices",
            authorization=request.headers.get("authorization", ""),
        )

    @app.post("/api/mobile-devices/{wallet_address}/revoke")
    async def mobile_device_revoke(wallet_address: str, request: Request):
        if not ADDRESS.fullmatch(wallet_address):
            raise HTTPException(status_code=400, detail="모바일 Wallet 주소 형식을 확인하세요.")
        return await relay_bytes(
            "POST",
            "/api/mobile-devices/" + quote(wallet_address, safe="") + "/revoke",
            await request.body(),
            request.headers.get("content-type", "application/json"),
            request.headers.get("authorization", ""),
        )

    @app.post("/api/mobile-pairings/complete")
    async def mobile_pairing_complete(request: Request):
        return await relay_bytes(
            "POST",
            "/api/mobile-pairings/complete",
            await request.body(),
            request.headers.get("content-type", "application/json"),
        )
