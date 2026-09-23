"""Packaged engine's fail-closed, signed-license gate.

No private signing material lives here. The public key is pinned by the build,
and the original photographs are never moved, encrypted or deleted by this gate.
Development engines are deliberately ungated; the installed product sets
TEZA_LICENSE_REQUIRED=1 and supplies the key, origin and data directory.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

import license_pin


REQUIRED = bool(getattr(sys, "frozen", False)) or os.environ.get("TEZA_LICENSE_REQUIRED") == "1"
_LOCK = threading.RLock()
_SKEW_SECONDS = 300


class LicenseError(Exception):
    pass


def _data_dir() -> Path:
    value = os.environ.get("TEZA_LICENSE_DATA_DIR", "")
    if not value:
        raise LicenseError("תיקיית הרישיון אינה מוגדרת")
    return Path(value)


def machine_id() -> str:
    """Stable Windows installation ID, hashed before it leaves this machine."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography") as key:
            guid, _ = winreg.QueryValueEx(key, "MachineGuid")
        if not isinstance(guid, str) or not guid.strip():
            raise ValueError("empty MachineGuid")
        return hashlib.sha256(("TEZA-device-v1:" + guid.strip().lower()).encode()).hexdigest()
    except (OSError, ValueError) as exc:
        raise LicenseError("לא ניתן לזהות את המחשב להפעלת הרישיון") from exc


def _decode(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def _public_key() -> Ed25519PublicKey:
    value = os.environ.get("TEZA_LICENSE_PUBLIC_KEY_PATH", "")
    if not value:
        raise LicenseError("מפתח אימות הרישיון חסר")
    try:
        key = serialization.load_pem_public_key(Path(value).read_bytes())
        if not isinstance(key, Ed25519PublicKey):
            raise ValueError("not an Ed25519 key")
        der = key.public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        if hashlib.sha256(der).hexdigest() != license_pin.EXPECTED_PUBLIC_KEY_SHA256:
            raise ValueError("public key does not match frozen engine pin")
        return key
    except (OSError, ValueError) as exc:
        raise LicenseError("מפתח אימות הרישיון אינו תקין") from exc


def verify(lease: str, *, now: int | None = None) -> dict:
    """Verify signature, machine and both deadlines before any work proceeds."""
    try:
        body_part, signature_part = lease.split(".", 1)
        body, signature = _decode(body_part), _decode(signature_part)
        _public_key().verify(signature, body)
        claims = json.loads(body)
        if not isinstance(claims, dict) or claims.get("v") != 1:
            raise ValueError("unsupported lease")
        if claims.get("device") != machine_id():
            raise LicenseError("הרישיון שייך למחשב אחר")
        if claims.get("status") not in ("trialing", "active"):
            raise LicenseError("הרישיון אינו פעיל")
        clock = int(time.time()) if now is None else now
        issued = claims.get("issued_at")
        offline_until = claims.get("offline_until")
        expires = claims.get("expires_at")
        if not isinstance(issued, int) or not isinstance(offline_until, int):
            raise ValueError("missing lease times")
        if issued > clock + _SKEW_SECONDS:
            raise LicenseError("שעון המחשב הוחזר לאחור")
        if clock >= offline_until or (expires is not None and clock >= expires):
            raise LicenseError("תקופת הרישיון הסתיימה")
        if expires is not None and not isinstance(expires, int):
            raise ValueError("invalid expiry")
        return claims
    except LicenseError:
        raise
    except Exception as exc:
        raise LicenseError("הרישיון אינו תקין או נחתם במפתח אחר") from exc


def _atomic_write(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(value, encoding="utf-8")
    os.replace(temp, path)


def _status() -> dict:
    if not REQUIRED:
        return {"ok": True, "mode": "development"}
    with _LOCK:
        try:
            folder = _data_dir()
            lease = (folder / "lease.txt").read_text(encoding="utf-8")
            claims = verify(lease)
            clock = int(time.time())
            high_path = folder / "high-water.txt"
            try:
                high = int(high_path.read_text(encoding="ascii"))
            except FileNotFoundError:
                high = 0
            except ValueError as exc:
                raise LicenseError("חותמת הזמן של הרישיון פגומה") from exc
            if clock + _SKEW_SECONDS < high:
                raise LicenseError("שעון המחשב הוחזר לאחור")
            if clock > high:
                _atomic_write(high_path, str(clock))
            return {
                "ok": True, "mode": claims.get("plan", "licensed"),
                "expires_at": claims.get("expires_at"),
                "offline_until": claims["offline_until"],
            }
        except FileNotFoundError:
            return {"ok": False, "error": "נדרשת הפעלה ראשונה של התוכנה"}
        except (LicenseError, OSError) as exc:
            return {"ok": False, "error": str(exc)}


def status() -> dict:
    return _status()


def current_lease() -> str:
    """The signed lease this copy holds, or "" before activation. The website
    accepts it as this computer's identity for gallery work (it signed it)."""
    try:
        return (_data_dir() / "lease.txt").read_text(encoding="utf-8").strip()
    except (OSError, LicenseError):  # no license folder: development, or not activated
        return ""


def server_origin() -> str:
    """The site this copy talks to NOW. The shell may move it while the engine
    runs (electron/serverOrigin.cjs writes TEZA_SERVER_FILE after verifying the
    new site holds our public key), so it is read at call time, not at start."""
    path = os.environ.get("TEZA_SERVER_FILE", "")
    if path:
        try:
            saved = str(json.loads(Path(path).read_text(encoding="utf-8")).get("origin", ""))
            if saved.startswith("https://"):
                return saved.rstrip("/")
        except (OSError, ValueError, AttributeError):
            pass  # not moved yet, or unreadable: the address given at start
    return os.environ.get("TEZA_LICENSE_ORIGIN", "").rstrip("/")


def activate(email: str, password: str, name: str = "", register: bool = False) -> dict:
    """First use must reach the server; its clock starts the immutable trial."""
    if not REQUIRED:
        return {"ok": True, "mode": "development"}
    origin = server_origin()
    if not origin.startswith("https://"):
        raise LicenseError("שרת הפעלה מאובטח אינו מוגדר")
    if not email or not password:
        raise LicenseError("יש להזין כתובת מייל וסיסמה")

    def post(route: str, data: dict, token: str = "") -> dict:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(
            origin + route, json.dumps(data).encode("utf-8"), headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            try:
                detail = json.load(exc).get("detail")
            except Exception:
                detail = None
            raise LicenseError(str(detail or "שרת הרישיונות דחה את הבקשה")) from exc
        except (OSError, ValueError) as exc:
            raise LicenseError("לא ניתן להתחבר לשרת הרישיונות") from exc

    identity = post(
        "/auth/register" if register else "/auth/login",
        {"email": email, "password": password, "name": name} if register
        else {"email": email, "password": password},
    )
    result = post(
        "/licenses/activate",
        {"device_id": machine_id(), "device_name": os.environ.get("COMPUTERNAME", "")},
        identity["token"],
    )
    lease = result.get("lease", "")
    verify(lease)  # Pin and verify BEFORE saving any server response.
    with _LOCK:
        _atomic_write(_data_dir() / "lease.txt", lease)
    return status()
