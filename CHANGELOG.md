# Changelog

## 1.7.0 — 24 October 2026

- Promote the tested cooperation update to stable with the exact frozen native 1.4.5 binaries; no new native build or signature change from rc.16.
- Auto yields running and queued desktop actions when the owner returns, retains supported background work and notifies connected MCP clients on both mode transitions. Availability does not replay partial input or resume emergency pause.
- Include the verified stop-contract timing correction. Standard MCP log notifications may not wake every host; bounded waits, action-result cooperation and SDK/CLI subscriptions remain available.

## 1.7.0-rc.16 — 24 October 2026

- Native 1.4.5 interrupts running and queued shared-input work when auto detects owner activity, even within the same app. Background AX and browser work remain available. Explicit bounded overrides remain effective until expiry. Partial input is never replayed and availability never resumes emergency pause.
- Emit content-free MCP cooperation log notifications on both mode transitions, include current cooperation on action results, and add `wait_for_mode`, SDK subscriptions and `opensky mode --watch`. Hosts may display logs without waking an agent.
- Align the pointer renderer with the 120-second default, propagate yield state across own-app AX calls, and cover real script interruption, queue races, multiple generic clients, watch cleanup and pause preservation.

## 1.7.0-rc.15 — 19 October 2026

- Simplify native UI 1.4.4 to the original compact cloud: relaxed eyes for alongside/background control, open eyes for desktop control, pause bars when stopped and a neutral waiting face for unreadable mode data. Auto, manual and temporary policies share the same behavior face.
- Remove Auto/clock/secondary-glyph badges, restore the square status-item footprint and mirror the expression in the popover header. Keep current behavior and temporary-turn explanations in plain words; saved/effective metadata and scheduling are unchanged.
- Validate light/dark true-size expressions, policy-equivalent artwork, pause precedence, popover sizing and passive native-service mode changes. Update GitHub screenshots and guidance to the simpler scheme.

## 1.7.0-rc.14 — 19 October 2026

- Native UI 1.4.3 keeps the cloud and adds fixed-width template mode marks: split windows for Alongside, pointer for Desktop, A for Auto and a clock for temporary turns. Tooltips and accessibility labels report saved/effective policy and pause.
- Add a prominent read-only mode card with the actual two-minute Auto state, temporary override, unavailable activity and permission explanations. Update mode while the panel is closed without polling client statistics or observing app content.
- Validate mode projection against fresh/live/private aggregate activity, the exact threshold, invalid data, override expiry and pause. Add light/dark true-size icon strips, six panel fixtures and passive live-service transition checks.
- Reposition the GitHub introduction and launch copy around “Build like you have a team,” with the one-command install near the top and concrete bring-your-own-agent capabilities.

## 1.7.0-rc.13 — 19 October 2026

- Fix the browser bridge repeatedly cancelling fresh observations during native tray pause. Cancel existing requests once per native pause transition; retain the stop gate on mutations.
- Propagate a verified native resume to the browser worker while preserving a separate SDK/extension pause. A missing native status never counts as a resume.
- Native UI 1.4.2 gives the activity panel keyboard focus, fixes Escape/outside-click dismissal and reads the actual click-event modifier for the Option menu. Expose own tray/panel geometry for precise multi-display targeting. Runtime-only installation still preserves a compatible approved native app.
- Validate the installed native panel with two real MCP clients, real panel growth/shrinkage, pause and background Chrome actions. Add an explicit bounded desktop-turn option to the opt-in live Inspector test.
- Sharpen the GitHub introduction around “Stop being your AI’s hands” and add founder/operator positioning and launch copy with evidence-bounded product claims.

## 1.7.0-rc.12 — 19 October 2026

- Fix native UI 1.4.1 activity panel sizing: fit the hosting view before presentation and resize after client rows arrive or disappear. An offscreen image alone missed the zero initial popover size.
- Add a regression check against the actual NSPopover/NSHostingController container for initial sizing and growth/shrinkage, and run native UI checks in the default test suite/CI. Runtime counters are unchanged.

