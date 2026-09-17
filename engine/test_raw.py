"""End to end over raw support: import, grid, edit, apply, publish.

    python engine/test_raw.py

THE FIXTURE IS BUILT, NOT SHIPPED. A camera file is 25-50MB and cannot live in
a repository, so this writes a real DNG - LibRaw genuinely decodes it - in the
layout every camera uses: IFD0 holding the JPEG the camera shows on its own
screen, a SubIFD holding the sensor data. Both halves of the promise are then
testable: the fast path takes the buried preview, the slow path rebuilds the
picture from sensor data, and nothing here is a mock.
"""

import io
import os
import struct
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import common  # noqa: E402
import gallery_derive  # noqa: E402
import previews  # noqa: E402
import raw  # noqa: E402
import render  # noqa: E402
import workspace  # noqa: E402

PASS, FAIL = [], []


def check(name, ok):
    (PASS if ok else FAIL).append(name)
    print("  " + ("ok  " if ok else "FAIL") + " " + name)


# --------------------------------------------------------------- the fixture

W, H, PW, PH = 480, 320, 480, 320


def _rat(n, d=10000):
    return struct.pack("<II", int(round(n * d)), d)


def _srat(n, d=10000):
    return struct.pack("<ii", int(round(n * d)), d)


class _IFD:
    def __init__(self):
        self.e, self.pool = [], b""

    def add(self, tag, typ, count, payload):
        if len(payload) <= 4:
            self.e.append([tag, typ, count, payload + b"\x00" * (4 - len(payload)), None])
        else:
            self.e.append([tag, typ, count, None, len(self.pool)])
            self.pool += payload + (b"\x00" if len(self.pool + payload) % 2 else b"")

    def mark(self, tag, typ, count, name):
        self.e.append([tag, typ, count, name, None])

    def size(self):
        return 2 + 12 * len(self.e) + 4

    def render(self, pool_off, marks):
        self.e.sort(key=lambda x: x[0])
        out = struct.pack("<H", len(self.e))
        for tag, typ, count, val, rel in self.e:
            if isinstance(val, str):
                val = struct.pack("<I", marks[val])
            if val is None:
                val = struct.pack("<I", pool_off + rel)
            out += struct.pack("<HHI", tag, typ, count) + val
        return out + struct.pack("<I", 0)


