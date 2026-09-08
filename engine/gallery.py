"""The client gallery: the API both sides talk to.

A photographer publishes a set of frames; the couple opens a link, signs in,
hearts what they want, splits it across the albums that were sold to them,
locks the choice, and then comments on what needs fixing. The choice comes
back into the project as a set, ready to be edited.

WHY THIS IS A MODULE AND NOT ROUTES IN server.py
------------------------------------------------
server.py binds 127.0.0.1 and is a sidecar; the gallery has to be reachable by
someone holding a phone somewhere else. Where it finally runs is not decided
yet, so nothing here decides it: `handle()` takes a method and a path and
returns a status and a body, and knows nothing about the socket underneath.
Mount it in the local engine, or put it behind anything on a VPS. Same code.

For the same reason the store is a seam (gallery_store.py): local disk today,
S3-compatible bucket by way of a config file, no code change either way.

THE PART THAT MATTERS
---------------------
Items are matched by `frameId`, never by filename. Between the upload and the
client's answer the photographer will rename files, move folders and delete
duplicates. Matching on a name means the couple's choices quietly evaporate,
and that is the one bug that would destroy trust in the whole mechanism.
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time

import gallery_records
import gallery_store


def _r():
    """The records backend - JSON files locally, Mongo when configured."""
    return gallery_records.records()

# No i/l/o/0/1: these get read off a phone screen and typed by hand.
_LETTERS = "abcdefghjkmnpqrstuvwxyz"
_DIGITS = "23456789"
_CODE = _LETTERS + _DIGITS

SESSION_TTL = 60 * 60 * 12
_PBKDF2_ROUNDS = 120_000

# token -> (galleryId, expiry). In memory on purpose: a restart signing the
# couple out again is a cost of nothing, and a session table is a thing to
# maintain. If this ever runs multi-process, this is the piece that moves.
_sessions = {}
_sessions_lock = threading.Lock()


class GalleryError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


# --------------------------------------------------------------------------
# credentials
# --------------------------------------------------------------------------

def _pick(alphabet, n):
    return "".join(secrets.choice(alphabet) for _ in range(n))


def _new_username():
    return f"{_pick(_LETTERS, 4)}-{_pick(_DIGITS, 3)}"


def _new_password():
    """Generated, never chosen.

    Two reasons, both practical. It removes the entire forgot-password path -
    the photographer reissues - and it stops clients from typing the password
    they use at the bank into a proofing gallery.
    """
    return f"{_pick(_CODE, 4)}-{_pick(_CODE, 4)}"


def _hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), _PBKDF2_ROUNDS
    )
    return salt, digest.hex()


def _password_ok(password, salt, expected):
    _, actual = _hash_password(password, salt)
    return hmac.compare_digest(actual, expected)


# --------------------------------------------------------------------------
# reading and writing
# --------------------------------------------------------------------------

def _gallery(gallery_id):
    found = _r().find("galleries", {"id": gallery_id})
    if not found:
        raise GalleryError(404, "gallery not found")
    return found[0]


def _gallery_by_slug(slug):
    found = _r().find("galleries", {"slug": slug})
    if not found:
        raise GalleryError(404, "gallery not found")
    return found[0]


def _items(gallery_id):
    items = _r().find("galleryItems", {"galleryId": gallery_id})
    items.sort(key=lambda i: (i.get("order", 0), i.get("name", "")))
    return items


def _item(gallery_id, item_id):
    found = _r().find("galleryItems", {"id": item_id, "galleryId": gallery_id})
    if not found:
        raise GalleryError(404, "photo not found")
    return found[0]


# --------------------------------------------------------------------------
# photographer side
# --------------------------------------------------------------------------

def create_gallery(project_id, name, albums):
    """A gallery and its credentials. The password is returned exactly once.

    `albums` is [{name, quota}] - what the photographer sold. The quota is a
    limit, not a hint: the client swaps something out or calls the photographer.
    """
    if not project_id:
        raise GalleryError(400, "a gallery belongs to a project")
    if not albums:
        raise GalleryError(400, "a gallery needs at least one album")

    password = _new_password()
    salt, hashed = _hash_password(password)
    now = time.time()

    gallery = {
        "id": secrets.token_hex(8),
        "slug": _pick(_CODE, 8),
        "projectId": project_id,
        "name": name or "גלריה",
        "username": _new_username(),
        "passwordSalt": salt,
        "passwordHash": hashed,
        "status": "active",
        "lockedAt": None,
        "createdAt": now,
        "albums": [
            {
                "id": secrets.token_hex(4),
                "name": (a.get("name") or f"אלבום {n + 1}").strip(),
                "quota": max(1, int(a.get("quota") or 1)),
                "nameSetByClient": False,
            }
            for n, a in enumerate(albums)
        ],
    }
    _r().save("galleries", gallery)
    out = dict(gallery)
    out.pop("passwordSalt", None)
    out.pop("passwordHash", None)
    out["password"] = password  # the only time it exists in readable form
    return out


def reissue_credentials(gallery_id):
    gallery = _gallery(gallery_id)
    password = _new_password()
    salt, hashed = _hash_password(password)
    gallery.update(
        {"username": _new_username(), "passwordSalt": salt, "passwordHash": hashed}
    )
    _r().save("galleries", gallery)
    _drop_sessions(gallery_id)
    return {"username": gallery["username"], "password": password}


def ingest(gallery_id, frame_id, name, derived, order=0):
    """Publish one derived frame into a gallery, in process.

    The path for a store that lives on this machine: the engine already holds
    the bytes, so they are written straight through rather than pushed back out
    over HTTP to ourselves.
    """
    gallery = _gallery(gallery_id)
    store = gallery_store.store()
    item_id = secrets.token_hex(8)
    base = f"gal/{gallery['id']}/{item_id}"

    store.put(f"{base}/thumb.jpg", derived["thumb"], "image/jpeg")
    store.put(f"{base}/v1.jpg", derived["preview"], "image/jpeg")

    item = {
        "id": item_id,
        "galleryId": gallery["id"],
        "frameId": frame_id,       # the stable identity. NEVER the filename.
        "name": name,
        "order": order,
        "thumbKey": f"{base}/thumb.jpg",
        "color": derived.get("color") or "#d8d3cc",
        "aspect": derived.get("aspect") or 1.5,
        "albumIds": [],
        "clientDone": False,
        "versions": [{"n": 1, "key": f"{base}/v1.jpg", "createdAt": time.time()}],
    }
    _r().save("galleryItems", item)
    return {"id": item_id, "frameId": frame_id}


def publish(gallery_id, frames):
    """Derive and publish a list of frames from disk, in one call.

    The path the studio actually uses while the store is this machine: the
    engine already has the files open, so deriving and writing here saves
    pushing 200MB back out over HTTP to ourselves.

    `frames` is [{path, frameId, name}]. A file that cannot be read is NAMED
    and skipped - one unreadable frame must never take a 600-frame publish down
    with it, and a silent skip is worse than a slow one.
    """
    import gallery_derive  # noqa: PLC0415  (only this path needs the decoder)

    _gallery(gallery_id)
    done, failed = [], []
    start = len(_items(gallery_id))
    for n, frame in enumerate(frames or []):
        path = frame.get("path")
        name = frame.get("name") or (os.path.basename(path) if path else "")
        frame_id = frame.get("frameId") or path
        if not path or not os.path.isfile(path):
            failed.append({"name": name or path, "error": "הקובץ לא נמצא"})
            continue
        try:
            derived = gallery_derive.derive(path)
            done.append(ingest(gallery_id, frame_id, name, derived, order=start + n))
        except Exception as e:  # noqa: BLE001
            failed.append({"name": name, "error": str(e)})
    return {"published": done, "failed": failed}


def upload_targets(gallery_id, frames):
    """The remote path: create the rows, hand back signed PUTs.

    Bytes go from the photographer's machine straight to the bucket. Routing
    them through the API host would mean paying for the same gigabytes twice
    and holding long connections open for a 20-minute upload.
    """
    gallery = _gallery(gallery_id)
    store = gallery_store.store()
    if not store.supports_presign:
        raise GalleryError(
            400,
            "this store cannot sign uploads; publish in process with ingest()",
        )

    out = []
    for n, frame in enumerate(frames):
        item_id = secrets.token_hex(8)
        base = f"gal/{gallery['id']}/{item_id}"
        item = {
            "id": item_id,
            "galleryId": gallery["id"],
            "frameId": frame.get("frameId"),
            "name": frame.get("name"),
            "order": frame.get("order", n),
            "thumbKey": f"{base}/thumb.jpg",
            "color": frame.get("color") or "#d8d3cc",
            "aspect": frame.get("aspect") or 1.5,
            "albumIds": [],
            "clientDone": False,
            "versions": [],           # nothing is published until it lands
            "pendingKey": f"{base}/v1.jpg",
        }
        _r().save("galleryItems", item)
        out.append({
            "itemId": item_id,
            "thumb": store.presign_put(f"{base}/thumb.jpg"),
            "preview": store.presign_put(f"{base}/v1.jpg"),
        })
    return {"targets": out}


def item_complete(gallery_id, item_id):
    """Both objects landed. Only now does the frame exist for the client."""
    item = _item(gallery_id, item_id)
    key = item.pop("pendingKey", None) or f"gal/{gallery_id}/{item_id}/v1.jpg"
    if not item.get("versions"):
        item["versions"] = [{"n": 1, "key": key, "createdAt": time.time()}]
    _r().save("galleryItems", item)
    return {"ok": True}


def add_version(gallery_id, item_id):
    """A corrected frame. The client sees "updated" instead of guessing."""
    item = _item(gallery_id, item_id)
    n = len(item.get("versions") or []) + 1
    key = f"gal/{gallery_id}/{item_id}/v{n}.jpg"
    store = gallery_store.store()
    item.setdefault("versions", []).append(
        {"n": n, "key": key, "createdAt": time.time()}
    )
    item["clientDone"] = False   # a new version reopens the question
    _r().save("galleryItems", item)
    return {"n": n, "key": key, "put": store.presign_put(key)}


def state(gallery_id):
    """Everything the photographer's copy needs in order to catch up.

    The engine polls this - the photographer's machine is behind NAT and
    cannot be called back. Whole state rather than a delta: a gallery is
    hundreds of small rows, and a wrong delta loses a client's choice silently,
    which is the one failure that must not be possible here.
    """
    gallery = _gallery(gallery_id)
    items = _items(gallery_id)
    comments = _r().find("galleryComments", {"galleryId": gallery_id})
    by_album = {a["id"]: 0 for a in gallery["albums"]}
    for item in items:
        for album_id in item.get("albumIds") or []:
            if album_id in by_album:
                by_album[album_id] += 1

    return {
        "gallery": {
            "id": gallery["id"],
            "slug": gallery["slug"],
            "name": gallery["name"],
            "username": gallery["username"],
            "status": gallery["status"],
            "lockedAt": gallery.get("lockedAt"),
            "albums": gallery["albums"],
        },
        "counts": by_album,
        "selection": [
            {
                "frameId": i["frameId"],
                "itemId": i["id"],
                "albumIds": i.get("albumIds") or [],
                "clientDone": bool(i.get("clientDone")),
                "versions": len(i.get("versions") or []),
            }
            for i in items
            if i.get("albumIds")
        ],
        "comments": [
            {
                "id": c["id"],
                "itemId": c["itemId"],
                "frameId": c.get("frameId"),
                "versionN": c.get("versionN"),
                "x": c.get("x"), "y": c.get("y"),
                "text": c.get("text"),
                "createdAt": c.get("createdAt"),
                "resolvedAt": c.get("resolvedAt"),
            }
            for c in comments
        ],
        "serverTime": time.time(),
    }


def delete_gallery(gallery_id):
    gallery = _gallery(gallery_id)
    gallery_store.store().delete_prefix(f"gal/{gallery['id']}")
    _r().remove_where("galleryComments", {"galleryId": gallery_id})
    _r().remove_where("galleryItems", {"galleryId": gallery_id})
    _r().remove("galleries", gallery_id)
    _drop_sessions(gallery_id)
    return {"ok": True}


def set_status(gallery_id, status):
    """active | frozen | archived.

    Frozen is what a lapsed subscription looks like: the objects stay, the door
    is shut. The client-facing message for it says the gallery is not available
    and to contact the photographer - never that an account was suspended,
    which embarrasses the photographer in front of their own client.
    """
    if status not in ("active", "frozen", "archived"):
        raise GalleryError(400, f"unknown status: {status}")
    gallery = _gallery(gallery_id)
    gallery["status"] = status
    _r().save("galleries", gallery)
    if status != "active":
        _drop_sessions(gallery_id)
    return {"ok": True, "status": status}


# --------------------------------------------------------------------------
# sessions
# --------------------------------------------------------------------------

def _issue_session(gallery_id):
    token = secrets.token_urlsafe(24)
    with _sessions_lock:
        _sessions[token] = (gallery_id, time.time() + SESSION_TTL)
    return token


def _session_gallery(token):
    with _sessions_lock:
        entry = _sessions.get(token or "")
        if not entry:
            raise GalleryError(401, "sign in again")
        gallery_id, expiry = entry
        if expiry < time.time():
            _sessions.pop(token, None)
            raise GalleryError(401, "sign in again")
    return gallery_id


def _drop_sessions(gallery_id):
    with _sessions_lock:
        for token in [t for t, (g, _) in _sessions.items() if g == gallery_id]:
            _sessions.pop(token, None)


# --------------------------------------------------------------------------
# client side
# --------------------------------------------------------------------------

def login(slug, username, password):
    gallery = _gallery_by_slug(slug)
    if gallery["status"] != "active":
        # Deliberately vague and unembarrassing: the person reading this is
        # the photographer's client, not the account holder.
        raise GalleryError(403, "הגלריה לא זמינה כרגע. אנא פנו לצלם.")
    ok = (username or "").strip().lower() == gallery["username"] and _password_ok(
        password or "", gallery["passwordSalt"], gallery["passwordHash"]
    )
    if not ok:
        raise GalleryError(401, "שם משתמש או סיסמה שגויים")
    return {"token": _issue_session(gallery["id"]), "galleryId": gallery["id"]}


def manifest(token):
    """One request, the whole gallery.

    Six hundred separate requests to build a grid is what makes a gallery feel
    broken on a phone. The heavy part - the images - is fetched lazily by the
    grid; this is only the index, plus a placeholder colour per frame so the
    layout never jumps while they load.
    """
    gallery_id = _session_gallery(token)
    gallery = _gallery(gallery_id)
    store = gallery_store.store()
    items = _items(gallery_id)

    published = [i for i in items if i.get("versions")]
    return {
        "gallery": {
            "name": gallery["name"],
            "locked": bool(gallery.get("lockedAt")),
            "albums": gallery["albums"],
        },
        "items": [
            {
                "id": i["id"],
                "color": i.get("color"),
                "aspect": i.get("aspect"),
                "thumb": store.url(i["thumbKey"]),
                "preview": store.url(i["versions"][-1]["key"]),
                "version": i["versions"][-1]["n"],
                "albumIds": i.get("albumIds") or [],
                "clientDone": bool(i.get("clientDone")),
            }
            for i in published
        ],
    }


def select(token, item_id, album_ids):
    """The heart, and which albums it lands in.

    A heart means "in every album" - that is the default and it is 90% of the
    taps. Turning a chip off is the exception, handled where it comes up. An
    empty list is an un-heart: there is no such thing as loved-but-nowhere.
    """
    gallery_id = _session_gallery(token)
    gallery = _gallery(gallery_id)
    if gallery.get("lockedAt"):
        raise GalleryError(409, "הבחירה נעולה. פנו לצלם כדי לפתוח אותה מחדש.")

    item = _item(gallery_id, item_id)
    known = {a["id"]: a for a in gallery["albums"]}
    wanted = [a for a in (album_ids or []) if a in known]

    # The quota is what was sold, so it is a wall, not a warning. Counted
    # server-side: the client's screen is a suggestion, this is the answer.
    if wanted:
        items = _items(gallery_id)
        for album_id in wanted:
            if album_id in (item.get("albumIds") or []):
                continue
            used = sum(1 for i in items if album_id in (i.get("albumIds") or []))
            if used >= known[album_id]["quota"]:
                raise GalleryError(409, {
                    "error": "album_full",
                    "albumId": album_id,
                    "name": known[album_id]["name"],
                    "quota": known[album_id]["quota"],
                })

    item["albumIds"] = wanted
    _r().save("galleryItems", item)
    return {"ok": True, "itemId": item_id, "albumIds": wanted}


def rename_album(token, album_id, name):
    gallery_id = _session_gallery(token)
    gallery = _gallery(gallery_id)
    name = (name or "").strip()[:60]
    if not name:
        raise GalleryError(400, "שם ריק")
    for album in gallery["albums"]:
        if album["id"] == album_id:
            album["name"] = name
            # Flagged, so the photographer is not left hunting for an album
            # under a name that no longer exists anywhere in their own notes.
            album["nameSetByClient"] = True
            _r().save("galleries", gallery)
            return {"ok": True, "albums": gallery["albums"]}
    raise GalleryError(404, "album not found")


def lock(token):
    """"סיימנו לבחור" - the one moment the set crosses into the software."""
    gallery_id = _session_gallery(token)
    gallery = _gallery(gallery_id)
    if not gallery.get("lockedAt"):
        gallery["lockedAt"] = time.time()
        _r().save("galleries", gallery)
    return {"ok": True, "lockedAt": gallery["lockedAt"]}


def unlock(gallery_id):
    """Reopening is the photographer's to do, and it is a deliberate act."""
    gallery = _gallery(gallery_id)
    gallery["lockedAt"] = None
    _r().save("galleries", gallery)
    return {"ok": True}