## 1.7.0-rc.11 — 19 October 2026

- Native UI 1.4.0: click or right-click the cloud for a light/dark activity panel with working/recent client rows, daily calls, average response timing, deferred/unsuccessful calls and a fifteen-minute graph. Option-click retains the command menu. Inspector and pause controls remain available.
- Add content-free, owner-only local counters for instrumented MCP, CLI and SDK requests. Distinguish client connections from agent tasks; expire stale/dead clients, exclude administrative polling and expose the same passive summary through MCP `agent_activity`, CLI `agents` and JavaScript.
- Existing clients need reconnecting to report activity. Runtime-only updates preserve the approved native helper; the new tray panel needs a full native upgrade and may require renewed macOS consent.

## 1.7.0-rc.10 — 18 October 2026

- Set the default auto-cooperation idle wait to two minutes (120 seconds). Keep explicit temporary desktop overrides, activity yielding and emergency pause unchanged.
- Update MCP descriptions, operating guidance, bundled skills and the Inspector test to use the new threshold.

## 1.7.0-rc.9 — 18 October 2026

- Fresh-Mac HTTPS bootstrap: verified prebuilt app, private pinned Node, official Claude installation and native MCP setup without Xcode/Homebrew/sudo.
- Resumable Terminal onboarding checks all three actual macOS access flags and preserves emergency pause.
- Identical downloaded native apps reuse existing consent and process; invalid apps fail before replacement.
- Owner-directed desktop turns can expire back to the saved cooperation mode.

## 1.7.0-rc.8 — 2026-10-18

- Add `opensky connect claude` and `./install.sh --claude` for combined Claude Code registration, skill installation and preconfigured native Desktop setup. Reuse connections and pending bundles, preserve unrelated settings, keep one-time native review visible, and defer opening over owner activity. Preserve a matching native API/UI build rather than rebuilding it.
- Avoid an unexpanded `${HOME}` directory default that blocked the actual Desktop configuration form. The public bundle now uses an optional custom path; locally prepared bundles embed the already-known runtime path.

- Add a native Claude Desktop MCPB extension with the cloud icon, normal extension configuration and discovery of OpenSky's current tools. Reuse the existing managed runtime and native app, including its permissions, stop state, Chrome connection and saved cooperation policy. No native rebuild is needed.
- Support custom runtime directories and fail clearly when the existing installation is missing, without creating credentials or starting the engine during connection. Ship the extension adapter with runtime updates and provide a bundle builder.
- Report the real package version during MCP initialization instead of stale release metadata.
- Verify the packaged file set, a real MCP handshake through an installation path containing spaces and Unicode, tool/guidance discovery, missing-install recovery and no engine startup. Document native Claude Code user-scope registration and the bundled skill.

## 1.7.0-rc.7 — 2026-10-18

- Add a standard responder-chain Edit menu for native windows. The real Inspector test found Command+A left the old query intact and the next query appended; Select All, Cut, Copy, Paste, Undo and Redo now have normal Mac key equivalents.
- Verify Command+A selects a complete Unicode value in an offscreen editor without clipboard input or foreground activation.
- Read the native version shown in About from the actual bundle metadata.
- Complete installed native 1.3.9 physical Inspector selection, successive searches, Unicode/role/identifier filters, empty results, clearing and row-details checks after an independent LaunchServices start. Preserve the five-minute auto rule, prior foreground, native permissions, stop state and existing Chrome connection.

## 1.7.0-rc.6 — 2026-10-18

