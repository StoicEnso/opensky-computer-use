# Security model

OpenSky is a desktop-control service running as its Mac owner. It is not a sandbox for an untrusted model or MCP client. An authorized client can operate apps, read screenshots and request AppleScript/JXA. The connected agent remains responsible for obtaining the user's authority for consequential actions.

The native service binds IPv4 localhost and requires an owner-only bearer token for desktop state and control. Browser-origin requests are rejected. `/health` returns only product/version readiness. There is no remote-access or unauthenticated control mode. Never expose the service through a tunnel, reverse proxy or shared port.

The token, local captures and logs are stored under `~/.local/share/opensky` by default. Keep this directory private and outside shared folders. The token is not included in generated client configurations. Other processes running as the same user are outside this isolation boundary.

Emergency pause invalidates queued work and cooperatively interrupts in-progress actions. It cannot undo input already delivered to an app, terminate arbitrary descendants spawned by a script, or reverse an external side effect. Resume permits new work. Fresh observations and explicit result verification are still required.

Named pointer animations are visual feedback. They do not establish that an app accepted an event. Background support, protected system dialogs and secure input vary by app and macOS. Screen capture covers the primary display or a specific app window; it is not an implicit all-display recording service.

Local builds are ad-hoc signed. Rebuilding can invalidate macOS permission records. This repository does not bypass macOS consent, require code-signing impersonation, or connect to a private vendor's restricted helper.

For a suspected vulnerability, avoid placing secrets or a working exploit against someone else's Mac in a public issue. Use GitHub's private vulnerability reporting when enabled on this repository. Include a minimal reproduction using disposable data and the affected release.

## Browser extension transport

The optional MV3 extension requires Chrome debugger/tabs/native-messaging access. The registered native host accepts only the fixed OpenSky extension origin, reads the local token itself and connects to an owner-only Unix socket. The extension never receives the bearer token. HTTP requests require the token and exact loopback Host; browser Origin requests are rejected. Multiple connected profiles require an explicit observed profile ID. Task ownership and snapshot handles prevent accidental cross-workflow input; they are not an isolation boundary against other same-user code.

Uploads require explicit existing absolute regular-file paths (up to 20); selecting them may immediately send data to the target site. Page observations remain untrusted content. The public browser tools do not expose arbitrary JavaScript evaluation. Chrome can detach debugger control, and OpenSky requires explicit resume before reattaching a revoked task. Browser pause cancels queued generations and cooperatively checks ongoing turns. Native emergency pause is checked before mutations and polled during pending work; latency and already-delivered input remain limits. Do not represent this as an instantaneous cross-process kill switch.
