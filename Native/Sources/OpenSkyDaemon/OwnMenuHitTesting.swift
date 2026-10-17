import AppKit
import ApplicationServices

// An own-process AX hit can be either a real menu or a click-through pointer.
// Menu ancestry is proof of an interactive target; other own hits still use
// the normal-window fallback and its overlay exclusions.
enum OwnMenuHitTesting {
    static func permits(role: String, hitPID: pid_t, targetPID: pid_t, currentPID: pid_t) -> Bool {
        hitPID == currentPID && targetPID == currentPID &&
            [kAXMenuRole, kAXMenuItemRole, kAXMenuBarItemRole].contains(role)
    }
    static func containsMenu(_ hit: AXUIElement, targetPID: pid_t) -> Bool {
        let currentPID = ProcessInfo.processInfo.processIdentifier
        guard targetPID == currentPID else { return false }
        var node: AXUIElement? = hit
        for _ in 0..<16 {
            guard let current = node else { return false }
            var pid: pid_t = 0, role: CFTypeRef?
            guard AXUIElementGetPid(current, &pid) == .success, pid == currentPID else { return false }
            if AXUIElementCopyAttributeValue(current, kAXRoleAttribute as CFString, &role) == .success,
               let role = role as? String, permits(role: role, hitPID: pid, targetPID: targetPID, currentPID: currentPID) { return true }
            var parent: CFTypeRef?
            guard AXUIElementCopyAttributeValue(current, kAXParentAttribute as CFString, &parent) == .success,
                  let parent, CFGetTypeID(parent) == AXUIElementGetTypeID() else { return false }
            node = (parent as! AXUIElement)
        }
        return false
    }
}
