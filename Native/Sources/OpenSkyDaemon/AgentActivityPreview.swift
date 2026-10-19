import AppKit
import SwiftUI

/// Pure fixtures: no owner-app reads, control requests, permission prompts or service startup.
func renderAgentActivityPreview(to directory: URL, save: (NSView, String) throws -> Void) throws {
    let now = Date().timeIntervalSince1970 * 1000
    func record(_ id: Int, name: String, pending: [String] = [], pid: Int32 = 10) throws -> AgentActivityRecord {
        let value: [String: Any] = ["schema": 1, "id": String(format: "%08d-0000-0000-0000-000000000000", id), "pid": pid,
            "name": name, "interface": "MCP", "updated_at": now, "day": AgentActivitySnapshot.day(at: now),
            "calls": 42, "failed": 0, "deferred": 1, "duration_ms": 12600,
            "pending": pending.enumerated().map { ["id": "call-\($0.offset)", "method": $0.element, "started_at": now - 200] as [String: Any] },
            "buckets": (0..<15).map { ["minute": floor(now / 60000) * 60000 - Double(14 - $0) * 60000,
                                      "calls": [1, 2, 0, 0, 3, 1, 2, 0, 1, 4, 3, 2, 5, 3, 2][$0]] }]
        return try JSONDecoder().decode(AgentActivityRecord.self, from: JSONSerialization.data(withJSONObject: value))
    }
    let a = try record(1, name: "Codex", pending: ["browser.snapshot", "native.get_app_state"])
    let b = try record(2, name: "Claude Code", pending: ["browser.fill"])
    let c = try record(3, name: "Cursor")
    let dead = try record(4, name: "Antigravity", pending: ["browser.upload"], pid: 99)
    let records = [a, b, c, dead]
    let summary = AgentActivitySnapshot.aggregate(records, now: now, isAlive: { $0 != 99 })
    precondition(summary.working == 2 && summary.recent == 1 && summary.calls == 168)
    precondition(summary.clients.count == 3 && summary.clients[0].pending == 2 && summary.averageMS == 300)
    precondition(AgentActivitySnapshot.aggregate(records, now: now + 90001, isAlive: { _ in true }).working == 0)
    precondition(AgentActivitySnapshot.aggregate(records, now: now + 90001, isAlive: { _ in true }).recent == 0)
    precondition(AgentActivitySnapshot.aggregate(records, now: now + 86400000, isAlive: { _ in false }).calls == 0)
    let temp = FileManager.default.temporaryDirectory.appendingPathComponent("2026-10-19-activity-preview-Codex-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: temp) }
    try FileManager.default.createDirectory(at: temp.appendingPathComponent("agent-activity"), withIntermediateDirectories: true)
    try Data("{corrupt".utf8).write(to: temp.appendingPathComponent("agent-activity/11111111-1111-1111-1111-111111111111.json"))
    precondition(AgentActivitySnapshot.read(home: temp).clients.isEmpty)
    // Check the actual NSPopover/NSHostingController container, not only NSView images.
    // Hosting controllers initially have a zero frame; a native popover needs an explicit fit.
    let sizingModel = AgentActivityModel(home: temp)
    let content = NSHostingController(rootView: AgentActivityView(model: sizingModel))
    let popover = NSPopover(); popover.contentViewController = content
    sizeAgentActivityPopover(popover, content: content)
    let quietSize = popover.contentSize
    precondition(quietSize.width == 380 && quietSize.height > 350 && quietSize.height < 760)
    sizingModel.snapshot = summary
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    sizeAgentActivityPopover(popover, content: content)
    precondition(popover.contentSize.width == 380 && popover.contentSize.height > quietSize.height,
                 "The actual native panel must grow when working client rows arrive")
    sizingModel.snapshot = AgentActivitySnapshot()
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    sizeAgentActivityPopover(popover, content: content)
    precondition(popover.contentSize == quietSize, "The panel must shrink back to its compact quiet state")
    popover.contentViewController = nil
    for (name, appearance, snapshot, paused, mode) in [
        ("working-light", NSAppearance.Name.aqua, summary, false, InteractionModeDisplay(policy: .auto, effective: .alongside, reason: .ownerActive)),
        ("working-dark", .darkAqua, summary, false, InteractionModeDisplay(policy: .auto, effective: .desktop, reason: .idle)),
        ("quiet-light", .aqua, AgentActivitySnapshot(), false, InteractionModeDisplay(policy: .alongside, effective: .alongside, reason: .selected)),
        ("paused-dark", .darkAqua, summary, true, InteractionModeDisplay(policy: .auto, effective: .alongside, reason: .ownerActive)),
        ("temporary-light", .aqua, AgentActivitySnapshot(), false, InteractionModeDisplay(policy: .auto, effective: .desktop, reason: .temporary)),
        ("unavailable-dark", .darkAqua, AgentActivitySnapshot(), false, InteractionModeDisplay(policy: .auto, effective: .alongside, reason: .unavailable))
    ] {
        let model = AgentActivityModel(home: temp); model.snapshot = snapshot; model.paused = paused
        model.permissionsReady = true; model.mode = mode
        let view = NSHostingView(rootView: AgentActivityView(model: model))
        let size = view.fittingSize
        precondition(size.width == 380 && size.height > 350 && size.height < 760, "Activity must fit a compact menu panel")
        print("Activity preview \(name): \(size.width) × \(size.height)")
        view.frame = NSRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: view.frame, styleMask: [], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: appearance); window.contentView = view
        RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        try save(view, "2026-10-19-opensky-activity-\(name)-Codex.png")
        window.contentView = nil; model.stop()
    }
    print("Agent activity fixtures passed: distinct clients, concurrent calls, exited/stale expiry, day rollover, corrupt record recovery, actual popover initial/grow/shrink sizing and light/dark/quiet/paused native rendering.")
}
