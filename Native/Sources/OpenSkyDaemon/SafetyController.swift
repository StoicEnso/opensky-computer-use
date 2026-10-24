import Foundation

/// Stop invalidates a generation permanently. Resume allows only newly submitted work.
public final class SafetyController {
    public static let shared = SafetyController()
    private let lock = NSLock()
    private var stopped = false
    private var generation: UInt64 = 0
    private let threadKey = "dev.opensky.operationGeneration"

    public var operationGeneration: UInt64 {
        if let active = Thread.current.threadDictionary[threadKey] as? NSNumber { return active.uint64Value }
        lock.lock(); defer { lock.unlock() }; return generation
    }

    public func isCurrent(_ value: UInt64) -> Bool {
        lock.lock(); defer { lock.unlock() }; return value == generation
    }

    public var isStopped: Bool {
        let active = (Thread.current.threadDictionary[threadKey] as? NSNumber)?.uint64Value
        lock.lock(); defer { lock.unlock() }
        return stopped || (active != nil && active != generation) || CooperationController.shared.interrupted
    }

    public func setStopped(_ value: Bool) {
        lock.lock()
        stopped = value
        if value { generation &+= 1 }
        lock.unlock()
        NotificationCenter.default.post(name: .openskyControlStateChanged, object: nil)
    }

    public func withGeneration<T>(_ value: UInt64, _ body: () -> T) -> T {
        let previous = Thread.current.threadDictionary[threadKey]
        Thread.current.threadDictionary[threadKey] = NSNumber(value: value)
        defer {
            if let previous { Thread.current.threadDictionary[threadKey] = previous }
            else { Thread.current.threadDictionary.removeObject(forKey: threadKey) }
        }
        return body()
    }
}

extension Notification.Name {
    static let openskyControlStateChanged = Notification.Name("dev.opensky.controlStateChanged")
}
