"""HTTP hardening: security headers on every response and request-size limits."""

from __future__ import annotations

import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

MAX_JSON_BYTES = int(os.getenv("ANVESH_MAX_JSON_KB", "512")) * 1024
MAX_UPLOAD_BYTES = int(os.getenv("ANVESH_MAX_UPLOAD_MB", "100")) * 1024 * 1024

HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
}


class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PATCH", "PUT", "DELETE"):
            ctype = request.headers.get("content-type", "")
            limit = MAX_UPLOAD_BYTES if ctype.startswith("multipart/") else MAX_JSON_BYTES
            try:
                length = int(request.headers.get("content-length") or 0)
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
            if length > limit:
                return JSONResponse({"detail": "Request too large"}, status_code=413)
        response = await call_next(request)
        for k, v in HEADERS.items():
            response.headers.setdefault(k, v)
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if "server" in response.headers:
            del response.headers["server"]
        return response
