"""
Passwords, web sessions, and the license signing keys.

Two very different secrets live here:
* SECRET_KEY signs the website's own session tokens (JWT) — symmetric, rotates
  freely, only the server ever checks it.
* The Ed25519 private key signs license leases. Its PUBLIC half is embedded in the
  desktop app so the app can verify a lease offline. The private half never leaves
  the server. This is the heart of docs/LICENSING.md §1.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import timedelta
from pathlib import Path

import bcrypt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from jose import jwt

from .config import SERVER_ROOT, get_settings
from .models import utcnow

settings = get_settings()

_KEYS_DIR = SERVER_ROOT / "keys"
_PRIV_PATH = _KEYS_DIR / "license_priv.pem"
_PUB_PATH = _KEYS_DIR / "license_pub.pem"

JWT_ALG = "HS256"


# ------------------------------------------------------------------ passwords

def _prep(plain: str) -> bytes:
    # bcrypt silently ignores bytes past 72; sha256+base64 folds any length into a
    # fixed 44-byte token first, so long passwords are not truncated.
    digest = hashlib.sha256(plain.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_prep(plain), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(_prep(plain), hashed.encode("ascii"))
    except ValueError:
        return False


# --------------------------------------------------------------- web sessions

def make_session_token(user_public_id: str, is_admin: bool, days: int = 30) -> str:
    now = utcnow()
    claims = {
        "sub": user_public_id,
        "adm": is_admin,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=days)).timestamp()),
    }
    return jwt.encode(claims, settings.secret_key, algorithm=JWT_ALG)


def read_session_token(token: str) -> dict:
    """Raises jose.JWTError on anything wrong (expired, tampered, bad sig)."""
    return jwt.decode(token, settings.secret_key, algorithms=[JWT_ALG])


# ---------------------------------------------------- license signing (Ed25519)

def _load_or_create_keys() -> Ed25519PrivateKey:
    """First run generates the keypair and writes both halves next to the server.

    In production the private key is provisioned once and backed up out of band;
    regenerating it invalidates every lease already in the field, so this only
    ever creates when nothing is there.
    """
    if _PRIV_PATH.exists():
        data = _PRIV_PATH.read_bytes()
        key = serialization.load_pem_private_key(data, password=None)
        assert isinstance(key, Ed25519PrivateKey)
        return key

    _KEYS_DIR.mkdir(parents=True, exist_ok=True)
    key = Ed25519PrivateKey.generate()
    _PRIV_PATH.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    pub = key.public_key()
    _PUB_PATH.write_bytes(
        pub.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    return key


_private_key: Ed25519PrivateKey | None = None


def _priv() -> Ed25519PrivateKey:
    global _private_key
    if _private_key is None:
        _private_key = _load_or_create_keys()
    return _private_key


def sign_lease(payload_bytes: bytes) -> bytes:
    """Return the Ed25519 signature over the canonical lease bytes."""
    return _priv().sign(payload_bytes)


def public_key_pem() -> str:
    _priv()  # ensure the pair exists
    return _PUB_PATH.read_text()


def verify_lease(payload_bytes: bytes, signature: bytes) -> bool:
    """Server-side self-check; the real verification happens in the desktop app
    with the embedded public key. Kept here so tests can prove sign/verify agree."""
    pub: Ed25519PublicKey = _priv().public_key()
    try:
        pub.verify(signature, payload_bytes)
        return True
    except Exception:
        return False
