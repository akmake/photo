"""Read-only Google Drive and Dropbox sources for project import.

The cloud is only an inlet. Files are copied into the project's local RAW
folder and every editing operation continues to use the existing local model.
OAuth uses the installed-app authorization-code flow with PKCE; no app secret
is embedded in the shipped desktop client.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import workspace
import secure_tokens


CALLBACK = "http://127.0.0.1:8756/oauth/callback"
IMAGE_EXTS = workspace.IMAGE_EXTS
PROVIDERS = {"google", "dropbox"}
_PENDING = {}
_LOCK = threading.Lock()


class CloudError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _settings_path():
    base = (
        os.environ.get("TEZA_HOME")
        or os.environ.get("LOCALAPPDATA")
        or os.path.expanduser("~")
    )
    return os.path.join(base, "TEZA", "settings.json")


def _settings():
    try:
        with open(_settings_path(), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _write_settings(data):
    target = _settings_path()
    os.makedirs(os.path.dirname(target), exist_ok=True)
    tmp = target + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, target)
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass


def _credentials(provider):
    config = {}
    try:
        with open(os.path.join(os.path.dirname(__file__), "cloud_apps.json"), "r", encoding="utf-8") as fh:
            config = (json.load(fh) or {}).get(provider) or {}
    except (OSError, ValueError):
        pass
    if provider == "google":
        return {
            "client_id": os.environ.get("TEZA_GOOGLE_CLIENT_ID", config.get("client_id", "")).strip(),
            "client_secret": os.environ.get("TEZA_GOOGLE_CLIENT_SECRET", config.get("client_secret", "")).strip(),
        }
    if provider == "dropbox":
        return {
            "client_id": os.environ.get("TEZA_DROPBOX_APP_KEY", config.get("client_id", "")).strip(),
            "client_secret": os.environ.get("TEZA_DROPBOX_APP_SECRET", config.get("client_secret", "")).strip(),
        }
    raise CloudError("unknown cloud provider")


def _token(provider):
    try:
        saved = secure_tokens.load(provider)
    except secure_tokens.SecureStoreError as exc:
        raise CloudError(str(exc), 503) from exc
    if saved:
        return saved

    # One-time migration from the early implementation, which persisted OAuth
    # responses as plaintext in settings.json. Move first, then remove the old
    # value so a failed vault write can never destroy the only refresh token.
    data = _settings()
    legacy = (data.get("cloud") or {}).get(provider)
    if not legacy:
        return {}
    try:
        secure_tokens.save(provider, legacy)
    except secure_tokens.SecureStoreError as exc:
        raise CloudError(str(exc), 503) from exc
    _remove_legacy_token(data, provider)
    return legacy


def _remove_legacy_token(data, provider):
    cloud = data.get("cloud") or {}
    cloud.pop(provider, None)
    if cloud:
        data["cloud"] = cloud
    else:
        data.pop("cloud", None)
    _write_settings(data)


def _save_token(provider, token):
    old = _token(provider)
    if not token.get("refresh_token") and old.get("refresh_token"):
        token["refresh_token"] = old["refresh_token"]
    token["saved_at"] = int(time.time())
    try:
        secure_tokens.save(provider, token)
    except secure_tokens.SecureStoreError as exc:
        raise CloudError(str(exc), 503) from exc
    # Defensive cleanup for installations migrated during a concurrent request.
    data = _settings()
    if (data.get("cloud") or {}).get(provider):
        _remove_legacy_token(data, provider)


def status():
    out = {}
    for provider in sorted(PROVIDERS):
        creds = _credentials(provider)
        token = _token(provider)
        out[provider] = {
            "configured": bool(creds["client_id"]),
            "connected": bool(token.get("access_token") or token.get("refresh_token")),
        }
    return out


def disconnect(provider):
    _require_provider(provider)
    try:
        secure_tokens.delete(provider)
    except secure_tokens.SecureStoreError as exc:
        raise CloudError(str(exc), 503) from exc
    data = _settings()
    if (data.get("cloud") or {}).get(provider):
        _remove_legacy_token(data, provider)
    return status()[provider]


def _require_provider(provider):
    if provider not in PROVIDERS:
        raise CloudError("unknown cloud provider")


def _b64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def begin(provider):
    _require_provider(provider)
    creds = _credentials(provider)
    if not creds["client_id"]:
        env_name = (
            "TEZA_GOOGLE_CLIENT_ID" if provider == "google"
            else "TEZA_DROPBOX_APP_KEY"
        )
        raise CloudError(f"Cloud connection is not configured ({env_name})", 503)

    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    redirect = CALLBACK + "/" + provider
    with _LOCK:
        _PENDING[state] = {
            "provider": provider,
            "verifier": verifier,
            "redirect": redirect,
            "created": time.time(),
        }
        for key, pending in list(_PENDING.items()):
            if time.time() - pending["created"] > 600:
                _PENDING.pop(key, None)

    if provider == "google":
        params = {
            "client_id": creds["client_id"],
            "redirect_uri": redirect,
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/drive.readonly",
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        base = "https://accounts.google.com/o/oauth2/v2/auth"
    else:
        params = {
            "client_id": creds["client_id"],
            "redirect_uri": redirect,
            "response_type": "code",
            "token_access_type": "offline",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        base = "https://www.dropbox.com/oauth2/authorize"
    return {"authorizationUrl": base + "?" + urllib.parse.urlencode(params)}


def finish(provider, args):
    _require_provider(provider)
    if args.get("error"):
        raise CloudError(args.get("error_description") or args["error"])
    state = args.get("state", "")
    with _LOCK:
        pending = _PENDING.pop(state, None)
    if not pending or pending["provider"] != provider:
        raise CloudError("The connection request expired. Return to TEZA and try again.")
    code = args.get("code")
    if not code:
        raise CloudError("The authorization service did not return a code.")

    creds = _credentials(provider)
    form = {
        "client_id": creds["client_id"],
        "code": code,
        "code_verifier": pending["verifier"],
        "grant_type": "authorization_code",
        "redirect_uri": pending["redirect"],
    }
    if creds.get("client_secret"):
        form["client_secret"] = creds["client_secret"]
    endpoint = (
        "https://oauth2.googleapis.com/token" if provider == "google"
        else "https://api.dropboxapi.com/oauth2/token"
    )
    token = _request_json(endpoint, form=form)
    token["expires_at"] = int(time.time()) + int(token.get("expires_in", 3600)) - 60
    _save_token(provider, token)
    return True


def _refresh(provider, token):
    refresh_token = token.get("refresh_token")
    if not refresh_token:
        raise CloudError("The cloud session expired. Connect the account again.", 401)
    creds = _credentials(provider)
    form = {
        "client_id": creds["client_id"],
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    if creds.get("client_secret"):
        form["client_secret"] = creds["client_secret"]
    endpoint = (
        "https://oauth2.googleapis.com/token" if provider == "google"
        else "https://api.dropboxapi.com/oauth2/token"
    )
    fresh = _request_json(endpoint, form=form)
    fresh["refresh_token"] = refresh_token
    fresh["expires_at"] = int(time.time()) + int(fresh.get("expires_in", 3600)) - 60
    _save_token(provider, fresh)
    return fresh


def _access_token(provider):
    token = _token(provider)
    if not token:
        raise CloudError("Connect the cloud account first.", 401)
    if int(token.get("expires_at", 0)) <= int(time.time()):
        token = _refresh(provider, token)
    return token["access_token"]


def _request(url, *, token=None, body=None, form=None, headers=None, output=None):
    request_headers = dict(headers or {})
    if token:
        request_headers["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    elif form is not None:
        data = urllib.parse.urlencode(form).encode("utf-8")
        request_headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=request_headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            if output:
                with open(output, "wb") as fh:
                    shutil.copyfileobj(response, fh)
                return None
            return response.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw)
            detail = parsed.get("error_description") or parsed.get("error") or raw
            if isinstance(detail, dict):
                detail = detail.get("message") or json.dumps(detail)
        except ValueError:
            detail = raw
        raise CloudError(str(detail) or f"Cloud service returned {exc.code}", exc.code) from exc
    except urllib.error.URLError as exc:
        raise CloudError("Could not reach the cloud service.", 503) from exc


def _request_json(url, **kwargs):
    raw = _request(url, **kwargs)
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, AttributeError) as exc:
        raise CloudError("The cloud service returned an invalid response.", 502) from exc


def list_folder(provider, folder=None):
    _require_provider(provider)
    token = _access_token(provider)
    return _google_list(token, folder or "root") if provider == "google" else _dropbox_list(token, folder or "")


def _google_list(token, folder):
    files = []
    page = None
    while True:
        query = {
            "q": f"'{folder}' in parents and trashed = false",
            "fields": "nextPageToken,files(id,name,mimeType,size,modifiedTime)",
            "pageSize": "1000",
            "orderBy": "folder,name",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
        if page:
            query["pageToken"] = page
        data = _request_json(
            "https://www.googleapis.com/drive/v3/files?" + urllib.parse.urlencode(query),
            token=token,
        )
        files.extend(data.get("files") or [])
        page = data.get("nextPageToken")
        if not page:
            break
    out = []
    for item in files:
        folder_kind = item.get("mimeType") == "application/vnd.google-apps.folder"
        if not folder_kind and os.path.splitext(item.get("name", ""))[1].lower() not in IMAGE_EXTS:
            continue
        out.append({
            "id": item["id"], "name": item.get("name") or "", 
            "kind": "folder" if folder_kind else "image",
            "size": int(item.get("size", 0)) if not folder_kind else None,
            "modified": item.get("modifiedTime"),
        })
    return {"folder": folder, "entries": out}


def _dropbox_list(token, folder):
    data = _request_json(
        "https://api.dropboxapi.com/2/files/list_folder",
        token=token,
        body={"path": folder, "recursive": False, "include_deleted": False, "limit": 2000},
    )
    entries = list(data.get("entries") or [])
    while data.get("has_more"):
        data = _request_json(
            "https://api.dropboxapi.com/2/files/list_folder/continue",
            token=token,
            body={"cursor": data["cursor"]},
        )
        entries.extend(data.get("entries") or [])
    out = []
    for item in entries:
        kind = item.get(".tag")
        folder_kind = kind == "folder"
        if not folder_kind and (kind != "file" or os.path.splitext(item.get("name", ""))[1].lower() not in IMAGE_EXTS):
            continue
        out.append({
            "id": item.get("path_lower") or item.get("id"),
            "name": item.get("name") or "",
            "kind": "folder" if folder_kind else "image",
            "size": item.get("size") if not folder_kind else None,
            "modified": item.get("client_modified"),
        })
    out.sort(key=lambda x: (x["kind"] != "folder", x["name"].lower()))
    return {"folder": folder, "entries": out}


def import_image(provider, item_id, name, size, raw_dir):
    _require_provider(provider)
    token = _access_token(provider)

    def download(target):
        if provider == "google":
            url = "https://www.googleapis.com/drive/v3/files/" + urllib.parse.quote(item_id, safe="") + "?alt=media"
            _request(url, token=token, output=target)
        else:
            _request(
                "https://content.dropboxapi.com/2/files/download",
                token=token,
                headers={"Dropbox-API-Arg": json.dumps({"path": item_id})},
                output=target,
            )

    return workspace.import_download(name, size, raw_dir, download)
