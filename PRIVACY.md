# OpenSky data handling

Updated 17 October 2026 for runtime 1.7.0-rc.2 / native API 1.3.0 and UI build 1.3.4.

OpenSky is a local macOS control engine. The shipped engine and JavaScript runtime have no built-in telemetry, analytics, developer upload endpoint or OpenSky cloud relay. Native control uses authenticated loopback RPC; MCP communicates with the connected agent over standard input/output. Apple Vision OCR runs on the Mac.

Guided onboarding uses a short-lived loopback web page with an unpredictable setup path, same-origin action checks and a fixed list of setup actions. It exposes readiness and agent configuration, never the desktop-control token. Optional Chrome integration saves a local enabled/verified timestamp and returns tab metadata to the connected agent when requested; it is off until explicit setup.

The optional OpenSky Browser extension uses Chrome's debugger interface and a local native-messaging host. Its broker binds authenticated IPv4 loopback (43822 by default) and an owner-only Unix socket. It has no OpenSky remote relay. The extension stores a random profile ID and pause preference locally, and workflow tab ownership in Chrome session storage. Requested tab metadata, page text/control values (password field values are redacted), upload filenames and screenshots are returned to the connected agent. Upload bytes go to the selected website through normal Chrome requests. This is broad browser access; install it only in a profile you authorize the agent to use. Uninstalling the native host does not remove the extension from Chrome.

## What persists on your Mac

- Requested screenshots are written under `$OPENSKY_HOME/screenshots` (default `~/.local/share/opensky/screenshots`). The directory is owner-only and completed files use owner-only permissions. There is currently no automatic retention limit; captures remain until deleted.
- A local control token, installation manifest and daemon diagnostics persist under the same runtime directory. Never share the token. Diagnostic files are not a workflow transcript, but errors may include local paths or operational details.
- Owner-selected auto cooperation uses passive native event monitors while auto is selected, or briefly while native pointer feedback needs activity awareness, with existing Accessibility access. The activity callback reads event-source metadata to ignore tagged OpenSky events; it does not read typed characters, key codes or pointer coordinates. An owner-only `user-activity.json` contains aggregate idle duration, sample time and service identity, refreshed every 250 ms. It has no remote endpoint or history of input events. Unknown/software input counts conservatively as external. Outside auto mode, a short feedback lease removes the activity monitors after visual feedback ends. Native feedback reads window bounds and stacking metadata to avoid covered/focused areas; it does not capture a screen to compute the mask. Emergency pause remains independent.
- Explicit demos and tests can save their own local results. Agents may create task records, screenshots or exports outside the runtime directory.
- Normal app/browser effects persist according to those apps: edited documents, browser history, downloads, clipboard interactions, site accounts and form submissions.

To reduce capture storage, use targeted Accessibility queries or `get_app_state({app, include_screenshot:false, include_ocr:false})` when visual context is unnecessary. Delete captures after use when no client needs their file paths. Uninstall deliberately preserves captures, credentials and client settings; remove retained data separately when no longer needed. Backups and folders synced by other software may keep additional copies.

## What leaves the engine

OpenSky returns requested app text, control details and screenshot paths through the CLI/SDK. MCP can also return screenshot image bytes. The connected agent can therefore receive sensitive on-screen content and may send it to a model provider or retain it in logs/history according to its settings. Running OpenSky locally does not make the agent or model local.

Browser and app actions communicate with their normal services. Data entered into a website goes to that website. Requested scripts can also read, write or communicate as the Mac owner; they are not limited to loopback by this control transport.

## Compliance statements

These are product data-handling facts, not a GDPR certification or a claim that no data is stored or transferred. Compliance depends on the actual workflow, information processed, authority to process it, retention and connected providers. Local processing and reduced capture use can support data minimisation, but do not establish compliance on their own. See the [ICO's data protection by design and default guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-by-design-and-by-default/).

For the control access boundary, see [the security model](SECURITY.md).
