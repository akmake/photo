"""The contract every payment provider fulfils."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class CheckoutResult:
    # Where to send the buyer to pay. For the stub this is a local dev page.
    checkout_url: str
    # The provider's own id for this attempt, stored on the subscription.
    provider_ref: str


@dataclass
class SubscriptionState:
    status: str  # active | trialing | past_due | canceled | expired
    current_period_end: datetime | None
    provider_ref: str | None


class PaymentProvider:
    name = "base"

    def start_checkout(self, *, user_public_id: str, email: str, plan: str) -> CheckoutResult:
        raise NotImplementedError

    def cancel(self, provider_ref: str) -> None:
        raise NotImplementedError

    def read_state(self, provider_ref: str) -> SubscriptionState:
        raise NotImplementedError

    def parse_webhook(self, body: bytes, headers: dict) -> dict:
        """Return a normalised event dict, or {} to ignore. Real providers verify
        a signature here; the stub trusts its own dev calls."""
        raise NotImplementedError
