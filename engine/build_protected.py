"""Compile the engine's own modules to machine code, for the packaged build.

    .venv/Scripts/python build_protected.py

WHY. PyInstaller ships Python modules as bytecode inside the executable, and
since PyInstaller 6 there is no encryption for it at all. On the 0.2.1 package
the module list of the engine, the method descriptions written in it and the
names of every function came out in seconds with PyInstaller's own archive
viewer — skin cleanup, masks, colour, culling, and the license gate with them
(docs/CODE-PROTECTION-TIMELINE.md). What ships instead is what this script
makes: each of our modules compiled by Cython to a native extension (.pyd).
No source, no bytecode, no docstrings — reading it means reverse-engineering
machine code, as with any program written in C++.

WHAT IT DOES
------------
1. Takes exactly the modules teza-engine.spec ships (same rule: every .py in
   engine/ except `_*`, `test_*`, `benchmark_*`, launch, setup_models,
   export_onnx). launch.py stays Python: it is PyInstaller's entry script, a
   page of plumbing with nothing in it to protect.
2. Compiles each one to engine/.protect/<module>.<tag>.pyd with Cython.
   `annotation_typing=False`: Cython must not turn our type hints into C type
   checks — the compiled module has to behave exactly like the Python one.
3. Writes engine/.protect/modules.json: the .pyd names and the SHA-256 of the
   source each was built from. teza-engine.spec refuses a stale build (a
   source changed after compiling) and scripts/engine-manifest.cjs seals the
   shipped files.

A module that does not compile stops the build. It is NOT quietly shipped as
bytecode — a protected build with a readable module in it is the failure this
whole step exists to prevent. If one ever has to be excluded, it goes in
CANNOT_COMPILE with the reason, and that is a decision, not a fallback.

NEEDS: Cython in .venv (`.venv/Scripts/python -m pip install cython`) and a C
compiler with the Windows SDK (Visual Studio Build Tools: "MSVC" + "Windows 11
SDK"). docs/PACKAGING.md §6 has the full order.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import sysconfig

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, ".protect")
SKIP = {"launch", "setup_models", "export_onnx", "build_protected"}

# Modules that must ship as bytecode, each with the reason. Empty on purpose.
CANNOT_COMPILE: dict[str, str] = {}


def engine_modules() -> list[str]:
    """The same list teza-engine.spec builds — kept identical by rule, so a
    module the spec ships is a module this script compiles."""
    return sorted(
        name[:-3]
        for name in os.listdir(HERE)
        if name.endswith(".py")
        and not name.startswith("_")
        and not name.startswith("test_")
        and not name.startswith("benchmark_")
        and name[:-3] not in SKIP
    )


def sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main() -> int:
    try:
        from Cython.Build import cythonize
        from setuptools import Extension
        from setuptools.dist import Distribution
    except ImportError as e:
        print(f"build_protected: {e}. Install Cython into engine/.venv first.", file=sys.stderr)
        return 1

    modules = [m for m in engine_modules() if m not in CANNOT_COMPILE]
    shutil.rmtree(OUT, ignore_errors=True)
    work = os.path.join(OUT, "work")
    os.makedirs(work)

    # Compile copies, not the files in engine/: Cython writes a .c beside its
    # input, and the working tree is not the place for 100 generated files.
    for m in modules:
        shutil.copy2(os.path.join(HERE, f"{m}.py"), os.path.join(work, f"{m}.py"))

    extensions = [Extension(m, [os.path.join(work, f"{m}.py")]) for m in modules]
    compiled = cythonize(
        extensions,
        build_dir=os.path.join(OUT, "c"),
        nthreads=os.cpu_count() or 1,
        quiet=True,
        compiler_directives={
            "language_level": 3,
            "annotation_typing": False,   # behave like Python, not like C
            "binding": True,              # functions stay introspectable
            "always_allow_keywords": True,
            "embedsignature": False,      # no signatures written into the binary
            "emit_code_comments": False,  # no source lines in the generated C
        },
    )

    dist = Distribution({"name": "teza-engine-protected", "ext_modules": compiled})
    cmd = dist.get_command_obj("build_ext")
    cmd.build_lib = OUT
    cmd.build_temp = os.path.join(OUT, "obj")
    cmd.ensure_finalized()
    cmd.run()

    suffix = sysconfig.get_config_var("EXT_SUFFIX")  # e.g. .cp314-win_amd64.pyd
    files, missing = [], []
    for m in modules:
        name = f"{m}{suffix}"
        (files if os.path.exists(os.path.join(OUT, name)) else missing).append(name)
    if missing:
        print("build_protected: not compiled:\n  " + "\n  ".join(missing), file=sys.stderr)
        return 1

    shutil.rmtree(work, ignore_errors=True)
    with open(os.path.join(OUT, "modules.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "python": sys.version.split()[0],
                "suffix": suffix,
                "modules": modules,
                "files": files,
                "sources": {m: sha256(os.path.join(HERE, f"{m}.py")) for m in modules},
                "cannot_compile": CANNOT_COMPILE,
            },
            f,
            indent=2,
        )
    print(f"build_protected: {len(files)} modules compiled → engine/.protect")
    return 0


if __name__ == "__main__":
    sys.exit(main())
