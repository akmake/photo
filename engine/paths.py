"""Where the model weights live. ONE place, asked by everything.

WHY THIS EXISTS
---------------
Every module used to build its own path, `os.path.join(dirname(__file__),
"models", ...)` — thirteen files, fourteen copies of the same assumption: that
the weights sit INSIDE the code folder.

That assumption breaks the moment the app is packaged. `models/` is ~1.9GB, it
is not code, and it changes almost never; the code beside it is a few megabytes
and changes weekly. An updater replaces the folder it installed, so weights
kept in there are re-downloaded on every single update — and an update that
costs 1.9GB is an update a photographer on hall wi-fi never installs. The
weights have to outlive the code folder, the way the records already do
(`db.py` keeps studio.db under LOCALAPPDATA for exactly this reason).

So the location becomes one decision, made here, and the packaged shell points
at it with an environment variable. Nothing else in the engine knows where the
weights are.

RESOLUTION ORDER
----------------
1. `TEZA_MODELS_DIR`, if set — what the packaged app passes to the sidecar.
2. `engine/models` — the development checkout, unchanged.

Read at import, not per call: the module-level `MODEL = model_path(...)`
constants are built once when the engine starts, so the variable must be set on
the process BEFORE it launches, which is how a spawned sidecar gets it anyway.

This module imports nothing but `os` on purpose — every engine module may
import it without any risk of an import cycle.
"""

import os

_HERE = os.path.dirname(os.path.abspath(__file__))

#: The development location: the checkout's own `engine/models`.
DEV_MODELS_DIR = os.path.join(_HERE, "models")

#: The variable the packaged app sets to move the weights out of the app folder.
ENV_VAR = "TEZA_MODELS_DIR"


def models_dir() -> str:
    """The folder holding the model weights."""
    override = os.environ.get(ENV_VAR)
    if override:
        return os.path.abspath(os.path.expanduser(override))
    return DEV_MODELS_DIR


def model_path(*parts: str) -> str:
    """A path to one weights file (or a subfolder of them)."""
    return os.path.join(models_dir(), *parts)


#: Resolved once, for callers that want the folder as a constant.
MODELS_DIR = models_dir()


# ------------------------------------------------------------------ user data
#
# The same problem as the weights, from the other side: what the app WRITES must
# not live inside the app either. A published client gallery kept beside the
# code is wiped by the next update, and in a real installation (Program Files)
# it cannot be written at all — the folder is read-only, and the failure would
# arrive as a gallery that simply never appears.
#
# The records already got this right on their own (engine/db.py puts studio.db
# under LOCALAPPDATA\TEZA). This is the same address, for the folders.
#
# Resolution order:
#   1. TEZA_DATA_DIR — what the packaged shell passes in (electron/main.cjs).
#   2. TEZA_HOME — the variable workspace.py already honours for "put this
#      installation somewhere else". One variable has to move everything, or a
#      test that redirects the settings leaves the galleries behind in the real
#      one — which is the accident workspace.py's own comment was written about.
#   3. The checkout's own TEZA/ when it exists, so a development machine keeps
#      writing exactly where it already does and nothing appears to vanish.
#   4. LOCALAPPDATA\TEZA — a real installation, beside the records.

#: The TEZA folder that sits next to the engine's own directory, in a checkout.
DEV_DATA_DIR = os.path.join(os.path.dirname(_HERE), "TEZA")


def data_dir(*parts: str) -> str:
    """A folder the photographer's own material is written into."""
    override = os.environ.get("TEZA_DATA_DIR")
    home = os.environ.get("TEZA_HOME")
    if override:
        base = os.path.abspath(os.path.expanduser(override))
    elif home:
        base = os.path.join(os.path.abspath(os.path.expanduser(home)), "TEZA")
    elif os.path.isdir(DEV_DATA_DIR):
        base = DEV_DATA_DIR
    else:
        base = os.path.join(
            os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "TEZA",
        )
    return os.path.join(base, *parts)
