---
name: opensky-computer-use
description: Operate an installed OpenSky macOS computer-use service through MCP, CLI, or JavaScript. Use for app inspection, screenshots/OCR, Accessibility actions, controlled input, and animated pointers. Supports macOS 14+ with the owner's Accessibility and Screen Recording permissions.
---

# OpenSky computer use

OpenSky is an independent open-source macOS automation service. It exposes the same native engine through MCP, CLI, and a JavaScript SDK. App support and background event delivery vary; inspect actual results and do not promise universal control.

## Find the available interface

Prefer the connected OpenSky MCP tools when present. Otherwise use `opensky` on `PATH`. The installed SDK normally lives at `~/.local/share/opensky/src/index.mjs`; expand the home path before importing it. Do not assume a vendor-specific scratch directory.

Start with `opensky doctor` or `opensky status`. These commands do not start the daemon. If it is absent and computer use is authorized, run `opensky daemon`. For missing permissions, explain the exact macOS setting to enable; do not claim access before it is verified. `opensky setup` prints setup instructions. `opensky config <client>` prints MCP configuration without changing client files.

## Inspect → act → verify

1. Discover running apps with `list_apps` or `opensky apps --running`.
2. Prefer `find_elements` for a known accessible name/role/identifier, or `opensky find "App name" "Exact control name"`. Multiple matches must be resolved before input. Full observations include structured `elements` with source, identifier, writable/enabled state and frames. Inspect the target with `get_app_state({ app, include_ocr: true })` or `opensky state "App name" --ocr`. Read the Accessibility tree and inspect the returned screenshot when layout matters.
3. Use a current element index for a supported Accessibility action. Use `set_value` for a writable field. Use a screen point only when grounded in a fresh observation. Re-inspect after navigation or a meaningful layout change because indices can become stale.
4. Choose execution mode deliberately: `background` requests operation without global input; support depends on the app. `hybrid` may fall back to focus or input. `takeover` uses foreground input and can move the user's pointer or focus.
5. Verify the resulting state before taking another dependent action. A returned input event does not prove that an app accepted it.

For browser work, use the user's existing Google Chrome session by default. Preserve their session and tabs. If Chrome control is unavailable, report the concrete failure instead of silently changing browsers or asking for a different sign-in.

## Examples

```sh
opensky apps --running --json
opensky state Calculator --ocr --full
opensky click Calculator 12
opensky set-value "Google Chrome" 5 "https://example.com"
opensky key "Google Chrome" Return
opensky cursor move 600,400 "OpenSky"
opensky cursor dismiss
```

The example element indices are placeholders: obtain actual indices from the latest state. Quote app names, text, and JSON that contain spaces. Coordinates use global macOS screen points.

```js
import os from "node:os";
import { pathToFileURL } from "node:url";
const sdk = await import(pathToFileURL(`${os.homedir()}/.local/share/opensky/src/index.mjs`).href);
const state = await sdk.computer_use.get_app_state({ app: "Calculator", include_ocr: true });
console.log(state.text);
```

Use `opensky rpc <method> '<JSON object>'` for native features without CLI shorthand. Methods include `click`, `drag`, `scroll`, `type_text`, `press_key`, `paste`, `perform_secondary_action`, `select_text`, `manage_window`, `run_applescript`, `screenshot_screen`, and pointer methods. Use the connected MCP tool schemas or SDK declarations for parameter details.

## Pointers and recovery

Named virtual cursors can show intent with labels, a curved path, click feedback, and a thinking animation. An overlay animation does not prove action success. Keep pointer animations brief and dismiss them when done. Parallel cursor overlays do not make concurrent keyboard or physical mouse control safe; serialize actions to the same app or input device.

`Control+Option+Command+Escape` triggers an emergency pause while the service is running. `opensky stop` pauses actions and dismisses pointers. `opensky resume` is an explicit restart of actions. `opensky shutdown` terminates the service. These commands do not automatically launch it. A stop cannot undo an action already delivered to an app. Stop permanently cancels the current native and MCP request generations; resume accepts new work. Do not resubmit timed-out input until its outcome is verified.

The local access token is stored at `$OPENSKY_HOME/control-token` (default `~/.local/share/opensky/control-token`) with owner-only permissions. Never display it, copy it into prompts, or place it in client configurations. Respect the active agent's authorization rules for consequential actions; desktop access alone does not authorize unrelated changes, publishing, purchases, or messages.

## Live demonstration and semantic sessions

`opensky demo` brings forward a new disposable native window and verifies real clicks, Unicode typing and clipboard paste with animated pointers. `--pointers-only` previews effects without input. `--quick` shortens presentation pauses. The demo preserves its result locally and leaves the test window open.

The SDK exports `createSession({app})`. Use `session.find({name, role})`, `session.click(selector)` or `session.setValue({identifier}, value)` with actual observed labels. Selectors default to exact AX names and refuse ambiguity. `session.waitFor(selector, {timeoutMs})` retries observations only. Input actions are attempted once; no implicit input retry is safe.
