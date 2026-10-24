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
    private var eventTap: CFMachPort?, eventSource: CFRunLoopSource?, timer: Timer?
    private var lastMonitorAttempt: TimeInterval = -10
    private var home = ""
    private var feedbackMonitoringUntil: TimeInterval = 0
    private var monitorReady = false
    private var cooperationPolicy = "alongside"

    func requestFeedbackMonitoring() {
        precondition(Thread.isMainThread)
        feedbackMonitoringUntil = ProcessInfo.processInfo.systemUptime + 2
        if !monitorReady { sample() }
    }
    var pointerOwnerActive: Bool {
        guard monitorReady else { return true }
        let idle = clock.idle(at: ProcessInfo.processInfo.systemUptime, generalIdle: Self.generalIdle())
        if cooperationPolicy == "auto" { return idle < InteractionModeDisplay.idleSeconds }
        if cooperationPolicy == "desktop" { return idle < 1.5 }
        return true
    }
    private let eventTypes: [CGEventType] = [.keyDown, .keyUp, .flagsChanged, .mouseMoved, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel]

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
    private func observe(_ event: CGEvent) {
        precondition(Thread.isMainThread)
        let marker = event.getIntegerValueField(.eventSourceUserData)
        clock.observe(marker: marker, now: ProcessInfo.processInfo.systemUptime)
        if marker != ExternalActivityClock.ownEventMarker {
            CooperationController.shared.externalInputObserved()
            CursorOverlayManager.shared.externalInputObserved()
        }
    }
    private func installMonitor(now: TimeInterval) {
        // AppKit may omit mouse-move delivery to a window or transform events
        // during menu tracking. Observe the tagged Quartz stream before that
        // delivery; never guess that an untagged event belongs to this process.
        lastMonitorAttempt = now
        let mask = eventTypes.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
            options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, context in
                guard let context else { return Unmanaged.passUnretained(event) }
                let tracker = Unmanaged<UserActivityTracker>.fromOpaque(context).takeUnretainedValue()
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    CooperationController.shared.update(.unavailable)
                    tracker.monitorReady = false
                    tracker.clock = ExternalActivityClock(now: ProcessInfo.processInfo.systemUptime)
                } else { tracker.observe(event) }
                return Unmanaged.passUnretained(event)
            }, userInfo: Unmanaged.passUnretained(self).toOpaque()) else { return }
        guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            CFMachPortInvalidate(tap); return
        }
        eventTap = tap; eventSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        clock = ExternalActivityClock(now: now)
    }
    private func removeMonitor() {
        if let eventSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), eventSource, .commonModes) }
        if let eventTap { CFMachPortInvalidate(eventTap) }
        eventSource = nil; eventTap = nil; monitorReady = false
    }
    private func sample() {
        let now = ProcessInfo.processInfo.systemUptime
        let modeURL = URL(fileURLWithPath: home).appendingPathComponent("interaction-mode.json")
        let config = (try? Data(contentsOf: modeURL)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        cooperationPolicy = Self.isAutoConfig(config) ? "auto" : (config?["mode"] as? String ?? "desktop")
        let permitted = (Self.isAutoConfig(config) || now < feedbackMonitoringUntil) && AXIsProcessTrusted()
        if permitted, let tap = eventTap {
            if !CFMachPortIsValid(tap) {
                // Permission changes can retire the WindowServer tap while its
                // local port reference survives. Enabling that port cannot recover it.
                removeMonitor()
            } else if !CGEvent.tapIsEnabled(tap: tap) {
                clock = ExternalActivityClock(now: now)
                CGEvent.tapEnable(tap: tap, enable: true)
                if !CGEvent.tapIsEnabled(tap: tap) { removeMonitor() }
            }
        }
        if permitted && eventTap == nil && now - lastMonitorAttempt >= 2 { installMonitor(now: now) }
        if !permitted { removeMonitor() }
        let generalIdle = permitted ? Self.generalIdle() : nil
        let ready = permitted && eventTap.map { CGEvent.tapIsEnabled(tap: $0) } == true && generalIdle != nil
        monitorReady = ready
        let record: [String: Any] = ["schema": 1, "pid": ProcessInfo.processInfo.processIdentifier,
            "sampled_uptime": now, "sampled_at_ms": Int64(Date().timeIntervalSince1970 * 1000), "external_idle_seconds": ready ? clock.idle(at: now, generalIdle: generalIdle) : 0,
            "observed_for_seconds": ready ? max(0, now - clock.startedAt) : 0,
            "monitor_ready": ready, "monitor_status": ready ? "ready" : (!permitted ? "not_enabled" : (eventTap == nil ? "reconnecting" : (generalIdle == nil ? "idle_signal_unavailable" : "tap_disabled"))),
            "monitor_backend": "quartz_listen_only", "own_input_filtered": true, "input_contents_recorded": false]
        CooperationController.shared.update(InteractionModeDisplay.resolve(config: config, missing: !FileManager.default.fileExists(atPath: modeURL.path), activity: record, now: Date().timeIntervalSince1970 * 1000))
        let file = URL(fileURLWithPath: home).appendingPathComponent("user-activity.json")
        if let data = try? JSONSerialization.data(withJSONObject: record) {
            try? data.write(to: file, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        }
    }
}
