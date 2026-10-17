import AppKit

final class OpenSkyMenu: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let status = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private let permissions = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private var stopItem: NSMenuItem!
    private var resumeItem: NSMenuItem!
    private var inspector: InspectorWindowController?

    override init() {
        super.init()
        item.button?.title = ""
        item.button?.imagePosition = .imageOnly
        item.button?.setAccessibilityIdentifier("dev.opensky.statusItem")
        let menu = NSMenu(); menu.delegate = self; menu.autoenablesItems = false
        menu.addItem(status); menu.addItem(permissions)
        status.isEnabled = false; permissions.isEnabled = false
        menu.addItem(.separator())
        let inspect = menu.addItem(withTitle: "Open Inspector…", action: #selector(openInspector), keyEquivalent: "i")
        inspect.keyEquivalentModifierMask = [.command, .shift]
        menu.addItem(withTitle: "Setup & Connections…", action: #selector(openSetup), keyEquivalent: "")
        menu.addItem(.separator())
        stopItem = menu.addItem(withTitle: "Pause Control    ⌃⌥⌘ Esc", action: #selector(stopControl), keyEquivalent: "")
        resumeItem = menu.addItem(withTitle: "Resume Control", action: #selector(resumeControl), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "About OpenSky", action: #selector(about), keyEquivalent: "")
        menu.addItem(withTitle: "Quit OpenSky", action: #selector(quit), keyEquivalent: "q")
        for entry in menu.items { entry.target = self }
        item.menu = menu
        NotificationCenter.default.addObserver(self, selector: #selector(controlStateChanged), name: .openskyControlStateChanged, object: nil)
        refresh()
    }

    func menuWillOpen(_ menu: NSMenu) { refresh() }
    private func refresh() {
        let stopped = SafetyController.shared.isStopped
        let ax = AXEngine.shared.isAXTrusted(), screen = CGPreflightScreenCaptureAccess(), post = CGPreflightPostEventAccess()
        let state = stopped ? "Control paused" : (ax && screen && post ? "Ready for your agent" : "Desktop permissions needed")
        item.button?.image = CloudMark.image(stopped: stopped)
        item.button?.toolTip = "OpenSky · \(state)"
        item.button?.setAccessibilityLabel("OpenSky, \(state.lowercased())")
        status.title = "OpenSky · \(state)"
        permissions.title = "Accessibility \(ax ? "✓" : "—")   Screen Capture \(screen ? "✓" : "—")   Event Posting \(post ? "✓" : "—")"
        stopItem.isEnabled = !stopped; resumeItem.isEnabled = stopped
    }
    @objc private func controlStateChanged() { DispatchQueue.main.async { self.refresh() } }
    @objc func stopControl() { SafetyController.shared.setStopped(true); CursorOverlayManager.shared.dismissCursor(); refresh() }
    @objc private func resumeControl() { SafetyController.shared.setStopped(false); refresh() }
    @objc private func openInspector() {
        _ = inspectorControl(action: "show", activate: true)
    }
    func inspectorControl(action: String, activate: Bool = false) -> [String: Any] {
        refresh() // Permission consent can change after launch; metadata must be current.
        if action == "show" {
            if inspector?.window?.isVisible != true { inspector = InspectorWindowController() }
            inspector?.present(activate: activate)
        } else if action == "close" { inspector?.close(); inspector = nil }
        var result: [String: Any] = ["ok": true, "visible": inspector?.window?.isVisible ?? false,
            "control_paused": SafetyController.shared.isStopped,
            "tray_image_template": item.button?.image?.isTemplate ?? false,
            "tray_title": item.button?.title ?? "", "tray_accessibility_label": item.button?.accessibilityLabel() ?? "",
            "inspector_busy": inspector?.model.busy ?? false,
            "inspector_element_count": inspector?.model.elements.count ?? 0]
        if let window = inspector?.window, window.isVisible {
            result["window_id"] = window.windowNumber
            let f = window.frame
            let layout = CGRect(x: f.minX, y: CGDisplayBounds(CGMainDisplayID()).height - f.maxY, width: f.width, height: f.height)
            let values = CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(window.windowNumber)) as? [[String: Any]]
            let bounds = values?.first?[kCGWindowBounds as String] as? [String: Any]
            let rendered = bounds.flatMap { CGRect(dictionaryRepresentation: $0 as CFDictionary) }
            result["window_ready"] = rendered.map { abs($0.minX-layout.minX)<=1 && abs($0.minY-layout.minY)<=1 && abs($0.width-layout.width)<=1 && abs($0.height-layout.height)<=1 } ?? false
        }
        return result
    }
    @objc private func openSetup() {
        let home = ProcessInfo.processInfo.environment["OPENSKY_HOME"] ?? NSHomeDirectory() + "/.local/share/opensky"
        let launcher = URL(fileURLWithPath: home).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("bin/opensky")
        let process = Process(); process.executableURL = launcher; process.arguments = ["onboard"]
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        do { try process.run() }
        catch {
            let alert = NSAlert(); alert.messageText = "Setup could not open"
            alert.informativeText = "Run opensky onboard from your installed CLI, or reinstall the OpenSky launcher."
            alert.runModal()
        }
    }
    @objc private func about() {
        NSApplication.shared.orderFrontStandardAboutPanel(options: [
            .applicationName: "OpenSky", .applicationVersion: "Native UI 1.3.5 · API 1.3.0",
            .credits: NSAttributedString(string: "Your agent. Your Mac.\nOpen source · MIT\nLocal MCP, CLI and JavaScript computer use.")
        ])
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc private func quit() { SafetyController.shared.setStopped(true); NSApplication.shared.terminate(nil) }
}
