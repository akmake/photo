"""One-time, server-clock 30-day activation semantics."""

import base64
import json
import sys
import unittest
from datetime import timedelta, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import Base, TrialActivation, User, utcnow  # noqa: E402
from app.routers.licenses import ActivateIn, activate, refresh  # noqa: E402


def payload(lease: str) -> dict:
    raw = lease.split(".", 1)[0]
    return json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))


class TrialTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(email="first@example.test")
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_first_activation_starts_fixed_30_day_trial(self):
        before = utcnow()
        result = activate(ActivateIn(device_id="machine-A"), self.user, self.db)
        after = utcnow()
        lease = payload(result.lease)
        self.assertEqual(lease["plan"], "trial")
        self.assertEqual(lease["status"], "trialing")
        end = self.user.subscription.current_period_end.replace(tzinfo=timezone.utc)
        self.assertGreaterEqual(end, before + timedelta(days=30))
        self.assertLessEqual(end, after + timedelta(days=30))
        self.assertEqual(lease["offline_until"], lease["expires_at"])
        expiry = lease["expires_at"]

        again = activate(ActivateIn(device_id="machine-A"), self.user, self.db)
        renewed = refresh(ActivateIn(device_id="machine-A"), self.user, self.db)
        self.assertEqual(payload(again.lease)["expires_at"], expiry)
        self.assertEqual(payload(renewed.lease)["expires_at"], expiry)
        self.assertEqual(self.db.scalar(select(TrialActivation).where(
            TrialActivation.device_id == "machine-A"
        )).user_id, self.user.id)

    def test_new_account_cannot_restart_trial_on_same_device(self):
        activate(ActivateIn(device_id="machine-A"), self.user, self.db)
        second = User(email="second@example.test")
        self.db.add(second)
        self.db.commit()
        with self.assertRaises(HTTPException) as raised:
            activate(ActivateIn(device_id="machine-A"), second, self.db)
        self.assertEqual(raised.exception.status_code, 409)

    def test_expired_trial_cannot_restart(self):
        activate(ActivateIn(device_id="machine-A"), self.user, self.db)
        self.user.subscription.current_period_end = utcnow() - timedelta(seconds=1)
        self.db.commit()
        with self.assertRaises(HTTPException) as raised:
            activate(ActivateIn(device_id="machine-A"), self.user, self.db)
        self.assertEqual(raised.exception.status_code, 402)


if __name__ == "__main__":
    unittest.main()
