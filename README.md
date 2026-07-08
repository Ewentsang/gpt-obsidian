# ChatGPT → Obsidian Inbox

[中文](README.zh-CN.md)

A lightweight Chrome extension that captures your ChatGPT conversations straight into your Obsidian vault — no copy-pasting, no manual formatting.

Click the extension icon while viewing any ChatGPT conversation, and it pulls the full conversation, cleans it up, and drops it into your vault's `inbox/` folder as a properly formatted markdown file with YAML frontmatter (title, source URL, capture date, and an `inbox` tag) — ready for whatever archiving or review workflow you already use.

**Design philosophy:** this tool only captures and cleans. It never summarizes, rewrites, or interprets your conversations — that judgment call is left to you (or your own downstream workflow). What you see in ChatGPT is what lands in your vault, faithfully preserved, including code blocks and formatting.

**How it works:** the extension reads the conversation directly from ChatGPT's own data (not by scraping the visible page), which makes it accurate and resistant to UI redesigns — with a DOM-based fallback for the rare case that path fails. Everything happens locally: your conversation data is sent directly from your browser to your own Obsidian vault via the Local REST API community plugin, over a connection that never leaves your machine. No cloud service, no third-party server, no account required beyond your existing ChatGPT and Obsidian setup.

## Features

- One-click manual capture — you decide what's worth saving
- Filenames prefixed with the capture date (`YYYY-MM-DD Title.md`), sortable in your vault's file explorer
- Automatic, collision-safe file naming (adds `-2`, `-3`, etc. if a title repeats)
- Clean error messages if Obsidian isn't reachable or the API key is wrong
- Zero external dependencies, zero build step — just load it and go

## Requirements

- Google Chrome
- Obsidian with the **Local REST API** community plugin installed and enabled
- An active ChatGPT account

## Setup (one-time)

1. In Chrome, go to `chrome://extensions`, enable **Developer mode**, click **"Load unpacked"**, and select this project's directory.
2. In Obsidian, install and enable the community plugin **Local REST API**.
3. In the plugin settings, enable **"Enable Non-encrypted (HTTP) Server"** (binds to `http://127.0.0.1:27123`). This avoids dealing with the plugin's self-signed HTTPS certificate since traffic never leaves this machine.
4. Copy the generated **API key** from the plugin settings.
5. Right-click the extension's toolbar icon and choose **"Options"** (or open it from the extension's card on `chrome://extensions`), paste the API key, and save.

## Usage

1. Open a conversation on `chatgpt.com` or `chat.openai.com` (the URL should look like `.../c/<some-id>`).
2. Click the extension's toolbar icon.
3. Click **"Save to Obsidian Inbox"**.
4. The popup shows the conversation title, then a success message once the file is saved to your vault's `inbox/` folder.

If you see an error, the popup message tells you what's wrong (Obsidian unreachable, invalid API key, or the current tab isn't a ChatGPT conversation) — the "Open Settings" button appears when the fix involves the API key.

## Development

```bash
npm test   # run the lib/*.js unit tests with Node's built-in test runner
```

Pure logic (filename sanitizing, frontmatter building, conversation parsing, request building) lives in dependency-free `lib/*.js` files so it can be tested with plain Node, outside of Chrome.
