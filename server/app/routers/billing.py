"""
Plans, checkout, and subscription state. The provider is pluggable; in dev it is
the stub that charges nothing (clearly labelled).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import current_user
from ..models import User, utcnow
from ..services.accounts import ensure_license, set_subscription
from ..services.payments import get_provider

router = APIRouter(prefix="/billing", tags=["billing"])
settings = get_settings()

# The catalogue. Prices are placeholders until the real gateway is chosen; they
# are labelled, not invented facts on a screen (CLAUDE.md §5).
PLANS = [
    {"id": "monthly", "name": "חודשי", "price_ils": 99, "period": "חודש"},
    {"id": "yearly", "name": "שנתי", "price_ils": 990, "period": "שנה"},
]


class CheckoutIn(BaseModel):
    plan: str = "monthly"


class StatusOut(BaseModel):
    plan: str | None
    status: str
    current_period_end: str | None
    is_current: bool


@router.get("/plans")
def plans() -> dict:
    return {"plans": PLANS, "provider": settings.payment_provider, "dev": settings.is_dev}


@router.post("/checkout")
def checkout(body: CheckoutIn, user: User = Depends(current_user)) -> dict:
    if settings.payment_provider == "stub" and not settings.is_dev:
        raise HTTPException(503, "תשלום עדיין לא הוגדר בשרת זה")
    if body.plan not in {p["id"] for p in PLANS}:
        raise HTTPException(400, "חבילה לא מוכרת")
    provider = get_provider()
    result = provider.start_checkout(user_public_id=user.public_id, email=user.email, plan=body.plan)
    return {"checkout_url": result.checkout_url, "provider_ref": result.provider_ref}


class ActivateIn(BaseModel):
    plan: str = "monthly"


@router.post("/activate", response_model=StatusOut)
def activate_subscription(
    body: ActivateIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> StatusOut:
    """Dev happy-path: authenticated user 'buys' via the stub in one call.

    Real flow keeps checkout → provider webhook → this same set_subscription call.
    """
    if not settings.is_dev or settings.payment_provider != "stub":
        raise HTTPException(404, "מסלול בדיקה זמין בסביבת פיתוח בלבד")
    provider = get_provider()
    checkout = provider.start_checkout(user_public_id=user.public_id, email=user.email, plan=body.plan)
    state = provider.read_state(checkout.provider_ref)

    ensure_license(db, user)
    sub = set_subscription(
        db, user,
        plan=body.plan,
        status=state.status,
        period_end=state.current_period_end,
        provider=provider.name,
        provider_ref=state.provider_ref,
    )
    db.commit()
    return StatusOut(
        plan=sub.plan,
        status=sub.status,
        current_period_end=sub.current_period_end.isoformat() if sub.current_period_end else None,
        is_current=sub.is_current(),
    )


@router.get("/status", response_model=StatusOut)
def billing_status(user: User = Depends(current_user)) -> StatusOut:
    sub = user.subscription
    if sub is None:
        return StatusOut(plan=None, status="none", current_period_end=None, is_current=False)
    return StatusOut(
        plan=sub.plan,
        status=sub.status,
        current_period_end=sub.current_period_end.isoformat() if sub.current_period_end else None,
        is_current=sub.is_current(),
    )


@router.post("/cancel", response_model=StatusOut)
def cancel(user: User = Depends(current_user), db: Session = Depends(get_db)) -> StatusOut:
    sub = user.subscription
    if sub is None:
        raise HTTPException(404, "אין מנוי פעיל")
    provider = get_provider()
    if sub.provider_ref:
        provider.cancel(sub.provider_ref)
    # Canceled but still valid until the period ends — the field the app reads.
    sub.status = "canceled"
    db.commit()
    return StatusOut(
        plan=sub.plan,
        status=sub.status,
        current_period_end=sub.current_period_end.isoformat() if sub.current_period_end else None,
        is_current=sub.is_current(),
    )
