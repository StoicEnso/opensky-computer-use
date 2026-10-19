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
    try checkInteractionModeDisplay(to: directory, save: save)
    try renderAgentActivityPreview(to: directory, save: save)
    try checkOwnAXExecution()
    try checkInspectorTargetPicker()
    try checkEditingShortcut()
    var readTime: TimeInterval = 0
    var readCurrent = true
    let readBudget = AXObservationBudget(now: { readTime }, isCurrent: { readCurrent })
    precondition(readBudget.permitsRead)
    readTime = 8; precondition(!readBudget.permitsRead && !readBudget.cancelled)
    readTime = 1; readCurrent = false; precondition(!readBudget.permitsRead && readBudget.cancelled)
    for role in [kAXMenuRole, kAXMenuItemRole, kAXMenuBarItemRole] {
        precondition(OwnMenuHitTesting.permits(role: role, hitPID: 7, targetPID: 7, currentPID: 7), "Own real menus must not be treated as pointer overlays")
        precondition(!OwnMenuHitTesting.permits(role: role, hitPID: 8, targetPID: 7, currentPID: 7), "Another app's menu must remain foreign")
        precondition(!OwnMenuHitTesting.permits(role: role, hitPID: 7, targetPID: 8, currentPID: 7), "An own menu must not authorize another target")
    }
    precondition(!OwnMenuHitTesting.permits(role: kAXWindowRole, hitPID: 7, targetPID: 7, currentPID: 7), "Own windows and overlays still require normal-window ownership")
    try checkWindowFeedback(to: directory)
    precondition(UserActivityTracker.isAutoConfig(["mode": "auto"]))
    precondition(UserActivityTracker.isAutoConfig(["mode": "alongside", "cooperation_policy": "auto"]))
    precondition(!UserActivityTracker.isAutoConfig(["mode": "alongside"]))
    precondition(!UserActivityTracker.isAutoConfig(["mode": "desktop", "cooperation_policy": "auto"]))
    var activity = ExternalActivityClock(now: 100)
    let taggedMove = CGEvent(mouseEventSource: UserActivityTracker.eventSource(), mouseType: .mouseMoved,
                             mouseCursorPosition: .zero, mouseButton: .left)
    precondition(taggedMove?.getIntegerValueField(.eventSourceUserData) == ExternalActivityClock.ownEventMarker,
                 "Production pointer events must retain their Quartz marker; no event is posted by this check")
    activity.observe(marker: ExternalActivityClock.ownEventMarker, now: 400)
    activity.observe(marker: ExternalActivityClock.ownEventMarker, now: 401)
    precondition(activity.idle(at: 401) == 301, "Own synthetic input must not restart external idle time")
    precondition(activity.idle(at: 402, generalIdle: 0) == 0, "An OS event without a callback must count conservatively")
    activity.observe(marker: ExternalActivityClock.ownEventMarker, now: 402)
    precondition(activity.idle(at: 402, generalIdle: 0) == 302, "A delayed own callback must restore idle continuity")
    activity.observe(marker: nil, now: 402)
    precondition(activity.idle(at: 402) == 0, "External input must end idle time")
    activity.observe(marker: nil, now: 410)
    precondition(activity.idle(at: 410) == 0, "Unknown input must count conservatively as external")
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
    print("UI fixtures rendered offscreen; independent cache, search, clear-on-close, stale-result recovery, own-action main-thread/cancellation, external-activity clock and template checks passed.")
}

