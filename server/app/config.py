"""
Settings, read once from the environment (.env in dev).

Everything that changes between the developer's laptop and the VPS lives here and
nowhere else, so the move to production is a file, not a code change — the same
principle the gallery already follows (docs/CLIENT-GALLERY.md).
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(SERVER_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    teza_env: str = "dev"
    secret_key: str = "dev-change-me"

    database_url: str = "sqlite:///./teza.db"

    # How long a signed lease stays valid offline before the app must reach the
    # server again. See docs/LICENSING.md §5.
    license_offline_days: int = 14

    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://127.0.0.1:8790/auth/google/callback"

    payment_provider: str = "stub"

    gallery_storage: str = "local"
    gallery_local_dir: str = "./gallery-data"

    @property
    def is_dev(self) -> bool:
        return self.teza_env == "dev"

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
