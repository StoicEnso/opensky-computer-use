# Contributing

OpenSky controls a real desktop. Useful contributions improve observable correctness, recovery, app compatibility, performance or clarity.

Use macOS 14+, Node.js 22+ and the Xcode Command Line Tools. Install development dependencies with `npm ci`, then run:

```sh
npm run build:native
npm test
npm run test:packaging
```

On your own Mac, grant the installed helper Accessibility and Screen Recording and run `npm run test:live`. This creates a disposable native app and checks the resulting controls and values. CI does not receive those permissions and cannot establish real app compatibility.

For an input change, test the actual target result. A generated event or animation alone is insufficient. Cover rejection of ambiguous/stale targets and stopping mid-operation when those paths change. Avoid automatically retrying input: repeated clicks can cause repeated side effects.

Keep desktop actions serialized. Stop/status must remain responsive, and resume must never revive previously cancelled requests. Preserve explicit errors when background control is unsupported. Add no implicit coordinate fallback for an invalid index.

Do not commit credentials, screenshots of personal apps, client configuration, or extracted third-party binaries/source. Public screenshots should use the disposable demo. Report the macOS version, app/version, execution mode and observable result for compatibility issues, with sensitive text removed.

Open a focused pull request explaining the user-visible change and relevant validation. The MIT license applies to contributions.