def comment(token, item_id, x, y, text):
    """A note pinned to a point on the frame.

    "Take that out" - take what out? Without a pin the photographer guesses,
    fixes the wrong thing, and the round trip was wasted. The coordinates are
    normalised 0..1 so they survive every size the frame is ever shown at, and
    they land on the canvas in the studio at the spot that was touched.
    """
    gallery_id = _session_gallery(token)
    gallery = _gallery(gallery_id)
    if not gallery.get("lockedAt"):
        raise GalleryError(409, "הערות נפתחות אחרי שסוגרים את הבחירה")

    item = _item(gallery_id, item_id)
    if not item.get("albumIds"):
        raise GalleryError(409, "אפשר להעיר רק על תמונות שנבחרו")

    text = (text or "").strip()[:2000]
    if not text:
        raise GalleryError(400, "הערה ריקה")

    doc = {
        "id": secrets.token_hex(8),
        "galleryId": gallery_id,
        "itemId": item_id,
        "frameId": item["frameId"],
        "versionN": (item.get("versions") or [{"n": 1}])[-1]["n"],
        "x": min(1.0, max(0.0, float(x))),
        "y": min(1.0, max(0.0, float(y))),
        "text": text,
        "createdAt": time.time(),
        "resolvedAt": None,
    }
    _r().save("galleryComments", doc)
    item["clientDone"] = False
    _r().save("galleryItems", item)
    return {"ok": True, "id": doc["id"], "versionN": doc["versionN"]}


