"""The contract every gallery storage backend fulfils."""

from __future__ import annotations


class GalleryStorage:
    name = "base"

    def put(self, key: str, data: bytes, content_type: str = "image/jpeg") -> None:
        raise NotImplementedError

    def get(self, key: str) -> bytes:
        raise NotImplementedError

    def exists(self, key: str) -> bool:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        raise NotImplementedError

    def public_url(self, key: str) -> str:
        """The URL a client's browser fetches. In dev this is served by the API;
        in production it is the CDN in front of the bucket."""
        raise NotImplementedError
