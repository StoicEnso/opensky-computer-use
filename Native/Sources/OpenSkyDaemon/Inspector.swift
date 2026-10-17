import AppKit
import SwiftUI

struct InspectorTarget: Identifiable, Equatable {
    let app: String
    let windowID: UInt32
    let label: String
    var id: String { "\(app):\(windowID)" }
}

final class InspectorModel: ObservableObject {
    @Published var targets: [InspectorTarget] = []
    @Published var selectedTarget = "" { didSet { if oldValue != selectedTarget { clearObservation() } } }
    @Published var elements: [ElementSummary] = []
    @Published var selectedElement: Int?
    @Published var search = ""
    @Published var busy = false
    @Published var message = "Choose a window, then inspect its controls."
    @Published var accessibility = false
    @Published var screenRecording = false
    @Published var stopped = false
    private var generation = 0
    private let queue = DispatchQueue(label: "dev.opensky.local-inspector", qos: .utility)
    private let readTargets: () -> [InspectorTarget]
    private let readWindow: (InspectorTarget) -> AppSnapshotResult
    private let readPermissions: () -> (Bool, Bool, Bool)
    init(readTargets: @escaping () -> [InspectorTarget] = InspectorModel.liveTargets,
         readWindow: @escaping (InspectorTarget) -> AppSnapshotResult = InspectorModel.liveWindow,
         readPermissions: @escaping () -> (Bool, Bool, Bool) = {
             (AXEngine.shared.isAXTrusted(), CGPreflightScreenCaptureAccess(), SafetyController.shared.isStopped)
         }) {
        self.readTargets = readTargets; self.readWindow = readWindow; self.readPermissions = readPermissions
    }
    static func liveTargets() -> [InspectorTarget] {
        AXEngine.inspectorEngine().listApps(includeRunningOnly: true).flatMap { app in
            (app.windows ?? []).map { window in
                InspectorTarget(app: app.id, windowID: window.id,
                    label: "\(app.displayName ?? app.id) · \(window.title?.isEmpty == false ? window.title! : "Untitled window") · #\(window.id)")
            }
        }
    }
    static func liveWindow(_ target: InspectorTarget) -> AppSnapshotResult {
        // Independent, short-lived cache: never invalidates an agent's AX handles.
        // No screenshots/OCR fallback, app launch, focus, input or clipboard access.
        AXEngine.inspectorEngine().getAppState(appIdentifier: target.app,
            includeScreenshot: false, includeOCR: false, launchIfNeeded: false,
            allowVisualFallback: false, windowID: target.windowID)
    }
    var visibleElements: [ElementSummary] {
        guard !search.isEmpty else { return elements }
        return elements.filter { [$0.role, $0.title, $0.value ?? "", $0.identifier ?? ""].joined(separator: " ").localizedCaseInsensitiveContains(search) }
    }

    func clearObservation() {
        generation += 1; elements = []; selectedElement = nil; busy = false
        message = "Choose a window, then inspect its controls."
    }

    func refreshWindows() {
        clearObservation(); busy = true
        // Passive checks: opening the Inspector never requests a Mac permission.
        (accessibility, screenRecording, stopped) = readPermissions()
        let request = generation
        queue.async {
            let targets = self.readTargets()
            DispatchQueue.main.async {
                guard self.generation == request else { return }
                self.targets = targets
                if !targets.contains(where: { $0.id == self.selectedTarget }) { self.selectedTarget = "" }
                self.busy = false
                self.message = targets.isEmpty ? "No on-screen windows found. Open or restore a window, then refresh." : "Choose a window, then inspect its controls."
            }
        }
    }

    func inspect() {
        guard !busy, let target = targets.first(where: { $0.id == selectedTarget }) else { return }
        clearObservation(); busy = true; message = "Reading the selected window…"
        let request = generation
        queue.async {
            let result = self.readWindow(target)
            DispatchQueue.main.async {
                guard self.generation == request else { return }
                self.busy = false; self.elements = result.elements
                self.accessibility = result.axTrusted
                let time = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
                self.message = result.error?.message ?? "\(result.elementCount) controls · Window #\(target.windowID) · Read at \(time)"
            }
        }
    }

    func close() { clearObservation(); targets = []; selectedTarget = ""; search = "" }
}

