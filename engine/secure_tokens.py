"""OAuth token storage backed by Windows Credential Manager.

Tokens never belong in settings.json. Generic credentials are encrypted by
Windows with the current user's logon key and are only available in that
user's credential set. The module deliberately fails closed on unsupported
platforms rather than silently falling back to plaintext.
"""

from __future__ import annotations

import ctypes
import json
import os
from ctypes import wintypes


TARGET_PREFIX = "TEZA/cloud/"
CRED_TYPE_GENERIC = 1
CRED_PERSIST_LOCAL_MACHINE = 2
ERROR_NOT_FOUND = 1168


class SecureStoreError(Exception):
    pass


if os.name == "nt":
    class FILETIME(ctypes.Structure):
        _fields_ = [
            ("dwLowDateTime", wintypes.DWORD),
            ("dwHighDateTime", wintypes.DWORD),
        ]


    class CREDENTIALW(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]


    PCREDENTIALW = ctypes.POINTER(CREDENTIALW)
    _advapi = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    _cred_write = _advapi.CredWriteW
    _cred_write.argtypes = [ctypes.POINTER(CREDENTIALW), wintypes.DWORD]
    _cred_write.restype = wintypes.BOOL
    _cred_read = _advapi.CredReadW
    _cred_read.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.POINTER(PCREDENTIALW),
    ]
    _cred_read.restype = wintypes.BOOL
    _cred_delete = _advapi.CredDeleteW
    _cred_delete.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
    _cred_delete.restype = wintypes.BOOL
    _cred_free = _advapi.CredFree
    _cred_free.argtypes = [ctypes.c_void_p]
    _cred_free.restype = None


def _target(provider):
    provider = (provider or "").strip().lower()
    if not provider or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-_" for c in provider):
        raise SecureStoreError("invalid credential target")
    return TARGET_PREFIX + provider


def _require_windows():
    if os.name != "nt":
        raise SecureStoreError("Secure cloud token storage requires Windows Credential Manager")


def save(provider, token):
    _require_windows()
    payload = json.dumps(token, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    # CRED_TYPE_GENERIC is capped at 2560 bytes on modern Windows. OAuth token
    # responses are normally well below this; fail instead of truncating.
    if len(payload) > 2560:
        raise SecureStoreError("OAuth token is too large for Windows Credential Manager")
    blob = (ctypes.c_ubyte * len(payload)).from_buffer_copy(payload)
    credential = CREDENTIALW()
    credential.Type = CRED_TYPE_GENERIC
    credential.TargetName = _target(provider)
    credential.Comment = "TEZA cloud OAuth token"
    credential.CredentialBlobSize = len(payload)
    credential.CredentialBlob = ctypes.cast(blob, ctypes.POINTER(ctypes.c_ubyte))
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE
    credential.UserName = provider
    if not _cred_write(ctypes.byref(credential), 0):
        raise SecureStoreError(f"Credential Manager write failed ({ctypes.get_last_error()})")


def load(provider):
    _require_windows()
    pointer = PCREDENTIALW()
    if not _cred_read(_target(provider), CRED_TYPE_GENERIC, 0, ctypes.byref(pointer)):
        error = ctypes.get_last_error()
        if error == ERROR_NOT_FOUND:
            return None
        raise SecureStoreError(f"Credential Manager read failed ({error})")
    try:
        credential = pointer.contents
        payload = ctypes.string_at(credential.CredentialBlob, credential.CredentialBlobSize)
        parsed = json.loads(payload.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("credential is not an object")
        return parsed
    except (UnicodeError, ValueError, json.JSONDecodeError) as exc:
        raise SecureStoreError("Stored cloud credential is invalid") from exc
    finally:
        _cred_free(pointer)


def delete(provider):
    _require_windows()
    if _cred_delete(_target(provider), CRED_TYPE_GENERIC, 0):
        return True
    error = ctypes.get_last_error()
    if error == ERROR_NOT_FOUND:
        return False
    raise SecureStoreError(f"Credential Manager delete failed ({error})")
