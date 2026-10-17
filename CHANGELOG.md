# Changelog

## 1.5.3 — 2026-10-17

- Separate local host registration, waiting for Chrome, verified connection and paused control in onboarding. Confirm a new connection with passive readiness checks and hide finished installation steps.
- Add explicit Copy folder path and Show in Finder controls to help select the hidden extension folder. Readiness checks never copy, reveal, install, restart or resume anything.
- Clear stale readiness and disable the native demo if a status check fails. Keep the native app and the unchanged 1.5.2 browser worker running; this update needs no extension reload.

## 1.5.2 — 2026-10-17

- Reproduce regular Chrome acknowledging inactive-tab mouse and keyboard events without delivering them, despite successful headless checks.
- Temporarily emulate focus in the exact renderer for trusted clicks and keys, then disable it in a cleanup scope, including cancellation and target errors. Keep Chrome's selected tabs, the physical pointer and clipboard unchanged.
- Verify real uploads from a root page and cross-origin frame in the owner's existing Chrome profile, with local server byte checks, independent inactive tabs and a trusted Enter key. Preserve the native app, process, permissions, stop state and alongside mode.
- Wait for disposable test documents and descendant frames to finish loading before binding action snapshots; retain navigation invalidation and no automatic input retries.

## 1.5.1 — 2026-10-17

- Reproduce an embedded upload button refusing the previous synthetic child-frame click.
- Route trusted clicks to the exact renderer target using content quads and verified hit testing; account for document scroll offsets and refuse covered controls before input.
- Verify file bytes from four activation-gated uploads across cross-origin, same-process, nested and scaled iframe fixtures. Preserve the selected tab, native permissions and no-retry behavior.

## 1.5.0 — 2026-10-17

- Add OpenSky’s own MV3 Chrome extension, native host and authenticated local broker, independent of Codex browser tools and Apple Events.
- Add ten MCP/SDK browser tools plus `opensky web`: inactive task tabs, frame-scoped snapshots, direct fields, clicks, keys, select controls, screenshots and explicit file uploads through intercepted choosers.
- Persist workflow ownership, serialize per-tab turns, reject stale targets and ambiguous profiles, and retain pause/detach handling without automatic input retries.
- Keep extension installation explicit and preserve the native 1.3.0 app, permissions and running state during runtime updates.
- Verify an isolated real Chrome workflow with overlapping inactive tabs, cross-origin frame input, trusted clicks, Unicode upload receipt, multiple files, screenshots and cancellation. Signed-in owner-profile verification requires the one-time extension load.

## 1.4.2 — 2026-10-17

- Add `computer_use.find_elements` to the JavaScript SDK, fixing a real workflow's attempt to use the MCP discovery method through the SDK. MCP, CLI and SDK now share selector validation, exact-window observations and snapshot-scoped results, without screenshots or input.
- Handle subcommand help such as `opensky find --help` before any app lookup or engine startup.
- Preserve alongside mode and the native helper through a runtime-only update.

## 1.4.1 — 2026-10-17

- Add persistent alongside/desktop cooperation mode shared by current-runtime MCP, CLI and SDK calls, checked before daemon startup or input. Alongside keeps exact-window background AX actions available and defers shared-input methods with actionable checkpoint guidance instead of permission questions.
- Live benchmark review found repeated foreground/takeover input and focus interruptions, with no new approval questions. Tighten guidance to continue independent work while shared-input steps wait; process-targeted keys do not isolate Chrome's keyboard focus.
- Preserve the native app, permissions and process through a runtime-only update. Existing MCP processes need reconnecting or the updated CLI/SDK to use the new mode; direct native callers are outside its scope.

## 1.4.0 — 17 October 2026

- Add local guided onboarding with passive readiness checks, owner-chosen OS settings, agent configuration and a verified demo. Add a double-click source installer, app icon and original repository cover.
- Strengthen MCP/skill guidance around continuing authorized task intent across frames and steps, skipping optional out-of-scope requests, and distinguishing host questions from OS consent.
- Describe parallel workflows with owned windows/tabs and overlapping waits while native input and Chrome AX interaction turns remain serialized.
- Add optional Chrome tab lifecycle control through MCP, CLI and SDK, using exact public scripting IDs. Keep it off until explicit setup so routine discovery cannot trigger a permission prompt. Live Apple Events verification remains pending OS setup; native AX remains the default working path.
- Verify a two-tab native Chrome workflow with overlapping loads and independent field values, plus a fresh-agent live trial completed without extra questions and an independent five-scenario authorization review.
- Keep compatibility with native engine 1.3.0 and runtime-only installation; full installs include the new native app icon.

## 1.3.1 — 17 October 2026

- Announce default auto workflow guidance in MCP initialization and expose it through a read-only MCP tool, CLI command and SDK helper.
- Carry task authority and user constraints forward without adding OpenSky-specific per-action prompts; preserve applicable host/tool rules according to their actual scope.
- Verify guidance can be read without launching or resuming the native engine.
- Complete one public reCAPTCHA v2 checkbox flow and verify server-side success through OpenSky in Chrome; no image puzzle was presented.
- Keep compatibility with the existing 1.3.0 native engine; this is a JavaScript/guidance patch.
- Add a transactional `--runtime-only` update that checks native compatibility and signature while preserving the helper's files, running state and permissions.
- Prefer fast, local-first native control in agent guidance, document on-device OCR and the absence of built-in telemetry/cloud relay, and disclose local capture retention and the connected agent's data boundary.

## 1.3.0 — 17 October 2026

- Add exact `window_id` inspection and pinned semantic sessions. A missing or ambiguous window fails explicitly; background action observations retain the selected window.
- Make low-level field setting AX-only by default. Foreground fallback requires explicit hybrid/takeover mode, and session field writes inherit the selected mode.
- Add Antigravity configuration output and Cursor's explicit stdio transport field.
- Document delegated task authority, background limitations and cross-agent setup without adding content-based driver gates.
- Add live read-only field and two-window background regression checks, plus session and transport validation.

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