def mark_done(token, item_id, done=True):
    """"סיימתי" on one frame. A signal, not a gate: nothing is blocked by it.

    What is sold is enforced (the quota); what belongs to the relationship is
    not (the rounds). The photographer runs that conversation, not the
    software. This only means their queue can show which frames are settled.
    """
    gallery_id = _session_gallery(token)
    item = _item(gallery_id, item_id)
    item["clientDone"] = bool(done)
    _r().save("galleryItems", item)
    return {"ok": True, "clientDone": item["clientDone"]}


# --------------------------------------------------------------------------
# routing
# --------------------------------------------------------------------------

_SLUG_ROUTE = re.compile(r"^/g/([A-Za-z0-9]+)/([a-z-]+)$")


def _admin_ok(headers):
    """Off by default, because by default this is a localhost sidecar.

    Set `admin_token` in gallery_config.json before this is reachable from
    anywhere else. Left as a live check rather than a TODO so that turning it
    on is configuration and not a code change.
    """
    try:
        cfg_token = gallery_store._load_config().get("admin_token")
    except gallery_store.StoreUnavailable:
        cfg_token = None
    if not cfg_token:
        return True
    got = (headers or {}).get("X-Teza-Admin") or ""
    return hmac.compare_digest(str(got), str(cfg_token))


