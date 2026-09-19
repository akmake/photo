"""
The developer's area — your control over accounts, subscriptions and licenses.
Guarded by is_admin. In dev, promote yourself with scripts/make_admin.py.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_admin
from ..models import License, User, utcnow
from ..services.accounts import ensure_license, set_subscription

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
def list_users(_: User = Depends(current_admin), db: Session = Depends(get_db)) -> dict:
    users = db.scalars(select(User).order_by(User.id.desc())).all()
    out = []
    for u in users:
        sub = u.subscription
        lic = u.license
        out.append({
            "account": u.public_id,
            "email": u.email,
            "name": u.name,
            "is_admin": u.is_admin,
            "created_at": u.created_at.isoformat(),
            "subscription": {
                "plan": sub.plan,
                "status": sub.status,
                "current_period_end": sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
                "is_current": sub.is_current(),
            } if sub else None,
            "license": {
                "key": lic.key,
                "status": lic.status,
                "max_devices": lic.max_devices,
                "devices": len(lic.devices),
            } if lic else None,
        })
    return {"users": out, "count": len(out)}


def _user(db: Session, account: str) -> User:
    u = db.scalar(select(User).where(User.public_id == account))
    if u is None:
        raise HTTPException(404, "משתמש לא נמצא")
    return u


class GrantIn(BaseModel):
    account: str
    plan: str = "pro"
    days: int = 30


@router.post("/grant")
def grant_subscription(body: GrantIn, _: User = Depends(current_admin), db: Session = Depends(get_db)) -> dict:
    """Manually grant/extend a subscription — comped accounts, support, testing."""
    u = _user(db, body.account)
    ensure_license(db, u)
    sub = set_subscription(
        db, u,
        plan=body.plan,
        status="active",
        period_end=utcnow() + timedelta(days=body.days),
        provider="admin",
        provider_ref=None,
    )
    db.commit()
    return {"account": u.public_id, "status": sub.status, "until": sub.current_period_end.isoformat()}


class RevokeIn(BaseModel):
    account: str


@router.post("/revoke")
def revoke_license(body: RevokeIn, _: User = Depends(current_admin), db: Session = Depends(get_db)) -> dict:
    """Kill a license: existing leases still run until their offline window ends,
    then the next refresh is refused. Immediate lockout is not possible on an
    offline machine — this is the honest limit from docs/LICENSING.md §8."""
    u = _user(db, body.account)
    lic = u.license
    if lic is None:
        raise HTTPException(404, "אין רישיון")
    lic.status = "revoked"
    db.commit()
    return {"account": u.public_id, "license_status": lic.status}


class SeatsIn(BaseModel):
    account: str
    max_devices: int


@router.post("/seats")
def set_seats(body: SeatsIn, _: User = Depends(current_admin), db: Session = Depends(get_db)) -> dict:
    u = _user(db, body.account)
    lic = ensure_license(db, u)
    lic.max_devices = max(1, body.max_devices)
    db.commit()
    return {"account": u.public_id, "max_devices": lic.max_devices}