def make_dng(path, with_preview=True, neutral=(0.5, 1.0, 0.7)):
    """A real DNG. `with_preview=False` is the camera that buries none."""
    prev = Image.new("RGB", (PW, PH))
    px = prev.load()
    for y in range(PH):
        for x in range(PW):
            px[x, y] = (40 + x * 200 // PW, 90, 200 - y * 120 // PH)
    buf = io.BytesIO()
    prev.save(buf, "JPEG", quality=90)
    jpeg = buf.getvalue()

    sensor = bytearray()
    for y in range(H):
        for x in range(W):
            sensor += struct.pack("<H", min(65535, 6000 + 20000 * x // W + 8000 * y // H))
    sensor = bytes(sensor)

    cm = [0.7034, -0.2361, -0.0564, -0.5346, 1.3226, 0.2153, -0.1096, 0.1927, 0.6100]

    i0 = _IFD()
    i0.add(254, 4, 1, struct.pack("<I", 1))
    i0.add(256, 4, 1, struct.pack("<I", PW if with_preview else 1))
    i0.add(257, 4, 1, struct.pack("<I", PH if with_preview else 1))
    if with_preview:
        i0.add(258, 3, 3, struct.pack("<HHH", 8, 8, 8))
        i0.add(259, 3, 1, struct.pack("<H", 7))
        i0.add(262, 3, 1, struct.pack("<H", 6))
        i0.mark(273, 4, 1, "jpeg")
        i0.add(277, 3, 1, struct.pack("<H", 3))
        i0.add(278, 4, 1, struct.pack("<I", PH))
        i0.add(279, 4, 1, struct.pack("<I", len(jpeg)))
    i0.add(271, 2, 5, b"TEZA\x00")
    i0.add(272, 2, 6, b"SYNTH\x00")
    i0.mark(330, 4, 1, "subifd")
    i0.add(50706, 1, 4, bytes([1, 4, 0, 0]))
    i0.add(50707, 1, 4, bytes([1, 3, 0, 0]))
    i0.add(50708, 2, 11, b"TEZA SYNTH\x00")
    i0.add(50721, 10, 9, b"".join(_srat(v) for v in cm))
    i0.add(50728, 5, 3, b"".join(_rat(v) for v in neutral))
    i0.add(50778, 3, 1, struct.pack("<H", 21))

    i1 = _IFD()
    i1.add(254, 4, 1, struct.pack("<I", 0))
    i1.add(256, 4, 1, struct.pack("<I", W))
    i1.add(257, 4, 1, struct.pack("<I", H))
    i1.add(258, 3, 1, struct.pack("<H", 16))
    i1.add(259, 3, 1, struct.pack("<H", 1))
    i1.add(262, 3, 1, struct.pack("<H", 32803))
    i1.mark(273, 4, 1, "sensor")
    i1.add(277, 3, 1, struct.pack("<H", 1))
    i1.add(278, 4, 1, struct.pack("<I", H))
    i1.add(279, 4, 1, struct.pack("<I", len(sensor)))
    i1.add(33421, 3, 2, struct.pack("<HH", 2, 2))
    i1.add(33422, 1, 4, bytes([0, 1, 1, 2]))

    off0 = 8
    pool0 = off0 + i0.size()
    off1 = pool0 + len(i0.pool)
    pool1 = off1 + i1.size()
    joff = pool1 + len(i1.pool)
    roff = joff + len(jpeg)
    marks = {"subifd": off1, "jpeg": joff, "sensor": roff}

    out = b"II" + struct.pack("<HI", 42, off0)
    out += i0.render(pool0, marks) + i0.pool
    out += i1.render(pool1, marks) + i1.pool
    out += jpeg + sensor
    with open(path, "wb") as fh:
        fh.write(out)
    return path


def mean_rgb(im):
    return np.asarray(im.convert("RGB")).mean(axis=(0, 1))


# ------------------------------------------------------------------ the tests


def test_the_door(tmp):
    print("\na raw file gets in at all")
    dng = make_dng(os.path.join(tmp, "a.dng"))
    check("the decoder claims it", raw.is_raw(dng))
    check("a jpg is not claimed", not raw.is_raw(os.path.join(tmp, "a.jpg")))
    # The import filter. A format missing here is a card that imports empty,
    # with nothing said - which is how .rw2, .pef and .srw were being skipped.
    missing = [e for e in raw.RAW_EXTENSIONS if e not in workspace.IMAGE_EXTS]
    check("import accepts every format the decoder can read: " + str(missing), not missing)


def test_it_opens(tmp):
    print("\nthe one door the whole product goes through")
    dng = make_dng(os.path.join(tmp, "b.dng"))
    im = common.load_image(dng)
    check("load_image returns a picture", im.size == (W, H) and im.mode == "RGB")

    # Pillow cannot open a single raw extension. Falling through to it produces
    # "cannot identify image file", which reads as a corrupt photograph rather
    # than as a missing decoder.
    bad = os.path.join(tmp, "broken.cr2")
    with open(bad, "wb") as fh:
        fh.write(b"this is not a sensor file")
    try:
        common.load_image(bad)
        check("an undecodable raw says what it is", False)
    except OSError as e:
        check("an undecodable raw says what it is", "גלם" in str(e))
    try:
        common.load_image(os.path.join(tmp, "gone.cr2"))
        check("a missing file stays a missing file", False)
    except FileNotFoundError:
        check("a missing file stays a missing file", True)
    except OSError:
        check("a missing file stays a missing file", False)


def test_the_light(tmp):
    print("\nwho decides what is white")
    dng = make_dng(os.path.join(tmp, "c.dng"))
    base = mean_rgb(common.load_image(dng))
    warm = mean_rgb(common.load_image(dng, develop={"warmth": 100}))
    cool = mean_rgb(common.load_image(dng, develop={"warmth": -100}))

    check(
        "0 is exactly what the camera said",
        np.allclose(base, mean_rgb(common.load_image(dng, develop={"warmth": 0, "tint": 0}))),
    )
    check("warmer is redder", warm[0] / warm[2] > base[0] / base[2])
    check("cooler goes the other way", cool[0] / cool[2] < base[0] / base[2])
    # Scaling only one side moves brightness as well as colour, which reads as
    # the exposure slipping every time the temperature is touched.
    check(
        "and the frame does not get brighter or darker doing it",
        abs(warm.mean() - base.mean()) < 0.12 * base.mean(),
    )

    green = mean_rgb(common.load_image(dng, develop={"tint": -100}))
    check("negative tint is the green half", green[1] / green.mean() > base[1] / base.mean())

    # A slider moved on its own must not need the other one spelled out.
    check("half a develop dict is enough", common.load_image(dng, develop={"warmth": 30}) is not None)
    check(
        "develop_of reads a recipe",
        raw.develop_of([{"toolId": "raw-develop", "params": {"warmth": 30}}])
        == {"warmth": 30.0, "tint": 0.0},
    )
    check(
        "a step turned off is not read",
        raw.develop_of([{"toolId": "raw-develop", "enabled": False, "params": {"warmth": 30}}])
        is None,
    )
    check("no step means the camera's own decision", raw.develop_of([]) is None)


def test_two_speeds(tmp):
    print("\nthe grid opens now, the frame being judged is decoded properly")
    dng = make_dng(os.path.join(tmp, "d.dng"))
    got = raw.embedded(dng, 320)
    check("the camera's buried preview comes out", got is not None and got[0].size[0] == 320)
    check(
        "and it still reports the FILE's long edge, not the preview's",
        got is not None and got[1] == W,
    )

    grid, _ = previews.decode_small(dng, 320, fast=True)
    edit, long_edge = previews.decode_small(dng, 320, fast=False)
    check(
        "they are not the same picture, on purpose",
        not np.allclose(
            mean_rgb(grid.resize((64, 64))), mean_rgb(edit.resize((64, 64))), atol=2
        ),
    )
    check("the edited frame answers about the real file", long_edge == W)

    # A camera that buries nothing must not be an error, only a slower frame.
    none = make_dng(os.path.join(tmp, "e.dng"), with_preview=False)
    check(
        "no buried preview falls through to a real decode",
        raw.embedded(none, 320) is None
        and previews.decode_small(none, 320, fast=True)[0] is not None,
    )
    check("a thumbnail is drawn", len(previews.thumb_bytes(dng, 320)) > 0)


def test_apply(tmp):
    print("\napply: sensor data in, one current version out")
    dng = make_dng(os.path.join(tmp, "f.dng"))
    dest = os.path.join(tmp, "out")
    look = {"toolId": "globals", "enabled": True, "params": {"contrast": 15}}

    plain, _ = render.export(dng, [look], dest, "jpeg", 92)
    check("a raw frame renders and is written as a JPEG", plain.lower().endswith(".jpg"))
    check(
        "and workspace looks for it under that name",
        os.path.basename(plain) == os.path.basename(workspace.edited_path(dest, "f.dng")),
    )

    warmed, _ = render.export(
        dng,
        [{"toolId": "raw-develop", "enabled": True, "params": {"warmth": 60}}, look],
        os.path.join(tmp, "out2"),
        "jpeg",
        92,
    )
    a, b = mean_rgb(Image.open(warmed)), mean_rgb(Image.open(plain))
    check(
        "the develop step reached the DECODER, not the pixels",
        a[0] / a[2] > b[0] / b[2] + 0.05,
    )


def test_gallery(tmp):
    print("\nwhat the client is asked to choose from")
    dng = make_dng(os.path.join(tmp, "g.dng"))
    d = gallery_derive.derive(dng)
    check("a raw frame publishes", bool(d["preview"]) and bool(d["thumb"]))
    check("with a real placeholder colour", d["color"].startswith("#") and len(d["color"]) == 7)
    check("and a real aspect", abs(d["aspect"] - W / float(H)) < 0.01)


def test_nothing_moved_for_jpeg(tmp):
    print("\nand a photographer who shoots JPEG notices nothing")
    j = os.path.join(tmp, "plain.jpg")
    im = Image.new("RGB", (600, 400))
    px = im.load()
    for y in range(400):
        for x in range(600):
            px[x, y] = (x % 256, y % 256, (x + y) % 256)
    im.save(j, quality=92)

    check("it loads", common.load_image(j).size == (600, 400))
    check(
        "a develop step is simply not for it",
        np.allclose(
            mean_rgb(common.load_image(j)),
            mean_rgb(common.load_image(j, develop={"warmth": 100})),
        ),
    )
    check(
        "the fast path means nothing on a jpg",
        np.allclose(
            mean_rgb(previews.decode_small(j, 320, fast=True)[0]),
            mean_rgb(previews.decode_small(j, 320, fast=False)[0]),
        ),
    )
    check("its long edge still reads from the file", previews.decode_small(j, 320)[1] == 600)
    check("it still publishes", gallery_derive.derive(j)["preview"] is not None)


def main():
    tmp = tempfile.mkdtemp(prefix="teza-raw-")
    try:
        for t in (
            test_the_door,
            test_it_opens,
            test_the_light,
            test_two_speeds,
            test_apply,
            test_gallery,
            test_nothing_moved_for_jpeg,
        ):
            t(tmp)
    finally:
        import shutil

        shutil.rmtree(tmp, ignore_errors=True)
    print("\n%d passed, %d failed" % (len(PASS), len(FAIL)))
    for name in FAIL:
        print("  failed: " + name)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
