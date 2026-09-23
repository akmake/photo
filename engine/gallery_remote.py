"""The client gallery, as seen from the studio: a relay to the website.

The gallery itself lives on the website (ManagPhoto repo, server/app/gallery),
because a couple opens it on a phone somewhere else and this app is not on the
internet. It used to live here (engine/gallery.py); it moved on 24.09.2026.

The studio did not change: it still posts /api/gallery/<action> to this engine,
with the same bodies, and gets the same answers. This module forwards them to the
website, and does locally the two things only this machine can do:

* PUBLISH. The originals never leave the disk. Each frame is derived HERE
  (gallery_derive: a 1600px preview and a 400px thumbnail), the website hands
  out signed upload URLs, the bytes go straight there, and only then is the frame
  made visible to the client. A frame that fails is NAMED and skipped - one
  unreadable file must never take a 600-frame publish down with it.
* THE LOGO is normalised here (PNG, transparency kept, capped) and sent ready.

Who is calling: the website knows this computer by the lease it signed when the
license was activated (license_state.current_lease). In development there is no
lease; a dev owner header is sent to a local website server instead.

"Cannot reach the website" is always said as such - never an empty answer.
"""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request

import license_state

NO_SITE = "אין חיבור לאתר. בדוק את החיבור לאינטרנט ונסה שוב."
TIMEOUT = 30
UPLOAD_TIMEOUT = 120
DEV_OWNER = "dev-photographer"


class RemoteError(Exception):
    def __init__(self, status, body):
        super().__init__(str(body))
        self.status = status
        self.body = body if isinstance(body, dict) else {"error": str(body)}


def _dev() -> bool:
    return not license_state.REQUIRED


def api_base() -> str:
    """Where the website's API answers. Deployed: <site>/api (the proxy strips
    /api). Development: the website's server directly, no proxy in between."""
    override = os.environ.get("TEZA_GALLERY_API", "").rstrip("/")
    if override:
        return override
    if _dev():
        return "http://127.0.0.1:8790"
    return license_state.server_origin() + "/api"


def public_origin() -> str:
    """Where the CLIENT opens the gallery: the website's own address."""
    override = os.environ.get("TEZA_GALLERY_PUBLIC", "").rstrip("/")
    if override:
        return override
    return "http://localhost:5180" if _dev() else license_state.server_origin()


def _absolute(url: str) -> str:
    """The website answers with '/api/…' paths (its own disk store); a bucket
    answers with full URLs. Either way, something this machine can reach."""
    if url and url.startswith("/api/"):
        return api_base() + url[len("/api"):]
    if url and url.startswith("/"):
        return public_origin() + url
    return url


def _identity() -> dict:
    lease = license_state.current_lease()
    if lease:
        return {"X-Teza-Lease": lease}
    if _dev():
        return {"X-Teza-Dev-Owner": os.environ.get("TEZA_GALLERY_DEV_OWNER", DEV_OWNER)}
    raise RemoteError(401, {"error": "התוכנה אינה מופעלת. הפעל את הרישיון ונסה שוב."})


