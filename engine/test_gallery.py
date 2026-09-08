"""End to end over the client gallery: publish, sign in, choose, lock, comment.

Runs against a temporary directory with no database server, no bucket and no
network - which is the point of the two seams (gallery_store, gallery_records).
Same code paths the real thing uses.

    python engine/test_gallery.py
"""

import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image  # noqa: E402

import gallery  # noqa: E402
import gallery_derive  # noqa: E402
import gallery_records  # noqa: E402
import gallery_store  # noqa: E402

PASS, FAIL = [], []


def check(name, condition, detail=""):
    (PASS if condition else FAIL).append(name)
    mark = "ok  " if condition else "FAIL"
    print(f"  {mark} {name}" + (f"   [{detail}]" if detail and not condition else ""))


def raises(name, status, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
        check(name, False, "no error raised")
    except gallery.GalleryError as e:
        check(name, e.status == status, f"got {e.status}, wanted {status}")


def make_frames(folder, n):
    """Real JPEGs, each a different colour, so the derived files are real too."""
    paths = []
    for i in range(n):
        path = os.path.join(folder, f"DSC_{4000 + i}.jpg")
        Image.new("RGB", (3000, 2000), (30 + i * 40, 90, 160 - i * 20)).save(
            path, "JPEG", quality=90
        )
        paths.append(path)
    return paths


def main():
    root = tempfile.mkdtemp(prefix="teza-gallery-test-")
    frames_dir = os.path.join(root, "frames")
    os.makedirs(frames_dir)

    os.environ["TEZA_GALLERY_ROOT"] = os.path.join(root, "objects")
    os.environ["TEZA_GALLERY_BACKEND"] = "local"
    gallery_store.reset()
    gallery_records.reset(gallery_records.JsonRecords(os.path.join(root, "records")))

    try:
        print("\nderive")
        paths = make_frames(frames_dir, 5)
        derived = [gallery_derive.derive(p) for p in paths]
        d = derived[0]
        check("preview is 1600px on the long edge", max(d["preview_size"]) == 1600,
              str(d["preview_size"]))
        check("thumb is 400px on the long edge", max(d["thumb_size"]) == 400,
              str(d["thumb_size"]))
        check("preview is far smaller than an original",
              len(d["preview"]) < 900_000, f"{len(d['preview'])} bytes")
        check("thumb is small enough for a 600-frame grid",
              len(d["thumb"]) < 90_000, f"{len(d['thumb'])} bytes")
        check("placeholder colour looks like a colour",
              d["color"].startswith("#") and len(d["color"]) == 7, d["color"])

        print("\ncreate")
        created = gallery.create_gallery(
            "proj-1", "משפחת כהן",
            [{"name": "הזוג", "quota": 3},
             {"name": "הורי החתן", "quota": 2},
             {"name": "הורי הכלה", "quota": 2}],
        )
        gid = created["id"]
        password = created["password"]
        check("password returned once, in the clear", bool(password), password)
        check("hash never leaves the module",
              "passwordHash" not in created and "passwordSalt" not in created)
        check("hebrew name survived the round trip", created["name"] == "משפחת כהן",
              created["name"])
        albums = created["albums"]

        print("\npublish")
        for n, (path, dv) in enumerate(zip(paths, derived)):
            gallery.ingest(gid, f"frame-{n}", os.path.basename(path), dv, order=n)
        stored = os.path.join(root, "objects", "gal", gid)
        files = sum(len(f) for _, _, f in os.walk(stored))
        check("two objects written per frame", files == 10, f"{files} files")

        print("\nsign in")
        raises("wrong password refused", 401, gallery.login, created["slug"],
               created["username"], "not-the-password")
        raises("unknown gallery is a 404", 404, gallery.login, "nosuchslug",
               "x", "y")
        session = gallery.login(created["slug"], created["username"], password)
        token = session["token"]
        check("signing in returns a token", bool(token))

        print("\nthe grid")
        man = gallery.manifest(token)
        check("every published frame is in the manifest", len(man["items"]) == 5,
              str(len(man["items"])))
        first = man["items"][0]
        check("each frame carries a placeholder colour", bool(first["color"]))
        check("each frame carries an aspect ratio", first["aspect"] > 1)
        check("thumb and preview are both addressable",
              bool(first["thumb"]) and bool(first["preview"]))
        check("nothing is chosen yet", all(not i["albumIds"] for i in man["items"]))

        print("\nchoosing")
        ids = [i["id"] for i in man["items"]]
        all_albums = [a["id"] for a in albums]
        gallery.select(token, ids[0], all_albums)
        check("a heart lands in every album",
              len(gallery.manifest(token)["items"][0]["albumIds"]) == 3)

        gallery.select(token, ids[1], [all_albums[0]])
        gallery.select(token, ids[2], [all_albums[0]])
        raises("the quota is a wall, not a warning", 409,
               gallery.select, token, ids[3], [all_albums[0]])
        gallery.select(token, ids[3], [all_albums[1]])
        check("a full album does not block a different one",
              all_albums[1] in gallery.manifest(token)["items"][3]["albumIds"])

        gallery.select(token, ids[2], [])
        check("clearing every album un-hearts the frame",
              not gallery.manifest(token)["items"][2]["albumIds"])
        gallery.select(token, ids[3], [all_albums[0], all_albums[1]])
        check("the freed slot can be used again",
              all_albums[0] in gallery.manifest(token)["items"][3]["albumIds"])

        print("\nrenaming")
        gallery.rename_album(token, all_albums[2], "סבתא רחל")
        renamed = [a for a in gallery.manifest(token)["gallery"]["albums"]
                   if a["id"] == all_albums[2]][0]
        check("the client can rename an album", renamed["name"] == "סבתא רחל")
        check("the rename is flagged for the photographer",
              renamed["nameSetByClient"] is True)
        check("the album id did not move", renamed["id"] == all_albums[2])

        print("\nlocking")
        raises("no comments before the choice is closed", 409,
               gallery.comment, token, ids[0], 0.5, 0.5, "מוקדם מדי")
        gallery.lock(token)
        check("the gallery reports itself locked",
              gallery.manifest(token)["gallery"]["locked"] is True)
        raises("choosing stops once locked", 409,
               gallery.select, token, ids[4], all_albums)

        print("\ncomments")
        raises("only chosen frames take comments", 409,
               gallery.comment, token, ids[2], 0.5, 0.5, "לא נבחרה")
        posted = gallery.comment(token, ids[0], 0.31, 0.72,
                                 "תוריד את הבחור משמאל")
        check("a comment belongs to the version it was written on",
              posted["versionN"] == 1)
        gallery.mark_done(token, ids[0])
        check("the client can settle one frame",
              gallery.manifest(token)["items"][0]["clientDone"] is True)

        print("\nback to the photographer")
        st = gallery.state(gid)
        check("chosen frames come back by frameId",
              {s["frameId"] for s in st["selection"]} ==
              {"frame-0", "frame-1", "frame-3"},
              str(sorted(s["frameId"] for s in st["selection"])))
        check("the counts match what was chosen",
              st["counts"][all_albums[0]] == 3, str(st["counts"]))
        check("the comment arrives with its pin",
              st["comments"][0]["x"] == 0.31 and st["comments"][0]["y"] == 0.72)
        check("the comment carries the frame it belongs to",
              st["comments"][0]["frameId"] == "frame-0")
        check("the lock is visible to the photographer",
              bool(st["gallery"]["lockedAt"]))

        print("\na corrected frame")
        ver = gallery.add_version(gid, ids[0])
        check("the next version is v2", ver["n"] == 2)
        check("a new version reopens the frame",
              gallery.manifest(token)["items"][0]["clientDone"] is False)

        print("\nrouting")
        # The surface server.py mounts. Same function a standalone process
        # would call, so this is the real routing and not a stand-in.
        check("a path that is not ours falls through",
              gallery.handle("GET", "/health", {}) is None)

        status, out = gallery.handle(
            "POST", f"/g/{created['slug']}/login",
            {"username": created["username"], "password": password},
        )
        check("login routes and answers 200", status == 200 and "token" in out,
              str(status))
        routed = out["token"]

        status, out = gallery.handle(
            "GET", f"/g/{created['slug']}/manifest", {},
            {"X-Gallery-Token": routed},
        )
        check("the manifest reads the token from the header",
              status == 200 and len(out["items"]) == 5, str(status))

        status, out = gallery.handle(
            "GET", f"/g/{created['slug']}/manifest", {}, {},
        )
        check("no token is 401, not an empty gallery",
              status == 401 and "items" not in out, str(status))

        status, out = gallery.handle(
            "POST", f"/g/{created['slug']}/nonsense", {},
            {"X-Gallery-Token": routed},
        )
        check("an unknown action is a 404", status == 404, str(status))

        status, out = gallery.handle(
            "GET", "/api/gallery/state", {"galleryId": gid},
        )
        check("the photographer's side routes too",
              status == 200 and out["gallery"]["id"] == gid, str(status))

        print("\nfreezing")
        gallery.set_status(gid, "frozen")
        raises("a frozen gallery signs everyone out", 401,
               gallery.manifest, token)
        raises("and will not let them back in", 403,
               gallery.login, created["slug"], created["username"], password)
        gallery.set_status(gid, "active")
        back = gallery.login(created["slug"], created["username"], password)
        check("paying reopens it, choices intact",
              len(gallery.manifest(back["token"])["items"]) == 5)

        print("\ndeleting")
        gallery.delete_gallery(gid)
        check("the objects are gone", not os.path.isdir(stored))
        raises("and so is the gallery", 404, gallery.state, gid)

    finally:
        shutil.rmtree(root, ignore_errors=True)
        os.environ.pop("TEZA_GALLERY_ROOT", None)
        os.environ.pop("TEZA_GALLERY_BACKEND", None)
        gallery_store.reset()
        gallery_records.reset()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    for name in FAIL:
        print(f"  failed: {name}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
