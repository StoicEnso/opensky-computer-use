import Foundation

/// A yield invalidates only shared-input operations. It never pauses the service,
/// resumes a stopped generation, or cancels exact-window background AX work.
final class CooperationController {
    static let shared = CooperationController()
    private let lock = NSLock()
    private var generation: UInt64 = 0
    private var desktop = false
    private var automatic = false
    private var overridden = false
    private var lastExternal: TimeInterval = -.infinity
    private let threadKey = "dev.opensky.cooperationGeneration"
    private let home = URL(fileURLWithPath: ProcessInfo.processInfo.environment["OPENSKY_HOME"] ?? NSHomeDirectory() + "/.local/share/opensky")

    static func requiresDesktop(_ method: String, _ params: [String: Any]) -> Bool {
        if ["drag", "scroll", "type_text", "press_key", "paste", "manage_window", "run_applescript"].contains(method) { return true }
        if ["click", "set_value", "perform_secondary_action", "select_text"].contains(method) {
            return (params["mode"] as? String ?? (method == "set_value" ? "background" : "hybrid")).lowercased() != "background"
        }
        return method == "inspector" && params["activate"] as? Bool == true
            || method == "agent_activity" && params["action"] as? String == "show"
    }
    func refresh() { update(InteractionModeDisplay.read(home: home)) }
    func update(_ mode: InteractionModeDisplay, now: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        lock.lock(); defer { lock.unlock() }
        automatic = mode.automatic; overridden = mode.reason == .temporary
        // A file sample can precede the live callback. Never re-enable a yielded
        // auto operation from that older sample, even if the owner stays in one app.
        let available = mode.effective == .desktop && (!automatic || overridden || now - lastExternal >= InteractionModeDisplay.idleSeconds)
        if desktop && !available { generation &+= 1 }
        desktop = available
    }
    func externalInputObserved(now: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        lock.lock(); defer { lock.unlock() }
        lastExternal = now
        if automatic && !overridden {
            if desktop { generation &+= 1 }
            desktop = false
        }
    }
    var ticket: UInt64 { lock.lock(); defer { lock.unlock() }; return generation }
    func isCurrent(_ ticket: UInt64) -> Bool {
        lock.lock(); defer { lock.unlock() }; return desktop && generation == ticket
    }
    var activeTicket: UInt64? { (Thread.current.threadDictionary[threadKey] as? NSNumber)?.uint64Value }
    var interrupted: Bool { activeTicket.map { !isCurrent($0) } ?? false }
    func withTicket<T>(_ ticket: UInt64?, _ body: () -> T) -> T {
        let previous = Thread.current.threadDictionary[threadKey]
        if let ticket { Thread.current.threadDictionary[threadKey] = NSNumber(value: ticket) }
        else { Thread.current.threadDictionary.removeObject(forKey: threadKey) }
        defer {
            if let previous { Thread.current.threadDictionary[threadKey] = previous }
            else { Thread.current.threadDictionary.removeObject(forKey: threadKey) }
        }
        return body()
    }
    func yieldResult(started: Bool) -> [String: Any] {
        lock.lock(); let currentMode = desktop ? "desktop" : "alongside"; lock.unlock()
        return ["ok": false, "error_code": "desktop_yielded", "deferred": true, "effective_mode": currentMode,
         "input_may_have_been_delivered": started, "retry_safe": false,
         "error": started ? "Shared desktop work yielded when cooperation changed. Earlier input may have completed; observe the target before continuing." : "Desktop is unavailable. No input from this request was sent.",
         "next_step": "Preserve this checkpoint. Continue supported exact-window background AX or browser work, or wait for desktop availability. Do not replay partial input automatically. An availability event never resumes emergency pause."]
    }
}
