"""Colour profiles the engine has to recognise but cannot ship as files.

Adobe RGB (1998) is the space a camera writes when it is set to "Adobe RGB" —
and most cameras then embed NO profile: they only mark the file (EXIF
ColorSpace = uncalibrated, interoperability index "R03"). Read as sRGB, such a
frame prints dull: its greens and cyans are numbers meant for a wider space.

Adobe's own .icc file is not ours to redistribute, and Pillow can only build
sRGB. A matrix/curve profile, though, is nothing but its published numbers —
the primaries, the white point and the gamma of the Adobe RGB (1998)
specification — so it is written here, byte by byte, as ICC v2. Any colour
engine (LittleCMS inside Pillow) reads it like the original.
"""

import struct

# Adobe RGB (1998) colorants, adapted to the ICC's D50 connection space
# (Bradford) — the values every Adobe-RGB-compatible profile carries.
_ADOBE_RGB_COLORANTS = {
    "rXYZ": (0.60974, 0.31111, 0.01947),
    "gXYZ": (0.20528, 0.62567, 0.06087),
    "bXYZ": (0.14919, 0.06322, 0.74457),
}
_D65_WHITE = (0.95045, 1.0, 1.08905)
_D50 = (0.9642, 1.0, 0.8249)
# Gamma 2 + 51/256 = 563/256, the specification's exact value.
_ADOBE_GAMMA_U8F8 = 563


def _s15f16(value: float) -> bytes:
    return struct.pack(">i", int(round(value * 65536)))


def _xyz_tag(xyz) -> bytes:
    return b"XYZ " + b"\0" * 4 + b"".join(_s15f16(v) for v in xyz)


def _curve_tag(gamma_u8f8: int) -> bytes:
    return b"curv" + b"\0" * 4 + struct.pack(">I", 1) + struct.pack(">H", gamma_u8f8)


def _desc_tag(text: str) -> bytes:
    ascii_text = text.encode("ascii") + b"\0"
    body = b"desc" + b"\0" * 4 + struct.pack(">I", len(ascii_text)) + ascii_text
    # Unicode and ScriptCode parts, empty — required by the v2 layout.
    body += struct.pack(">II", 0, 0) + struct.pack(">HB", 0, 0) + b"\0" * 67
    return body


def _text_tag(text: str) -> bytes:
    return b"text" + b"\0" * 4 + text.encode("ascii") + b"\0"


def _pad4(data: bytes) -> bytes:
    return data + b"\0" * (-len(data) % 4)


def adobe_rgb_1998_icc() -> bytes:
    """An ICC v2 display profile equivalent to Adobe RGB (1998)."""
    curve = _curve_tag(_ADOBE_GAMMA_U8F8)
    tags = [
        (b"desc", _desc_tag("Compatible with Adobe RGB (1998)")),
        (b"cprt", _text_tag("Public domain - built from published primaries")),
        (b"wtpt", _xyz_tag(_D65_WHITE)),
        (b"rXYZ", _xyz_tag(_ADOBE_RGB_COLORANTS["rXYZ"])),
        (b"gXYZ", _xyz_tag(_ADOBE_RGB_COLORANTS["gXYZ"])),
        (b"bXYZ", _xyz_tag(_ADOBE_RGB_COLORANTS["bXYZ"])),
        (b"rTRC", curve),
        (b"gTRC", curve),
        (b"bTRC", curve),
    ]
    table_size = 4 + 12 * len(tags)
    offset = 128 + table_size
    directory = struct.pack(">I", len(tags))
    data = b""
    shared: dict[bytes, int] = {}
    for signature, body in tags:
        if body in shared:  # the three TRCs share one curve
            directory += signature + struct.pack(">II", shared[body], len(body))
            continue
        shared[body] = offset + len(data)
        directory += signature + struct.pack(">II", offset + len(data), len(body))
        data += _pad4(body)
    size = 128 + table_size + len(data)
    header = (
        struct.pack(">I", size)
        + b"\0" * 4                      # preferred CMM
        + struct.pack(">I", 0x02100000)  # version 2.1
        + b"mntr" + b"RGB " + b"XYZ "
        + b"\0" * 12                     # date
        + b"acsp"
        + b"\0" * 4                      # platform
        + b"\0" * 4                      # flags
        + b"\0" * 8                      # manufacturer, model
        + b"\0" * 8                      # attributes
        + struct.pack(">I", 0)           # perceptual
        + b"".join(_s15f16(v) for v in _D50)
        + b"\0" * 4                      # creator
        + b"\0" * 16                     # profile id
        + b"\0" * 28                     # reserved
    )
    assert len(header) == 128
    return header + directory + data
