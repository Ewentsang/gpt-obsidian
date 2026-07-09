# Design: Multi-vault connections + in-vault folder browser

**Date:** 2026-07-09
**Status:** Approved design, pending spec review
**Supersedes:** the free-text "Save to folder" field committed on `feat/configurable-target-folder` (that field's autocomplete is replaced by the folder browser; its `normalizeFolder`/encoding logic is kept).

## Problem

The extension hardcodes a single Obsidian Local REST API endpoint (`http://127.0.0.1:27123`) and a single API key, and (after the interim change) a single typed folder path. Two real gaps remain for a user who runs **several Obsidian vaults, often open at the same time**:

1. **No way to choose which vault.** The Local REST API is per-vault: each vault runs its own HTTP server on its own port with its own API key. With multiple vaults open, only one can own 27123; the rest must use distinct ports. The extension can currently only ever reach whichever single vault owns 27123 with the matching key, and gives no indication of which vault that is.
2. **Typing a folder path is error-prone.** The user wants to *pick* a folder, not remember its exact path.

## Constraints (from the Local REST API)

These are hard facts that shape the design:

- **Per-vault servers.** One plugin instance per vault, each on its own port + API key. Simultaneous vaults require distinct ports.
- **API key is mandatory and cannot be auto-fetched.** `/vault/*` requests require `Authorization: Bearer <key>` (401 otherwise). No endpoint exposes the key — that is the security model. The key must be copy-pasted once per vault. (Reading it off disk would require a per-OS native-messaging host; explicitly out of scope.)
- **The health endpoint `GET /` responds without a key**, returning `{ status: "OK", service: "Obsidian Local REST API", versions: {...}, authenticated: <bool> }`. This makes **port auto-detection** possible.
- **The API does not expose the vault name or path.** Vault identity is therefore `(port, key)`; a human-readable label must be supplied by the user.
- **Server is only alive while that vault's Obsidian is open.**
- **HTTPS uses a self-signed cert** that `fetch()` from an extension rejects without manual cert import. Scope is **HTTP only** (the plugin's "Enable Non-encrypted (HTTP) Server" option), on a user-chosen port.

## Goals

- Let the user define and switch between multiple named vault connections.
- Auto-detect running Local REST API servers by port so the user never has to know/type a port.
- Replace folder typing with a click-through, API-driven folder browser that behaves identically on Windows/macOS/Linux.
- Let the user save into a not-yet-existing subfolder ("new folder here").
- Preserve zero-dependency, zero-build architecture; keep pure logic in `lib/*.js` unit-testable under Node.
- Migrate existing single-connection users automatically.

## Non-goals (YAGNI)

- HTTPS / self-signed cert handling.
- Native-messaging host to read keys off disk.
- Free-text path entry in the popup (replaced by the browser; "new folder here" covers the create case).
- Editing/moving/deleting vault files beyond writing the new conversation note.
- Remote (non-loopback) hosts.

## Data model (`chrome.storage.local`)

```jsonc
{
  "connections": [
    { "id": "c1", "label": "Work",     "port": 27123, "apiKey": "…", "lastFolder": "inbox" },
    { "id": "c2", "label": "Personal", "port": 27124, "apiKey": "…", "lastFolder": "" }
  ],
  "activeConnectionId": "c1"
}
```

- `id`: stable opaque id (generated from an incrementing counter + label; no `Date.now`/random needed).
- `port`: HTTP port on `127.0.0.1`.
- `lastFolder`: normalized vault-relative path the browser reopens at for that vault (`""` = vault root).
- **Migration:** on load, if `connections` is absent but a legacy `localRestApiKey` exists, create one connection `{ label: "My vault", port: 27123, apiKey: <legacy>, lastFolder: <legacy targetFolder> ?? "inbox" }`, set it active, and remove the legacy `localRestApiKey` / `targetFolder` keys.

## Components & interfaces

### `lib/local-rest-api.js` (pure, Node-testable)
- `baseUrlFor({ port })` → `http://127.0.0.1:<port>`.
- `normalizeFolder(folder)` / `encodeFolderPath(folder)` — kept as-is.
- `buildInfoRequest(baseUrl)` → `GET /` (no auth header) for port probing/health.
- `buildListRequest(baseUrl, apiKey, folder)` → `GET /vault/<folder>/` (folder listing; `""` = root).
- `buildWriteRequest(baseUrl, apiKey, folder, filename, content)` → `PUT /vault/<folder>/<file>`.
- `subfoldersOf(entries)` — given a listing's `files[]`, return only sub-folder names (entries ending in `/`, trailing slash stripped). Used by the browser; pure and testable.

### `background.js` (service worker; routing + network)
Message handlers (each resolves `{ ok, result | error }`):
- `LIST_CONNECTIONS` → `{ connections: [{id,label,port}], activeConnectionId }` (keys never sent to the popup).
- `DETECT_VAULTS` → probes a bounded port set (`27123`–`27133`) with `buildInfoRequest`, short timeout, in parallel; returns `{ ports: [live ports] }`. Best-effort.
- `VERIFY_CONNECTION { connectionId | {port, apiKey} }` → pings `GET /` then `GET /vault/`; returns `{ authenticated, sampleFolders: [...] }` so the options page can confirm the right vault.
- `LIST_SUBFOLDERS { connectionId, folder }` → one-level listing of sub-folders at `folder` (lazy; no recursion). 404 → `[]`.
- `SET_ACTIVE_CONNECTION { connectionId }`.
- `SAVE_TO_INBOX { title, source, transcript, connectionId, folder }` → resolves the connection, dedupes filename against `LIST` of `folder`, writes, updates that connection's `lastFolder`, returns `{ label, folder, filename }`.

Connection CRUD (add/edit/remove/set-default) is handled by the options page writing `chrome.storage.local` directly; background reads current state per message.

### `popup.html` / `popup.js`
Layout (folder-browser design):
```
Vault: [ Work ▾ ]  ●(connected / red if unreachable)
📂 / › Projects ›                (breadcrumb; each segment clickable to jump up)
  ├ 📁 <subfolder>               (click to descend)
  ├ 📁 …
＋ New subfolder…                (inline text → save into a new folder at this level)
Here: Projects/2026
[ 📥 Save here ]
<status>
```
- On open: `LIST_CONNECTIONS`; populate the vault dropdown; select active; open the browser at that connection's `lastFolder`; render its connectivity dot via `VERIFY_CONNECTION` (lightweight).
- Changing the vault: `SET_ACTIVE_CONNECTION`, reset browser to that vault's `lastFolder`, re-check connectivity. If unreachable, show a clear inline message (Obsidian for that vault not open / wrong port) and disable Save.
- Navigation: clicking a subfolder calls `LIST_SUBFOLDERS` for the deeper path; breadcrumb segments jump back up. All lazy.
- "New subfolder…": reveals a small input; the typed name is appended to the current path as the save target (REST `PUT` auto-creates missing directories).
- Save: extracts the conversation (existing content-script flow, unchanged), then `SAVE_TO_INBOX` with `connectionId` + current folder. Status shows `Saved to <label> · <folder>/<filename>`.
- If there are **no connections**, the popup shows a short prompt with an "Open Settings" button instead of the browser.

### `options.html` / `options.js`
- Connection list; each row: `label · port · key(masked) · [Test] · [Remove]`, plus a radio/marker for the default (active) connection.
- **[Detect vaults]** button → `DETECT_VAULTS`; for each live port not already configured, offer to add it (prefill port; user pastes key + label).
- **[Test]** per row → `VERIFY_CONNECTION`; shows authenticated state + a few root folders so the user can confirm it is the intended vault.
- "+ Add connection" for manual entry (label + port + key).
- Validation: label non-empty; port integer in range; key non-empty.

### `manifest.json`
- Broaden `host_permissions` from `http://127.0.0.1:27123/*` to `http://127.0.0.1/*` so any local port can be probed/used (Chrome match patterns ignore port; this is loopback-only). ChatGPT host permissions unchanged.

## Data flow (save)

1. Popup: user picks vault + navigates to folder → clicks Save.
2. Content script extracts the conversation (unchanged).
3. Popup → `SAVE_TO_INBOX { …payload, connectionId, folder }`.
4. Background resolves `(port, key)`, lists `folder` for dedup, builds filename (`YYYY-MM-DD Title.md`, collision-safe), `PUT`s markdown, updates `lastFolder`.
5. Background → `{ label, folder, filename }`; popup shows the confirmed path with vault label.

## Error handling

- Port unreachable / Obsidian closed → "Can't reach <label> — is that vault's Obsidian open?" (connectivity dot red, Save disabled).
- 401 → "API key for <label> is wrong — fix it in Settings." Popup surfaces an "Open Settings" affordance.
- Folder listing 404 → treated as empty (folder will be created on write).
- `DETECT_VAULTS`: probe failures are silent per-port; a fully empty result shows "No running vaults found — open Obsidian and enable the Local REST API HTTP server."

## Testing

- `lib` unit tests (Node): `baseUrlFor`, `buildInfoRequest`, `buildListRequest`/`buildWriteRequest` with the `baseUrl` signature (incl. nested folder + vault root), `normalizeFolder`, and `subfoldersOf` (filters trailing-slash entries, strips slash).
- Chrome-dependent paths (messaging, storage, DOM) are verified manually by loading the unpacked extension: detect → add two connections on different ports → switch vaults → browse → save into existing and new folders → confirm files land in the correct vault.

## Cross-platform note

All new UI is HTML inside the popup/options pages; folder browsing is plain HTTP against the loopback API. Behavior is identical on Windows, macOS, and Linux — no OS-native pickers, no per-OS binaries.

## Rollout

Continue on branch `feat/configurable-target-folder`, evolving the interim commit. The autocomplete input is removed in favor of the browser; `normalizeFolder`/encoding is retained. READMEs updated to document connections, auto-detect, and the folder browser.