- Retire invalid idle-listener ports and recreate listeners after failed re-enabling, with a bounded reconnect cadence. Recovery starts a fresh monitored interval and never resumes stopped control or inherits desktop availability.
- Add an opt-in regression that invalidates a disposable real listener using the production tracker. The previous source fails this case; the fixed tracker reconnects without posting input or requesting access.
- Expose a small, validated set of monitor states in passive diagnostics. Record local writer/parent process IDs with cooperation changes to help diagnose overlapping clients; preserve the actual saved mode.
- Bound the live test's observation-only readiness wait, retain search-value/footer diagnostics, and stop when the native app reopens or the saved cooperation preference changes. Check fixture runtime, port and binary isolation before UI-service tests send any request.

## 1.7.0-rc.5 — 2026-10-18

- Fix a live Inspector crash: own Accessibility reads could lazily create AppKit result rows on the RPC worker thread. Route own snapshots and target revalidation to the main thread before taking the cache lock; route own attribute and hit-test reads there too. Preserve operation generations and observations while paused.
- Refuse own-control observations and input on native builds before 1.3.7, where the crash remains possible. Other applications and passive Inspector lifecycle controls remain available.
- Wait for the selected window's Inspect button to become enabled before the live test continues. Always clean up the disposable fixture even when Inspector closure is unavailable after a service failure.
- Verify normal macOS permission-entry replacement through an approved OpenSky helper under the owner's specific setup authority. Independently verify the updated app after a normal LaunchServices start; temporary inherited access does not establish the app's own consent.

## 1.7.0-rc.4 — 2026-10-18

- Observe opted-in activity through a read-only Quartz event tap. Live diagnostics found tagged OpenSky input in Quartz while the AppKit-based idle record subsequently restarted. Keep unknown events external, retain the general OS-idle cross-check, and start a fresh idle interval whenever monitoring starts or recovers. An unavailable monitor stays alongside; no permission is requested automatically.
- Give the Inspector window picker a stable AppKit control and cancel its menu tracking on close/teardown. A real hit diagnostic found a menu ancestry that did not match the current picker before, during or after pointer feedback. Keep expected-control checks intact.
- Report separate click interruption, coverage, control-change and event-creation failures. Distinguish failures before a button event from interruption after delivery; never retry uncertain input automatically.
- Add offscreen selection/binding/control-identity checks and precise live-test stage/activity diagnostics. Record installed permissions, isolated probe results and unfinished physical search/filter tests separately.

## 1.7.0-rc.3 — 2026-10-18

- Activate the own accessory app on the main thread and raise its pinned key-capable window with cancellation checks.
- Report macOS event-synthesizing readiness separately from AX access. Missing real OS event-posting access now fails before CG input; background AX remains available. Permission requests remain explicit setup actions, never ordinary input side effects.
- Recreate the Inspector on reopen without ordering animations, report passive rendered-frame readiness, and preserve an already-open Inspector on repeated show requests.
- Bound Accessibility inspection with a cancellable read budget and temporary per-element messaging timeouts; clear incomplete snapshot handles and retain default timeouts for action targets. Keep passive Inspector status/close and pointer status/dismiss responsive independently of a busy action queue.
- Fix physical own-menu hit testing: actual Inspector popup menu items may extend outside its normal window. Accept verified own menu ancestry while retaining process identity, expected-control and pointer-overlay checks.
- Add an opt-in disposable Inspector search/filter/selection check that preserves auto cooperation, waits for 300 external idle seconds and rechecks before each shared-input step. Its explicit AX menu-choice option supports testing the rest of the UI on earlier helpers.
- Record installed versus candidate behavior and genuine interruptions separately; never report an interrupted run as a passed filter check.

## 1.7.0-rc.2 — 2026-10-17

