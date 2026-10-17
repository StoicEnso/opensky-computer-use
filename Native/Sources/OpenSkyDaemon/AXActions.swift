import ApplicationServices
import Foundation

/// Core AX calls into our own SwiftUI view execute synchronously. Keep those
/// actions on AppKit's main thread and carry the request's stop generation.
enum OpenSkyAXActions {
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
