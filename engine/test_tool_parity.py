"""The tool contract is declared in four places. This asserts they agree.

    src/toolRegistry.ts   what the UI renders and what params it sends
    engine/server.py      what /tools advertises over HTTP
    engine/render.py      what can actually be dispatched
    engine/presets.py     what the default recipes switch on

Nothing keeps those in step, and they have already drifted in a way that cost
real work: the server advertised `skin-cleanup` as `disabled: true` with a single
`strength` slider defaulting to 60 long after the engine had two operators and a
much better default. The UI therefore sent parameter names the running engine did
not know, the engine silently fell back to ITS default, and the sliders stopped
controlling anything at all — with no error anywhere. A tool that worked looked
broken from the front end, and no amount of moving the slider could have shown
otherwise.

That is the failure this file exists to make impossible. It is deliberately a
CONTRACT test, not a behaviour test: it never renders a pixel, so it is fast
enough to run on every change.

    python test_tool_parity.py
"""

from __future__ import annotations

import json
import os
import re
import sys

import presets
import render
import server

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY_TS = os.path.join(ROOT, "src", "toolRegistry.ts")

# Tools the UI owns entirely: implemented in JS for live preview, and never
# dispatched through the engine. Listed here so their absence is a stated fact
# rather than an unexplained gap.
UI_ONLY: set[str] = set()

# Engine tools with no slider block in the registry, on purpose.
#   pixel-color is FITTED from a before/after pair, not configured, so it has no
#   params to declare (src/studio/screens/SetRecipe.tsx). The UI does drive it —
#   BeforeAfter.tsx and ColorMatch.tsx push it into a recipe directly.
ENGINE_ONLY: set[str] = {"pixel-color"}


def parse_registry() -> dict:
    """Pull id/params/defaults/flags out of the TS registry without a JS parser.

    A regex over source is normally a bad idea; here it is the honest option,
    because the alternative is no check at all and the thing being checked is
    exactly the kind of divergence nobody notices by reading.
    """
    src = open(REGISTRY_TS, encoding="utf-8").read()
    tools = {}
    for block in re.finditer(r"\{\s*(?:/\*.*?\*/\s*|//[^\n]*\n\s*)*id:\s*'([\w-]+)'",
                             src, re.S):
        tool_id = block.group(1)
        start = block.start()
        depth, i = 0, start
        while i < len(src):
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        body = src[start:i]
        # Only inside the `params: [...]` array. Scanning the whole tool body
        # captured the TOOL's own id as a parameter (`blush.blush`), which then
        # reported a mismatch for every tool on the list — a checker that cries
        # wolf is worse than none, because the real entries get skimmed past.
        params = {}
        pblock = re.search(r"params:\s*\[(.*?)\]\s*,?\s*$", body, re.S)
        if pblock:
            for p in re.finditer(
                r"\{[^{}]*?id:\s*'([\w-]+)'[^{}]*?default:\s*(-?[\d.]+)[^{}]*?\}",
                pblock.group(1), re.S
            ):
                params[p.group(1)] = float(p.group(2))
        if "kind:" not in body:
            continue
        tools[tool_id] = {
            "params": params,
            "experimental": "experimental: true" in body,
            "legacy": "legacy: true" in body,
            "kind": (re.search(r"kind:\s*'(\w+)'", body) or [None, "?"])[1],
        }
    return tools


def parse_server() -> dict:
    out = {}
    for spec in server.TOOLS:
        out[spec["id"]] = {
            "params": {p["id"]: float(p.get("default", 0)) for p in spec.get("params", [])},
            "disabled": bool(spec.get("disabled")),
            "kind": spec.get("kind", "?"),
        }
    return out


def main() -> int:
    ui = parse_registry()
    sv = parse_server()
    dispatch = set(render.TOOLS)
    http = set(server.DISPATCH)
    problems: list[str] = []

    ai_ui = {t for t, v in ui.items() if v["kind"] == "ai"}

    print(f"UI registry: {len(ui)} tools ({len(ai_ui)} ai) · server: {len(sv)} · "
          f"render dispatch: {len(dispatch)} · http dispatch: {len(http)}\n")

    # 1. An AI tool the UI can show but the engine cannot run is dead on arrival.
    for tool_id in sorted(ai_ui - dispatch - UI_ONLY):
        problems.append(f"{tool_id}: UI offers it, render.TOOLS cannot dispatch it")
    for tool_id in sorted(dispatch - set(ui) - ENGINE_ONLY):
        problems.append(f"{tool_id}: engine can render it, UI registry has no entry")

    # 2. Anything served on the single-tool HTTP endpoint must also be
    #    dispatchable in a recipe, or a tool the Lab can drive is silently
    #    dropped from an export.
    #
    #    The reverse is NOT an error: /tools/{id}/apply exists for AI tools that
    #    have to be computed in the engine and cached, while the global tools
    #    reach the screen through the JS engine and reach disk through /render.
    #    Both the Lab and the gallery use /render (src/api.ts), so a global tool
    #    missing from DISPATCH costs nothing. That asymmetry is by design and is
    #    asserted rather than left as an unexplained 14-line diff.
    for tool_id in sorted(http - dispatch):
        problems.append(f"{tool_id}: served over HTTP but absent from render.TOOLS "
                        f"(works in the lab, silently skipped in a recipe)")
    for tool_id in sorted(http - set(ui)):
        problems.append(f"{tool_id}: served over HTTP but the UI registry has no "
                        f"entry")

    # 3. Same tool, same parameter names and defaults on both sides.
    for tool_id in sorted(set(ui) & set(sv)):
        u, s = ui[tool_id]["params"], sv[tool_id]["params"]
        for name in sorted(set(u) - set(s)):
            problems.append(f"{tool_id}.{name}: UI sends it, engine never declares "
                            f"it (engine will fall back to its own default)")
        for name in sorted(set(s) - set(u)):
            problems.append(f"{tool_id}.{name}: engine declares it, UI has no "
                            f"control for it")
        for name in sorted(set(u) & set(s)):
            if abs(u[name] - s[name]) > 1e-6:
                problems.append(f"{tool_id}.{name}: default {u[name]} in UI vs "
                                f"{s[name]} in engine")
        if sv[tool_id]["disabled"] and not ui[tool_id]["experimental"]:
            problems.append(f"{tool_id}: engine says disabled, UI offers it normally")

    # 4. A preset may not reference a tool that cannot be dispatched.
    for level in presets.PORTRAIT_LEVELS:
        for entry in presets.portrait(level):
            if entry["toolId"] not in dispatch:
                problems.append(f"preset '{level}' uses {entry['toolId']}, which "
                                f"render.TOOLS cannot dispatch")

    if problems:
        print(f"{len(problems)} contract mismatch(es):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("tool contract: UI, server, dispatch and presets all agree.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
