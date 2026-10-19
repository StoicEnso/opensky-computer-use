import AppKit
import SwiftUI

/// NSHostingController starts with a zero view/preferred size outside a window.
/// Fit the actual content before presentation and after its client rows change.
func sizeAgentActivityPopover(_ popover: NSPopover, content: NSViewController) {
    content.view.layoutSubtreeIfNeeded()
    let fitting = (content as? NSHostingController<AgentActivityView>)?.sizeThatFits(in: NSSize(width: 380, height: 1000)) ?? content.view.fittingSize
    let size = NSSize(width: 380, height: ceil(fitting.height))
    content.preferredContentSize = size
    content.view.setFrameSize(size)
    popover.contentSize = size
}

struct AgentActivityRecord: Decodable {
    struct Pending: Decodable { let id: String; let method: String; let started_at: Double }
    struct Bucket: Decodable { let minute: Double; let calls: Double }
    let schema: Int; let id: String; let pid: Int32; let name: String; let `interface`: String
    let updated_at: Double; let day: String; let calls: Double; let failed: Double; let deferred: Double; let duration_ms: Double
    let pending: [Pending]; let buckets: [Bucket]
}

struct AgentActivityClient: Identifiable {
    let id: String; let name: String; let transport: String; let working: Bool; let pending: Int; let method: String; let lastSeen: Double
    var symbol: String { name == "Terminal" || name == "Claude Code" ? "terminal" : "app.connected.to.app.below.fill" }
    var operation: String {
        let action = method.split(separator: ".").last.map(String.init) ?? ""
        switch action {
        case "snapshot", "get_app_state", "frames", "list_apps", "tabs_list": return "Inspecting"
        case "fill", "set_value", "type_text", "paste": return "Entering text"
        case "upload": return "Uploading a file"
        case "screenshot", "screenshot_screen": return "Capturing a view"
        case "tab_open", "tab_claim", "tab_close", "tab_release", "tab_navigate": return "Managing a tab"
        case "click", "press_key", "drag", "scroll", "select_option", "perform_secondary_action", "select_text", "manage_window", "run_applescript": return "Controlling an app"
        default: return "Using OpenSky"
        }
    }
}

struct AgentActivitySnapshot {
    var working = 0; var recent = 0; var calls: Double = 0; var failed: Double = 0; var deferred: Double = 0; var duration: Double = 0
    var clients: [AgentActivityClient] = []; var buckets = Array(repeating: 0.0, count: 15)
    var averageMS: Double { calls > 0 ? duration / calls : 0 }
    static let names = Set(["Claude Code", "Claude", "Codex", "Antigravity", "Cursor", "Terminal", "JavaScript", "MCP client"])
    static let actions = Set(["native.list_apps", "native.get_app_state", "native.click", "native.drag", "native.scroll", "native.set_value", "native.type_text", "native.press_key", "native.paste", "native.perform_secondary_action", "native.select_text", "native.manage_window", "native.run_applescript", "native.screenshot_screen", "browser.tabs_list", "browser.tab_open", "browser.tab_claim", "browser.tab_navigate", "browser.tab_close", "browser.tab_release", "browser.snapshot", "browser.frames", "browser.click", "browser.fill", "browser.upload", "browser.press_key", "browser.select_option", "browser.screenshot"])
    static func day(at ms: Double) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: ms / 1000))
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
    static func read(home: URL, now: Double = Date().timeIntervalSince1970 * 1000,
                     isAlive: (Int32) -> Bool = { kill($0, 0) == 0 || errno == EPERM }) -> Self {
        let directory = home.appendingPathComponent("agent-activity")
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])) ?? []
        var records: [AgentActivityRecord] = []
        for url in urls where url.lastPathComponent.range(of: "^[a-f0-9-]{36}\\.json$", options: .regularExpression) != nil {
            guard let info = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]),
                  info.isRegularFile == true, info.isSymbolicLink != true, (info.fileSize ?? Int.max) <= 65536,
                  let data = try? Data(contentsOf: url), let record = try? JSONDecoder().decode(AgentActivityRecord.self, from: data),
                  record.id + ".json" == url.lastPathComponent else { continue }
            records.append(record)
        }
        return aggregate(records, now: now, isAlive: isAlive)
    }
    static func aggregate(_ records: [AgentActivityRecord], now: Double, isAlive: (Int32) -> Bool) -> Self {
        var result = Self(); let minute = floor(now / 60000) * 60000
        for record in records {
            guard record.schema == 1, record.pid > 0, record.updated_at.isFinite,
                  record.updated_at <= now + 1000, record.updated_at >= now - 2 * 86400000,
                  [record.calls, record.failed, record.deferred, record.duration_ms].allSatisfy({ $0.isFinite && $0 >= 0 }) else { continue }
            if record.day == day(at: now) {
                result.calls += record.calls; result.failed += record.failed; result.deferred += record.deferred; result.duration += record.duration_ms
            }
            for bin in record.buckets where bin.minute.isFinite && bin.calls.isFinite && bin.calls >= 0 {
                let offset = (minute - bin.minute) / 60000
                if offset >= 0 && offset < 15 && offset.rounded() == offset { result.buckets[14 - Int(offset)] += bin.calls }
            }
            guard isAlive(record.pid) else { continue }
            let pending = record.pending.filter { actions.contains($0.method) && $0.started_at.isFinite && $0.started_at <= now && $0.started_at >= now - 90000 }
            let working = !pending.isEmpty, recent = now - record.updated_at <= 60000
            guard working || recent else { continue }
            if working { result.working += 1 } else { result.recent += 1 }
            result.clients.append(AgentActivityClient(id: record.id, name: names.contains(record.name) ? record.name : "MCP client",
                transport: ["MCP", "CLI", "SDK"].contains(record.interface) ? record.interface : "SDK",
                working: working, pending: pending.count, method: pending.first?.method ?? "", lastSeen: record.updated_at))
        }
        result.clients.sort { a, b in a.working != b.working ? a.working : a.lastSeen != b.lastSeen ? a.lastSeen > b.lastSeen : a.id < b.id }
        return result
    }
}

