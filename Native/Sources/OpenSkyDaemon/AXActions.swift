import ApplicationServices
import Foundation

/// Core AX calls into our own SwiftUI view execute synchronously. Keep those
/// actions on AppKit's main thread and carry the request's stop generation.
enum OpenSkyAXActions {
    /// Own-process AX reads can lazily create AppKit views, including table rows.
    /// They need the same thread as writes, but remain available while paused.
    static func read<T>(_ element: AXUIElement, _ body: @escaping () -> T) -> T {
        let generation = SafetyController.shared.operationGeneration
        let work = { SafetyController.shared.withGeneration(generation, body) }
        var pid: pid_t = 0
        if AXUIElementGetPid(element, &pid) == .success,
           pid == ProcessInfo.processInfo.processIdentifier, !Thread.isMainThread {
            return DispatchQueue.main.sync(execute: work)
        }
        return work()
    }
    static func copyAttribute(_ element: AXUIElement, _ attribute: CFString, _ value: inout CFTypeRef?) -> AXError {
        var copied: CFTypeRef?
        let error = read(element) { AXUIElementCopyAttributeValue(element, attribute, &copied) }
        value = copied
        return error
    }
    static func run(_ element: AXUIElement, _ body: @escaping () -> AXError) -> AXError {
        let generation = SafetyController.shared.operationGeneration
        let action = {
            SafetyController.shared.withGeneration(generation) {
                SafetyController.shared.isStopped ? .cannotComplete : body()
            }
        }
        var pid: pid_t = 0
        if AXUIElementGetPid(element, &pid) == .success,
           pid == ProcessInfo.processInfo.processIdentifier, !Thread.isMainThread {
            return DispatchQueue.main.sync(execute: action)
        }
        return action()
    }
    static func perform(_ element: AXUIElement, _ action: CFString) -> AXError {
        run(element) { AXUIElementPerformAction(element, action) }
    }
    static func set(_ element: AXUIElement, _ attribute: CFString, _ value: CFTypeRef) -> AXError {
        run(element) { AXUIElementSetAttributeValue(element, attribute, value) }
    }
}
