"""Small account operations shared by several routers."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from ..models import License, Subscription, User


def ensure_license(db: Session, user: User) -> License:
    """Every account has exactly one license row; create it on demand."""
    if user.license is not None:
        return user.license
    lic = License(user_id=user.id)
    db.add(lic)
    db.flush()
    db.refresh(user)
    return lic


def set_subscription(
    db: Session,
    user: User,
    *,
    plan: str,
    status: str,
    period_end: datetime | None,
    provider: str,
    provider_ref: str | None,
) -> Subscription:
    """Create or update the account's single subscription."""
    sub = user.subscription
    if sub is None:
        sub = Subscription(user_id=user.id)
        db.add(sub)
    sub.plan = plan
    sub.status = status
    sub.current_period_end = period_end
    sub.provider = provider
    sub.provider_ref = provider_ref
    db.flush()
    db.refresh(user)
    return sub
