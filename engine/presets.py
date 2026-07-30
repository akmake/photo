"""Named intensity levels — one dial instead of three.

The three skin tools each carry their own `strength` and they STACK, so a recipe
at 55/50/35 gives the photographer no single number for "how far has this face
moved". That is a real problem and not a cosmetic one: the honest answer to
"how much did you retouch this child" has to be one value, not three.

So the ratios between the tools are fixed here and only the LEVEL moves. The
numbers are not invented — they come from the ladder rendered in
`_exp_strength_ladder.py` and the texture each level actually costs, measured on
a 480px face:

    level     retouch/cleanup/smooth   fine-detail energy retained
    natural         25 / 30 / 12                103%
    light           40 / 40 / 22                103%
    medium          55 / 50 / 35                103%
    strong          72 / 62 / 50                105%
    max             90 / 80 / 70                111%

The counter-intuitive part is that fine detail goes UP, not down — the skin
tools add micro-contrast and replace smooth blemishes with textured skin. What
the higher levels actually spend is TONAL variation: the natural mottling of the
low frequencies. That is what reads as "doll" long before any pore disappears,
and it is why the default here is `light` rather than `medium`.
"""

# `skin-cleanup` now carries TWO numbers, because it is two operators with
# opposite risk profiles (see cleanup._params):
#
#   redness — diffuse pigment. Cannot write structure, cannot flatten a crease,
#             passes test_blush at full strength. This is where the result comes
#             from: measured on a 573px acne face, it alone removed 85 of the 86
#             marks the tool removes. So it climbs fast with the level.
#   spots   — discrete healing. Contributed ONE mark out of 86 while carrying all
#             of the patch risk, so it stays deliberately low. It is kept rather
#             than zeroed because a scab, a crumb or a scratch is a real object
#             that only reconstruction can remove.
#
# The redness ladder tops out at 90, not 100, and that is measured too: 100 wins
# on a 573px face (132 marks against 149) but LOSES on a 290px one (27 against
# 24) — at small scale the aggressive lightness lift leaves its own residue.
# Since face width in a real frame is not something the photographer controls,
# the default sits where it cannot hurt the small case.
PORTRAIT_LEVELS = {
    #             retouch  redness  spots  smooth
    "off": (0, 0, 0, 0),
    "natural": (25, 70, 15, 12),
    "light": (40, 90, 25, 22),
    "medium": (55, 90, 35, 35),
    "strong": (72, 100, 45, 50),
    "max": (90, 100, 60, 70),
}

DEFAULT_LEVEL = "light"

# `skin-cleanup` is ON.
#
# It was switched off for a real reason: its repairs read as patches. That
# diagnosis was correct and is still correct — `inpaint_texture` takes low
# frequencies from Telea diffusion and high frequencies from a donor at sigma
# 1.5, and NOTHING supplies the band in between, so a repair lands with the right
# colour, the right grain and no structure. (`patch_poisson` exists, is the
# classical answer to exactly this, and is still unused.)
#
# What changed is that the patching path is no longer where the result comes
# from. The diffuse-pigment operator does the work and cannot patch anything,
# because it never writes structure. Measured on a 573px acne face at the
# `light` level: 217 marks -> 149, redness -85%, texture inside repairs 1.04
# (1.0 = indistinguishable from the surrounding skin), test_blush PASS on both
# reference faces. Keeping the whole tool off to restrain a component that now
# contributes 1 mark in 86 costs far more than it protects.
SKIN_CLEANUP_ENABLED = True

# The finishing tools that are safe to apply at any level — they add colour, not
# smoothing, so they cannot contribute to a plastic face.
COLOUR_DEFAULTS = {
    "blush": {"strength": 40, "size": 50, "warmth": 35},
    "eye-sparkle": {"strength": 45, "whites": 35, "sparkle": 40},
    "hair-tones": {"strength": 40, "warmth": 35, "shine": 30, "richness": 35},
}


def portrait(level: str = DEFAULT_LEVEL, colour: bool = True) -> list:
    """A ready recipe for one dial position. -> [{toolId, params}, ...]"""
    retouch, redness, spots, smooth = PORTRAIT_LEVELS.get(
        level, PORTRAIT_LEVELS[DEFAULT_LEVEL]
    )
    tools = []
    if retouch:
        tools.append({"toolId": "face-retouch", "params": {"strength": retouch}})
    if (redness or spots) and SKIN_CLEANUP_ENABLED:
        tools.append(
            {
                "toolId": "skin-cleanup",
                "params": {"redness": redness, "spots": spots},
            }
        )
    if smooth:
        tools.append({"toolId": "skin", "params": {"strength": smooth}})
    if colour:
        for tool_id, params in COLOUR_DEFAULTS.items():
            tools.append({"toolId": tool_id, "params": dict(params)})
    return tools


def scaled(level: str = DEFAULT_LEVEL, amount: int = 100) -> list:
    """A level, then scaled continuously by `amount` (0..100).

    The named levels are for the UI; this is for a slider that has to move
    smoothly between them without the photographer thinking about three tools.
    """
    a = max(0.0, min(1.0, amount / 100.0))
    out = []
    for t in portrait(level):
        params = {
            k: (round(v * a) if k in ("strength",) and isinstance(v, (int, float)) else v)
            for k, v in t["params"].items()
        }
        if params.get("strength", 1) > 0:
            out.append({"toolId": t["toolId"], "params": params})
    return out
