"""Append-only record of every experiment run.

Twenty experiments were run before this existed and all of their numbers lived
only in a chat transcript and a temp directory that gets deleted. Re-running an
experiment because nobody wrote down that it had already failed is the most
expensive kind of waste on this project.

Every run appends one JSON line to runs.jsonl. Nothing is ever overwritten, so
a config that lost is still there next month when someone proposes it again.

    from explog import log
    log("bgrid", {"sx": 6, "sl": 16}, {"closed": 57.9, "blotch": 0.02},
        pair="haze", note="cross-channel pinned")
"""

import json
import os
import platform
import socket
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "runs.jsonl")


def _git_rev():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=HERE,
            stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return None


def log(model, config, metrics, pair=None, note=None, artifacts=None):
    """model: which approach. config: its knobs. metrics: what was measured."""
    row = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "model": model,
        "pair": pair,
        "config": config,
        "metrics": metrics,
        "note": note,
        "artifacts": artifacts or [],
        "git": _git_rev(),
        "host": f"{socket.gethostname()}/{platform.system()}",
    }
    with open(PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row


def load():
    if not os.path.exists(PATH):
        return []
    with open(PATH, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def table(metric="closed", pair=None):
    """Every run ranked on one metric — so 'have we tried this' is answerable."""
    rows = [r for r in load() if (pair is None or r["pair"] == pair)]
    rows = [r for r in rows if metric in (r["metrics"] or {})]
    rows.sort(key=lambda r: r["metrics"][metric], reverse=True)
    out = []
    for r in rows:
        cfg = ", ".join(f"{k}={v}" for k, v in (r["config"] or {}).items())
        out.append(f"{r['metrics'][metric]:>8.2f}  {r['model']:<10} {r['pair'] or '-':<8} {cfg}"
                   + (f"   # {r['note']}" if r.get("note") else ""))
    return "\n".join(out) or "(nothing logged yet)"


if __name__ == "__main__":
    import sys
    print(table(sys.argv[1] if len(sys.argv) > 1 else "closed",
                sys.argv[2] if len(sys.argv) > 2 else None))
