---
title: chatgpt-to-obsidian design
status: approved
created: 2026-07-08
---

# chatgpt-to-obsidian — Chrome Extension Design

## Purpose

A Chrome extension that captures a ChatGPT conversation and drops a cleaned
markdown transcript into the `inbox/` folder of the user's Obsidian vault
(`my-wiki`), matching the vault's existing `inbox` skill conventions. No
summarization happens in the extension — that stays a Claude Code step
("处理 inbox") performed later, in the vault itself.

## Non-goals

- No automatic/scheduled capture. Manual trigger only (v1).
- No summarization or LLM calls inside the extension.
- No personal/work classification, wiki archiving, or index/log updates —
  those belong to the vault's existing "处理 inbox" flow.
- No multi-conversation batch export in v1 (one click = one open conversation).

## Target vault

Fixed path (matches the vault's own `CLAUDE.md` / `inbox` skill):

```
/Users/ewen/Library/Mobile Documents/iCloud~md~obsidian/Documents/my-wiki/inbox/
```

## Architecture

```
ChatGPT tab (chatgpt.com)
  └─ content script
       - reads conversation id from URL (chatgpt.com/c/<id>)
       - fetches chatgpt.com/backend-api/conversation/<id> (same-origin,
         cookies included — reuses the user's logged-in session)
       - falls back to DOM scraping if the backend API response shape
         doesn't match what we expect
       - walks the message `mapping` tree in create_time order
       - converts each message to markdown (Turndown for HTML→MD on
         assistant messages; user messages are plain text)
       - sends { title, url, markdown } to the popup on request

Popup (popup.html/js)
  - "存入 Obsidian inbox" button
  - on click: asks the active tab's content script to extract
  - shows conversation title as a preview before confirming
  - shows success / error toast after the write attempt

Background service worker
  - receives the extracted { title, url, markdown } from the popup
  - builds the final file: frontmatter + transcript
  - resolves filename collisions (-2, -3, ... suffix)
  - PUT https://127.0.0.1:27123/vault/inbox/<filename>.md
    (Obsidian Local REST API community plugin, HTTP loopback port —
    avoids self-signed HTTPS cert friction since traffic never leaves
    the machine)
  - reports result back to the popup

Options page (options.html/js)
  - one field: Local REST API key
  - saved to chrome.storage.local
```

## File format

Matches the vault's `inbox` skill frontmatter convention exactly:

```yaml
---
title: <conversation title>
source: <https://chatgpt.com/c/xxx>
captured: <YYYY-MM-DD, from the system clock at capture time>
tags: [inbox]
---
```

Body: the conversation transcript in order, each turn labeled (`**You:**` /
`**ChatGPT:**`), code blocks and lists preserved via Turndown conversion.
Content is cleaned of ChatGPT UI chrome (regenerate buttons, model-switch
labels, citation footnote markup) but the actual message text is never
paraphrased or trimmed.

**Filename:** cleaned conversation title (emoji stripped, `:` → `-`, `/` →
`-`, Chinese characters kept) — same rule as the `inbox` skill uses for
other captures. If a file with that name already exists, append `-2`,
`-3`, etc. One file per capture (no same-day append/merge).

## Error handling

| Failure | Behavior |
|---|---|
| Local REST API unreachable (plugin not installed/enabled) | Popup shows "无法连接 Obsidian，请确认 Local REST API 插件已开启" |
| API key missing/invalid (401) | Popup shows "API key 无效，请到设置页检查" and links to options page |
| backend-api response shape unexpected | Fall back to DOM scraping; if that also fails, popup shows "无法读取对话内容" and does not write a partial/corrupt file |
| Filename collision | Silently append numeric suffix, mention final filename in the success toast |

## Testing

Since this is a browser extension with no build/test framework needed for
v1, verification is manual:

1. Load unpacked extension in `chrome://extensions`.
2. Open a real ChatGPT conversation, click "存入 Obsidian inbox".
3. Confirm the file appears in `my-wiki/inbox/` with correct frontmatter
   and a faithful, readable transcript (spot-check against the live page).
4. Test the collision case (capture the same conversation twice).
5. Test the error path with the Local REST API plugin disabled.

## Setup dependency (one-time, user-side)

Install the **Local REST API** community plugin in Obsidian, enable it,
copy its generated API key into the extension's options page. This is the
only manual setup step; everything else is handled by the extension.

## Open questions / future work (explicitly out of scope for v1)

- Multi-conversation nightly batch capture (would need ChatGPT's
  conversation-list API, not just a single conversation).
- Auto-capture on tab close.
- extension-side summarization (rejected for v1 — see Non-goals).
