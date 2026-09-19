"""Promote a user to admin by email. Usage: python scripts/make_admin.py you@example.com"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from app.db import SessionLocal, init_db
from app.models import User

def main():
    if len(sys.argv) < 2:
        print("usage: python scripts/make_admin.py <email>")
        sys.exit(1)
    email = sys.argv[1].lower().strip()
    init_db()
    db = SessionLocal()
    u = db.scalar(select(User).where(User.email == email))
    if u is None:
        print(f"no user with email {email}")
        sys.exit(1)
    u.is_admin = True
    db.commit()
    print(f"{email} is now admin")

if __name__ == "__main__":
    main()
