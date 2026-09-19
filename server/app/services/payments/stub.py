"""
The development payment provider. It charges nothing and is clearly labelled as
a dev stub everywhere it surfaces — this is NOT fake data pretending to be real
money (CLAUDE.md §5). It exists so the whole subscribe → activate → run flow can
be exercised locally before a real gateway is wired in.

"Paying" here simply grants a period that starts now and ends in 30 days.
"""

from __future__ import annotations

import secrets
from datetime import timedelta

from ...models import utcnow
from .base import CheckoutResult, PaymentProvider, SubscriptionState


class StubProvider(PaymentProvider):
    name = "stub"

    def start_checkout(self, *, user_public_id: str, email: str, plan: str) -> CheckoutResult:
        ref = "stub_" + secrets.token_hex(8)
        # No card, no charge. In dev the app/portal completes via the
        # authenticated POST /billing/activate; there is no external page.
        url = "/billing/activate"
        return CheckoutResult(checkout_url=url, provider_ref=ref)

    def cancel(self, provider_ref: str) -> None:
        # Nothing external to cancel; the caller flips the DB status.
        return None

    def read_state(self, provider_ref: str) -> SubscriptionState:
        return SubscriptionState(
            status="active",
            current_period_end=utcnow() + timedelta(days=30),
            provider_ref=provider_ref,
        )

    def parse_webhook(self, body: bytes, headers: dict) -> dict:
        return {}
