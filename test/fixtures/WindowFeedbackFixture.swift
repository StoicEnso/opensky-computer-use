import AppKit

// Two disposable background windows. Local control affects only these fixtures.
final class FeedbackFixture: NSObject, NSApplicationDelegate {
    let target = NSWindow(contentRect: NSRect(x: 90, y: 150, width: 460, height: 280), styleMask: [.titled], backing: .buffered, defer: false)
    let cover = NSWindow(contentRect: NSRect(x: 320, y: 150, width: 230, height: 280), styleMask: [.titled], backing: .buffered, defer: false)
    var timer: Timer?, last = ""
    let output = ProcessInfo.processInfo.environment["OPENSKY_FEEDBACK_FIXTURE_OUTPUT"]!
    let control = ProcessInfo.processInfo.environment["OPENSKY_FEEDBACK_FIXTURE_CONTROL"]!
    func applicationDidFinishLaunching(_ notification: Notification) {
        target.title = "OpenSky background feedback fixture"; cover.title = "OpenSky covering fixture"
        target.isReleasedWhenClosed = false; cover.isReleasedWhenClosed = false
        target.backgroundColor = .windowBackgroundColor; cover.backgroundColor = .systemGray
        let label = NSTextField(labelWithString: "Disposable background feedback test")
        label.frame = NSRect(x: 20, y: 200, width: 420, height: 28); target.contentView?.addSubview(label)
        if let raw = ProcessInfo.processInfo.environment["OPENSKY_FEEDBACK_FIXTURE_FRAME"],
           let data = raw.data(using: .utf8), let frame = try? JSONSerialization.jsonObject(with: data) as? [Double], frame.count == 4 {
            let top = CGFloat(CGDisplayBounds(CGMainDisplayID()).height)
            target.setFrame(NSRect(x: frame[0], y: top - frame[1] - frame[3], width: frame[2], height: frame[3]), display: true)
            cover.setFrame(NSRect(x: frame[0] + frame[2] / 2, y: top - frame[1] - frame[3], width: frame[2] / 2, height: frame[3]), display: true)
        }
        let below = Int(ProcessInfo.processInfo.environment["OPENSKY_FEEDBACK_FIXTURE_BELOW"] ?? "0") ?? 0
        target.orderFront(nil); cover.orderFront(nil)
        target.order(.below, relativeTo: below); cover.order(.above, relativeTo: target.windowNumber)
        save()
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.update() }
    }
    func update() {
        guard let command = try? String(contentsOfFile: control, encoding: .utf8), command != last else { return }
        last = command
        switch command.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "uncover": cover.orderOut(nil)
        case "cover": cover.setFrame(target.frame, display: true); cover.order(.above, relativeTo: target.windowNumber)
        case "hide": target.orderOut(nil); cover.orderOut(nil)
        case "quit": NSApp.terminate(nil)
        default: break
        }
        save()
    }
    func save() {
        func bounds(_ window: NSWindow) -> [Double] {
            let own = window.frame
            let r = CGRect(x: own.minX, y: CGDisplayBounds(CGMainDisplayID()).height - own.maxY, width: own.width, height: own.height)
            return [r.minX, r.minY, r.width, r.height]
        }
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], 0) as? [[String: Any]] ?? []
        let targetIndex = windows.firstIndex { ($0[kCGWindowNumber as String] as? Int) == target.windowNumber } ?? windows.count
        let blockers = windows.prefix(targetIndex).compactMap { value -> [String: Any]? in
            guard let raw = value[kCGWindowBounds as String] as? [String: Any], let r = CGRect(dictionaryRepresentation: raw as CFDictionary) else { return nil }
            let t = bounds(target); guard r.intersects(CGRect(x: t[0], y: t[1], width: t[2], height: t[3])) else { return nil }
            return ["id": value[kCGWindowNumber as String] ?? 0, "pid": value[kCGWindowOwnerPID as String] ?? 0, "layer": value[kCGWindowLayer as String] ?? 0, "frame": [r.minX,r.minY,r.width,r.height]]
        }
        let data: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier, "target": target.windowNumber, "cover": cover.windowNumber, "target_frame": bounds(target), "cover_frame": bounds(cover), "command": last, "blockers": blockers, "target_visible": target.isVisible, "cover_visible": cover.isVisible, "bundle_id": Bundle.main.bundleIdentifier ?? "missing", "activation_policy": NSRunningApplication.current.activationPolicy.rawValue]
        try? JSONSerialization.data(withJSONObject: data).write(to: URL(fileURLWithPath: output), options: .atomic)
    }
}
let app = NSApplication.shared
let delegate = FeedbackFixture(); app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