def call(action: str, body: dict | None = None) -> dict:
    """POST /gallery/<action> on the website. Raises RemoteError."""
    headers = {"Content-Type": "application/json", **_identity()}
    request = urllib.request.Request(
        f"{api_base()}/gallery/{action}",
        json.dumps(body or {}).encode("utf-8"), headers=headers, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        try:
            payload = json.load(e)
        except Exception:  # noqa: BLE001
            payload = {"error": f"האתר החזיר שגיאה {e.code}"}
        raise RemoteError(e.code, payload) from None
    except (OSError, ValueError):
        raise RemoteError(503, {"error": NO_SITE}) from None


def _put(url: str, data: bytes, content_type: str = "image/jpeg") -> None:
    request = urllib.request.Request(
        _absolute(url), data, headers={"Content-Type": content_type}, method="PUT",
    )
    try:
        with urllib.request.urlopen(request, timeout=UPLOAD_TIMEOUT) as response:
            response.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ההעלאה נדחתה ({e.code})") from None
    except OSError:
        raise RuntimeError(NO_SITE) from None


# --------------------------------------------------------------------------
# the two things done here
# --------------------------------------------------------------------------

BATCH = 20   # rows are created on the website this many at a time


def publish(gallery_id, frames):
    """Derive and upload a list of frames: [{path, frameId, name, groupId,
    groupName}]. Returns {published: [{id, frameId}], failed: [{name, error}]}
    — the same answer the in-process publish gave."""
    import gallery_derive  # noqa: PLC0415  (only this path needs the decoder)

    done, failed = [], []
    frames = list(frames or [])
    for start in range(0, len(frames), BATCH):
        batch = []
        for frame in frames[start:start + BATCH]:
            path = frame.get("path")
            name = frame.get("name") or (os.path.basename(path) if path else "")
            # The FILE NAME, never the absolute path: project.json is keyed by
            # name so the folder can move without orphaning anything.
            frame_id = frame.get("frameId") or os.path.basename(path or "")
            if not path or not os.path.isfile(path):
                failed.append({"name": name or path, "error": "הקובץ לא נמצא"})
                continue
            try:
                derived = gallery_derive.derive(path)
            except Exception as e:  # noqa: BLE001
                failed.append({"name": name, "error": str(e)})
                continue
            batch.append((frame, frame_id, name, derived))
        if not batch:
            continue

        targets = call("upload-targets", {"galleryId": gallery_id, "frames": [
            {"frameId": frame_id, "name": name,
             "groupId": frame.get("groupId"), "groupName": frame.get("groupName"),
             "color": derived.get("color"), "aspect": derived.get("aspect")}
            for frame, frame_id, name, derived in batch
        ]})["targets"]

        for (frame, frame_id, name, derived), target in zip(batch, targets):
            try:
                _put(target["thumb"], derived["thumb"])
                _put(target["preview"], derived["preview"])
                call("item-complete", {"galleryId": gallery_id, "itemId": target["itemId"]})
                done.append({"id": target["itemId"], "frameId": frame_id})
            except (RuntimeError, RemoteError) as e:
                failed.append({"name": name, "error": getattr(e, "body", {}).get("error") or str(e)})
                try:   # no invisible half-frame left behind for a retry to trip on
                    call("discard-item", {"galleryId": gallery_id, "itemId": target["itemId"]})
                except RemoteError:
                    pass
    return {"published": done, "failed": failed}


def publish_version(gallery_id, item_id, path, keep_choice=False):
    """A corrected frame, derived here and published as the next version."""
    import gallery_derive  # noqa: PLC0415

    if not path or not os.path.isfile(path):
        raise RemoteError(400, {"error": "הקובץ המתוקן לא נמצא"})
    derived = gallery_derive.derive(path)
    signed = call("version", {"galleryId": gallery_id, "itemId": item_id})
    try:
        _put(signed["put"], derived["preview"])
        _put(signed["thumbPut"], derived["thumb"])
    except RuntimeError as e:
        raise RemoteError(503, {"error": str(e)}) from None
    return call("version-complete", {
        "galleryId": gallery_id, "itemId": item_id,
        "keepChoice": bool(keep_choice), "color": derived.get("color"),
    })


def set_brand(logo_b64, filename=""):
    import gallery_derive  # noqa: PLC0415

    if not logo_b64:
        raise RemoteError(400, {"error": "לא התקבל קובץ"})
    try:
        data = base64.b64decode(logo_b64.split(",", 1)[-1], validate=False)
        made = gallery_derive.derive_logo(data)
    except ValueError as e:
        raise RemoteError(400, {"error": str(e)}) from None
    except Exception:  # noqa: BLE001
        raise RemoteError(400, {"error": "הקובץ פגום"}) from None
    return call("brand-set", {
        "logo": base64.b64encode(made["png"]).decode("ascii"),
        "aspect": made["aspect"], "filename": filename,
    })


def _with_absolute_logo(answer):
    if isinstance(answer, dict) and answer.get("logo"):
        answer = {**answer, "logo": _absolute(answer["logo"])}
    return answer


# --------------------------------------------------------------------------
# the engine's entry point — same signature the local gallery had
# --------------------------------------------------------------------------

def handle(method, path, body, headers=None):
    """(status, payload) for /api/gallery/<action>, or None if not ours."""
    if not path.startswith("/api/gallery/"):
        return None
    action = path[len("/api/gallery/"):]
    body = body or {}
    try:
        if action == "site":
            # Where the client opens a gallery — the studio builds the link it
            # sends from this.
            return 200, {"origin": public_origin()}
        if action == "publish" and method == "POST":
            return 200, publish(body.get("galleryId"), body.get("frames") or [])
        if action == "publish-version" and method == "POST":
            return 200, publish_version(body.get("galleryId"), body.get("itemId"),
                                        body.get("path"), keep_choice=bool(body.get("keepChoice")))
        if action == "brand-set" and method == "POST":
            return 200, _with_absolute_logo(set_brand(body.get("logo"), body.get("filename") or ""))
        if action == "brand":
            return 200, _with_absolute_logo(call("brand", {}))
        return 200, call(action, body)
    except RemoteError as e:
        return e.status, e.body
