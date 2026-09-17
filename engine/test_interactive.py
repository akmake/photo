"""The edit screen's experience, end to end over HTTP, on an EMPTY cache.

    python test_interactive.py <folder of photographs>

Runs a real engine on a spare port with its caches in a temp directory, then
does what the photographer does: open a frame nobody prepared, open a frame the
background preparer got to first, drag a slider, and scroll a grid. Prints the
wall-clock number for each, and fails on the promises:

  * a prepared frame opens in a fraction of an unprepared one's time;
  * a dragged slider answers ONCE, for the last value — the stale renders in
    its lane are refused, not run;
  * a thumbnail served from the cache is the same bytes as a fresh one.
"""

import glob
import json
import os
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

HOME = tempfile.mkdtemp(prefix="teza-interactive-")
os.environ["TEZA_HOME"] = HOME
os.environ["LOCALAPPDATA"] = HOME

import common  # noqa: E402
import masks  # noqa: E402
import previews  # noqa: E402
import server  # noqa: E402

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        failures += 1


RECIPE = [
    {"toolId": "skin-retouch", "params": {"blemishes": 100, "evenness": 70, "texture": 0, "glow": 0, "keepMoles": 1}, "enabled": True},
    {"toolId": "skin-cleanup", "params": {"redness": 90}, "enabled": True},
    {"toolId": "eye-sparkle", "params": {"strength": 50}, "enabled": True},
    {"toolId": "glow", "params": {"amount": 35, "people": 25, "skin": 20, "fabric": 15, "radius": 40}, "enabled": True},
    {"toolId": "contour", "params": {"cheekbones": 25, "forehead": 15, "jaw": 15, "undereye": -10, "sculpt": 20}, "enabled": True},
    {"toolId": "tone-color", "params": {"exposure": 0, "contrast": 15, "highlights": -10, "shadows": 15, "temperature": 0, "saturation": 5}, "enabled": True},
    {"toolId": "tonal-contrast", "params": {"contrast": 40}, "enabled": True},
    {"toolId": "sharpen", "params": {"amount": 30, "radius": 20, "masking": 25}, "enabled": True},
]
W = 1400


def with_exposure(e):
    r = json.loads(json.dumps(RECIPE))
    r[5]["params"]["exposure"] = e
    return r


def start():
    srv = server.Server(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}"


def post(base, path, body):
    req = urllib.request.Request(base + path, json.dumps(body).encode("utf-8"),
                                 {"Content-Type": "application/json"})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            return r.status, json.loads(r.read()), time.perf_counter() - t
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), time.perf_counter() - t


def get(base, path):
    t = time.perf_counter()
    with urllib.request.urlopen(base + path, timeout=300) as r:
        return r.read(), time.perf_counter() - t


def subject_ready(path):
    _, img, _ = previews.working_frame(path, W)
    rgb = common.to_np(img)
    masks.set_source(rgb, previews.photo_key(path))
    try:
        return os.path.exists(masks._disk_path(common.downscale(rgb), "subject"))
    finally:
        masks.clear_source()


