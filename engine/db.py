r"""The studio's records, in a real database.

WHY THIS EXISTS
---------------
Everything the application knew about the business — projects, clients,
payments, which folders belong to which shoot, every album and every spread —
used to live in the browser's localStorage. That is one key in one browser
profile: clearing site data, switching machines, or using a different browser
wiped the entire studio, with no backup and no export. The photographs
survived, because they are files on disk; all the knowledge about them did not.

So the records move here. The browser cannot speak to a database, but this
engine already runs locally and already has disk access, so it becomes the data
server:

    browser  --HTTP-->  engine  -->  SQLite (one file)
                          \-->  the photographs, on disk, untouched

The split is deliberate and is the product's oldest rule (docs/PRODUCT-UX.md
§3.7): the DATABASE holds knowledge ABOUT the work, the DISK holds the work.
Not one photograph is copied in here — an album stores the path to a frame,
never the frame.

WHY SQLITE AND NOT MONGODB
--------------------------
This was MongoDB until 2026-09-17. MongoDB is a SEPARATE PROGRAM that has to be
installed and running on the machine, and the application is shipped as one
installer to photographers who will never install a database server. On a fresh
machine the whole studio opened on "the records cannot be read".

SQLite ships inside Python itself, needs no installation, no service and no
port, and the entire database is ONE FILE that can be copied, backed up or
mailed. For a single photographer on one machine there is nothing MongoDB was
buying that is worth an install step.

The shape of the data did not change and neither did this module's callers: the
same seven functions, the same arguments, the same errors. Everything above
this file — `server.py`, `gallery_records.py`, `src/db.ts` — is untouched.

IDENTITY
--------
The application already gives every record a stable id of its own (a project
id, a folder id, an absolute file path). That id IS the primary key, so there
is exactly one identity for a record instead of two that have to be kept in
step.

QUERIES
-------
Every `where` the application sends is flat equality on top-level fields — that
is all MongoDB was ever asked for here, and it is all this supports. A query
this cannot answer RAISES instead of quietly matching nothing: a filter that
silently returns an empty list is how "no results" becomes indistinguishable
from "wrong question", and the screen would show a photographer an empty studio.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading

DB_NAME = "teza"

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
    "looks",           # a colour learned in ColorMatch, saved by name to reuse anywhere
}

_conn = None
_lock = threading.RLock()


class DatabaseUnavailable(RuntimeError):
    """The records file could not be opened or written. Never 'no data'."""


def path():
    """-> the one file the studio's records live in.

    TEZA_HOME redirects the whole installation elsewhere, which is what lets a
    test run against a temp directory instead of the real studio. Same
    precedence as every other engine cache (`workspace.py`, `masks.py`).
    """
    base = (
        os.environ.get("TEZA_HOME")
        or os.environ.get("LOCALAPPDATA")
        or os.path.expanduser("~")
    )
    return os.path.join(base, "TEZA", "studio.db")


# The URI the health screen reports. It used to be a mongodb:// address; it is
# now a file, and it is still the answer to "where exactly are my records".
def uri():
    return path()


def _connect():
    """The one connection, created on first use and kept.

    `check_same_thread=False` because the engine is a threading HTTP server and
    a request is answered on whichever thread took it; every call through this
    module holds `_lock`, so only one of them is ever inside SQLite.
    """
    global _conn
    if _conn is not None:
        return _conn
    with _lock:
        if _conn is None:
            target = path()
            try:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                conn = sqlite3.connect(target, check_same_thread=False)
                # WAL: a reader never waits for the writer, which matters here
                # because the background preparer writes while a screen reads.
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS records (
                        collection TEXT NOT NULL,
                        id         TEXT NOT NULL,
                        doc        TEXT NOT NULL,
                        PRIMARY KEY (collection, id)
                    )
                    """
                )
                conn.commit()
            except Exception as e:  # noqa: BLE001
                raise DatabaseUnavailable(str(e)) from e
            _conn = conn
    return _conn


def _check(collection):
    if collection not in COLLECTIONS:
        raise ValueError(f"unknown collection: {collection}")


def _key(doc):
    """A document's own id. Without one it could never be addressed again."""
    key = doc.get("id", doc.get("_id"))
    if key is None:
        raise ValueError("document has no id")
    return str(key)


def _stored(doc):
    """As written: `id` is the field, and `_id` never survives the trip.

    `_id` is only ever seen on documents that came out of the old MongoDB, and
    carrying it forward would leave two spellings of one identity in the file.
    """
    out = dict(doc)
    out.pop("_id", None)
    out["id"] = _key(doc)
    return out


def _normalise(where):
    """A `where` as this module understands it, or an explicit refusal.

    `_id` is accepted because `gallery_records.MongoRecords` still renames `id`
    to `_id` on its way in, which was correct for MongoDB and is harmless here
    as long as exactly one spelling reaches the matcher.
    """
    where = dict(where or {})
    if "_id" in where:
        where.setdefault("id", where.pop("_id"))
        where.pop("_id", None)
    for field, value in where.items():
        if field.startswith("$") or isinstance(value, dict):
            raise ValueError(
                f"this database matches flat equality only; got {field}={value!r}"
            )
    return where


