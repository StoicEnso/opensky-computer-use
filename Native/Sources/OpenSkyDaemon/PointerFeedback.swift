import AppKit
import CoreGraphics

struct PointerFeedbackRequest {
    let createdAt = ProcessInfo.processInfo.systemUptime
    var app: String?
    var windowID: UInt32?
}

enum PointerFeedbackContext {
    private static let key = "dev.opensky.pointerFeedback"
    private final class Box: NSObject {
        let value: PointerFeedbackRequest
        init(_ value: PointerFeedbackRequest) { self.value = value }
    }
    static var current: PointerFeedbackRequest? {
        get { (Thread.current.threadDictionary[key] as? Box)?.value }
        set {
            if let newValue { Thread.current.threadDictionary[key] = Box(newValue) }
            else { Thread.current.threadDictionary.removeObject(forKey: key) }
        }
    }
}

struct PointerFeedbackScope: Equatable {
    let pid: Int32
    let windowID: UInt32
}

struct PointerWindow {
    let id: UInt32
    let pid: Int32
    let frame: CGRect
    let layer: Int
    let alpha: Double
    static func live() -> [PointerWindow] {
        guard let values = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
        return values.compactMap { value in
            guard let id = value[kCGWindowNumber as String] as? UInt32,
                  let pid = value[kCGWindowOwnerPID as String] as? Int32,
                  let layer = value[kCGWindowLayer as String] as? Int,
                  let bounds = value[kCGWindowBounds as String] as? [String: Any],
                  let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return nil }
            return PointerWindow(id: id, pid: pid, frame: frame, layer: layer, alpha: value[kCGWindowAlpha as String] as? Double ?? 1)
        }
    }
}

enum PointerFeedbackGeometry {
    // Non-overlapping rectangle subtraction handles overlapping occluders without
    // an even-odd mask accidentally making an overlap visible again.
    static func subtract(_ cover: CGRect, from rect: CGRect) -> [CGRect] {
        let cut = rect.intersection(cover)
        guard !cut.isNull, cut.width > 0, cut.height > 0 else { return [rect] }
        return [CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: cut.minY - rect.minY),
                CGRect(x: rect.minX, y: cut.maxY, width: rect.width, height: rect.maxY - cut.maxY),
                CGRect(x: rect.minX, y: cut.minY, width: cut.minX - rect.minX, height: cut.height),
                CGRect(x: cut.maxX, y: cut.minY, width: rect.maxX - cut.maxX, height: cut.height)]
            .filter { $0.width > 0 && $0.height > 0 }
    }
    static func focusedWindow(_ windows: [PointerWindow], pid: Int32?) -> PointerWindow? {
        windows.first { $0.pid == pid && $0.layer == 0 && $0.alpha > 0.01 && $0.frame.width > 1 && $0.frame.height > 1 }
    }
    static func regions(scope: PointerFeedbackScope, windows: [PointerWindow], focusedPID: Int32?, ownerActive: Bool, ignored: Set<UInt32> = []) -> [CGRect] {
        guard let index = windows.firstIndex(where: { $0.id == scope.windowID && $0.pid == scope.pid && $0.layer == 0 && $0.alpha > 0.01 }) else { return [] }
        let target = windows[index]
        let focused = focusedWindow(windows, pid: focusedPID)
        // Without a known focused window, do not guess what is safe to cover.
        guard focused != nil else { return [] }
        if ownerActive && focused?.id == target.id { return [] }
        // Higher layers remain above our normal-level windows in WindowServer.
        // Do not mistake their transparent full-screen planes for opaque covers.
        var covers = windows.prefix(index).filter { !ignored.contains($0.id) && $0.id != target.id && $0.alpha > 0.01 && $0.layer == 0 }.map(\.frame)
        if ownerActive, let focused { covers.append(focused.frame) }
        var regions = [target.frame]
        for cover in covers {
            regions = regions.flatMap { subtract(cover, from: $0) }
            if regions.count > 256 { return [] } // Ambiguous/complex layout: stay quiet.
        }
        return regions
    }
}
