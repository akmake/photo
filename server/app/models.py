"""
The records. This is the source of truth for the business: who has an account,
what they pay for, which machines are activated, and which galleries exist.

Design notes
------------
* Internal keys are integers; anything that leaves the server (a license key, a
  gallery link, an account's public id) is an unguessable token, never the int.
* A `User` has at most one `Subscription` and one `License` at a time. The
  License carries the seat limit and the Devices bound to it — that is the whole
  machinery behind "one account, a few machines" (docs/LICENSING.md §5).
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _license_key() -> str:
    # Human-shaped, e.g. TEZA-8F3A-1C9D-4B22-77E0. Not a secret by itself; the
    # real gate is the Ed25519 signature on the lease (docs/LICENSING.md §1).
    raw = secrets.token_hex(8).upper()
    groups = "-".join(raw[i : i + 4] for i in range(0, 16, 4))
    return f"TEZA-{groups}"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    public_id: Mapped[str] = mapped_column(String(32), unique=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), default="")

    # Null when the account is Google-only. Google-sub is null for email/password.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    google_sub: Mapped[str | None] = mapped_column(
        String(255), unique=True, nullable=True, index=True
    )

    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    subscription: Mapped[Subscription | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    license: Mapped[License | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    galleries: Mapped[list[Gallery]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)

    plan: Mapped[str] = mapped_column(String(50), default="pro")
    # active | trialing | past_due | canceled | expired
    status: Mapped[str] = mapped_column(String(20), default="active")

    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    provider: Mapped[str] = mapped_column(String(30), default="stub")
    provider_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped[User] = relationship(back_populates="subscription")

    def is_current(self) -> bool:
        if self.status not in ("active", "trialing"):
            return False
        if self.current_period_end is None:
            return True
        end = self.current_period_end
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        return end > utcnow()


class License(Base):
    __tablename__ = "licenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)

    key: Mapped[str] = mapped_column(String(30), unique=True, default=_license_key)
    max_devices: Mapped[int] = mapped_column(Integer, default=2)
    # active | revoked
    status: Mapped[str] = mapped_column(String(20), default="active")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="license")
    devices: Mapped[list[Device]] = relationship(
        back_populates="license", cascade="all, delete-orphan"
    )


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    license_id: Mapped[int] = mapped_column(ForeignKey("licenses.id"))

    # A stable, hashed machine fingerprint. Never MAC — see docs/LICENSING.md §5.
    device_id: Mapped[str] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")

    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    license: Mapped[License] = relationship(back_populates="devices")


class Gallery(Base):
    __tablename__ = "galleries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    title: Mapped[str] = mapped_column(String(200), default="")
    client_name: Mapped[str] = mapped_column(String(200), default="")
    # The unguessable part of the client link.
    token: Mapped[str] = mapped_column(String(32), unique=True, default=_uuid, index=True)
    # Optional short code the client also types, so a leaked link alone is not enough.
    access_code: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # draft | published | closed
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="galleries")
    images: Mapped[list[GalleryImage]] = relationship(
        back_populates="gallery", cascade="all, delete-orphan"
    )


class GalleryImage(Base):
    __tablename__ = "gallery_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    gallery_id: Mapped[int] = mapped_column(ForeignKey("galleries.id"))

    # The original filename on the photographer's disk — the join key back to the
    # engine. The original bytes themselves NEVER come here (docs/LICENSING.md §2).
    filename: Mapped[str] = mapped_column(String(500))
    preview_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    thumb_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    ordering: Mapped[int] = mapped_column(Integer, default=0)

    gallery: Mapped[Gallery] = relationship(back_populates="images")
    selection: Mapped[GallerySelection | None] = relationship(
        back_populates="image", uselist=False, cascade="all, delete-orphan"
    )


class GallerySelection(Base):
    __tablename__ = "gallery_selections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    gallery_id: Mapped[int] = mapped_column(ForeignKey("galleries.id"), index=True)
    image_id: Mapped[int] = mapped_column(ForeignKey("gallery_images.id"), unique=True)

    selected: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str] = mapped_column(Text, default="")
    marked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    image: Mapped[GalleryImage] = relationship(back_populates="selection")