def _matches(doc, where):
    return all(doc.get(field) == value for field, value in where.items())


def _rows(collection, where=None):
    """Every stored document in a collection that matches, as dicts."""
    where = _normalise(where)
    conn = _connect()
    with _lock:
        cursor = conn.execute(
            "SELECT doc FROM records WHERE collection = ?", (collection,)
        )
        docs = [json.loads(row[0]) for row in cursor.fetchall()]
    return [doc for doc in docs if _matches(doc, where)]


def health():
    """Whether the records are reachable, and how many there are.

    The counts are not decoration: they are how the app can tell an empty
    studio apart from a database it never actually reached.
    """
    try:
        conn = _connect()
        with _lock:
            rows = conn.execute(
                "SELECT collection, COUNT(*) FROM records GROUP BY collection"
            ).fetchall()
        tally = {name: 0 for name in COLLECTIONS}
        for name, count in rows:
            if name in tally:
                tally[name] = count
        return {
            "ok": True,
            "db": DB_NAME,
            "uri": uri(),
            "counts": {name: tally[name] for name in sorted(COLLECTIONS)},
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "db": DB_NAME, "uri": uri(), "error": str(e)}


def find(collection, where=None):
    """Every matching document. An empty list means empty, never 'unreachable'
    — that case raises instead, so the UI can tell the two apart."""
    _check(collection)
    try:
        return _rows(collection, where)
    except DatabaseUnavailable:
        raise
    except ValueError:
        raise  # a bad collection name or filter is a bad REQUEST, not an outage
    except Exception as e:  # noqa: BLE001
        raise DatabaseUnavailable(str(e)) from e


def save(collection, doc):
    """Insert or replace one document, by its own id."""
    _check(collection)
    try:
        stored = _stored(doc)
        conn = _connect()
        with _lock:
            conn.execute(
                "INSERT INTO records (collection, id, doc) VALUES (?, ?, ?) "
                "ON CONFLICT(collection, id) DO UPDATE SET doc = excluded.doc",
                (collection, stored["id"], json.dumps(stored, ensure_ascii=False)),
            )
            conn.commit()
        return {"ok": True, "id": stored["id"]}
    except DatabaseUnavailable:
        raise
    except ValueError:
        raise
    except Exception as e:  # noqa: BLE001
        raise DatabaseUnavailable(str(e)) from e


def save_many(collection, docs):
    """Replace a whole set of documents in one transaction.

    One transaction on purpose: a screen that saves eight changed projects must
    not be able to leave four of them saved because the machine went down
    between two writes.
    """
    _check(collection)
    if not docs:
        return {"ok": True, "count": 0}
    try:
        rows = []
        for doc in docs:
            stored = _stored(doc)
            rows.append(
                (collection, stored["id"], json.dumps(stored, ensure_ascii=False))
            )
        conn = _connect()
        with _lock:
            conn.executemany(
                "INSERT INTO records (collection, id, doc) VALUES (?, ?, ?) "
                "ON CONFLICT(collection, id) DO UPDATE SET doc = excluded.doc",
                rows,
            )
            conn.commit()
        return {"ok": True, "count": len(rows)}
    except DatabaseUnavailable:
        raise
    except ValueError:
        raise
    except Exception as e:  # noqa: BLE001
        raise DatabaseUnavailable(str(e)) from e


def remove(collection, doc_id):
    _check(collection)
    try:
        conn = _connect()
        with _lock:
            cursor = conn.execute(
                "DELETE FROM records WHERE collection = ? AND id = ?",
                (collection, str(doc_id)),
            )
            conn.commit()
        return {"ok": True, "deleted": cursor.rowcount}
    except DatabaseUnavailable:
        raise
    except ValueError:
        raise
    except Exception as e:  # noqa: BLE001
        raise DatabaseUnavailable(str(e)) from e


def remove_where(collection, where):
    """Delete a set — a project's folders go with the project."""
    _check(collection)
    try:
        doomed = [doc["id"] for doc in _rows(collection, where) if "id" in doc]
        if not doomed:
            return {"ok": True, "deleted": 0}
        conn = _connect()
        with _lock:
            conn.executemany(
                "DELETE FROM records WHERE collection = ? AND id = ?",
                [(collection, key) for key in doomed],
            )
            conn.commit()
        return {"ok": True, "deleted": len(doomed)}
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
        conn = _connect()
        with _lock:
            existing = {
                row[0]
                for row in conn.execute(
                    "SELECT id FROM records WHERE collection = ?", (name,)
                ).fetchall()
            }
            fresh = []
            for doc in docs:
                try:
                    stored = _stored(doc)
                except ValueError:
                    continue  # a record with no id cannot be addressed later
                if stored["id"] not in existing:
                    fresh.append(
                        (name, stored["id"], json.dumps(stored, ensure_ascii=False))
                    )
            if fresh:
                conn.executemany(
                    "INSERT INTO records (collection, id, doc) VALUES (?, ?, ?)",
                    fresh,
                )
                conn.commit()
        report[name] = {
            "imported": len(fresh),
            "skipped": len(docs) - len(fresh),
            "alreadyThere": len(existing),
        }
    return report
