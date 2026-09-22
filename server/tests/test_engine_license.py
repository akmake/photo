"""The packaged engine must refuse unsigned, expired and wrong-machine leases."""

import base64
import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))
import license_state  # noqa: E402
import license_pin  # noqa: E402


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


class EngineLicenseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.key = Ed25519PrivateKey.generate()
        public = self.key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        (self.folder / "public.pem").write_bytes(public)
        der = self.key.public_key().public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        pin = patch.object(license_pin, "EXPECTED_PUBLIC_KEY_SHA256", hashlib.sha256(der).hexdigest())
        pin.start()
        self.addCleanup(pin.stop)
        env = patch.dict(os.environ, {
            "TEZA_LICENSE_PUBLIC_KEY_PATH": str(self.folder / "public.pem"),
            "TEZA_LICENSE_DATA_DIR": str(self.folder),
        })
        env.start()
        self.addCleanup(env.stop)
        machine = patch.object(license_state, "machine_id", return_value="machine-A")
        machine.start()
        self.addCleanup(machine.stop)
        required = patch.object(license_state, "REQUIRED", True)
        required.start()
        self.addCleanup(required.stop)

    def lease(self, *, device="machine-A", expires=2000, offline=2000):
        claims = {
            "v": 1, "device": device, "status": "trialing", "plan": "trial",
            "issued_at": 1000, "offline_until": offline, "expires_at": expires,
        }
        body = json.dumps(claims, sort_keys=True, separators=(",", ":")).encode()
        return b64(body) + "." + b64(self.key.sign(body))

    def test_signed_lease_only_until_fixed_deadline(self):
        self.assertEqual(license_state.verify(self.lease(), now=1500)["plan"], "trial")
        with self.assertRaises(license_state.LicenseError):
            license_state.verify(self.lease(), now=2000)

    def test_tamper_and_other_machine_are_refused(self):
        with self.assertRaises(license_state.LicenseError):
            license_state.verify(self.lease() + "x", now=1500)
        with self.assertRaises(license_state.LicenseError):
            license_state.verify(self.lease(device="machine-B"), now=1500)

    def test_clock_rollback_blocks_work(self):
        (self.folder / "lease.txt").write_text(self.lease(expires=5000, offline=5000))
        with patch.object(license_state.time, "time", return_value=2000):
            self.assertTrue(license_state.status()["ok"])
        with patch.object(license_state.time, "time", return_value=1000):
            self.assertFalse(license_state.status()["ok"])


if __name__ == "__main__":
    unittest.main()
