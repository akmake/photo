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

OAuth access and refresh tokens are stored as generic credentials in the
current user's **Windows Credential Manager**, under `TEZA/cloud/google` and
`TEZA/cloud/dropbox`. Windows encrypts this vault with the user's logon key.
No token or token fragment is written to `TEZA/settings.json`.

Installations that used the earlier plaintext format are migrated
automatically: TEZA first writes the token to Credential Manager and only then
removes the old value from `settings.json`. If the secure write fails, the old
value is retained so the account is not silently lost. Disconnecting an
account deletes its credential from the vault.

The implementation fails closed on non-Windows systems; it never falls back to
plaintext token storage. A future macOS build should provide an equivalent
Keychain backend before cloud import is enabled there.
