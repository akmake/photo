"""
Accounts: email/password now, Google as the second door.

Google from a *desktop app* cannot use an embedded webview — Google blocks it
(docs/LICENSING.md, the "תסביך"). The flow here is the standard one: the app opens
the system browser at /auth/google/login, the user signs in on google.com, and
Google returns to /auth/google/callback, which mints our own session token. The
website uses the very same endpoints.
"""

from __future__ import annotations

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import current_user
from ..models import User
from ..security import hash_password, make_session_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

_oauth = OAuth()
if settings.google_enabled:
    _oauth.register(
        name="google",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


# ------------------------------------------------------------- schemas

class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str = ""


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    token: str
    email: str
    name: str
    is_admin: bool


class MeOut(BaseModel):
    account: str
    email: str
    name: str
    is_admin: bool


def _token_out(user: User) -> TokenOut:
    return TokenOut(
        token=make_session_token(user.public_id, user.is_admin),
        email=user.email,
        name=user.name,
        is_admin=user.is_admin,
    )


# ------------------------------------------------------------- email/password

@router.post("/register", response_model=TokenOut)
def register(body: RegisterIn, db: Session = Depends(get_db)) -> TokenOut:
    email = body.email.lower().strip()
    if len(body.password) < 8:
        raise HTTPException(400, "הסיסמה חייבת להיות באורך 8 תווים לפחות")
    exists = db.scalar(select(User).where(User.email == email))
    if exists is not None:
        raise HTTPException(409, "כתובת המייל כבר רשומה")
    user = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return _token_out(user)


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)) -> TokenOut:
    email = body.email.lower().strip()
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "מייל או סיסמה שגויים")
    return _token_out(user)


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)) -> MeOut:
    return MeOut(account=user.public_id, email=user.email, name=user.name, is_admin=user.is_admin)


# ------------------------------------------------------------- google

@router.get("/google/login")
async def google_login(request: Request):
    if not settings.google_enabled:
        raise HTTPException(503, "כניסת גוגל לא מוגדרת בשרת הזה")
    return await _oauth.google.authorize_redirect(request, settings.google_redirect_uri)


@router.get("/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    if not settings.google_enabled:
        raise HTTPException(503, "כניסת גוגל לא מוגדרת בשרת הזה")
    token = await _oauth.google.authorize_access_token(request)
    info = token.get("userinfo") or {}
    sub = info.get("sub")
    email = (info.get("email") or "").lower().strip()
    if not sub or not email:
        raise HTTPException(400, "גוגל לא החזירה זהות תקינה")

    user = db.scalar(select(User).where(User.google_sub == sub))
    if user is None:
        # Link to an existing email account, or create a new one.
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(email=email, name=info.get("name", ""), google_sub=sub)
            db.add(user)
        else:
            user.google_sub = sub
        db.commit()
        db.refresh(user)

    session_token = make_session_token(user.public_id, user.is_admin)
    # The desktop app listens on a loopback URL and reads the token from the query;
    # the website would instead set a cookie. Both are fine off the same endpoint.
    return RedirectResponse(url=f"/auth/google/done?token={session_token}")


@router.get("/google/done")
def google_done(token: str) -> dict:
    # A tiny landing the app's embedded browser / loopback catcher reads.
    return {"token": token}
