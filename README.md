# OpenSky

Open-source macOS computer use for agents, with native Accessibility inspection, screenshots and OCR, input actions, and animated virtual pointers. The same Swift service can be used through MCP, a command-line tool, or a JavaScript SDK.

OpenSky is an independent implementation using public macOS APIs. It does not call OpenAI's private computer-use service or bypass its client restrictions. Similar method names are a convenience; this project does not claim drop-in compatibility or better reliability than Codex.

![OpenSky's native animated pointer](artifacts/2026-10-17-opensky-pointer-demo-Codex.gif)

## Watch it control your Mac

After installation and permission setup, run `opensky demo`. A new disposable Mac window comes forward. OpenSky reads its controls, points at targets, clicks the counter three times, types English/Dhivehi/emoji and pastes a checklist. Each result is checked. The window stays open so you can inspect it; close it when finished.

`opensky demo --pointers-only` previews the visual effects without performing input. `opensky demo --quick` uses shorter presentation pauses. Stop at any time with **Control + Option + Command + Escape**.

## What is included

- App and window discovery; Accessibility trees with snapshot-scoped element indices.
- Window or desktop screenshots, with on-device Apple Vision text recognition.
- Clicks, typing, keys, scrolling, drags, clipboard paste, window actions, and requested AppleScript/JXA execution.
- A transparent pointer overlay with curved motion, click feedback, highlights, thinking animation, and named cursors.
- MCP over standard input/output, an agent-neutral CLI, and an importable Node.js SDK with TypeScript declarations.
- An authenticated loopback service, explicit pause/resume/shutdown, and permission diagnostics.

App support varies. Accessibility actions work best in apps that expose useful trees. Background input is best effort and some apps require focus. OCR gives text locations, not a complete semantic model of every canvas. Multiple virtual pointers do not make simultaneous keyboard or physical mouse actions safe.

## Requirements

- macOS 14 or later, Apple silicon or Intel.
- Node.js 22 or later.
- Xcode Command Line Tools with Swift 5.10 or later (`xcode-select --install` if absent).
- Accessibility and Screen Recording access granted by the Mac's owner. Apple Events permission may also be requested for scripts targeting other apps.

No model or paid API is bundled. The local engine is MIT licensed; any agent or model you connect has its own cost and terms.

## Install from source

Clone or download this repository, inspect it, then run:

```sh
git clone https://github.com/StoicEnso/opensky-computer-use.git
cd opensky-computer-use
./install.sh --dry-run
./install.sh
```

The installer always invokes a release build of current Swift source. It creates and verifies an ad-hoc signed `~/Applications/OpenSky.app` with the stable bundle identifier `dev.opensky.computeruse`, copies the JavaScript runtime to `~/.local/share/opensky`, and writes launchers to `~/.local/bin`.

Updates stop the existing helper before replacing its files. App, runtime, launcher and optional skill replacements are rolled back together if a replacement fails. Your token, captures and client configuration stay in place.

It does not modify agent configurations. Skill installation is optional:

```sh
./install.sh --skill codex
# Or: --skill claude, --skill all
```

Add `~/.local/bin` to your `PATH` if necessary. Run `opensky setup`, then:

```sh
opensky daemon
opensky rpc status '{"promptAX":true,"promptScreen":true}'
opensky doctor
```

In **System Settings → Privacy & Security**, allow OpenSky under **Accessibility** and **Screen & System Audio Recording** (called **Screen Recording** on some macOS versions). Request the initial recording prompt with `opensky rpc status '{"promptScreen":true}'`. Restart OpenSky after granting permissions. Ad-hoc signing preserves the bundle identifier but a rebuild can still require macOS permission to be granted again.

The installed app starts through macOS LaunchServices so permission checks belong to OpenSky itself. If a rebuilt app still reports no access while its switch is on, remove the old OpenSky entry from that permission list and add the current app again. Verify both permissions with `opensky doctor` after restarting it.

`opensky doctor` reports installation, connection, and permission status without starting the daemon. It exits unsuccessfully while required permissions or the daemon are missing.

Custom paths are supported with `./install.sh --prefix /path/to/prefix --app-dir /path/to/Applications`. `OPENSKY_HOME` overrides the runtime directory. Paths and existing unrelated configuration are preserved; the installer refuses to replace unrelated apps or launchers.

## Connect an agent

Print configuration for your client:

```sh
opensky config codex
opensky config claude-code
opensky config claude-desktop
opensky config cursor
```

These commands only print configuration. Merge it into the chosen client's MCP configuration, then restart or reconnect that client. Generated commands use absolute paths so a GUI application's limited `PATH` does not prevent Node from being found.

MCP clients can use `find_elements` to inspect controls by exact name, role or Accessibility identifier. The result includes current indices, source metadata and a snapshot ID. Multiple matches are explicit; refine the selector before acting.

For example, Codex uses:

```toml
[mcp_servers.opensky-computer-use]
command = "/Users/YOUR_USER/.local/bin/opensky-mcp"
args = []
```

Claude Desktop and Cursor use an MCP server entry such as:

```json
{
  "mcpServers": {
    "opensky-computer-use": {
      "command": "/Users/YOUR_USER/.local/bin/opensky-mcp",
      "args": []
    }
  }
}
```

Use the output of `opensky config` for your actual absolute path. Other MCP clients can start the same `opensky-mcp` launcher with standard input/output. The bundled [agent skill](skills/opensky-computer-use/SKILL.md) describes the inspect → act → verify workflow without depending on one model vendor.

## Select controls by name

Every observation now includes an `elements` array alongside the readable tree. The SDK supports exact selection without parsing tree text:

```js
import { createSession } from './src/index.mjs';

const session = createSession({ app: 'YOUR_APP_BUNDLE_ID' });
const save = await session.find({ role: 'button', name: 'Save' });
// After reviewing the target and authorizing the action:
await session.click({ role: 'button', name: 'Save' });
```

Use actual labels/identifiers from your app's current observation. `find` defaults to exact, case-insensitive AX names; OCR is opt-in. Ambiguous/disabled targets fail explicitly. `setValue(selector, text)` requires a writable control. `waitFor(selector, { timeoutMs: 5000 })` polls observations; it does not repeat input. Abort signals are checked between observations. A timed-out input request has an unknown delivery outcome and must be verified before submitting it again.

MCP bounds in-flight work to 64 requests and forwards it promptly to the single native action queue. The native queue accepts up to 64 pending requests and expires work after five seconds of waiting. Emergency stop invalidates their current generation. Resuming does not revive old queued actions. Physical desktop input remains serialized across clients.

## CLI

```sh
opensky status                           # Existing daemon; never starts one
opensky apps --running --json
opensky state Calculator --ocr --full
opensky click Calculator 12              # Use an index from the latest state
opensky click Calculator 500,400 --takeover
opensky set-value "Google Chrome" 5 "https://example.com"
opensky key "Google Chrome" Return
opensky screen --ocr --json
opensky cursor move 600,400 "OpenSky"
opensky cursor wiggle 2 "Thinking"
opensky demo                             # Verified control in a disposable window
```

Before using an element index, inspect the target app again after meaningful UI changes. Coordinates are global macOS screen points. Use `opensky help` for the full command list or `opensky rpc <method> '<JSON object>'` for native methods not given a shorthand. Pass `-` instead of the JSON object to read it from standard input.

Actions can start the daemon. `status`, `doctor`, `stop`, `resume`, and `shutdown` only contact an existing daemon.

```sh
opensky stop                 # Pause actions and dismiss pointers
opensky resume               # Explicitly allow actions again
opensky shutdown             # Terminate the service
```

Press **Control+Option+Command+Escape** for an emergency pause while the daemon is running. Captures are stored in `$OPENSKY_HOME/screenshots`.

Stopping the service cannot undo an action that an application has already received. Review consequential actions through your agent before it performs them.

## JavaScript SDK

```js
import { computer_use } from "opensky-computer-use";

const state = await computer_use.get_app_state({
  app: "Calculator",
  include_ocr: true
});
console.log(state.text);

await computer_use.click({
  app: "Calculator",
  element_index: 12,
  mode: "hybrid",
  cursor_id: "assistant",
  label: "Selecting a button"
});

await computer_use.cursor_dismiss({});
```

Inside a source checkout, import `./src/index.mjs`; after a local install, use the absolute `~/.local/share/opensky/src/index.mjs` path (expand `~` in your code). `hybrid` tries supported Accessibility actions and may use focus or input fallback. `background` requests background operation and cannot make every application accept background events. `takeover` deliberately operates through foreground input.

## Architecture and local access

```text
MCP client / CLI / JavaScript SDK
              │
      authenticated loopback RPC
              │
       OpenSky.app (Swift)
       ├─ Accessibility inspection and actions
       ├─ Screenshots and Vision OCR
       ├─ Input and window control
       └─ Animated pointer overlay
```

The service listens on `127.0.0.1:43821` by default and requires the local bearer token stored with owner-only permissions at `$OPENSKY_HOME/control-token`. The SDK supplies it automatically. Treat that token as permission to control the current desktop. The token is never placed in generated MCP configuration.

`OPENSKY_PORT` changes the local port; `OPENSKY_BINARY` selects a specific native executable. The installed launchers set the app path and runtime location. The SDK prefers the installed app, then the local build. Do not expose this control port through a proxy or remote tunnel.

## Develop and verify

```sh
npm run build:native
node scripts/build-app.mjs .build/OpenSky.app
npm test
npm run test:packaging
npm run test:live  # After permissions are enabled; uses only a disposable test window.
npm run test:live -- --ax-only  # Optional: check input before granting Screen Recording.
node src/cli.mjs help
```

Native builds use the `Native/` directory. Source changes require a rebuild; reinstalling rebuilds and replaces the app. Diagnostic and automated checks do not establish reliability across every app. A live check needs the relevant macOS permissions and a disposable target document or test app.

## Uninstall

```sh
opensky uninstall --dry-run
opensky uninstall
```

Alternatively, run `./install.sh --uninstall` with the same custom path options used for installation. Only recognized OpenSky app/code and managed launchers are removed. Local credentials, captures, optional skill files, and MCP client configurations remain so unrelated settings are not rewritten. Remove the OpenSky entry from your agent configuration manually, and delete retained data or the optional skill only if you no longer need them.

## License

[MIT](LICENSE). See [the investigation and verification notes](artifacts/2026-10-17-opensky-research-and-verification-Codex.txt) for evidence and limits. Private REA captures and proprietary reference code are excluded from distributions.
