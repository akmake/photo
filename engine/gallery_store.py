"""Where a client gallery's bytes live.

Two implementations behind one interface, because the deployment target is not
decided yet and should not have to be decided in order to build:

    LocalStore  - files under a directory, served by whoever mounts the API.
                  Runs with no account, no keys, no domain. This is what the
                  whole gallery can be developed and tested against.

    S3Store     - any S3-compatible object storage (Backblaze B2, Cloudflare
                  R2, ...). The move from local to cloud is a config file, not
                  a code change, which is the entire reason this seam exists.

WHAT NEVER GOES IN HERE: the original frame. A gallery stores a 1600px preview
and a 400px thumbnail, both generated on the photographer's own machine. The
original stays on their disk, where it already is. Uploading originals is
selling a backup service - a different product, with different promises - out
of the gallery's margin, and it costs about forty times the storage.

Presigning: S3Store hands the uploader a signed PUT so bytes go straight from
the photographer's machine to the bucket and never through the API host.
LocalStore cannot presign and says so; the caller writes through put() instead.
One branch, both paths real.
"""

import json
import os
import shutil
import threading

_CONFIG_NAME = "gallery_config.json"
_HERE = os.path.dirname(os.path.abspath(__file__))


class StoreUnavailable(RuntimeError):
    """Storage could not be reached or is misconfigured.

    Deliberately distinct from "nothing there": a gallery that cannot read its
    bucket must say so, never render as an empty gallery. Same rule the
    database follows.
    """


def _load_config():
    """Config from engine/gallery_config.json, overridable by environment.

    The file is git-ignored (see gallery_config.example.json). Keys belong in
    installation configuration, never in source.
    """
    cfg = {}
    path = os.path.join(_HERE, _CONFIG_NAME)
    if os.path.isfile(path):
        try:
            # Explicit encoding: this machine is a Hebrew Windows install and
            # the default codepage is not UTF-8. Paths in this file can be
            # Hebrew.
            with open(path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except Exception as e:  # noqa: BLE001
            raise StoreUnavailable(f"{_CONFIG_NAME} is unreadable: {e}") from e

    env = os.environ.get
    for key, var in (
        ("backend", "TEZA_GALLERY_BACKEND"),
        ("endpoint", "TEZA_GALLERY_ENDPOINT"),
        ("region", "TEZA_GALLERY_REGION"),
        ("bucket", "TEZA_GALLERY_BUCKET"),
        ("access_key_id", "TEZA_GALLERY_KEY_ID"),
        ("secret_access_key", "TEZA_GALLERY_SECRET"),
        ("public_base", "TEZA_GALLERY_PUBLIC_BASE"),
        ("root", "TEZA_GALLERY_ROOT"),
    ):
        if env(var):
            cfg[key] = env(var)
    return cfg


class LocalStore:
    """Objects as files under a root directory.

    Not a stand-in for the real thing - it is a real backend. A photographer
    running everything on one machine is a legitimate deployment, and it is
    also the only way to exercise the full gallery in development without
    renting anything.
    """

    supports_presign = False

    def __init__(self, root=None, public_base="/gallery-files"):
        self.root = root or os.path.join(_HERE, "..", "TEZA", "gallery")
        self.root = os.path.abspath(self.root)
        self.public_base = public_base.rstrip("/")

    def _path(self, key):
        # A key is our own construction (gal/<id>/<item>/<size>.jpg), never
        # anything a client sent. Still refuse traversal rather than trust it.
        safe = os.path.normpath(key).replace("\\", "/")
        if safe.startswith("../") or safe.startswith("/") or ".." in safe.split("/"):
            raise StoreUnavailable(f"refusing suspicious key: {key}")
        return os.path.join(self.root, *safe.split("/"))

    def put(self, key, data, content_type="image/jpeg"):
        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)  # never leave a half-written object readable
        except OSError as e:
            raise StoreUnavailable(f"cannot write {key}: {e}") from e

    def get(self, key):
        try:
            with open(self._path(key), "rb") as f:
                return f.read()
        except FileNotFoundError:
            return None
        except OSError as e:
            raise StoreUnavailable(f"cannot read {key}: {e}") from e

    def presign_put(self, key, content_type="image/jpeg", ttl=3600):
        return None  # honest: there is nothing to sign against a local disk

    def url(self, key, ttl=3600):
        return f"{self.public_base}/{key}"

    def delete_prefix(self, prefix):
        """A whole gallery's folder, or one object. Both callers exist: a
        gallery is deleted by prefix, a replaced logo by its exact key."""
        path = self._path(prefix)
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
        elif os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass  # a stale object is not worth failing a delete over


