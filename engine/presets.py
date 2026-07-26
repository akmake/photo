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

PORTRAIT_LEVELS = {
    "off": (0, 0, 0),
    "natural": (25, 30, 12),
    "light": (40, 40, 22),
    "medium": (55, 50, 35),
    "strong": (72, 62, 50),
    "max": (90, 80, 70),
}

DEFAULT_LEVEL = "light"

# The finishing tools that are safe to apply at any level — they add colour, not
# smoothing, so they cannot contribute to a plastic face.
COLOUR_DEFAULTS = {
    "blush": {"strength": 40, "size": 50, "warmth": 35},
    "eye-sparkle": {"strength": 45, "whites": 35, "sparkle": 40},
    "hair-tones": {"strength": 40, "warmth": 35, "shine": 30, "richness": 35},
}


def portrait(level: str = DEFAULT_LEVEL, colour: bool = True) -> list:
    """A ready recipe for one dial position. -> [{toolId, params}, ...]"""
    retouch, clean, smooth = PORTRAIT_LEVELS.get(level, PORTRAIT_LEVELS[DEFAULT_LEVEL])
    tools = []
    if retouch:
        tools.append({"toolId": "face-retouch", "params": {"strength": retouch}})
    if clean:
        tools.append({"toolId": "skin-cleanup", "params": {"strength": clean}})
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
