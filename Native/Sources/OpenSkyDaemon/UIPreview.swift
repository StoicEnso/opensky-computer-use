import AppKit
import SwiftUI

/// Disposable, offscreen design fixtures. Never enumerates or captures the owner's apps.
func renderUIPreview(to directory: URL) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    func save(_ view: NSView, _ name: String) throws {
        view.layoutSubtreeIfNeeded()
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw NSError(domain: "UI preview", code: 1) }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { throw NSError(domain: "UI preview", code: 2) }
        try data.write(to: directory.appendingPathComponent(name))
    }
    precondition(AXEngine.inspectorEngine() !== AXEngine.shared, "Inspector must own its cache")
    let model = InspectorModel()
    let target = InspectorTarget(app: "dev.opensky.disposable-fixture", windowID: 4242, label: "OpenSky Fixture · Project Notes · #4242")
    model.targets = [target]; model.selectedTarget = target.id
    model.accessibility = true; model.screenRecording = true
    model.elements = [
        ("AXWindow", "Project Notes", "", false, [String]()),
        ("AXTextField", "Project name", "A little more sky", true, ["AXConfirm"]),
        ("AXButton", "Save note", "", false, ["AXPress"]),
        ("AXCheckBox", "Keep a local copy", "1", true, ["AXPress"]),
        ("AXStaticText", "All changes saved", "", false, [String]())
    ].enumerated().map { i, sample in
        ElementSummary(IndexedAXNode(index: i, axElement: nil, role: sample.0, title: sample.1, value: sample.2,
            frame: CGRect(x: 100, y: 100 + i * 30, width: 240, height: 24), isSettable: sample.3, actions: sample.4, identifier: "fixture.control.\(i)"))
    }
    model.selectedElement = 1; model.message = "5 controls · Window #4242 · Disposable preview data"
    for (name, appearance) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 660), styleMask: [], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: appearance)
        let view = NSHostingView(rootView: InspectorView(model: model)); view.frame = window.contentView!.bounds
        window.contentView = view
        view.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        try save(view, "2026-10-17-opensky-inspector-\(name)-Codex.png")
        window.contentView = nil
    }
    let marks = NSHostingView(rootView: TrayPreview())
    marks.frame = NSRect(x: 0, y: 0, width: 800, height: 220)
    let window = NSWindow(contentRect: marks.frame, styleMask: [], backing: .buffered, defer: false)
    window.appearance = NSAppearance(named: .aqua); window.contentView = marks
    RunLoop.current.run(until: Date().addingTimeInterval(0.2))
    try save(marks, "2026-10-17-opensky-tray-preview-Codex.png")
    model.search = "PROJECT"; precondition(model.visibleElements.count == 2, "Search must match labels and values without case sensitivity")
    model.close(); precondition(model.elements.isEmpty && model.targets.isEmpty && model.selectedTarget.isEmpty && model.search.isEmpty, "Closing clears locally observed content")
    precondition(CloudMark.image().isTemplate && CloudMark.image(stopped: true).isTemplate)
    try checkInspectorRecovery()
    precondition(NSWorkspace.shared.frontmostApplication?.processIdentifier != ProcessInfo.processInfo.processIdentifier,
                 "Offscreen rendering must not activate the preview process")
    print("UI fixtures rendered offscreen; independent cache, search, clear-on-close, stale-result recovery and template checks passed.")
}

private func checkInspectorRecovery() throws {
    let first = InspectorTarget(app: "dev.opensky.fixture", windowID: 1, label: "First fixture")
    let second = InspectorTarget(app: "dev.opensky.fixture", windowID: 2, label: "Second fixture")
    let gate = DispatchSemaphore(value: 0)
    let node = ElementSummary(IndexedAXNode(index: 1, axElement: nil, role: "AXButton", title: "Fixture control", value: nil, frame: nil, isSettable: false, actions: ["AXPress"]))
    let model = InspectorModel(readTargets: { [first, second] }, readWindow: { target in
        if target.windowID == 1 { _ = gate.wait(timeout: .now() + 3) }
        return AppSnapshotResult(success: true, error: nil, warnings: [], snapshotID: "fixture", screenshotWidth: nil,
            screenshotHeight: nil, screenshotFrame: nil, app: target.app, bundleId: target.app, displayName: "Fixture",
            pid: -1, windowId: target.windowID, windowFrame: nil, text: "Fixture", screenshotUrl: nil,
            screenshotPath: nil, axTrusted: true, elementCount: 1, elements: [node])
    }, readPermissions: { (true, false, true) })
    func wait(_ predicate: () -> Bool) throws {
        let deadline = Date().addingTimeInterval(4)
        while !predicate(), Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
        guard predicate() else { throw NSError(domain: "Inspector fixture timed out", code: 3) }
    }
    model.refreshWindows(); try wait { !model.busy }
    precondition(model.targets == [first, second] && model.stopped && !model.screenRecording)
    model.selectedTarget = first.id; model.inspect()
    model.selectedTarget = second.id
    precondition(model.elements.isEmpty)
    gate.signal()
    // Queue a current read behind the superseded one. Only the current result may render.
    model.inspect(); try wait { !model.busy }
    precondition(model.selectedTarget == second.id && model.message.contains("Window #2") && model.elements.count == 1)
    model.selectedTarget = first.id; model.inspect(); model.close(); gate.signal()
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    precondition(model.elements.isEmpty && model.targets.isEmpty && !model.busy)
}

private struct TrayPreview: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("OpenSky · A small companion in your menu bar").font(.system(size: 18, weight: .semibold))
            HStack(spacing: 16) {
                bar(dark: false, paused: false)
                bar(dark: true, paused: false)
                bar(dark: false, paused: true)
            }
            Text("Actual 20 × 18 pt template mark · Eyes when ready · Pause bars when stopped").font(.system(size: 12)).foregroundStyle(.secondary)
        }.padding(28).frame(width: 800, height: 220).background(Color(nsColor: .windowBackgroundColor))
    }
    private func bar(dark: Bool, paused: Bool) -> some View {
        HStack(spacing: 15) {
            Image(nsImage: CloudMark.image(stopped: paused)).renderingMode(.template).frame(width: 20, height: 18)
            Image(systemName: "wifi")
            Image(systemName: "battery.100")
            Text("9:41").font(.system(size: 12, weight: .medium))
        }.foregroundStyle(dark ? .white : .black).padding(.horizontal, 16).frame(height: 38)
            .background(dark ? Color(white: 0.14) : Color(white: 0.91), in: RoundedRectangle(cornerRadius: 9))
    }
}
