"""The project's home on disk — and why the disk is the memory.

A project is a FOLDER, not a row in a database. Everything the photographer
made lives inside it, so copying that folder to another machine carries the
work with it, a backup of the shoot backs up the knowledge about the shoot,
and uninstalling the software cannot take the job away.

    <root>/<project>/
        תמונות גלם/     the truth. Written once, at import, and never again.
        תמונות/         one current version per frame, replaced on every apply.
        project.json    the memory: batches, assignments, statuses, recipe.

The two picture folders are the whole model. There is no folder per edit and no
history: applying a look to a batch REPLACES those frames in `תמונות`, and the
replacement is always computed from `תמונות גלם` through the full current
recipe — never stacked on top of the previous output. That is what keeps a
fifth tool from being the fifth JPEG generation, and what keeps a step
removable after the fact.

The rule between the two sources of truth:
    the DISK says what EXISTS.  project.json says what it MEANS.
A file deleted in Explorer is gone and its entry reads as missing; a file that
appears is an unassigned frame. Neither is an error.
"""

import json
import os
import shutil
import time

RAW_DIR = "תמונות גלם"
EDITED_DIR = "תמונות"
STATE_FILE = "project.json"

IMAGE_EXTS = {
    ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp",
    ".cr2", ".cr3", ".nef", ".arw", ".dng", ".raf", ".orf",
}

# Windows forbids these outright, and a trailing dot or space produces a folder
# that cannot be deleted from Explorer. A client's name is user text — it WILL
# contain a colon or a slash eventually.
_BAD = '<>:"/\\|?*'


def safe_name(name):
    out = "".join("-" if c in _BAD else c for c in (name or "").strip())
    out = out.rstrip(" .")
    return out or "פרויקט"


# ------------------------------------------------------------------ the root
#
# Asked once, then never again. It lives beside the cache rather than inside a
# project, because it is the answer to "where do projects go" — a setting of the
# installation, not of any one job.

def _settings_path():
    # TEZA_HOME redirects the whole installation elsewhere. It exists because a
    # test that exercises set_root() through the real HTTP handler otherwise
    # writes the REAL settings file — which happened, and silently replaced the
    # photographer's chosen projects folder with a temp directory that the test
    # then deleted.
    base = (
        os.environ.get("TEZA_HOME")
        or os.environ.get("LOCALAPPDATA")
        or os.path.expanduser("~")
    )
    return os.path.join(base, "TEZA", "settings.json")


