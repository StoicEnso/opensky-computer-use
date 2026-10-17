# Changelog

## After 1.2.0 — 17 October 2026

- Tested a real Chrome → Finder → TextEdit workflow: read the public release page, create a folder, type and paste Unicode, save as UTF-8, close and reopen from Finder, then compare exact contents.
- Fixed SDK import in embedded Node hosts that hide the `process` global.
- Expose visible native menu commands while excluding collapsed-menu descendants.
- Retry only transient post-action observations during window/sheet transitions; never replay delivered input or relaunch an app during action verification.
- Explicitly focus a windowless app through its normal LaunchServices reopen event.
- Wait for target point ownership after app activation, verify requested window geometry, and finish positioning after cross-display resizing.
- Keep successful CLI actions successful when only their follow-up screenshot is unavailable; report that condition as an observation warning.
- Added embedded-SDK and CLI regression tests, plus live menu and quit-without-relaunch checks.

## 1.2.0 — 17 October 2026

- Added structured Accessibility/OCR controls with labels, identifiers, frames, enabled/writable state, actions and snapshot bindings.
- Added `createSession`, exact semantic selectors, explicit ambiguity errors and bounded observation polling. Input is never automatically retried.
- Added the `find_elements` MCP tool and `opensky find` command.
- Replaced the default pointer-only demo with `opensky demo`: a disposable native window, real clicks, Unicode typing, clipboard paste and verified results. `--pointers-only` retains the animation preview.
- Emergency stop permanently cancels the current native generation and pending local MCP dispatch. MCP forwards work to one authoritative native action queue, so another client or the hotkey can cancel that backlog too. Resume accepts newly submitted work; old queued requests stay cancelled.
- Bounded queues and expired requests prevent an unlimited backlog of delayed desktop input.
- Added transactional installation rollback for the app, runtime, launchers and optional skills.
- Bounded named pointer retention, expired abandoned thinking animations, cancelled delayed visual feedback after stop, cached wallpaper bitmap decoding and synchronized the menu-bar stop indicator.
- Expanded real native/MCP, semantic selection, installation recovery and live macOS checks.

## 1.1.0 — 17 October 2026

- Preserved the existing local OpenSky prototype, then rebuilt its transport, targeting, installation and verification paths.
- Added authenticated loopback control, explicit error handling, generation-scoped snapshot indices, target revalidation and emergency pause.
- Added portable CLI/MCP/SDK packaging, model-neutral skills and an installer with permission diagnostics.
- Fixed separate-display pointer overlays, Unicode modifier handling and Markdown paste.
- Verified the installed helper's own Accessibility and Screen Recording permissions through LaunchServices startup.

## Provenance

OpenSky started as the owner's local Antigravity prototype. It is an independent implementation using public macOS APIs. The owner's isolated local checkout preserves that starting point and subsequent changes. The public repository begins with a reviewed 1.2 snapshot because older setup notes included machine-specific paths. No OpenAI private-service implementation or extracted proprietary package content is distributed. Similar names and visual behaviors do not establish drop-in compatibility or benchmark superiority.
