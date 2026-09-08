r"""The studio's records, in a real database.

WHY THIS EXISTS
---------------
Everything the application knew about the business — projects, clients,
payments, which folders belong to which shoot, every album and every spread —
used to live in the browser's localStorage. That is one key in one browser
profile: clearing site data, switching machines, or using a different browser
wiped the entire studio, with no backup and no export. The photographs
survived, because they are files on disk; all the knowledge about them did not.

So the records move here. The browser cannot speak to MongoDB, but this engine
already runs locally and already has disk access, so it becomes the data
server:

    browser  --HTTP-->  engine  -->  MongoDB (127.0.0.1:27017)
                          \-->  the photographs, on disk, untouched

The split is deliberate and is the product's oldest rule (docs/PRODUCT-UX.md
§3.7): the DATABASE holds knowledge ABOUT the work, the DISK holds the work.
Not one photograph is copied in here — an album stores the path to a frame,
never the frame.

IDENTITY
--------
The application already gives every record a stable id of its own (a project
id, a folder id, an absolute file path). That id IS the `_id`, so there is
exactly one identity for a record instead of two that have to be kept in step.
Documents cross the wire with `id`; `_id` never leaves this module.
"""

from __future__ import annotations

import threading

DB_NAME = "teza"
URI = "mongodb://127.0.0.1:27017"

# A short timeout on purpose. If the database is down, the screen has to say so
# in a moment — a UI that hangs for thirty seconds is indistinguishable from a
# broken one, and the photographer starts clicking things.
TIMEOUT_MS = 3000

# Only these collections can be addressed. The endpoints are generic so the
# document shapes stay owned by the application, but a generic endpoint that
# accepts ANY collection name would let a stray call write into a namespace
# nothing ever reads again.
COLLECTIONS = {
    "projects",     # one job: client, event, date, money, counters
    "folders",      # the folders on disk a project points at
    "photoStatus",  # per-frame status, keyed by absolute path
    "albums",       # album designs: spreads, layouts, cover, review versions
    "galleries",       # a client gallery: credentials, albums, lock state
    "galleryItems",    # one published frame: keys, selection, versions
    "galleryComments", # a client's note, pinned to a point on one version
    "galleryBrand",    # the photographer's mark, shown on their client galleries
}

_client = None
_lock = threading.Lock()


class DatabaseUnavailable(RuntimeError):
    """MongoDB could not be reached. Never treated as 'no data'."""


def _connect():
    """The one client, created on first use and kept."""
    global _client
    if _client is not None:
        return _client
    with _lock:
        if _client is None:
            try:
                from pymongo import MongoClient
            except ImportError as e:  # noqa: BLE001
                raise DatabaseUnavailable(
                    "pymongo is not installed in the engine environment"
                ) from e
            _client = MongoClient(URI, serverSelectionTimeoutMS=TIMEOUT_MS)
    return _client


def _collection(name):
    if name not in COLLECTIONS:
        raise ValueError(f"unknown collection: {name}")
    try:
        return _connect()[DB_NAME][name]
    except DatabaseUnavailable:
        raise
    except Exception as e:  # noqa: BLE001
        raise DatabaseUnavailable(str(e)) from e


def _out(doc):
    """A stored document as the application expects it: `id`, never `_id`."""
    if doc is None:
        return None
    doc = dict(doc)
    doc["id"] = doc.pop("_id")
    return doc


def _in(doc):
    """An application document as it is stored. `id` becomes the primary key."""
    doc = dict(doc)
    key = doc.pop("id", None)
    if key is None:
        raise ValueError("document has no id")
    doc["_id"] = key
    return doc


def health():
    """Whether the records are reachable, and how many there are.

    The counts are not decoration: they are how the app can tell an empty
    studio apart from a database it never actually reached.
    """
    try:
        client = _connect()
        client.admin.command("ping")
        database = client[DB_NAME]
        return {
            "ok": True,
            "db": DB_NAME,
            "uri": URI,
            "counts": {
                name: database[name].estimated_document_count()
                for name in sorted(COLLECTIONS)
            },
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "db": DB_NAME, "uri": URI, "error": str(e)}


def find(collection, where=None):
    """Every matching document. An empty list means empty, never 'unreachable'
    — that case raises instead, so the UI can tell the two apart."""
    try:
        return [_out(doc) for doc in _collection(collection).find(where or {})]
    except DatabaseUnavailable:
        raise
    except ValueError:
        raise  # a bad collection name is a bad REQUEST, not an outage
    except Exception as e:  # noqa: BLE001
        raise DatabaseUnavailable(str(e)) from e


def save(collection, doc):
    """Insert or replace one document, by its own id."""
    try:
        stored = _in(doc)
        _collection(collection).replace_one(
            {"_id": stored["_id"]}, stored, upsert=True
        )
        return {"ok": True, "id": stored["_id"]}
    except DatabaseUnavailable:
        raise
    except ValueError:
        raise
    except Exception as e:  # noqa: BLE001
        raise DatabaseUnavailable(str(e)) from e


def save_many(collection, docs):
    """Replace a whole set of documents in one round trip."""
    if not docs:
        return {"ok": True, "count": 0}
    try:
        from pymongo import ReplaceOne

        ops = []
        for doc in docs:
            stored = _in(doc)
            ops.append(ReplaceOne({"_id": stored["_id"]}, stored, upsert=True))
        _collection(collection).bulk_write(ops, ordered=False)
        return {"ok": True, "count": len(ops)}
    except DatabaseUnavailable:
        raise
    except ValueError:
        raise
    except Exception as e:  # noqa: BLE001
        raise DatabaseUnavailable(str(e)) from e


def remove(collection, doc_id):
    try:
        result = _collection(collection).delete_one({"_id": doc_id})
        return {"ok": True, "deleted": result.deleted_count}
    except DatabaseUnavailable:
        raise
    except ValueError:
        raise
    except Exception as e:  # noqa: BLE001
        raise DatabaseUnavailable(str(e)) from e


def remove_where(collection, where):
    """Delete a set — a project's folders go with the project."""
    try:
        result = _collection(collection).delete_many(where or {})
        return {"ok": True, "deleted": result.deleted_count}
    except DatabaseUnavailable:
        raise
    except ValueError:
        raise
    except Exception as e:  # noqa: BLE001
        raise DatabaseUnavailable(str(e)) from e


def import_once(payload):
    """Move the browser's saved records in, WITHOUT ever overwriting.

    This runs when the application finds records in localStorage that the
    database does not have. A collection that already holds documents is left
    completely alone: the browser copy is the older one by definition, and
    replaying it over live records would undo real work. Per-document, an id
    that already exists is skipped for the same reason.

    Nothing is deleted from the browser here either. The old copy stays where
    it is as a safety net until the photographer has seen their work in the new
    home — a migration that removes the only other copy of the data on its
    first run is a migration nobody can recover from.
    """
    report = {}
    for name, docs in (payload or {}).items():
        if name not in COLLECTIONS or not isinstance(docs, list):
            continue
        collection = _collection(name)
        existing = {doc["_id"] for doc in collection.find({}, {"_id": 1})}
        fresh = []
        for doc in docs:
            try:
                stored = _in(doc)
            except ValueError:
                continue  # a record with no id cannot be addressed later
            if stored["_id"] not in existing:
                fresh.append(stored)
        if fresh:
            collection.insert_many(fresh, ordered=False)
        report[name] = {
            "imported": len(fresh),
            "skipped": len(docs) - len(fresh),
            "alreadyThere": len(existing),
        }
    return report