final class AgentActivityModel: ObservableObject {
    @Published var snapshot = AgentActivitySnapshot()
    @Published var paused = false
    @Published var permissionsReady = false
    @Published var mode = InteractionModeDisplay.unavailable
    private var timer: Timer?; private var reading = false; private var generation = 0
    private let home: URL
    init(home: URL = URL(fileURLWithPath: ProcessInfo.processInfo.environment["OPENSKY_HOME"] ?? NSHomeDirectory() + "/.local/share/opensky")) { self.home = home }
    func start() {
        guard timer == nil else { return }; refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
    }
    func stop() { timer?.invalidate(); timer = nil; generation += 1; reading = false }
    func refresh() {
        paused = SafetyController.shared.isStopped
        permissionsReady = AXEngine.shared.isAXTrusted() && CGPreflightScreenCaptureAccess() && CGPreflightPostEventAccess()
        guard !reading else { return }; reading = true
        let generation = self.generation, home = self.home
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let snapshot = AgentActivitySnapshot.read(home: home)
            DispatchQueue.main.async {
                guard let self, self.generation == generation else { return }
                self.reading = false; self.snapshot = snapshot
            }
        }
    }
    deinit { timer?.invalidate() }
}

struct AgentActivityView: View {
    @ObservedObject var model: AgentActivityModel
    var inspector: () -> Void = {}; var setup: () -> Void = {}; var pause: () -> Void = {}; var about: () -> Void = {}; var quit: () -> Void = {}
    private var data: AgentActivitySnapshot { model.snapshot }
    private var tint: Color { model.paused ? .orange : Color(red: 0.12, green: 0.64, blue: 0.48) }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(nsImage: CloudMark.image(stopped: model.paused)).resizable().scaledToFit().frame(width: 29, height: 26).foregroundStyle(.cyan)
                Text("OpenSky").font(.system(size: 16, weight: .semibold))
                Spacer()
                HStack(spacing: 5) {
                    Circle().fill(tint).frame(width: 5, height: 5)
                    Text(model.paused ? "Paused" : "Live").font(.system(size: 11, weight: .medium))
                }.padding(.horizontal, 9).padding(.vertical, 5).background(tint.opacity(0.10), in: Capsule())
            }.padding(.bottom, 16)
            modeCard.padding(.bottom, 16)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(data.working)").font(.system(size: 46, weight: .semibold, design: .rounded)).monospacedDigit()
                VStack(alignment: .leading, spacing: 3) {
                    Text(data.working == 1 ? "client working now" : "clients working now").font(.system(size: 14, weight: .medium))
                    Text(model.paused ? "Control is paused" : data.working > 0 ? "Real calls in flight" : "Ready when your agents are")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }.accessibilityElement(children: .combine).padding(.bottom, 20)
            HStack(spacing: 0) {
                metric("Calls today", count(data.calls))
                Divider().frame(height: 30)
                metric("Avg. response", latency(data.averageMS))
                Divider().frame(height: 30)
                metric("Deferred", count(data.deferred))
            }.padding(.vertical, 13).background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
            HStack { Text("ACTIVITY"); Spacer(); Text("LAST 15 MIN") }
                .font(.system(size: 9, weight: .semibold)).tracking(0.8).foregroundStyle(.secondary).padding(.top, 20).padding(.bottom, 10)
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(data.buckets.indices, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 2).fill(data.buckets[index] > 0 ? tint.opacity(0.72) : Color.primary.opacity(0.07))
                        .frame(height: data.buckets[index] > 0 ? max(5, 35 * data.buckets[index] / max(1, data.buckets.max() ?? 1)) : 3)
                        .frame(maxWidth: .infinity)
                }
            }.frame(height: 36, alignment: .bottom).accessibilityLabel("Calls over the last fifteen minutes: \(count(data.buckets.reduce(0, +)))")
            Divider().padding(.vertical, 17)
            HStack {
                Text("Clients").font(.system(size: 12, weight: .semibold))
                Spacer()
                Text("\(data.recent) recently active").font(.system(size: 10)).foregroundStyle(.secondary)
            }.padding(.bottom, 10)
            if data.clients.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "sparkle").foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("A little quiet right now").font(.system(size: 12, weight: .medium))
                        Text("Clients appear when they use OpenSky.").font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12)
            } else {
                ScrollView {
                    VStack(spacing: 3) { ForEach(data.clients) { client in clientRow(client) } }
                }.frame(height: min(180, CGFloat(data.clients.count) * 48)).scrollIndicators(.hidden)
            }
            if data.failed > 0 {
                Label("\(count(data.failed)) unsuccessful calls today", systemImage: "exclamationmark.circle")
                    .font(.system(size: 10)).foregroundStyle(.secondary).padding(.top, 9)
            }
            Divider().padding(.top, 13).padding(.bottom, 12)
            HStack(spacing: 6) {
                Image(systemName: model.permissionsReady ? "checkmark.shield" : "exclamationmark.shield")
                Text(model.permissionsReady ? "Mac permissions ready" : "Mac permissions needed")
                Spacer()
            }.font(.system(size: 10)).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Button(action: inspector) { Label("Inspector", systemImage: "viewfinder").frame(maxWidth: .infinity) }
                Button(action: pause) { Label(model.paused ? "Resume" : "Pause", systemImage: model.paused ? "play.fill" : "pause.fill").frame(maxWidth: .infinity) }
                    .accessibilityIdentifier("dev.opensky.activity.pause")
                Menu { Button("Setup & Connections…", action: setup); Button("About OpenSky", action: about); Divider(); Button("Quit OpenSky", action: quit) }
                    label: { Image(systemName: "ellipsis").frame(width: 18) }
                    .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("OpenSky options")
            }.controlSize(.regular).padding(.top, 13)
            Text("Local counters · no page content recorded").font(.system(size: 9)).foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity).padding(.top, 12)
        }.padding(20).frame(width: 380).fixedSize(horizontal: false, vertical: true).background(.regularMaterial)
    }
    private var modeCard: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: model.paused ? "pause.fill" : model.mode.symbol)
                .font(.system(size: 16, weight: .medium)).frame(width: 28)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(model.mode.title(paused: model.paused, permissionsReady: model.permissionsReady))
                        .font(.system(size: 12, weight: .semibold))
                    Spacer(minLength: 0)
                    Text(model.mode.badge).font(.system(size: 9, weight: .medium))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(.primary.opacity(0.06), in: Capsule())
                }
                Text(model.mode.detail(paused: model.paused, permissionsReady: model.permissionsReady))
                    .font(.system(size: 10)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }.padding(12).frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .combine).accessibilityIdentifier("dev.opensky.activity.mode")
    }
    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(value).font(.system(size: 17, weight: .semibold)).monospacedDigit()
            Text(title).font(.system(size: 10)).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 13)
    }
    private func clientRow(_ client: AgentActivityClient) -> some View {
        HStack(spacing: 10) {
            Image(systemName: client.symbol).font(.system(size: 14)).foregroundStyle(client.working ? tint : .secondary)
                .frame(width: 30, height: 30).background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) { Text(client.name).font(.system(size: 12, weight: .medium)); Text(client.transport).font(.system(size: 9)).foregroundStyle(.tertiary) }
                Text(client.working ? client.operation : "Recently active").font(.system(size: 10)).foregroundStyle(.secondary)
            }
            Spacer()
            if client.working {
                Circle().fill(tint).frame(width: 6, height: 6).accessibilityLabel("\(client.pending) calls in flight")
            } else { Text("Idle").font(.system(size: 10)).foregroundStyle(.tertiary) }
        }.frame(height: 45).accessibilityElement(children: .combine)
    }
    private func count(_ value: Double) -> String { Int(min(Double(Int.max / 2), max(0, value))).formatted() }
    private func latency(_ ms: Double) -> String { data.calls == 0 ? "—" : ms < 1000 ? "\(Int(ms)) ms" : String(format: "%.1f s", ms / 1000) }
}
