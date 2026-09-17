"""One engine lane, measured. Nothing here touches the running engine.

  python lane_probe.py <ncores> <tmp_home> <img1> <img2> <img3>

Affinity is set BEFORE any import, so every thread pool the libraries build
sees only the cores this lane is allowed. Prints one JSON line.
"""
import ctypes
import json
import os
import sys
import time

NCORES = int(sys.argv[1])
TMP_HOME = sys.argv[2]
IMAGES = sys.argv[3:]

# --- restrict this process to NCORES logical processors, before anything loads
_k32 = ctypes.windll.kernel32
_mask = (1 << NCORES) - 1
_k32.SetProcessAffinityMask(_k32.GetCurrentProcess(), ctypes.c_size_t(_mask))

# A cold, isolated cache: previews.cache_root() reads LOCALAPPDATA.
os.makedirs(TMP_HOME, exist_ok=True)
os.environ["LOCALAPPDATA"] = TMP_HOME
os.environ["TEZA_HOME"] = TMP_HOME

ENGINE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "engine")
os.chdir(ENGINE)
sys.path.insert(0, ENGINE)


class _Counters(ctypes.Structure):
    _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]


_k32.GetCurrentProcess.restype = ctypes.c_void_p
_gpmi = _k32.K32GetProcessMemoryInfo
_gpmi.argtypes = [ctypes.c_void_p, ctypes.POINTER(_Counters), ctypes.c_ulong]
_gpmi.restype = ctypes.c_int


def mem():
    c = _Counters()
    c.cb = ctypes.sizeof(c)
    if not _gpmi(_k32.GetCurrentProcess(), ctypes.byref(c), ctypes.sizeof(c)):
        return {"error": ctypes.get_last_error()}
    return {"now_mb": round(c.WorkingSetSize / 2**20, 1),
            "peak_mb": round(c.PeakWorkingSetSize / 2**20, 1)}


# The shipped defaults, copied from engine/test_resolution_parity.py:47-52.
RECIPE = [
    {"toolId": "skin-retouch", "params": {"blemishes": 100, "evenness": 70, "keepMoles": 1}, "enabled": True},
    {"toolId": "skin-cleanup", "params": {"redness": 90, "spots": 25}, "enabled": True},
    {"toolId": "contour", "params": {"cheek": 50, "sculpt": 40}, "enabled": True},
    {"toolId": "blush", "params": {"strength": 50}, "enabled": True},
]

out = {"ncores": NCORES, "frames": []}

t = time.perf_counter()
import common  # noqa: E402
import render  # noqa: E402
out["import_s"] = round(time.perf_counter() - t, 2)
out["mem_after_import"] = mem()

for i, path in enumerate(IMAGES):
    t = time.perf_counter()
    img = common.load_image(path)
    t_open = time.perf_counter() - t

    t = time.perf_counter()
    # key=None: no stage cache. Every frame pays its own full cost, which is
    # what a lane chewing through a set actually does.
    render.render(img, RECIPE, 1.0, None, key=None)
    t_render = time.perf_counter() - t

    out["frames"].append({
        "n": i + 1,
        "name": os.path.basename(path),
        "px": f"{img.size[0]}x{img.size[1]}",
        "open_s": round(t_open, 2),
        "render_s": round(t_render, 2),
        "mem": mem(),
    })
    render.clear_stage_cache()

out["mem_peak"] = mem()
print(json.dumps(out, ensure_ascii=False))
