import Foundation

struct AXObservationBudget {
    private let deadline: TimeInterval
    private let now: () -> TimeInterval
    private let isCurrent: () -> Bool
    init(seconds: TimeInterval = 8, now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }, isCurrent: @escaping () -> Bool) {
        self.now = now; self.isCurrent = isCurrent; deadline = now() + seconds
    }
    var cancelled: Bool { !isCurrent() }
    var permitsRead: Bool { now() < deadline && isCurrent() }
}