def handle(method, path, body, headers=None):
    """One entry point. Returns (status, obj), or None if the path is not ours.

    Knows nothing about sockets, so the same function serves the local engine
    and a standalone process on a VPS without a line changing.
    """
    if not (path.startswith("/g/") or path.startswith("/api/gallery/")):
        return None

    headers = headers or {}
    token = headers.get("X-Gallery-Token") or (body or {}).get("token")

    try:
        if path.startswith("/api/gallery/"):
            if not _admin_ok(headers):
                raise GalleryError(401, "unauthorized")
            return 200, _admin_route(method, path, body or {})

        match = _SLUG_ROUTE.match(path)
        if not match:
            return 404, {"error": "not found"}
        slug, action = match.group(1), match.group(2)
        return 200, _client_route(method, slug, action, body or {}, token)

    except GalleryError as e:
        message = e.message
        return e.status, message if isinstance(message, dict) else {"error": message}
    except gallery_records.RecordsUnavailable as e:
        # Never "no photos". A gallery that cannot read its records has to say
        # so, or the client is shown an empty gallery that is a lie.
        return 503, {"error": "לא ניתן לקרוא את הנתונים כרגע", "detail": str(e)}
    except gallery_store.StoreUnavailable as e:
        return 503, {"error": "לא ניתן להגיע לאחסון", "detail": str(e)}


