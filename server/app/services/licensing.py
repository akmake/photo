"""
The lease: a small signed document the desktop app verifies offline on every
launch (docs/LICENSING.md §3, §5).

Wire format, deliberately JWT-shaped but Ed25519-signed:

    base64url(canonical_json_payload) + "." + base64url(signature)

The payload is canonical JSON (sorted keys, no spaces) so the exact same bytes are
signed here and re-hashed for verification in the app. Two clocks live in it:

* expires_at    — the subscription's real end, the server's truth.
* offline_until — issued_at + LICENSE_OFFLINE_DAYS. The app may run without the
                  network until here; past it, it must refresh once.

The app trusts whichever is sooner, plus the device binding and a clock-rollback
check it keeps itself.
"""

from __future__ import annotations

import base64
import json
from datetime import timedelta

from ..config import get_settings
from ..models import License, Subscription, utcnow
from ..security import sign_lease

settings = get_settings()

LEASE_VERSION = 1


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _canonical(payload: dict) -> bytes:
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def build_lease(
    *,
    user_public_id: str,
    email: str,
    device_id: str,
    license: License,
    subscription: Subscription | None,
) -> dict:
    """Return {lease, expires_at, offline_until} — lease is the signed string.

    Called on activate and on refresh. The subscription end is copied in as the
    hard expiry; if there is no dated subscription (e.g. a lifetime grant) the
    only limit is the offline window, which a periodic refresh keeps extending.
    """
    now = utcnow()
    offline_until = now + timedelta(days=settings.license_offline_days)

    sub_end = subscription.current_period_end if subscription else None
    plan = subscription.plan if subscription else "none"
    status = subscription.status if subscription else "none"

    payload = {
        "v": LEASE_VERSION,
        "account": user_public_id,
        "email": email,
        "device": device_id,
        "license": license.key,
        "plan": plan,
        "status": status,
        "issued_at": int(now.timestamp()),
        "offline_until": int(offline_until.timestamp()),
        "expires_at": int(sub_end.timestamp()) if sub_end else None,
    }

    body = _canonical(payload)
    sig = sign_lease(body)
    lease = f"{_b64(body)}.{_b64(sig)}"

    return {
        "lease": lease,
        "offline_until": offline_until.isoformat(),
        "expires_at": sub_end.isoformat() if sub_end else None,
    }
