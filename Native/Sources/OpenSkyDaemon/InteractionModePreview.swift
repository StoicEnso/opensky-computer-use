import AppKit

/// Deterministic runtime-parity cases and true-size icons; never reads owner state.
func checkInteractionModeDisplay(to directory: URL, save: (NSView, String) throws -> Void) throws {
    let now = 1000000.0
    let auto: [String: Any] = ["mode": "alongside", "cooperation_policy": "auto"]
    var activity: [String: Any] = ["schema": 1, "pid": 42, "own_input_filtered": true, "input_contents_recorded": false,
        "monitor_ready": true, "sampled_at_ms": now, "external_idle_seconds": 119.999, "observed_for_seconds": 200]
    func resolve(_ config: [String: Any]? = auto, _ data: [String: Any]? = nil, at: Double = now, alive: Bool = true) -> InteractionModeDisplay {
        InteractionModeDisplay.resolve(config: config, activity: data, now: at, isAlive: { _ in alive })
    }
    let active = resolve(auto, activity)
    precondition(active.automatic && active.effective == .alongside && active.reason == .ownerActive)
    activity["external_idle_seconds"] = 120.0
    let idle = resolve(auto, activity)
    precondition(idle.effective == .desktop && idle.reason == .idle)
    precondition(resolve(["mode": "auto"], activity) == idle)
    precondition(resolve(auto, activity, at: now + 1500).effective == .desktop)
    precondition(resolve(auto, activity, at: now + 1501).reason == .unavailable)
    precondition(resolve(auto, activity, at: now - 1).reason == .unavailable)
    precondition(resolve(auto, activity, alive: false).effective == .alongside)
    precondition(resolve(auto).reason == .unavailable)
    for (key, value) in [("monitor_ready", false as Any), ("schema", true), ("pid", 0), ("pid", 1.5),
                         ("external_idle_seconds", -1), ("observed_for_seconds", 119), ("own_input_filtered", 1), ("input_contents_recorded", 0)] {
        var invalid = activity; invalid[key] = value
        precondition(resolve(auto, invalid).reason == .unavailable, "Malformed \(key) cannot permit desktop")
    }
    let manualDesktop = resolve(["mode": "desktop", "cooperation_policy": "auto"])
    let alongside = resolve(["mode": "alongside"])
    precondition(manualDesktop.policy == .desktop && manualDesktop.effective == .desktop && !manualDesktop.automatic)
    precondition(alongside.effective == .alongside && !alongside.automatic)
    var override = auto; override["desktop_override_until"] = now + 1000
    let temporary = resolve(override)
    precondition(temporary.policy == .auto && temporary.effective == .desktop && temporary.reason == .temporary)
    precondition(resolve(override, nil, at: now + 1000).reason == .unavailable)
    override["desktop_override_until"] = "future"
    precondition(resolve(override).reason == .invalid)
    override["desktop_override_until"] = true
    precondition(resolve(override).reason == .invalid)
    precondition(resolve(["mode": "bad"]).reason == .invalid && resolve(nil).reason == .invalid)
    precondition(InteractionModeDisplay.resolve(config: nil, missing: true, activity: nil, now: now) == manualDesktop)
    precondition(idle.title(paused: true, permissionsReady: true) == "Control paused")
    precondition(idle.title(paused: false, permissionsReady: false) == "Desktop permission needed")
    precondition(active.summary(paused: false) == "Alongside you" && idle.summary(paused: false) == "Desktop control")
    precondition(temporary.summary(paused: false) == "Desktop turn")

    let home = FileManager.default.temporaryDirectory.appendingPathComponent("2026-10-19-mode-fixture-Codex-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: home) }
    precondition(InteractionModeDisplay.read(home: home).effective == .desktop)
    let configURL = home.appendingPathComponent("interaction-mode.json"), activityURL = home.appendingPathComponent("user-activity.json")
    try JSONSerialization.data(withJSONObject: auto).write(to: configURL)
    activity["pid"] = getpid()
    try JSONSerialization.data(withJSONObject: activity).write(to: activityURL)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: activityURL.path)
    precondition(InteractionModeDisplay.read(home: home, now: now).effective == .desktop)
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: activityURL.path)
    precondition(InteractionModeDisplay.read(home: home, now: now).reason == .unavailable)
    try Data("{bad".utf8).write(to: configURL)
    precondition(InteractionModeDisplay.read(home: home).reason == .invalid)

    let states: [(String, InteractionModeDisplay, Bool)] = [
        ("Alongside / background", active, false), ("Desktop control", idle, false), ("Paused", active, true)]
    for dark in [false, true] {
        let view = ModeIconPreview(states: states, dark: dark)
        try save(view, "2026-10-19-opensky-mode-icons-\(dark ? "dark" : "light")-Codex.png")
    }
    let images = states.map { CloudMark.statusImage(mode: $0.1, stopped: $0.2) }
    precondition(images.allSatisfy { $0.isTemplate && $0.size == NSSize(width: 20, height: 18) })
    precondition(Set(images.compactMap { $0.tiffRepresentation }).count == states.count, "Control states need distinct faces")
    precondition(CloudMark.statusImage(mode: active).tiffRepresentation == CloudMark.statusImage(mode: alongside).tiffRepresentation,
        "Auto and manual alongside must share one calm face")
    for mode in [idle, manualDesktop, temporary] {
        precondition(CloudMark.statusImage(mode: mode).tiffRepresentation == images[1].tiffRepresentation,
            "Auto, manual and temporary desktop must share one alert face")
        precondition(CloudMark.statusImage(mode: mode, stopped: true).tiffRepresentation == images[2].tiffRepresentation,
            "Pause takes precedence over every policy")
    }
    let waiting = CloudMark.statusImage(mode: .unavailable)
    precondition(waiting.isTemplate && waiting.size == NSSize(width: 20, height: 18))
    precondition(!images.compactMap { $0.tiffRepresentation }.contains(waiting.tiffRepresentation!), "Unknown data cannot imply desktop control")
    print("Mode display checks passed: runtime parity, threshold, stale/unavailable activity, live private records, overrides, expiry, pause, permissions and distinct fixed-width template icons.")
}

