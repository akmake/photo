# -*- mode: python ; coding: utf-8 -*-
"""How the engine becomes one executable.

    .venv/Scripts/python -m PyInstaller teza-engine.spec --noconfirm

Output: .dist/teza-engine/teza-engine.exe and the libraries beside it. Both
output folders are inside engine/ and git-ignored; nothing here writes near the
repo's `dist/`, which belongs to the interface's build.

ONE FOLDER, NOT ONE FILE. A single-file build unpacks the whole bundle into a
temporary directory on EVERY launch — with this dependency list that is
gigabytes of copying before the studio can answer, every time it is opened. The
folder form starts immediately, and the installer puts it beside the app where
nobody has to look at it.

WHAT IS DELIBERATELY NOT IN HERE
--------------------------------
* engine/models — 1.9GB of weights. They are not code and they must survive an
  update of the code, so they are installed beside the app and found through
  TEZA_MODELS_DIR (engine/paths.py). Freezing them in would mean re-downloading
  them for every fix.
* setup_models.py and export_onnx.py — the two scripts that DOWNLOAD and DERIVE
  weights on a developer machine. A shipped app never runs them, and export
  drags in `onnx` for nothing.
* The diagnostic scripts (`_*.py`) and the tests.
"""

import os

from PyInstaller.utils.hooks import collect_all

HERE = os.path.abspath(os.getcwd())

# Every product module, whether or not the analyser can see the import.
# server.py imports most of them by name, but several are imported lazily inside
# functions, and launch.py reaches server and prep through runpy — which is a
# runtime decision the analyser cannot follow. Listing the directory is the one
# form of this that cannot go stale when a module is added.
SKIP = {"launch", "setup_models", "export_onnx"}
ENGINE_MODULES = sorted(
    name[:-3]
    for name in os.listdir(HERE)
    if name.endswith(".py")
    and not name.startswith("_")
    and not name.startswith("test_")
    and not name.startswith("benchmark_")
    and name[:-3] not in SKIP
)

datas = []
binaries = []
hiddenimports = list(ENGINE_MODULES)

# The libraries that carry native code and data files of their own. Left to the
# analyser alone, each of these ships as an importable package whose real
# payload — the .tflite graphs, the ONNX runtime's DLLs, libraw — is missing,
# and the failure only shows up at the first photograph.
for package in ("mediapipe", "onnxruntime", "rawpy", "cv2", "mobile_sam"):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

# torch is left to PyInstaller's own hook: it is the heaviest dependency in the
# tree and `collect_all` on it pulls in the test suites and every backend as
# well. If something turns out to be missing, add it here by name rather than
# widening this to the whole package.

a = Analysis(
    ["launch.py"],
    pathex=[HERE],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        "onnx",          # export only
        "matplotlib",    # nothing in the engine draws a chart
        "tkinter",
        "pytest",
        "IPython",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="teza-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,          # UPX on ML runtimes is a known source of odd crashes
    console=True,       # flipped off once the build is proven; see docs
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="teza-engine",
)
