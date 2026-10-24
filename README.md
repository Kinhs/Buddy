# Buddy

A pixel desktop buddy that mirrors your AI coding agent. It always stays on top of other windows and runs on Windows and Linux (Tauri v2).

| Agent state | Buddy |
|---|---|
| Prompt sent / tool running | **working**: bubble shows the tool (`Running npm test`); the pose depends on the tool |
| Tool failed / API error | **error**: `×`, back to working after 5 s |
| Turn finished (`Stop`) | **done**: celebration + OS notification, then chills after 20 s. With several sessions, Buddy stays "working" until the last one finishes |
| Waiting for you (`Notification`) | **waiting**: `!` |
| `AskUserQuestion` / permission prompt | **asking**: `?` + clickable answers / Allow-Deny |
| Nothing for 3 min | **sleep**: `zZ` |

## Prerequisites

- Node.js 18+ and Rust (https://rustup.rs)
- Linux: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
- Windows: Microsoft C++ Build Tools ("Desktop development with C++"). WebView2 ships with Windows 10/11.

## Run

```bash
npm install
npm start
npm run build
npm run install-hooks
```

- `npm start` runs the dev build.
- `npm run build` creates installers in `src-tauri/target/release/bundle/` (`.deb`/`.AppImage` on Linux, `.msi`/`.exe` on Windows; build each on its own OS).
- `install-hooks` merges hooks into `~/.claude/settings.json`. The first run saves the original as `settings.json.bak`; later runs never overwrite it. Restart Claude Code sessions afterwards.

Drag Buddy to move it. Click the name tag for the menu:
- **Skin**: Clay blob or Itachi (Akatsuki). Remembered across restarts.
- **System notifications**: on/off. Buddy's own animations still show everything.
- **Quit**.

Run the tests with `npm test` (Node hook/installer/session tests + Rust tests).

### Answering from Buddy

When Claude asks a question or needs a permission, the terminal waits while Buddy shows the choices.
- Click an answer: it goes straight back to Claude.
- **Terminal**: hands the prompt back to the normal terminal UI.
- Buddy not running, or no answer within 5 min: the terminal UI is used as usual.

### Codex

Codex only reports finished turns. Add to `~/.codex/config.toml`:

```toml
notify = ["node", "/absolute/path/to/Buddy/hooks/buddy-hook.js"]
```

## Notes

- **Linux Wayland (GNOME)**: Buddy sets `GDK_BACKEND=x11` itself (runs through XWayland) because GNOME ignores always-on-top for native Wayland windows.
- Port: `127.0.0.1:47321`, override with `BUDDY_PORT` (set it for both the app and the hooks).
- Requests carrying an `Origin` header (i.e. from a web page) are rejected, so websites can't push fake prompts.
- Every Claude tool call runs `hooks/buddy-hook.js` once (~50 ms node startup).

## Files

- `src-tauri/src/lib.rs`: window + local HTTP bridge (`POST /event`, `POST /ask` holds until you answer), notifications, menu
- `src/index.html`, `src/renderer.js`: sprites, moods, answer panel; `src/bridge.js`: Tauri IPC glue; `src/sessions.js`: which sessions are busy
- `src/skins/`: pose PNGs for the Itachi skins
- `tests/`: `npm test`
- `hooks/buddy-hook.js`: Claude Code hook / Codex notify adapter, never fails the agent
- `scripts/install-hooks.js`: adds the hooks to Claude settings
