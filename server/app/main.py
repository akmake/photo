"""
The TEZA backend entry point. Run:  uvicorn app.main:app --reload --port 8790
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from .config import get_settings
from .db import init_db
from .routers import admin, auth, billing, client, galleries, licenses

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.is_dev and (len(settings.secret_key) < 32 or settings.secret_key.startswith("dev-")):
        raise RuntimeError("Production SECRET_KEY must be a unique, long random value")
    init_db()
    yield


app = FastAPI(title="TEZA Platform", version="0.1.0", lifespan=lifespan)

# Authlib's OAuth flow stores state between the redirect and the callback in the
# session; the key is the same server secret.
app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)

# In dev the website, the app and the API all live on different origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.is_dev else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(billing.router)
app.include_router(licenses.router)
app.include_router(galleries.router)
app.include_router(client.router)
app.include_router(admin.router)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "env": settings.teza_env, "service": "teza-platform"}
