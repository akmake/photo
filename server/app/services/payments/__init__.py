"""
Payment provider selection. One interface, swappable implementation — the choice
of real provider (Stripe, an Israeli card gateway) is a config line, never a
rewrite (docs/LICENSING.md, README).
"""

from ...config import get_settings
from .base import PaymentProvider
from .stub import StubProvider

_settings = get_settings()
_provider: PaymentProvider | None = None


def get_provider() -> PaymentProvider:
    global _provider
    if _provider is not None:
        return _provider

    name = _settings.payment_provider
    if name == "stub":
        _provider = StubProvider()
    else:
        # A real provider (stripe / israeli-gateway) registers here later. Failing
        # loudly beats silently charging nobody.
        raise RuntimeError(f"payment provider not implemented: {name!r}")
    return _provider
