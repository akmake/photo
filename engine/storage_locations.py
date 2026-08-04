"""Discover desktop-synchronised cloud folders.

TEZA edits real files on disk. Google Drive for desktop and the Dropbox desktop
app expose their clouds as normal folders or drives, so the existing import and
project code keeps its offline and crash-safe semantics. The vendor clients own
the network sync; this module only discovers their local roots.
"""

import ctypes
import json
import os
import string


def _existing(path):
    if not path:
        return None
    expanded = os.path.abspath(os.path.expandvars(os.path.expanduser(path)))
    return expanded if os.path.isdir(expanded) else None


def _dropbox_roots():
    roots = []
    for base in (os.environ.get("LOCALAPPDATA"), os.environ.get("APPDATA")):
        if not base:
            continue
        info = os.path.join(base, "Dropbox", "info.json")
        try:
            with open(info, "r", encoding="utf-8") as fh:
                accounts = json.load(fh)
            for account in accounts.values():
                path = _existing(account.get("path"))
                if path and path not in roots:
                    roots.append(path)
        except (OSError, ValueError, AttributeError):
            pass
    fallback = _existing(os.path.join(os.path.expanduser("~"), "Dropbox"))
    if fallback and fallback not in roots:
        roots.append(fallback)
    return roots


def _volume_label(root):
    if os.name != "nt":
        return ""
    label = ctypes.create_unicode_buffer(261)
    ok = ctypes.windll.kernel32.GetVolumeInformationW(
        root, label, len(label), None, None, None, None, 0
    )
    return label.value if ok else ""


def _google_roots():
    roots = []
    if os.name == "nt":
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for index, letter in enumerate(string.ascii_uppercase):
            if not mask & (1 << index):
                continue
            root = f"{letter}:\\"
            try:
                label = _volume_label(root).lower()
                if "google drive" in label or "google disk" in label:
                    roots.append(root)
            except OSError:
                pass
    home = os.path.expanduser("~")
    for name in ("Google Drive", "My Drive"):
        path = _existing(os.path.join(home, name))
        if path and path not in roots:
            roots.append(path)
    return roots


def locations():
    google = _google_roots()
    dropbox = _dropbox_roots()
    return [
        {"id": "computer", "label": "המחשב", "available": True, "roots": []},
        {"id": "google-drive", "label": "Google Drive", "available": bool(google), "roots": google},
        {"id": "dropbox", "label": "Dropbox", "available": bool(dropbox), "roots": dropbox},
    ]


def provider_root(provider):
    for item in locations():
        if item["id"] == provider:
            return item["roots"][0] if item["roots"] else None
    return None
