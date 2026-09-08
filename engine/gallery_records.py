"""Where a gallery's records live - the same seam the bytes have.

    JsonRecords   one file per collection under TEZA/gallery-db. No server, no
                  driver, no install. A gallery is hundreds of small rows, so
                  this is not a toy: it is the right size for a photographer
                  running everything on one machine.

    MongoRecords  delegates to db.py, the project's existing store.

Chosen by `records` in gallery_config.json, exactly like the storage backend.
This exists because `pymongo` is not installed in the engine environment today
(db.health() says so plainly), and because the deployment target is still open:
demanding a database server before the gallery can be run once would decide
that question by accident.

The one rule both backends keep, and the reason this is not just a dict:
UNREACHABLE IS NOT EMPTY. A read that fails raises. A gallery whose records
cannot be read has to say "cannot read" - showing an empty gallery instead is
a lie the client would act on.
"""

import json
import os
import threading

_HERE = os.path.dirname(os.path.abspath(__file__))


class RecordsUnavailable(RuntimeError):
    """The records could not be reached. Never means "there are none"."""


class JsonRecords:
    """A collection is a JSON file; a document is keyed by its own id.

    Written whole on every save. At the scale this holds - one gallery is a few
    hundred rows - the cost is a millisecond, and it buys atomic replacement
    with no partial state to recover from.
    """

    def __init__(self, root=None):
        self.root = os.path.abspath(
            root or os.path.join(_HERE, "..", "TEZA", "gallery-db")
        )
        self._lock = threading.RLock()

    def _path(self, collection):
        if not collection.isalnum():
            raise ValueError(f"bad collection: {collection}")
        return os.path.join(self.root, f"{collection}.json")

    def _read(self, collection):
        path = self._path(collection)
        if not os.path.isfile(path):
            return {}
        try:
            # Explicit encoding at every boundary: Hebrew Windows, and gallery
            # names are Hebrew.
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:  # noqa: BLE001
            raise RecordsUnavailable(f"cannot read {collection}: {e}") from e

    def _write(self, collection, docs):
        path = self._path(collection)
        try:
            os.makedirs(self.root, exist_ok=True)
            tmp = path + ".part"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(docs, f, ensure_ascii=False, indent=1)
            os.replace(tmp, path)
        except Exception as e:  # noqa: BLE001
            raise RecordsUnavailable(f"cannot write {collection}: {e}") from e

    def find(self, collection, where=None):
        with self._lock:
            docs = self._read(collection)
        where = where or {}
        return [
            dict(doc) for doc in docs.values()
            if all(doc.get(k) == v for k, v in where.items())
        ]

    def save(self, collection, doc):
        if not doc.get("id"):
            raise ValueError("document has no id")
        with self._lock:
            docs = self._read(collection)
            docs[doc["id"]] = dict(doc)
            self._write(collection, docs)
        return {"ok": True, "id": doc["id"]}

    def remove(self, collection, doc_id):
        with self._lock:
            docs = self._read(collection)
            existed = docs.pop(doc_id, None) is not None
            if existed:
                self._write(collection, docs)
        return {"ok": True, "removed": 1 if existed else 0}

    def remove_where(self, collection, where):
        with self._lock:
            docs = self._read(collection)
            doomed = [
                k for k, doc in docs.items()
                if all(doc.get(f) == v for f, v in (where or {}).items())
            ]
            for k in doomed:
                docs.pop(k)
            if doomed:
                self._write(collection, docs)
        return {"ok": True, "removed": len(doomed)}


class MongoRecords:
    """db.py, with `id` kept as the field name on both sides."""

    def __init__(self):
        import db  # noqa: PLC0415
        self._db = db
        health = db.health()
        if not health.get("ok"):
            raise RecordsUnavailable(health.get("error") or "database unreachable")

    def _where(self, where):
        where = dict(where or {})
        if "id" in where:
            where["_id"] = where.pop("id")
        return where

    def find(self, collection, where=None):
        try:
            return self._db.find(collection, self._where(where))
        except self._db.DatabaseUnavailable as e:
            raise RecordsUnavailable(str(e)) from e

    def save(self, collection, doc):
        try:
            return self._db.save(collection, doc)
        except self._db.DatabaseUnavailable as e:
            raise RecordsUnavailable(str(e)) from e

    def remove(self, collection, doc_id):
        try:
            return self._db.remove(collection, doc_id)
        except self._db.DatabaseUnavailable as e:
            raise RecordsUnavailable(str(e)) from e

    def remove_where(self, collection, where):
        try:
            return self._db.remove_where(collection, self._where(where))
        except self._db.DatabaseUnavailable as e:
            raise RecordsUnavailable(str(e)) from e


_records = None
_lock = threading.Lock()


def records():
    global _records
    with _lock:
        if _records is None:
            import gallery_store  # noqa: PLC0415
            try:
                cfg = gallery_store._load_config()
            except Exception:  # noqa: BLE001
                cfg = {}
            if (cfg.get("records") or "json").lower() == "mongo":
                _records = MongoRecords()
            else:
                _records = JsonRecords(cfg.get("records_root"))
        return _records


def reset(instance=None):
    """Swap the backend. Tests point this at a temporary directory."""
    global _records
    with _lock:
        _records = instance
