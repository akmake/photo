"""
What the desktop app talks to. Three verbs (docs/LICENSING.md §4):

* activate   — bind this machine, get the first signed lease.
* refresh    — the periodic heartbeat that extends the offline window.
* deactivate — release this machine (moving to a new computer).

Plus /public-key, which the app build reads once to embed the verify key, and
/status for the portal.

Enforcement lives here, not in the UI, because the app itself is on the user's
machine and therefore breakable (docs/LICENSING.md §1, §8). The lease is only
issued when the subscription is truly current.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import Device, License, User, utcnow
from ..security import public_key_pem
from ..services.accounts import ensure_license
from ..services.licensing import build_lease

router = APIRouter(prefix="/licenses", tags=["licenses"])


class ActivateIn(BaseModel):
    device_id: str
    device_name: str = ""


class LeaseOut(BaseModel):
    lease: str
    offline_until: str
    expires_at: str | None
    device_id: str


def _require_current_subscription(user: User) -> None:
    sub = user.subscription
    if sub is None or not sub.is_current():
        raise HTTPException(402, "אין מנוי בתוקף")


def _issue(db: Session, user: User, device_id: str) -> LeaseOut:
    lease = build_lease(
        user_public_id=user.public_id,
        email=user.email,
        device_id=device_id,
        license=user.license,
        subscription=user.subscription,
    )
    db.commit()
    return LeaseOut(
        lease=lease["lease"],
        offline_until=lease["offline_until"],
        expires_at=lease["expires_at"],
        device_id=device_id,
    )


@router.get("/public-key")
def get_public_key() -> dict:
    """The Ed25519 public key the app embeds to verify leases offline."""
    return {"algorithm": "ed25519", "public_key_pem": public_key_pem()}


@router.post("/activate", response_model=LeaseOut)
def activate(body: ActivateIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> LeaseOut:
    device_id = body.device_id.strip()
    if not device_id:
        raise HTTPException(400, "חסר מזהה מכשיר")

    _require_current_subscription(user)
    lic = ensure_license(db, user)
    if lic.status != "active":
        raise HTTPException(403, "הרישיון בוטל")

    existing = db.scalar(
        select(Device).where(Device.license_id == lic.id, Device.device_id == device_id)
    )
    if existing is None:
        active_count = len(lic.devices)
        if active_count >= lic.max_devices:
            raise HTTPException(
                409,
                f"הרישיון כבר פעיל על {active_count} מכשירים "
                f"(מותר {lic.max_devices}). נתק מכשיר אחר תחילה.",
            )
        db.add(Device(license_id=lic.id, device_id=device_id, name=body.device_name.strip()))
        db.flush()
        db.refresh(user)
    else:
        existing.last_seen = utcnow()
        existing.name = body.device_name.strip() or existing.name

    return _issue(db, user, device_id)


@router.post("/refresh", response_model=LeaseOut)
def refresh(body: ActivateIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> LeaseOut:
    """The heartbeat. A known device gets a fresh lease; an unknown one is told to
    activate (it may have been deactivated elsewhere)."""
    device_id = body.device_id.strip()
    _require_current_subscription(user)
    lic = ensure_license(db, user)
    if lic.status != "active":
        raise HTTPException(403, "הרישיון בוטל")

    device = db.scalar(
        select(Device).where(Device.license_id == lic.id, Device.device_id == device_id)
    )
    if device is None:
        raise HTTPException(409, "המכשיר אינו רשום — נדרשת הפעלה מחדש")
    device.last_seen = utcnow()
    return _issue(db, user, device_id)


class DeactivateIn(BaseModel):
    device_id: str


@router.post("/deactivate")
def deactivate(body: DeactivateIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    lic = user.license
    if lic is None:
        raise HTTPException(404, "אין רישיון")
    device = db.scalar(
        select(Device).where(Device.license_id == lic.id, Device.device_id == body.device_id.strip())
    )
    if device is None:
        raise HTTPException(404, "המכשיר לא נמצא")
    db.delete(device)
    db.commit()
    return {"ok": True, "freed": body.device_id}


@router.get("/devices")
def list_devices(user: User = Depends(current_user)) -> dict:
    lic = user.license
    if lic is None:
        return {"max_devices": 0, "devices": []}
    return {
        "max_devices": lic.max_devices,
        "devices": [
            {
                "device_id": d.device_id,
                "name": d.name,
                "first_seen": d.first_seen.isoformat(),
                "last_seen": d.last_seen.isoformat(),
            }
            for d in lic.devices
        ],
    }