def main(folder):
    files = sorted(glob.glob(os.path.join(folder, "*.jpg")) + glob.glob(os.path.join(folder, "*.JPG")))
    files = sorted(set(files))
    warmup, cold, prepared = files[0], files[len(files) // 3], files[2 * len(files) // 3]
    base = start()
    print(f"engine on {base}, caches in {HOME}")

    # Models load once per process; that is not what a photographer waits for
    # on the tenth frame, so it is paid before anything is measured.
    post(base, "/render", {"path": warmup, "recipe": RECIPE, "w": W})

    print("\nopening a frame")
    code, j, cold_s = post(base, "/render", {"path": cold, "recipe": RECIPE, "w": W})
    print("  ", [(x["tool"], x["ms"]) for x in j.get("meta", {}).get("steps", [])])
    check(f"unprepared frame opens: {cold_s:.1f}s", code == 200)

    t = time.perf_counter()
    post(base, "/prep", {"paths": [prepared], "w": W, "thumbs": [320], "recipe": RECIPE})
    marker = previews.prep_marker(prepared, W, ",".join(sorted({t["toolId"] for t in RECIPE})))
    while not os.path.exists(marker):
        if time.perf_counter() - t > 600:
            break
        time.sleep(0.5)
    prep_s = time.perf_counter() - t
    check(f"the preparer finished it in the background: {prep_s:.1f}s",
          os.path.exists(marker) and subject_ready(prepared))
    code, j, warm_s = post(base, "/render", {"path": prepared, "recipe": RECIPE, "w": W})
    print("  ", [(x["tool"], x["ms"]) for x in j.get("meta", {}).get("steps", [])])
    check(f"prepared frame opens: {warm_s:.1f}s (unprepared {cold_s:.1f}s)",
          code == 200 and warm_s < cold_s * 0.5)

    ahead = files[2 * len(files) // 3 + 1]
    post(base, "/prep", {"paths": [], "w": W, "ahead": [{"path": ahead, "recipe": RECIPE}]})
    time.sleep(1.0)
    while server._AHEAD or server._INTERACTIVE.value:
        time.sleep(0.2)
    # the job was popped; wait for the worker to finish it
    time.sleep(0.5)
    server.on_worker(lambda: None)
    code, j, next_s = post(base, "/render", {"path": ahead, "recipe": RECIPE, "w": W})
    check(f"the next frame, rendered ahead, opens: {next_s:.2f}s", code == 200 and next_s < 1.0)

    print("\ndragging a slider")
    results = []

    def fire(e):
        results.append((e,) + post(base, "/render", {"path": prepared, "recipe": with_exposure(e), "w": W, "lane": "edit"}))

    t = time.perf_counter()
    threads = []
    for e in range(10, 60, 10):
        th = threading.Thread(target=fire, args=(e,))
        th.start()
        threads.append(th)
        time.sleep(0.08)
    for th in threads:
        th.join()
    drag_s = time.perf_counter() - t
    done = sorted(e for e, code, _, _ in results if code == 200)
    stale = sorted(e for e, code, _, _ in results if code == 409)
    check(f"five values in 0.4s answered in {drag_s:.2f}s; rendered {done}, refused {stale}",
          50 in done and len(stale) >= 3)

    for tool, param, value in (("sharpen", "amount", 55), ("tone-color", "exposure", 15),
                               ("glow", "amount", 50), ("skin-retouch", "evenness", 50)):
        r = json.loads(json.dumps(RECIPE))
        for s in r:
            if s["toolId"] == tool:
                s["params"][param] = value
        code, _, s_ = post(base, "/render", {"path": prepared, "recipe": r, "w": W, "lane": "edit"})
        print(f"  {tool}.{param} moved: {s_:.2f}s")

    print("\nthe grid")
    first, t1 = get(base, f"/thumb?path={urllib.parse.quote(prepared)}&w=320")
    again, t2 = get(base, f"/thumb?path={urllib.parse.quote(prepared)}&w=320")
    check(f"thumbnail from cache {t2 * 1000:.0f}ms (drawn by the preparer)", first == again)
    check("same bytes as drawing it fresh", first == previews.thumb_bytes(prepared, 320))
    fresh = files[1]
    _, f1 = get(base, f"/thumb?path={urllib.parse.quote(fresh)}&w=320")
    _, f2 = get(base, f"/thumb?path={urllib.parse.quote(fresh)}&w=320")
    print(f"  unprepared thumbnail {f1 * 1000:.0f}ms, second time {f2 * 1000:.0f}ms")

    print(f"\n{'PASS' if not failures else f'{failures} FAILED'}")
    return failures


if __name__ == "__main__":
    import urllib.parse  # noqa: F401

    sys.exit(1 if main(sys.argv[1]) else 0)
