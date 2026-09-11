import asyncio
import time
from urllib.parse import quote
from fastapi import Body, HTTPException
from fastapi.responses import JSONResponse
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