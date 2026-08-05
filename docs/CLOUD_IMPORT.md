# Cloud import setup

Google Drive and Dropbox are read-only import sources. TEZA downloads selected
images into the project's local `תמונות גלם` folder; editing and project state
remain local.

## Application credentials

Copy `engine/cloud_apps.example.json` to `engine/cloud_apps.json`. The real file
is ignored by Git. Client IDs are public desktop-app identifiers, but they still
belong in installation configuration rather than source code.

Environment variables override the JSON file:

- `TEZA_GOOGLE_CLIENT_ID` (and optional `TEZA_GOOGLE_CLIENT_SECRET`)
- `TEZA_DROPBOX_APP_KEY` (and optional `TEZA_DROPBOX_APP_SECRET`)

PKCE is used for both providers, so a secret is not required in the distributed
desktop client.

## Google Drive

1. Create a Google Cloud project and enable Google Drive API.
2. Configure the OAuth consent screen.
3. Create an OAuth client with application type **Desktop app**.
4. Put its client ID in `cloud_apps.json`.

TEZA requests only `https://www.googleapis.com/auth/drive.readonly` and uses the
desktop loopback callback at `http://127.0.0.1:8756/oauth/callback/google`.

## Dropbox

1. Create a scoped Dropbox app (App Folder or Full Dropbox, depending on the
   folders photographers should be able to browse).
2. Enable `files.metadata.read` and `files.content.read`.
3. Add this exact redirect URI in the Dropbox app console:
   `http://127.0.0.1:8756/oauth/callback/dropbox`
4. Put the app key in `cloud_apps.json`.

## Local token storage

Refresh tokens are saved in the installation's existing `TEZA/settings.json`
file with restricted file permissions where the operating system supports it.
Disconnecting an account from the picker removes its local token.
