import AppKit

// Disposable data for the opt-in live Inspector test. Never activates itself.
final class InspectorFixture: NSObject, NSApplicationDelegate {
    let window = NSWindow(contentRect: NSRect(x: 55, y: 190, width: 540, height: 360), styleMask: [.titled, .closable], backing: .buffered, defer: false)
    func applicationDidFinishLaunching(_ notification: Notification) {
        window.title = "OpenSky Inspector Search Fixture"
        window.isReleasedWhenClosed = false
        let title = NSTextField(labelWithString: "Inspector search verification")
        title.frame = NSRect(x: 24, y: 295, width: 480, height: 30)
        let field = NSTextField(string: "café cloud ✓")
        field.frame = NSRect(x: 24, y: 235, width: 460, height: 28)
        field.setAccessibilityLabel("Project title"); field.setAccessibilityIdentifier("fixture.project")
        let commit = NSButton(title: "Commit sample", target: nil, action: nil)
        commit.frame = NSRect(x: 24, y: 165, width: 155, height: 32)
        commit.setAccessibilityIdentifier("fixture.commit")
        let local = NSButton(checkboxWithTitle: "Use local copy", target: nil, action: nil)
        local.frame = NSRect(x: 24, y: 115, width: 200, height: 28)
        local.setAccessibilityIdentifier("fixture.local")
        let disabled = NSButton(title: "Unavailable action", target: nil, action: nil)
        disabled.frame = NSRect(x: 220, y: 165, width: 180, height: 32)
        disabled.isEnabled = false; disabled.setAccessibilityIdentifier("fixture.disabled")
        for view in [title, field, commit, local, disabled] { window.contentView?.addSubview(view) }
        window.orderBack(nil)
    }
}
let app = NSApplication.shared
let delegate = InspectorFixture(); app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
