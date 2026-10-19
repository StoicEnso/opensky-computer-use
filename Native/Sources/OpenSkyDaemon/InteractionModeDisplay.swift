import AppKit

/// Read-only projection of the SDK's cooperation policy. This never changes mode,
/// starts activity monitoring, resumes control or grants desktop authority.
struct InteractionModeDisplay: Equatable {
    enum Policy: String { case auto = "Auto", alongside = "Alongside", desktop = "Desktop" }
    enum Effective: String { case alongside = "Alongside", desktop = "Desktop" }
    enum Reason { case selected, ownerActive, idle, unavailable, temporary, invalid }
    static let idleSeconds = 120.0
    var policy: Policy?; var effective: Effective?; var reason: Reason
    static let unavailable = Self(policy: nil, effective: nil, reason: .invalid)
    var automatic: Bool { policy == .auto }
    var symbol: String { effective == .alongside ? "rectangle.split.2x1" : effective == .desktop ? "cursorarrow" : "questionmark" }
    var badge: String { reason == .temporary ? "Temporary · \(policy?.rawValue ?? "Mode") saved" : policy?.rawValue ?? "Check mode" }
    func title(paused: Bool, permissionsReady: Bool) -> String {
        if paused { return "Control paused" }
        if reason == .invalid { return "Mode unavailable" }
        if effective == .alongside { return "Alongside you" }
        if !permissionsReady { return "Desktop permission needed" }
        return reason == .temporary ? "Desktop turn" : automatic ? "Desktop available" : "Desktop control"
    }
    func detail(paused: Bool, permissionsReady: Bool) -> String {
        if paused { return "Resume when you’re ready. Your mode stays saved." }
        if reason == .invalid { return "Check your mode with opensky mode." }
        if effective == .desktop && !permissionsReady { return "Open Setup to check macOS access." }
        if reason == .temporary { return "Returns to \(policy?.rawValue ?? "your saved mode") when this turn ends." }
        if automatic {
            if reason == .unavailable { return "Activity signal unavailable. Staying alongside." }
            return effective == .desktop ? "Shared input available while you’re idle." : "Desktop turns after 2 minutes idle."
        }
        return effective == .alongside ? "Agents use supported background controls." : "Agents may use your keyboard and pointer."
    }
    func summary(paused: Bool) -> String {
        let mode = effective?.rawValue ?? "Mode unavailable"
        let selection = reason == .temporary ? "\(mode) turn · \(policy?.rawValue ?? "Mode") saved" : automatic ? "Auto · \(mode)" : mode
        return paused ? "Paused · \(selection)" : selection
    }
    private static func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
        return n.doubleValue
    }
    private static func boolean(_ value: Any?, equals expected: Bool) -> Bool {
        guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return false }
        return n.boolValue == expected
    }
    static func resolve(config: [String: Any]?, missing: Bool = false, activity: [String: Any]?, now: Double,
                        isAlive: (Int32) -> Bool = { kill($0, 0) == 0 || errno == EPERM }) -> Self {
        if missing { return Self(policy: .desktop, effective: .desktop, reason: .selected) }
        guard let config, let raw = config["mode"] as? String, ["auto", "alongside", "desktop"].contains(raw) else { return .unavailable }
        let policy: Policy = raw == "auto" || (raw == "alongside" && config["cooperation_policy"] as? String == "auto") ? .auto : raw == "alongside" ? .alongside : .desktop
        if config.keys.contains("desktop_override_until") {
            guard let until = number(config["desktop_override_until"]) else { return .unavailable }
            if until > now { return Self(policy: policy, effective: .desktop, reason: .temporary) }
        }
        guard policy == .auto else { return Self(policy: policy, effective: policy == .desktop ? .desktop : .alongside, reason: .selected) }
        let fallback = Self(policy: .auto, effective: .alongside, reason: .unavailable)
        guard let activity, number(activity["schema"]) == 1,
              boolean(activity["own_input_filtered"], equals: true), boolean(activity["input_contents_recorded"], equals: false),
              boolean(activity["monitor_ready"], equals: true),
              let pid = number(activity["pid"]), pid > 0, pid <= Double(Int32.max), pid.rounded() == pid, isAlive(Int32(pid)),
              let sampled = number(activity["sampled_at_ms"]), let idle = number(activity["external_idle_seconds"]), idle >= 0,
              let observed = number(activity["observed_for_seconds"]), observed >= idle else { return fallback }
        let age = (now - sampled) / 1000
        guard age >= 0 && age <= 1.5 else { return fallback }
        let ready = floor((idle + age) * 1000) / 1000 >= idleSeconds
        return Self(policy: .auto, effective: ready ? .desktop : .alongside, reason: ready ? .idle : .ownerActive)
    }
    static func read(home: URL, now: Double = Date().timeIntervalSince1970 * 1000) -> Self {
        let modeURL = home.appendingPathComponent("interaction-mode.json")
        // Match missing-file desktop default, but never interpret unreadable/corrupt data as desktop.
        let data: Data
        do { data = try Data(contentsOf: modeURL) }
        catch let error as NSError {
            return error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError ? resolve(config: nil, missing: true, activity: nil, now: now) : .unavailable
        }
        let config = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let url = home.appendingPathComponent("user-activity.json")
        var activity: [String: Any]?
        if let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
           attrs[.type] as? FileAttributeType == .typeRegular,
           ((attrs[.size] as? NSNumber)?.intValue ?? Int.max) <= 65536,
           (attrs[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
           let permissions = (attrs[.posixPermissions] as? NSNumber)?.intValue, permissions & 0o077 == 0,
           let record = try? Data(contentsOf: url) {
            activity = (try? JSONSerialization.jsonObject(with: record)) as? [String: Any]
        }
        return resolve(config: config, activity: activity, now: now)
    }
}
