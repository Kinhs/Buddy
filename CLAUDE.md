# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Buddy is an always-on-top pixel desktop pet (Tauri v2, Linux + Windows) that mirrors what Claude Code / Codex is doing and lets the user answer Claude's questions and permission prompts from its bubble.

## Commands

```bash
npm start                      # tauri dev
npm test                       # node --test (tests/*.test.js) + cargo test
node --test tests/hook.test.js                     # one test file
node --test --test-name-pattern="permission deny" tests/hook.test.js  # one test by name
cargo test --manifest-path src-tauri/Cargo.toml rejects_only_browser_requests
cargo build --manifest-path src-tauri/Cargo.toml   # debug binary: src-tauri/target/debug/buddy
npm run build                  # installers in src-tauri/target/release/bundle/
npm run install-hooks          # merges hooks into ~/.claude/settings.json (real user config)
```

- Rust is in `~/.cargo/env`; `source` it first if `cargo` is missing.
- There is no bundler: `src/` is served as-is (`frontendDist: ../src`, `withGlobalTauri`), but the app **embeds `src/` at compile time**. After editing anything in `src/` (JS, HTML, PNGs), rebuild before running the binary.

## Architecture

Data flow: agent hook → `hooks/buddy-hook.js` → HTTP `127.0.0.1:47321` → Rust (`src-tauri/src/lib.rs`) → Tauri events → `src/renderer.js`.

- **Hook (`hooks/buddy-hook.js`)**: runs for every Claude Code hook event (stdin JSON) and for Codex `notify` (JSON as last argv). It must never break the agent: on any failure it exits 0 with no stdout. The only stdout it may print is a valid `hookSpecificOutput` (PreToolUse `allow` + `updatedInput.answers` for `AskUserQuestion`, PermissionRequest `decision.behavior`). `tests/hook.test.js` pins this contract against a fake Buddy.
- **Bridge (`lib.rs`)**: `tiny_http` on a background thread. `POST /event` → emits `event`. `POST /ask` keeps the HTTP request open in `Pending` until the renderer calls the `answer` command, or `ASK_TIMEOUT` (5 min, must stay below the hook's 330 s `timeout` in `install-hooks.js`). An empty answer `{}` means "use the terminal UI". Requests with an `Origin` header are rejected (stops web pages from injecting prompts). Also owns the system notifications (on/off persisted as the marker file `notifications-off` in the app config dir), the name-tag popup menu (skin + notifications + quit), and `resize`.
- **Front end**: `src/bridge.js` is the only Tauri-specific file; it defines `window.buddy` (`onEvent/onAsk/onAskClosed/onSkin/answer/resize/menu`). `src/sessions.js` tracks busy session ids, so one session finishing doesn't end another's "working" (also a CommonJS module for tests). `src/renderer.js` holds the mood state machine (`idle | working | done | waiting | asking | error | sleep`), the ask panel and the drawing.
  - `since` resets on every event (mood decay: done→idle 20 s, idle→sleep 3 min, error→working 5 s); `entered` resets only when the state changes (Susanoo long-task stages, done intro timing).
  - Skins: `blob` is drawn in code (16×16). Pose skins live in `SKINS` (currently only `akatsuki`). Each has `poses` (PNGs in `src/skins/<name>/`), `timelines` (looped `[pose, ms]` lists, or `{ intro, loop }`), `tools` (tool name → timeline) and `pick(now)` (state → timeline key). A step named `'pose>land'` / `'pose>leave'` draws that pose plus the crow sprite flying to or from `PERCH`.
  - Pose frames are full 80×90 cells drawn at (0,0): new frames must be 80×90 with the feet on row 88, or poses jump when they swap. `AK_CALM` lists held frames that get the 1 px breathing bob.
  - Drawing goes to an offscreen 1:1 `art` canvas; `blit()` copies it to `#sprite` at a whole number of device pixels per art pixel with smoothing off. Don't rely on CSS `image-rendering: pixelated`: WebKitGTK smooths CSS-upscaled canvases (Buddy looked blurry on a 125%-scaled GNOME screen).
  - `fit()` sizes the window to its content (resize anchored bottom-right, so transparent space doesn't block clicks). `resizable` must stay `true` in `tauri.conf.json`: with `false`, GTK locks the window size.
- **Linux**: `run()` forces `GDK_BACKEND=x11`, because GNOME Wayland ignores always-on-top for native Wayland windows.

## Testing UI changes

Screenshots of the Tauri window aren't available on Wayland here. To verify rendering, serve a copy of `src/` with a stub `bridge.js` that implements the same `window.buddy` API (plus a way to fire `event` / `ask` / `skin` callbacks), open it in a browser, drive states, and read `sprite.toDataURL()` frames. For the live app, POST events with curl:

```bash
curl -d '{"kind":"done","agent":"Claude","project":"Buddy","message":"test"}' 127.0.0.1:47321/event
```

## Notes

- The Itachi art is fan art derived from Naruto: personal use only. Don't ship public builds with it.
- `previews/` (generated GIFs/PNGs) is git-ignored on purpose.