struct InspectorView: View {
    @ObservedObject var model: InspectorModel
    private var selection: ElementSummary? { model.elements.first { $0.elementIndex == model.selectedElement } }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                Image(nsImage: CloudMark.image()).resizable().scaledToFit().frame(width: 40, height: 36).foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 3) {
                    Text("A closer look.").font(.system(size: 26, weight: .semibold, design: .rounded))
                    Text("See the controls OpenSky can read in a window.").foregroundStyle(.secondary)
                }
                Spacer()
                Text(model.stopped ? "CONTROL PAUSED" : "READ ONLY").font(.system(size: 10, weight: .bold)).tracking(1).padding(8).background(.quaternary, in: Capsule())
            }
            HStack(spacing: 20) {
                Label(model.accessibility ? "Accessibility ready" : "Accessibility unavailable", systemImage: model.accessibility ? "checkmark.circle.fill" : "circle")
                Label(model.screenRecording ? "Screen capture ready" : "Screen capture unavailable", systemImage: model.screenRecording ? "checkmark.circle.fill" : "circle")
            }.font(.system(size: 12)).foregroundStyle(.secondary)
            HStack {
                Picker("Window", selection: $model.selectedTarget) {
                    Text("Choose a window…").tag("")
                    ForEach(model.targets) { Text($0.label).tag($0.id) }
                }.disabled(model.busy).accessibilityIdentifier("opensky.inspector.window")
                Button { model.refreshWindows() } label: { Image(systemName: "arrow.clockwise") }.help("Refresh window list").accessibilityLabel("Refresh window list").disabled(model.busy)
                Button("Inspect Window") { model.inspect() }.buttonStyle(.borderedProminent).disabled(model.busy || model.selectedTarget.isEmpty).accessibilityIdentifier("opensky.inspector.inspect")
            }
            HStack {
                if model.busy { ProgressView().controlSize(.small) }
                Text(model.message).font(.system(size: 12)).foregroundStyle(.secondary).textSelection(.enabled)
                Spacer()
            }
            HSplitView {
                VStack(spacing: 8) {
                    TextField("Find a control…", text: $model.search).textFieldStyle(.roundedBorder).accessibilityLabel("Find a control")
                    List(selection: $model.selectedElement) {
                        ForEach(model.visibleElements, id: \.elementIndex) { element in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(element.title.isEmpty ? element.role : element.title).lineLimit(1)
                                Text(element.role.replacingOccurrences(of: "AX", with: "") + (element.enabled ? "" : " · Disabled")).font(.system(size: 11)).foregroundStyle(.secondary)
                            }.padding(.vertical, 3).tag(element.elementIndex)
                        }
                    }.listStyle(.bordered(alternatesRowBackgrounds: true))
                    Text("\(model.visibleElements.count) of \(model.elements.count) controls").font(.system(size: 11)).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                }.frame(minWidth: 250)
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let element = selection {
                            Text(element.title.isEmpty ? "Untitled control" : element.title).font(.title3.bold())
                            detail("Role", element.role)
                            detail("Value", element.value ?? "—")
                            detail("Identifier", element.identifier ?? "—")
                            detail("Frame", element.frame?.map { String(format: "%.0f", $0) }.joined(separator: ", ") ?? "Unavailable")
                            detail("Available actions", element.actions.isEmpty ? "None" : element.actions.joined(separator: ", "))
                            detail("State", (element.enabled ? "Enabled" : "Disabled") + (element.settable ? " · Editable" : ""))
                        } else {
                            Image(systemName: "cursorarrow.and.square.on.square.dashed").font(.system(size: 28)).foregroundStyle(.secondary).padding(.top, 42)
                            Text("Choose a control").font(.headline)
                            Text("Its label, role, value and available actions appear here.").foregroundStyle(.secondary)
                        }
                    }.textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 18).padding(.vertical, 8)
                }.frame(minWidth: 250)
            }
            Text("Inspect when you need it. No continuous monitoring or automatic screenshots. Agent targets stay independent.").font(.system(size: 11)).foregroundStyle(.secondary)
        }.padding(24).frame(minWidth: 780, minHeight: 580).background(Color(nsColor: .windowBackgroundColor))
    }
    private func detail(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(.system(size: 10, weight: .semibold)).tracking(0.8).foregroundStyle(.secondary)
            Text(value).font(.system(size: 12, design: .monospaced)).fixedSize(horizontal: false, vertical: true)
        }
    }
}

final class InspectorWindowController: NSWindowController, NSWindowDelegate {
    let model = InspectorModel()
    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 660), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "OpenSky Inspector"; window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 820, height: 630)
        super.init(window: window)
        window.contentView = NSHostingView(rootView: InspectorView(model: model))
        window.delegate = self
        window.setFrameAutosaveName("OpenSkyInspector")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func present(activate: Bool = true) {
        model.refreshWindows()
        if window?.isVisible != true { window?.center() }
        if activate {
            showWindow(nil); NSApp.activate(ignoringOtherApps: true)
        } else {
            // An explicit CLI/SDK request can open this app-owned window behind the owner.
            window?.orderBack(nil)
        }
    }
    func windowWillClose(_ notification: Notification) { model.close() }
}