def _read_settings():
    try:
        with open(_settings_path(), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def default_root():
    return os.path.join(
        os.path.join(os.path.expanduser("~"), "Documents"), "TEZA"
    )


def get_root():
    """-> where projects live. ALWAYS an answer, never None.

    It used to return None until the photographer had chosen, and the import
    screen made that a wall: the first thing asked was "where should projects be
    saved", to someone who had come to that screen to bring photographs IN. The
    obvious reply is to point at the folder the photographs are in — which is
    what happened, and the result was a project folder created inside the card
    dump, and an import that never ran.

    A default nobody has to think about, changeable afterwards, is the honest
    shape of a question with a sensible answer.
    """
    root = _read_settings().get("root")
    if root and os.path.isdir(root):
        return root
    fallback = default_root()
    os.makedirs(fallback, exist_ok=True)
    return fallback


def set_root(path):
    path = (path or "").strip().strip('"')
    if not os.path.isdir(path):
        raise ValueError(f"לא נמצאה תיקייה: {path}")
    settings = _read_settings()
    settings["root"] = path
    target = _settings_path()
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8") as fh:
        json.dump(settings, fh, ensure_ascii=False, indent=2)
    return path


# --------------------------------------------------------------- the project

def paths(home):
    return {
        "home": home,
        "raw": os.path.join(home, RAW_DIR),
        "edited": os.path.join(home, EDITED_DIR),
        "state": os.path.join(home, STATE_FILE),
    }


def init_project(name, root=None):
    """Create (or adopt) the project's folder. Idempotent on purpose — opening
    an existing project must not be a different code path from creating one."""
    root = root or get_root()
    if not root:
        raise ValueError("לא הוגדרה תיקיית הפרויקטים")
    home = os.path.join(root, safe_name(name))
    p = paths(home)
    os.makedirs(p["raw"], exist_ok=True)
    os.makedirs(p["edited"], exist_ok=True)
    return p


def _unique(dest):
    """A name collision between two cards is real (both hold IMG_0001.CR2) and
    must never overwrite. Only an IDENTICAL file is treated as already here."""
    stem, ext = os.path.splitext(dest)
    n = 2
    while os.path.exists(dest):
        dest = f"{stem} ({n}){ext}"
        n += 1
    return dest


def import_file(src, raw_dir):
    """Copy ONE frame into the project. Returns what happened to it.

    One file per call so the screen can count in items — 300 RAW frames off a
    card is minutes, and a spinner that says nothing about scale is how a
    photographer decides the import hung.

    `copy2` keeps mtime, which is not cosmetic: it is the fallback capture time
    the batch pool orders by when a RAW has no readable EXIF.
    """
    if not os.path.isfile(src):
        raise ValueError(f"לא נמצא קובץ: {src}")
    os.makedirs(raw_dir, exist_ok=True)
    dest = os.path.join(raw_dir, os.path.basename(src))

    # Importing the same card twice is a normal accident, not an error: the
    # same name AND the same size is the frame already sitting here.
    if os.path.exists(dest) and os.path.getsize(dest) == os.path.getsize(src):
        return {"file": dest, "skipped": True}

    dest = _unique(dest)
    shutil.copy2(src, dest)
    return {"file": dest, "skipped": False}


def import_download(name, size, raw_dir, download):
    """Download one remote frame into the project without exposing a partial file.

    ``download`` receives a temporary path and writes the remote bytes there.
    The same name + byte size rule used for cards also applies to cloud imports,
    so choosing the same Drive or Dropbox folder twice is harmless.
    """
    name = os.path.basename((name or "").strip())
    if not name or os.path.splitext(name)[1].lower() not in IMAGE_EXTS:
        raise ValueError("invalid image name")
    os.makedirs(raw_dir, exist_ok=True)
    dest = os.path.join(raw_dir, name)
    if os.path.exists(dest) and size is not None:
        if os.path.getsize(dest) == int(size):
            return {"file": dest, "skipped": True}

    dest = _unique(dest)
    part = dest + ".teza-download"
    try:
        download(part)
        if not os.path.isfile(part):
            raise ValueError("cloud download did not create a file")
        os.replace(part, dest)
    finally:
        try:
            if os.path.exists(part):
                os.remove(part)
        except OSError:
            pass
    return {"file": dest, "skipped": False}


# ------------------------------------------------------------- reading a set

def _shot_time(path):
    """When the frame was TAKEN, in epoch seconds.

    The batch pool is ordered by this and nothing else: a batch is a
    stretch of the day, so in capture order it is a contiguous run — which is
    what turns "mark 87 photos" into two clicks instead of 87.

    EXIF first, file mtime as the fallback. The fallback is honest because
    import preserves mtime, and a card writes frames in the order they were
    shot.
    """
    try:
        from PIL import Image  # local: RAW paths never reach here in bulk

        with Image.open(path) as im:
            exif = im.getexif()
            for tag in (36867, 36868, 306):  # DateTimeOriginal, Digitized, DateTime
                raw_value = exif.get(tag)
                if not raw_value:
                    continue
                try:
                    return time.mktime(
                        time.strptime(str(raw_value), "%Y:%m:%d %H:%M:%S")
                    )
                except ValueError:
                    continue
    except Exception:  # noqa: BLE001 — RAW, truncated file, anything
        pass
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


def edited_path(edited_dir, raw_name):
    """Where a raw frame's current version lives.

    Not the same filename: `render.export` writes a JPEG, so IMG_0001.CR2 is
    IMG_0001.jpg on the other side. Matching on the full name instead of the
    stem is how a RAW set would look permanently unedited no matter how many
    times it had been rendered.
    """
    stem = os.path.splitext(raw_name)[0]
    same = os.path.join(edited_dir, raw_name)
    if os.path.isfile(same):
        return same
    return os.path.join(edited_dir, stem + ".jpg")


def list_frames(raw_dir, edited_dir=None):
    """Every frame in the set, in capture order, with the file to SHOW.

    `shown` is the edited copy when one exists and the raw otherwise. A frame
    that has never been touched has no entry in `תמונות` yet — "two folders
    with the photos" describes the set once it has been worked on, and copying
    300 files a second time at import to make it literally true from minute one
    would cost minutes and buy nothing.
    """
    if not os.path.isdir(raw_dir):
        return []
    out = []
    for name in os.listdir(raw_dir):
        if os.path.splitext(name)[1].lower() not in IMAGE_EXTS:
            continue
        path = os.path.join(raw_dir, name)
        edited = edited_path(edited_dir, name) if edited_dir else None
        has_edit = bool(edited and os.path.isfile(edited))
        out.append({
            "path": path,
            "name": name,
            "shot": _shot_time(path),
            "edited": has_edit,
            "shown": edited if has_edit else path,
        })
    out.sort(key=lambda f: (f["shot"], f["name"]))
    return out


# ---------------------------------------------------------------- the memory

EMPTY_STATE = {
    "version": 1,
    "batches": [],      # [{id, name, order}]
    "assign": {},          # frame name -> batch id
    "statuses": {},        # frame name -> 'working' | 'ready'
    "recipe": {"version": 1, "base": [], "perBatch": {}, "perFrame": {}},
    # The client gallery this folder was published to, once it has been. Kept
    # HERE, beside the batches, and not in the business record: the batch the
    # client's choice creates and the note saying it was already created have
    # to live in the same file, or the two can disagree — a batch with no note
    # is imported twice, a note with no batch is never imported at all.
    # None until a gallery is made. See docs/CLIENT-GALLERY.md.
    "gallery": None,
}


def read_state(home):
    """The project's memory. A missing file is a new project, not a failure.

    Keyed by FILE NAME rather than absolute path: the folder can move, be
    renamed, or arrive on another machine under a different drive letter, and
    the knowledge has to survive that — it lives inside the folder precisely so
    it can travel with it.
    """
    try:
        with open(paths(home)["state"], "r", encoding="utf-8") as fh:
            saved = json.load(fh)
    except (OSError, ValueError):
        return json.loads(json.dumps(EMPTY_STATE))
    state = json.loads(json.dumps(EMPTY_STATE))
    for key in state:
        if key in saved:
            state[key] = saved[key]
    return state


def write_state(home, state):
    """Written through a temp file and replaced: a half-written project.json is
    a project that has lost its batches, and a crash mid-write is exactly
    when that would happen."""
    target = paths(home)["state"]
    os.makedirs(os.path.dirname(target), exist_ok=True)
    tmp = target + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, target)
    return target
