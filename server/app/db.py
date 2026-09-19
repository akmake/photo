"""
The database handle. SQLite in dev, Postgres in production — the only difference
is DATABASE_URL. SQLAlchemy 2.0 style.
"""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

# check_same_thread is a SQLite-only quirk: FastAPI serves each request on its own
# thread, and SQLite otherwise refuses a connection opened on another. Harmless on
# Postgres because the argument is filtered out for non-sqlite URLs.
_connect_args = (
    {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
)

engine = create_engine(settings.database_url, connect_args=_connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Import models so their tables are registered on Base before create_all.
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