def _admin_route(method, path, body):
    action = path[len("/api/gallery/"):]
    if action == "create" and method == "POST":
        return create_gallery(
            body.get("projectId"), body.get("name"), body.get("albums") or []
        )
    if action == "publish" and method == "POST":
        return publish(body.get("galleryId"), body.get("frames") or [])
    if action == "upload-targets" and method == "POST":
        return upload_targets(body.get("galleryId"), body.get("frames") or [])
    if action == "item-complete" and method == "POST":
        return item_complete(body.get("galleryId"), body.get("itemId"))
    if action == "version" and method == "POST":
        return add_version(body.get("galleryId"), body.get("itemId"))
    if action == "state":
        return state(body.get("galleryId"))
    if action == "credentials" and method == "POST":
        return reissue_credentials(body.get("galleryId"))
    if action == "status" and method == "POST":
        return set_status(body.get("galleryId"), body.get("status"))
    if action == "unlock" and method == "POST":
        return unlock(body.get("galleryId"))
    if action == "delete" and method == "POST":
        return delete_gallery(body.get("galleryId"))
    raise GalleryError(404, "not found")


def _client_route(method, slug, action, body, token):
    if action == "login" and method == "POST":
        return login(slug, body.get("username"), body.get("password"))
    if action == "manifest":
        return manifest(token)
    if action == "select" and method == "POST":
        return select(token, body.get("itemId"), body.get("albumIds"))
    if action == "album-name" and method == "POST":
        return rename_album(token, body.get("albumId"), body.get("name"))
    if action == "lock" and method == "POST":
        return lock(token)
    if action == "comment" and method == "POST":
        return comment(
            token, body.get("itemId"), body.get("x"), body.get("y"), body.get("text")
        )
    if action == "done" and method == "POST":
        return mark_done(token, body.get("itemId"), body.get("done", True))
    raise GalleryError(404, "not found")