private func checkInspectorTargetPicker() throws {
    let model = InspectorModel(readTargets: { [] }, readWindow: { _ in fatalError("No live read") }, readPermissions: { (false, false, false) })
    let target = InspectorTarget(app: "dev.opensky.fixture", windowID: 7, label: "Disposable fixture · #7")
    model.targets = [target]
    let hosting = NSHostingView(rootView: InspectorTargetPicker(model: model))
    hosting.frame = NSRect(x: 0, y: 0, width: 400, height: 40)
    let window = NSWindow(contentRect: hosting.frame, styleMask: [], backing: .buffered, defer: false)
    window.contentView = hosting
    RunLoop.current.run(until: Date().addingTimeInterval(0.15))
    func picker(_ view: NSView) -> NSPopUpButton? {
        if let button = view as? NSPopUpButton { return button }
        return view.subviews.lazy.compactMap { picker($0) }.first
    }
    guard let button = picker(hosting), let menu = button.menu, let action = button.action else {
        throw NSError(domain: "Stable Inspector picker", code: 1)
    }
    precondition(button.numberOfItems == 2)
    button.selectItem(at: 1); button.sendAction(action, to: button.target)
    precondition(model.selectedTarget == target.id, "Native menu selection must update the Inspector binding")
    model.busy = true
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    precondition(picker(hosting) === button && button.menu === menu && !button.isEnabled,
                 "Ordinary model updates must preserve control/menu identity")
    window.contentView = nil
}

