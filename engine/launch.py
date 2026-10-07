"""The packaged engine's entry point. One executable, two jobs.

WHY THIS FILE EXISTS
--------------------
In development the engine is started as `python server.py`, and when it wants a
background worker it starts `python prep.py` — two scripts and an interpreter.
A packaged build has neither: there is no python.exe beside the app and no loose
.py files, only one frozen executable.

So the executable calls ITSELF with a flag. `teza-engine.exe` serves the studio;
`teza-engine.exe --prep` is the background preparation worker that server.py
spawns (see `_prep_process` there, which passes the flag when frozen).

Both are entered by CALLING them — `server.serve()`, `prep.main()` — and not
through runpy as `__main__`, which is how this file did it until 07.10.2026.
The packaged engine ships server.py and prep.py compiled to machine code
(build_protected.py, docs/CODE-PROTECTION-TIMELINE.md), and runpy can only run
a module it has the code object of. Their `if __name__ == "__main__":` blocks
call the same two functions, so the command line behaves as it always did.
"""

import multiprocessing
import os
import sys


def _bundle_dir() -> str:
    """Where the engine's own files sit — beside the executable when frozen."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def main() -> None:
    # PyInstaller re-executes the program for every child process. Without this,
    # a library that reaches for multiprocessing would start the whole engine
    # again instead of a worker — as many times as it liked.
    multiprocessing.freeze_support()

    here = _bundle_dir()
    # server.py and prep.py both resolve their neighbours relative to the
    # working directory, the same as they do when started by hand.
    os.chdir(here)
    if here not in sys.path:
        sys.path.insert(0, here)

    if "--prep" in sys.argv[1:]:
        # The frozen preparation worker is another entry point into image work;
        # it must not bypass the HTTP server's license gate when run directly.
        if getattr(sys, "frozen", False):
            import license_state
            if not license_state.status()["ok"]:
                sys.exit("TEZA license required")
        import prep
        prep.main()
    else:
        import server
        server.serve()


if __name__ == "__main__":
    main()
