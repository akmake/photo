"""
Gallery byte storage. Local disk in dev, S3-compatible (Backblaze B2) in
production — the move is a config line, matching the plan in
docs/CLIENT-GALLERY.md. Only derived previews/thumbs ever land here; the
photographer's original RAW never does (docs/LICENSING.md §2).
"""

from ...config import get_settings
from .base import GalleryStorage
from .local import LocalStorage

_settings = get_settings()
_storage: GalleryStorage | None = None


def get_storage() -> GalleryStorage:
    global _storage
    if _storage is not None:
        return _storage

    if _settings.gallery_storage == "local":
        _storage = LocalStorage(_settings.gallery_local_dir)
    else:
        # S3Store (boto3, B2 endpoint) plugs in here later.
        raise RuntimeError(f"gallery storage not implemented: {_settings.gallery_storage!r}")
    return _storage