- Replace screen-saver-level, all-Spaces cursor planes with normal-level, exact-window feedback. Show exposed background work while the owner types elsewhere; clip normal occluders and protect the focused owner window. Higher system layers remain above feedback through WindowServer ordering.
- Bind automatic feedback to its observed app/window. Add explicit app/window scope and passive pointer status through the existing MCP choreography tool, CLI and SDK. Status/dismiss remain available for recovery without launching or resuming control.
- Shorten idle feedback, hide empty planes, stop the idle animation timer, and cancel delayed feedback after dismissal. Ignore screen-parameter notifications that do not change display geometry. Exclude known feedback windows from app inventory and input hit testing.
- Refresh tray permission metadata when Inspector status is read. Passive pointer activity monitoring outside auto mode is limited to a short feedback lease and stores aggregate metadata only.
- Add real disposable-window stacking/occlusion/recovery checks plus pixel-level mask tests at primary and secondary-display origins. Preserve existing native input, cooperation, stop and browser boundaries.

## 1.7.0-rc.1 — 2026-10-17

- Add owner-selected `opensky mode auto` across MCP, CLI and JavaScript. It permits desktop turns after 300 seconds of external-input inactivity and returns to alongside restrictions on the next request after activity, including a recheck after native startup. Missing activity data stays alongside; emergency pause and task authority remain independent.
- Add `user_activity` / `opensky activity`. Native build 1.3.3 uses opt-in passive monitors and owner-only aggregate metadata, filters tagged OpenSky input, and treats unknown/software input conservatively as external. No typed characters or pointer coordinates are retained. Update initialization guidance and the bundled skill to preserve the owner's saved auto policy and avoid repeated availability questions after its threshold.
- Add actual native executable-path diagnostics to `opensky doctor` and the UI-service test. This catches macOS reopening a registered staging copy despite a matching app version.
- Keep a deliberate setup readiness recheck queued behind an in-flight passive read, so an earlier success cannot swallow the user's fresh check.
- Add a loaded-worker version and explicit Reload extension control to OpenSky Browser status. Reads never reload; maintenance preserves Chrome and requires fresh tab observation afterward.
- Browser extension 1.5.3 verifies exact field focus after a renderer task before sending a key. It rejects unconfirmed focus before input and retains focus-emulation cleanup; key delivery still requires outcome verification.
- Verify the installed cloud tray/Inspector build 1.3.2 under its own macOS permissions, then fix the real self-control crash it exposed: own AX actions/writes move to the main thread with their original stop generation. Runtime clients reject self-directed AX input on older builds.
- Include the Inspector in normal-window hit testing and isolate offscreen preview execution from production app registration. Build 1.3.3 is staged for a full native upgrade; exact installation/live-test scope is recorded in the dated results.

## 1.6.1 — 2026-10-17

- Add `opensky inspector status|show|close`. Show opens the app-owned Inspector behind other apps and returns its exact native window ID. Status and close never launch a missing engine.
- Keep explicit activation deferred in alongside mode. Validate Inspector actions and boolean arguments, and report a clear native upgrade requirement for older helpers.
- Show “Desktop permissions needed” in the tray when native access is missing, instead of announcing readiness during a consent handoff.
- Add a live UI-service check using a disposable app identity and temporary local runtime: tray template, paused accessibility label, background Inspector opening, validation and closing while paused. It requests no permissions and does not establish the installed app's consent or third-party-window inspection.
- Validate a real native upgrade and recovery: macOS required fresh Accessibility/Screen Recording consent for the changed ad-hoc signature, so the working app was restored with its original permissions, private settings and browser connection. Completing that machine's upgrade awaits the owner's system-setting handoff.

## 1.6.0 — 2026-10-17

- Give OpenSky an original cloud companion app icon and a compact, appearance-aware menu-bar template. Eyes change to pause bars when control stops; accessible labels retain the app name and state.
- Add a native, read-only Inspector with exact-window selection, searchable controls and element details. Use a separate AX cache, reject superseded results, and clear observations on close. Inspection never launches an app, captures a screenshot, sends input or changes the clipboard.
- Add passive permission status, Setup & Connections and About to the tray. Menu opening never requests consent or resumes control.
- Native UI build 1.3.1 retains API 1.3.0 compatibility. Existing runtime-only updates preserve the running helper; the new tray and Inspector require a full native app upgrade.

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