class S3Store:
    """Any S3-compatible bucket. Verified against the B2 and R2 API shapes.

    boto3 is imported lazily so that a local-only installation never needs it
    and the engine keeps starting on a machine that has no cloud configured.
    """

    supports_presign = True

    def __init__(self, cfg):
        missing = [
            k for k in ("bucket", "access_key_id", "secret_access_key")
            if not cfg.get(k)
        ]
        if missing:
            raise StoreUnavailable(
                "gallery storage is configured as 's3' but missing: "
                + ", ".join(missing)
            )
        try:
            import boto3  # noqa: PLC0415
            from botocore.config import Config  # noqa: PLC0415
        except ImportError as e:
            raise StoreUnavailable(
                "the s3 backend needs boto3 (pip install boto3)"
            ) from e

        self.bucket = cfg["bucket"]
        self.public_base = (cfg.get("public_base") or "").rstrip("/")
        try:
            self._s3 = boto3.client(
                "s3",
                endpoint_url=cfg.get("endpoint") or None,
                region_name=cfg.get("region") or "us-east-1",
                aws_access_key_id=cfg["access_key_id"],
                aws_secret_access_key=cfg["secret_access_key"],
                # B2's S3 layer does not accept the browser POST policy form;
                # signed PUT is the shape that works on both B2 and R2.
                config=Config(signature_version="s3v4"),
            )
        except Exception as e:  # noqa: BLE001
            raise StoreUnavailable(f"cannot open the bucket: {e}") from e

    def put(self, key, data, content_type="image/jpeg"):
        try:
            self._s3.put_object(
                Bucket=self.bucket, Key=key, Body=data, ContentType=content_type
            )
        except Exception as e:  # noqa: BLE001
            raise StoreUnavailable(f"cannot write {key}: {e}") from e

    def get(self, key):
        try:
            return self._s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except Exception as e:  # noqa: BLE001
            if "NoSuchKey" in str(e) or "404" in str(e):
                return None
            raise StoreUnavailable(f"cannot read {key}: {e}") from e

    def presign_put(self, key, content_type="image/jpeg", ttl=3600):
        try:
            return self._s3.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": self.bucket, "Key": key, "ContentType": content_type
                },
                ExpiresIn=ttl,
            )
        except Exception as e:  # noqa: BLE001
            raise StoreUnavailable(f"cannot sign an upload for {key}: {e}") from e

    def url(self, key, ttl=3600):
        # With a CDN in front, the bucket is not addressed directly and the
        # object is public-through-the-CDN; without one, hand out a signed GET
        # that expires. A leaked permanent object URL is scrapeable forever.
        if self.public_base:
            return f"{self.public_base}/{key}"
        try:
            return self._s3.generate_presigned_url(
                "get_object", Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=ttl,
            )
        except Exception as e:  # noqa: BLE001
            raise StoreUnavailable(f"cannot sign a read for {key}: {e}") from e

    def delete_prefix(self, prefix):
        try:
            paginator = self._s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
                if keys:
                    self._s3.delete_objects(
                        Bucket=self.bucket, Delete={"Objects": keys}
                    )
        except Exception as e:  # noqa: BLE001
            raise StoreUnavailable(f"cannot delete {prefix}: {e}") from e


_store = None
_lock = threading.Lock()


def store():
    """The configured store. Local unless told otherwise."""
    global _store
    with _lock:
        if _store is None:
            cfg = _load_config()
            backend = (cfg.get("backend") or "local").lower()
            if backend in ("s3", "b2", "r2"):
                _store = S3Store(cfg)
            else:
                _store = LocalStore(
                    cfg.get("root"),
                    cfg.get("public_base") or "/gallery-files",
                )
        return _store


def reset():
    """Drop the cached store so a config change takes effect. Tests use this."""
    global _store
    with _lock:
        _store = None