private final class ModeIconPreview: NSView {
    let states: [(String, InteractionModeDisplay, Bool)]; let dark: Bool
    init(states: [(String, InteractionModeDisplay, Bool)], dark: Bool) {
        self.states = states; self.dark = dark
        super.init(frame: NSRect(x: 0, y: 0, width: 450, height: 180))
    }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ rect: NSRect) {
        (dark ? NSColor(calibratedWhite: 0.12, alpha: 1) : NSColor(calibratedWhite: 0.96, alpha: 1)).setFill(); bounds.fill()
        let ink = dark ? NSColor.white : NSColor.black
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: ink]
        ("OpenSky · One cloud, three expressions" as NSString).draw(at: NSPoint(x: 22, y: 142), withAttributes: attributes)
        for (index, state) in states.enumerated() {
            let x = CGFloat(index) * 145 + 22
            let mark = CloudMark.statusImage(mode: state.1, stopped: state.2)
            // Tint explicitly: these are offscreen previews rather than NSStatusBar's template renderer.
            let tinted = NSImage(size: mark.size, flipped: false) { _ in
                mark.draw(at: .zero, from: .zero, operation: .sourceOver, fraction: 1)
                ink.setFill(); NSRect(origin: .zero, size: mark.size).fill(using: .sourceIn); return true
            }
            tinted.draw(in: NSRect(x: x, y: 97, width: 20, height: 18))
            (state.0 as NSString).draw(at: NSPoint(x: x, y: 70), withAttributes: [.font: NSFont.systemFont(ofSize: 10), .foregroundColor: ink])
            // 2x magnification helps inspect edges, while the row above stays actual size.
            tinted.draw(in: NSRect(x: x, y: 15, width: 40, height: 36))
        }
    }
}
