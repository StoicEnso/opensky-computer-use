import AppKit
import ApplicationServices

struct ExternalActivityClock {
    static let ownEventMarker: Int64 = 0x4f534b59494e5054
    private(set) var startedAt: TimeInterval
    private(set) var lastExternalInput: TimeInterval
    private(set) var lastObservedInput: TimeInterval
    init(now: TimeInterval) {
        startedAt = now; lastExternalInput = now; lastObservedInput = now
    }
    mutating func observe(marker: Int64?, now: TimeInterval) {
        lastObservedInput = now
        // Only explicitly tagged input is ours. Process identity alone must not
        // hide a physical event delivered inside OpenSky's own window.
        // Never inspect a character, key code, coordinate, or clipboard value.
        guard marker != Self.ownEventMarker else { return }
        lastExternalInput = now
    }
    func idle(at now: TimeInterval, generalIdle: TimeInterval? = nil) -> TimeInterval {
        let confirmed = max(0, now - lastExternalInput)
        // A newer OS event without a monitor callback counts conservatively.
        // A delayed tagged callback restores continuity without another five-minute wait.
        if let generalIdle, now - generalIdle > lastObservedInput { return min(confirmed, max(0, generalIdle)) }
        return confirmed
    }
}

/// Opt-in aggregate activity for auto cooperation. No event contents are saved.
final class UserActivityTracker {
    static let shared = UserActivityTracker()
    private var clock = ExternalActivityClock(now: ProcessInfo.processInfo.systemUptime)
    private var globalMonitor: Any?, localMonitor: Any?, timer: Timer?
    private var home = ""
    private let mask: NSEvent.EventTypeMask = [.keyDown, .keyUp, .flagsChanged, .mouseMoved, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel]

    static func isAutoConfig(_ config: [String: Any]?) -> Bool {
        let mode = config?["mode"] as? String
        return mode == "auto" || (mode == "alongside" && config?["cooperation_policy"] as? String == "auto")
    }

    static func eventSource() -> CGEventSource? {
        let source = CGEventSource(stateID: .privateState)
        source?.userData = ExternalActivityClock.ownEventMarker
        return source
    }
    private static func generalIdle() -> TimeInterval? {
        let types: [CGEventType] = [.keyDown, .keyUp, .flagsChanged, .mouseMoved, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel]
        let values = types.map { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0) }
        guard values.allSatisfy({ $0.isFinite && $0 >= 0 }) else { return nil }
        return values.min()
    }
    func start(home: String) {
        precondition(Thread.isMainThread)
        self.home = home
        timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.sample() }
        RunLoop.main.add(timer!, forMode: .common)
        sample()
    }
    private func observe(_ event: NSEvent) {
        let raw = event.cgEvent
        clock.observe(marker: raw?.getIntegerValueField(.eventSourceUserData), now: ProcessInfo.processInfo.systemUptime)
    }
    private func sample() {
        let now = ProcessInfo.processInfo.systemUptime
        let modeURL = URL(fileURLWithPath: home).appendingPathComponent("interaction-mode.json")
        let config = (try? Data(contentsOf: modeURL)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let permitted = Self.isAutoConfig(config) && AXIsProcessTrusted()
        if permitted && (globalMonitor == nil || localMonitor == nil) {
            if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
            if let localMonitor { NSEvent.removeMonitor(localMonitor) }
            globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in self?.observe(event) }
            localMonitor = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in self?.observe(event); return event }
            // Start a new observed idle interval; never assume prior human absence.
            clock = ExternalActivityClock(now: now)
        }
        if !permitted {
            if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
            if let localMonitor { NSEvent.removeMonitor(localMonitor) }
            globalMonitor = nil; localMonitor = nil
        }
        let generalIdle = permitted ? Self.generalIdle() : nil
        let ready = permitted && globalMonitor != nil && localMonitor != nil && generalIdle != nil
        let record: [String: Any] = ["schema": 1, "pid": ProcessInfo.processInfo.processIdentifier,
            "sampled_uptime": now, "sampled_at_ms": Int64(Date().timeIntervalSince1970 * 1000), "external_idle_seconds": ready ? clock.idle(at: now, generalIdle: generalIdle) : 0,
            "observed_for_seconds": ready ? max(0, now - clock.startedAt) : 0,
            "monitor_ready": ready, "own_input_filtered": true, "input_contents_recorded": false]
        let file = URL(fileURLWithPath: home).appendingPathComponent("user-activity.json")
        if let data = try? JSONSerialization.data(withJSONObject: record) {
            try? data.write(to: file, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        }
    }
}