private func checkOwnAXExecution() throws {
    let own = AXUIElementCreateApplication(ProcessInfo.processInfo.processIdentifier)
    func background(generation: UInt64, expectAction: Bool) throws {
        let lock = NSLock(); var finished = false; var success = false
        DispatchQueue.global().async {
            var called = false
            let result = SafetyController.shared.withGeneration(generation) {
                OpenSkyAXActions.run(own) {
                    called = true
                    return Thread.isMainThread && SafetyController.shared.operationGeneration == generation ? .success : .failure
                }
            }
            lock.lock(); success = expectAction ? called && result == .success : !called && result == .cannotComplete; finished = true; lock.unlock()
        }
        let end = Date().addingTimeInterval(3)
        while Date() < end {
            lock.lock(); let done = finished; lock.unlock(); if done { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        lock.lock(); let passed = finished && success; lock.unlock()
        if !passed { throw NSError(domain: "Own AX main-thread/cancellation regression", code: 1) }
    }
    // Reads can instantiate lazy AppKit rows, so test their thread independently
    // of mutating AX actions and ensure observation remains available when paused.
    func backgroundRead() throws {
        let lock = NSLock(); var finished = false; var correct = false
        let generation = SafetyController.shared.operationGeneration
        DispatchQueue.global().async {
            let read = SafetyController.shared.withGeneration(generation) {
                OpenSkyAXActions.read(own) {
                    Thread.isMainThread && SafetyController.shared.operationGeneration == generation
                }
            }
            lock.lock(); correct = read; finished = true; lock.unlock()
        }
        let end = Date().addingTimeInterval(3)
        while Date() < end {
            lock.lock(); let done = finished; lock.unlock(); if done { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        lock.lock(); let passed = finished && correct; lock.unlock()
        if !passed { throw NSError(domain: "Own AX read main-thread regression", code: 1) }
    }
    try backgroundRead()
    SafetyController.shared.setStopped(true)
    try backgroundRead()
    SafetyController.shared.setStopped(false)
    let original = SafetyController.shared.operationGeneration
    try background(generation: original, expectAction: true)
    SafetyController.shared.setStopped(true); SafetyController.shared.setStopped(false)
    try background(generation: original, expectAction: false)
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


private func checkWindowFeedback(to directory: URL) throws {
    let target = PointerWindow(id: 1, pid: 11, frame: CGRect(x: 40, y: 40, width: 320, height: 220), layer: 0, alpha: 1)
    let focus = PointerWindow(id: 2, pid: 22, frame: CGRect(x: 150, y: 80, width: 180, height: 140), layer: 0, alpha: 1)
    let scope = PointerFeedbackScope(pid: 11, windowID: 1)
    let regions = PointerFeedbackGeometry.regions(scope: scope, windows: [focus, target], focusedPID: 22, ownerActive: true)
    precondition(!regions.isEmpty, "Typing elsewhere must not hide exposed background work")
    precondition(regions.allSatisfy { $0.intersection(focus.frame).isNull || $0.intersection(focus.frame).isEmpty })
    precondition(regions.allSatisfy { target.frame.contains($0) })
    precondition(PointerFeedbackGeometry.regions(scope: scope, windows: [target], focusedPID: 11, ownerActive: true).isEmpty, "Protect the active owner's target window")
    precondition(!PointerFeedbackGeometry.regions(scope: scope, windows: [target], focusedPID: 11, ownerActive: false).isEmpty)
    precondition(PointerFeedbackGeometry.regions(scope: scope, windows: [target], focusedPID: nil, ownerActive: true).isEmpty)
    precondition(PointerFeedbackGeometry.regions(scope: scope, windows: [focus], focusedPID: 22, ownerActive: true).isEmpty)
    let covering = PointerWindow(id: 3, pid: 33, frame: target.frame, layer: 0, alpha: 1)
    precondition(PointerFeedbackGeometry.regions(scope: scope, windows: [focus, covering, target], focusedPID: 22, ownerActive: true).isEmpty)
    let sameAppFocus = PointerWindow(id: 4, pid: 11, frame: focus.frame, layer: 0, alpha: 1)
    precondition(!PointerFeedbackGeometry.regions(scope: scope, windows: [sameAppFocus, target], focusedPID: 11, ownerActive: true).isEmpty, "Same-app background windows remain independent")
    let transparentPlane = PointerWindow(id: 8, pid: 88, frame: target.frame, layer: 1000, alpha: 1)
    precondition(PointerFeedbackGeometry.regions(scope: scope, windows: [transparentPlane, focus, target], focusedPID: 22, ownerActive: true) == regions, "Higher layers occlude through WindowServer; transparent planes must not erase exposed work")
    let duplicateCover = PointerWindow(id: 5, pid: 55, frame: focus.frame, layer: 1, alpha: 1)
    let twice = PointerFeedbackGeometry.regions(scope: scope, windows: [focus, duplicateCover, target], focusedPID: 22, ownerActive: true)
    precondition(twice == regions, "Overlapping covers must not punch visible holes")
    for (offset, name) in [(CGPoint.zero, "window-feedback"), (CGPoint(x: 2560, y: 174), "window-feedback-offset")] {
    let shifted = regions.map { $0.offsetBy(dx: offset.x, dy: offset.y) }
    try CursorOverlayManager.shared.withOffscreenFeedbackFixture(regions: shifted, offset: offset) { view in
        let window = NSWindow(contentRect: view.frame, styleMask: [], backing: .buffered, defer: false)
        window.contentView = view; view.layoutSubtreeIfNeeded()
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw NSError(domain: "Pointer fixture", code: 1) }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        var painted = 0
        let scale = CGFloat(bitmap.pixelsWide) / 400
        for y in 0..<bitmap.pixelsHigh {
            for x in 0..<bitmap.pixelsWide {
                let point = CGPoint(x: (CGFloat(x) + 0.5) / scale + offset.x, y: (CGFloat(y) + 0.5) / scale + offset.y)
                let alpha = bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0
                if !shifted.contains(where: { $0.contains(point) }) {
                    precondition(alpha < 0.01, "Feedback painted outside the visible target or over the focused window")
                } else if alpha > 0.1 { painted += 1 }
            }
        }
        precondition(painted > 20, "Background feedback must remain visible in exposed regions")
        try bitmap.representation(using: .png, properties: [:])?.write(to: directory.appendingPathComponent("2026-10-17-opensky-\(name)-Codex.png"))
        window.contentView = nil
    }
    }
    print("Window feedback checks passed: exposed background pixels, covered/focused-window exclusion, independent same-app windows and overlapping occluders.")
}

private func checkEditingShortcut() throws {
    let editor = NSTextView(frame: NSRect(x: 0, y: 0, width: 200, height: 40))
    editor.string = "café cloud ✓"
    editor.setSelectedRange(NSRange(location: 0, length: 0))
    let menu = OpenSkyEditingMenu.make()
    guard let select = menu.items.first(where: { $0.action == #selector(NSText.selectAll(_:)) }),
          let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command,
             timestamp: 0, windowNumber: 0, context: nil, characters: "a", charactersIgnoringModifiers: "a", isARepeat: false, keyCode: 0) else {
        throw NSError(domain: "Standard editing shortcut unavailable", code: 1)
    }
    select.target = editor // Fixture editor only; production resolves its first responder.
    guard menu.performKeyEquivalent(with: event), editor.selectedRange().length == editor.string.utf16.count else {
        throw NSError(domain: "Command+A must select the complete Unicode text", code: 1)
    }
}
