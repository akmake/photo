"""Dev storage: files under a local directory, served back by the API."""

from __future__ import annotations

from pathlib import Path

from .base import GalleryStorage


class LocalStorage(GalleryStorage):
    name = "local"

    def __init__(self, root: str):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # Keys are internal and slash-delimited; keep them inside root.
        p = (self.root / key).resolve()
        if not str(p).startswith(str(self.root)):
            raise ValueError("key escapes storage root")
        return p

    def put(self, key: str, data: bytes, content_type: str = "image/jpeg") -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def delete(self, key: str) -> None:
        p = self._path(key)
        if p.exists():
            p.unlink()

    def public_url(self, key: str) -> str:
        return f"/galleries/asset/{key}"
