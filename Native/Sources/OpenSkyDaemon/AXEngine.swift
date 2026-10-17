import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - Data Structures for App & AX State

public struct WindowSummary: Codable {
    public let id: UInt32
    public let app: String
    public let title: String?
    public let frame: CGRect
}

public struct AppSummary: Codable {
    public let id: String
    public let displayName: String?
    public let pid: Int32?
    public let isRunning: Bool
    public let windows: [WindowSummary]?
}

public final class IndexedAXNode {
    public let index: Int
    public let axElement: AXUIElement?
    public let role: String
    public let title: String
    public let value: String?
    public let frame: CGRect?
    public let isSettable: Bool
    public let actions: [String]
    public let isOCR: Bool
    public let identifier: String?
    public let enabled: Bool

    public init(
        index: Int,
        axElement: AXUIElement?,
        role: String,
        title: String,
        value: String?,
        frame: CGRect?,
        isSettable: Bool,
        actions: [String],
        isOCR: Bool = false,
        identifier: String? = nil,
        enabled: Bool = true
    ) {
        self.index = index
        self.axElement = axElement
        self.role = role
        self.title = title
        self.value = value
        self.frame = frame
        self.isSettable = isSettable
        self.actions = actions
        self.isOCR = isOCR
        self.identifier = identifier
        self.enabled = enabled
    }

    public var centerPoint: CGPoint? {
        guard let f = frame, f.width > 0, f.height > 0 else { return nil }
        return CGPoint(x: f.midX, y: f.midY)
    }
}

public struct ElementSummary: Codable {
    public let elementIndex: Int
    public let role: String
    public let title: String
    public let value: String?
    public let identifier: String?
    public let enabled: Bool
    public let settable: Bool
    public let source: String
    public let frame: [Double]?
    public let actions: [String]

    init(_ node: IndexedAXNode) {
        elementIndex = node.index; role = node.role; title = node.title; value = node.value
        identifier = node.identifier; enabled = node.enabled; settable = node.isSettable
        source = node.isOCR ? "ocr" : "ax"; actions = node.actions
        frame = node.frame.map { [Double($0.minX), Double($0.minY), Double($0.width), Double($0.height)] }
    }
    public var json: [String: Any] {
        var result: [String: Any] = ["element_index": elementIndex, "role": role, "title": title,
            "enabled": enabled, "settable": settable, "source": source, "actions": actions]
        if let value { result["value"] = value }
        if let identifier { result["identifier"] = identifier }
        if let frame { result["frame"] = frame }
        return result
    }
}

public struct AppSnapshotResult: Codable {
    public let success: Bool
    public let error: ObservationIssue?
    public let warnings: [ObservationIssue]
    public let snapshotID: String?
    public let screenshotWidth: Int?
    public let screenshotHeight: Int?
    public let screenshotFrame: CGRect?
    public let app: String
    public let bundleId: String
    public let displayName: String
    public let pid: Int32
    public let windowId: UInt32?
    public let windowFrame: CGRect?
    public let text: String
    public let screenshotUrl: String?
    public let screenshotPath: String?
    public let axTrusted: Bool
    public let elementCount: Int
    public let elements: [ElementSummary]
}

// MARK: - AXEngine

public final class AXEngine {
    public static let shared = AXEngine()

    private struct CachedSnapshot {
        let id: String
        let pid: Int32
        let bundleID: String?
        let windowId: UInt32?
        let frame: CGRect
        let createdAt: TimeInterval
        let nodes: [Int: IndexedAXNode]
    }
    private let stateLock = NSRecursiveLock()
    private var snapshotsByKey: [String: CachedSnapshot] = [:]
    // Never recycle an index during this daemon's lifetime. Old indices cannot select
    // a different element after another observation, even if callers omit snapshot_id.
    private var nextElementIndex = 0
    private var instructedApps: Set<String> = []

    private init() {}

    public func isAXTrusted(prompt: Bool = false) -> Bool {
        if prompt {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            return AXIsProcessTrustedWithOptions(options)
        }
        return AXIsProcessTrusted()
    }

    // MARK: - App Inventory & Resolution

    public func listApps(includeRunningOnly: Bool = false) -> [AppSummary] {
        let running = NSWorkspace.shared.runningApplications
        let cgWindows = fetchAllOnScreenWindows()

        var results: [AppSummary] = []
        var seenBundles = Set<String>()

        for app in running {
            guard app.activationPolicy == .regular || app.bundleIdentifier == "com.apple.finder" else { continue }
            let bundleId = app.bundleIdentifier ?? app.localizedName ?? "pid.\(app.processIdentifier)"
            seenBundles.insert(bundleId)
            let appWindows = cgWindows.filter { $0.pid == app.processIdentifier }.map {
                WindowSummary(id: $0.windowId, app: app.localizedName ?? bundleId, title: $0.title, frame: $0.frame)
            }
            results.append(
                AppSummary(
                    id: bundleId,
                    displayName: app.localizedName,
                    pid: app.processIdentifier,
                    isRunning: true,
                    windows: appWindows.isEmpty ? nil : appWindows
                )
            )
        }

        if !includeRunningOnly {
            // Also scan /Applications and /System/Applications for quick launching
            let appDirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities"]
            for dir in appDirs {
                guard let items = try? FileManager.default.contentsOfDirectory(atPath: dir) else { continue }
                for item in items where item.hasSuffix(".app") {
                    let fullPath = (dir as NSString).appendingPathComponent(item)
                    if let bundle = Bundle(path: fullPath),
                       let bundleId = bundle.bundleIdentifier,
                       !seenBundles.contains(bundleId) {
                        seenBundles.insert(bundleId)
                        let name = (bundle.infoDictionary?["CFBundleDisplayName"] as? String)
                            ?? (bundle.infoDictionary?["CFBundleName"] as? String)
                            ?? (item as NSString).deletingPathExtension
                        results.append(
                            AppSummary(
                                id: bundleId,
                                displayName: name,
                                pid: nil,
                                isRunning: false,
                                windows: nil
                            )
                        )
                    }
                }
            }
        }

        return results.sorted { a, b in
            if a.isRunning != b.isRunning { return a.isRunning && !b.isRunning }
            return (a.displayName ?? a.id) < (b.displayName ?? b.id)
        }
    }

    public func resolveOrLaunchApp(
        identifier: String,
        launchIfNeeded: Bool = true,
        launchInBackground: Bool = true,
        reopenIfRunning: Bool = false
    ) -> NSRunningApplication? {
        let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let pathBundleID = trimmed.hasPrefix("/") ? Bundle(path: trimmed)?.bundleIdentifier : nil
        let lower = (pathBundleID ?? trimmed).lowercased()

        // 1. Check already-running applications
        let running = NSWorkspace.shared.runningApplications.filter { !$0.isTerminated }
        let exactBundles = running.filter { $0.bundleIdentifier?.lowercased() == lower }
        if exactBundles.count == 1 && !reopenIfRunning { return exactBundles[0] }
        if exactBundles.count > 1 { return nil }
        let exactNames = running.filter { $0.localizedName?.lowercased() == lower }
        if exactNames.count == 1 && !reopenIfRunning { return exactNames[0] }
        if exactNames.count > 1 { return nil }
        let partialMatches = running.filter {
            ($0.localizedName?.lowercased().contains(lower) == true) ||
            ($0.bundleIdentifier?.lowercased().contains(lower) == true)
        }
        if partialMatches.count == 1 && !reopenIfRunning { return partialMatches[0] }
        // An ambiguous short name must never launch or control an arbitrary match.
        if partialMatches.count > 1 { return nil }

        guard launchIfNeeded else { return nil }

        // 2. Try to find bundle URL and launch in background (Codex style: no focus steal!)
        var appURL: URL?
        if trimmed.hasPrefix("/") && trimmed.hasSuffix(".app") {
            appURL = URL(fileURLWithPath: trimmed)
        } else if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: trimmed) {
            appURL = url
        } else {
            let candidates = [
                "/Applications/\(trimmed).app",
                "/System/Applications/\(trimmed).app",
                "/System/Applications/Utilities/\(trimmed).app",
                "\(FileManager.default.homeDirectoryForCurrentUser.path)/Applications/\(trimmed).app"
            ]
            for c in candidates where FileManager.default.fileExists(atPath: c) {
                appURL = URL(fileURLWithPath: c)
                break
            }
        }

        guard let targetURL = appURL else {
            return nil
        }

        let config = NSWorkspace.OpenConfiguration()
        config.activates = !launchInBackground
        config.addsToRecentItems = false

        let sem = DispatchSemaphore(value: 0)
        var launchedApp: NSRunningApplication?

        NSWorkspace.shared.openApplication(at: targetURL, configuration: config) { app, _ in
            launchedApp = app
            sem.signal()
        }
        if Thread.isMainThread {
            // --rpc runs on the main thread; NSWorkspace can deliver its completion there.
            // Keep the run loop moving instead of blocking the callback for eight seconds.
            let deadline = Date().addingTimeInterval(8)
            while sem.wait(timeout: .now()) != .success && Date() < deadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.02))
            }
        } else {
            _ = sem.wait(timeout: .now() + 8.0)
        }

        if let app = launchedApp {
            // Brief settle for window creation
            Thread.sleep(forTimeInterval: 0.6)
            return app
        }
        return nil
    }

    // MARK: - Capture App State (AX Tree + Snapshot References + Vision OCR + Screenshot)

    public func getAppState(
        appIdentifier: String,
        disableDiff: Bool = false,
        includeScreenshot: Bool = true,
        includeOCR: Bool = false,
        launchIfNeeded: Bool = true
    ) -> AppSnapshotResult {
        stateLock.lock()
        defer { stateLock.unlock() }
        let trusted = isAXTrusted(prompt: false)
        let appKey = appIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let runningApp = resolveOrLaunchApp(identifier: appIdentifier, launchIfNeeded: launchIfNeeded, launchInBackground: true) else {
            snapshotsByKey.removeValue(forKey: appKey)
            let issue = ObservationIssue(code: "app_not_found_or_ambiguous",
                message: "Application '\(appIdentifier)' was not found or is ambiguous. Use an exact bundle ID from list_apps().")
            return AppSnapshotResult(success: false, error: issue, warnings: [], snapshotID: nil,
                screenshotWidth: nil, screenshotHeight: nil, screenshotFrame: nil,
                app: appIdentifier, bundleId: appIdentifier, displayName: appIdentifier, pid: -1,
                windowId: nil, windowFrame: nil, text: issue.message, screenshotUrl: nil,
                screenshotPath: nil, axTrusted: trusted, elementCount: 0, elements: [])
        }
        let pid = runningApp.processIdentifier
        let bundleId = runningApp.bundleIdentifier ?? appIdentifier
        let displayName = runningApp.localizedName ?? bundleId
        let cgWindows = fetchAllOnScreenWindows().filter { $0.pid == pid }
        var primaryCGWin = cgWindows.first
        var axWindow: AXUIElement?
        let axApp = AXUIElementCreateApplication(pid)
        if trusted {
            enableEnhancedAccessibility(for: axApp)
            var focused: CFTypeRef?
            if AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &focused) == .success,
               let value = focused, CFGetTypeID(value) == AXUIElementGetTypeID() {
                axWindow = (value as! AXUIElement)
            } else {
                var windows: CFTypeRef?
                if AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windows) == .success,
                   let elements = windows as? [AXUIElement] { axWindow = elements.first }
            }
            if let frame = axWindow.flatMap({ getFrame(of: $0) }) {
                let title = axWindow.flatMap({ getStringAttribute($0, kAXTitleAttribute as String) })
                // CG window ordering and an app's focused AX window are not necessarily the
                // same. Select the screenshot ID by geometry and title of the actual AX tree.
                primaryCGWin = cgWindows.first(where: { Self.framesMatch($0.frame, frame) && (title == nil || $0.title == nil || $0.title == title) })
                    ?? cgWindows.first(where: { Self.framesMatch($0.frame, frame) })
            }
        }
        let windowFrame = axWindow.flatMap { getFrame(of: $0) } ?? primaryCGWin?.frame ?? .zero
        let windowId = primaryCGWin?.windowId
        let windowTitle = axWindow.flatMap { getStringAttribute($0, kAXTitleAttribute as String) } ?? primaryCGWin?.title ?? displayName
        var nodeMap: [Int: IndexedAXNode] = [:]
        var lines: [String] = []
        var nextIndex = nextElementIndex
        var warnings: [ObservationIssue] = []
        var error: ObservationIssue?
        if trusted {
            if let window = axWindow {
                traverseAXElement(window, depth: 0, maxDepth: 22, maxElements: 550,
                    nextIndex: &nextIndex, nodeMap: &nodeMap, lines: &lines)
            }
            var menuBar: CFTypeRef?
            if AXUIElementCopyAttributeValue(axApp, kAXMenuBarAttribute as CFString, &menuBar) == .success,
               let value = menuBar, CFGetTypeID(value) == AXUIElementGetTypeID() {
                traverseAXElement(value as! AXUIElement, depth: 0, maxDepth: 8, maxElements: 750,
                    nextIndex: &nextIndex, nodeMap: &nodeMap, lines: &lines)
            }
        } else {
            warnings.append(ObservationIssue(code: "accessibility_permission_required",
                message: "Accessibility permission is unavailable; only screenshot and OCR observations can be provided."))
        }

        var screenshot: ScreenshotResult?
        let shouldCapture = includeScreenshot || includeOCR || nodeMap.count < 3
        if shouldCapture {
            if let id = windowId {
                switch VisionScreenshotEngine.shared.captureWindowResult(windowID: id, windowFrame: windowFrame) {
                case .success(let shot): screenshot = shot
                case .failure(let issue):
                    if includeScreenshot || includeOCR { error = issue } else { warnings.append(issue) }
                }
            } else {
                let issue = ObservationIssue(code: "app_window_unavailable",
                    message: "No matching on-screen application window is available for capture. Open or restore the app window, then observe again.")
                if includeScreenshot || includeOCR { error = issue } else { warnings.append(issue) }
            }
        }
        if (includeOCR || nodeMap.count < 3), let shot = screenshot, let image = shot.cgImage {
            switch VisionScreenshotEngine.shared.recognizeTextResult(in: image, windowFrame: shot.windowFrame, startingIndex: nextIndex) {
            case .success(let items):
                if !items.isEmpty { lines.append("[Vision OCR visual elements; coordinates are global Quartz points]") }
                for item in items {
                    nodeMap[item.index] = IndexedAXNode(index: item.index, axElement: nil, role: "ocr_text",
                        title: item.text, value: nil, frame: item.frame, isSettable: false, actions: ["Click"], isOCR: true)
                    lines.append("\(item.index) text \"\(cleanSingleLine(item.text))\" [at \(Int(item.frame.midX)), \(Int(item.frame.midY))]")
                }
                nextIndex += items.count
            case .failure(let issue):
                if includeOCR { error = issue } else { warnings.append(issue) }
            }
        }
        nextElementIndex = nextIndex
        if nodeMap.isEmpty && screenshot == nil && error == nil {
            error = ObservationIssue(code: "observation_unavailable", message: "The app exposed no accessibility elements and its window could not be captured.")
        }
        let snapshotID = UUID().uuidString
        let cached = CachedSnapshot(id: snapshotID, pid: pid, bundleID: runningApp.bundleIdentifier, windowId: windowId, frame: windowFrame,
            createdAt: ProcessInfo.processInfo.systemUptime, nodes: nodeMap)
        // Retire aliases from prior observations too (for example, a previous short name).
        snapshotsByKey = snapshotsByKey.filter { $0.value.pid != pid }
        for key in [bundleId.lowercased(), displayName.lowercased(), appKey] { snapshotsByKey[key] = cached }
        var output: [String] = []
        if !instructedApps.contains(bundleId), let guidance = appSpecificInstructions(for: bundleId, displayName: displayName) {
            instructedApps.insert(bundleId)
            output.append("<app_specific_instructions>\n\(guidance)\n</app_specific_instructions>")
        }
        output.append("Snapshot: \(snapshotID). Element indices belong to this observation; observe again after UI changes.")
        output.append("Window: \"\(cleanSingleLine(windowTitle))\", App: \(displayName) (bundle: \(bundleId), pid: \(pid), frame: [\(Int(windowFrame.minX)), \(Int(windowFrame.minY)), \(Int(windowFrame.width)), \(Int(windowFrame.height))]).")
        output.append(contentsOf: warnings.map { "[\($0.code): \($0.message)]" })
        if let issue = error { output.append("[\(issue.code): \(issue.message)]") }
        // Returning a partial diff with regenerated indices can silently rebind an old index.
        // Full trees keep each current binding visible; disableDiff remains API-compatible.
        output.append(contentsOf: lines)
        return AppSnapshotResult(success: error == nil, error: error, warnings: warnings, snapshotID: snapshotID,
            screenshotWidth: screenshot?.width, screenshotHeight: screenshot?.height, screenshotFrame: screenshot?.windowFrame,
            app: appIdentifier, bundleId: bundleId, displayName: displayName, pid: pid, windowId: windowId,
            windowFrame: windowFrame == .zero ? nil : windowFrame, text: output.joined(separator: "\n"),
            screenshotUrl: screenshot?.url, screenshotPath: screenshot?.filePath, axTrusted: trusted, elementCount: nodeMap.count,
            elements: nodeMap.values.sorted { $0.index < $1.index }.map(ElementSummary.init))
    }

    public func lookupNode(appIdentifier: String, elementIndex: Int) -> IndexedAXNode? {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard let snapshot = currentSnapshot(appIdentifier), let node = snapshot.nodes[elementIndex] else { return nil }
        if node.isOCR {
            // OCR nodes have no live AX reference. Re-read their text and geometry before
            // using a coordinate, so an old screenshot cannot click replaced content.
            guard let id = snapshot.windowId,
                  case .success(let shot) = VisionScreenshotEngine.shared.captureWindowResult(windowID: id, windowFrame: snapshot.frame),
                  let image = shot.cgImage,
                  case .success(let items) = VisionScreenshotEngine.shared.recognizeTextResult(in: image, windowFrame: shot.windowFrame),
                  let frame = node.frame,
                  items.contains(where: { $0.text == node.title && Self.framesMatch($0.frame, frame) }) else { return nil }
        }
        if let element = node.axElement {
            var role: CFTypeRef?
            guard AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role) == .success else { return nil }
            let title = getStringAttribute(element, kAXTitleAttribute as String) ?? ""
            let description = getStringAttribute(element, kAXDescriptionAttribute as String) ?? ""
            guard (!title.isEmpty ? title : description) == node.title,
                  getStringAttribute(element, kAXValueAttribute as String) == node.value else { return nil }
            if let oldFrame = node.frame {
                guard let liveFrame = getFrame(of: element), Self.framesMatch(oldFrame, liveFrame) else { return nil }
            }
        }
        return node
    }

    public func lookupWindowInfo(appIdentifier: String) -> (windowId: UInt32?, frame: CGRect)? {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard let snapshot = currentSnapshot(appIdentifier) else { return nil }
        return (snapshot.windowId, snapshot.frame)
    }

    public func validateSnapshot(appIdentifier: String, snapshotID: String) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return currentSnapshot(appIdentifier)?.id == snapshotID
    }

    private func currentSnapshot(_ appIdentifier: String) -> CachedSnapshot? {
        let key = appIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let snapshot = snapshotsByKey[key], ProcessInfo.processInfo.systemUptime - snapshot.createdAt <= 60,
              let running = NSRunningApplication(processIdentifier: snapshot.pid), !running.isTerminated,
              running.bundleIdentifier == snapshot.bundleID else { return nil }
        if let id = snapshot.windowId {
            guard let live = fetchAllOnScreenWindows().first(where: { $0.pid == snapshot.pid && $0.windowId == id }),
                  Self.framesMatch(live.frame, snapshot.frame) else { return nil }
        }
        return snapshot
    }

    private static func framesMatch(_ a: CGRect, _ b: CGRect) -> Bool {
        abs(a.minX - b.minX) <= 1 && abs(a.minY - b.minY) <= 1 &&
            abs(a.width - b.width) <= 1 && abs(a.height - b.height) <= 1
    }

    // MARK: - Private AX Helpers

    private func enableEnhancedAccessibility(for axApp: AXUIElement) {
        AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(axApp, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    }

    private func traverseAXElement(
        _ element: AXUIElement,
        depth: Int,
        maxDepth: Int,
        maxElements: Int,
        nextIndex: inout Int,
        nodeMap: inout [Int: IndexedAXNode],
        lines: inout [String]
    ) {
        if depth > maxDepth || nodeMap.count >= maxElements { return }

        let rawRole = getStringAttribute(element, kAXRoleAttribute as String) ?? "Element"
        let subrole = getStringAttribute(element, kAXSubroleAttribute as String)
        let role = friendlyRoleName(rawRole: rawRole, subrole: subrole)

        let title = getStringAttribute(element, kAXTitleAttribute as String) ?? ""
        let desc = getStringAttribute(element, kAXDescriptionAttribute as String) ?? ""
        let value = getStringAttribute(element, kAXValueAttribute as String)
        let placeholder = getStringAttribute(element, kAXPlaceholderValueAttribute as String)
        let enabled = getBoolAttribute(element, kAXEnabledAttribute as String) ?? true
        let settable = isAttributeSettable(element, kAXValueAttribute as String)
        let frame = getFrame(of: element)
        let actions = getActions(of: element)

        let idx = nextIndex
        nextIndex += 1

        let primaryLabel = !title.isEmpty ? title : desc
        let node = IndexedAXNode(
            index: idx,
            axElement: element,
            role: role,
            title: primaryLabel,
            value: value,
            frame: frame,
            isSettable: settable,
            actions: actions,
            identifier: getStringAttribute(element, kAXIdentifierAttribute as String),
            enabled: enabled
        )
        nodeMap[idx] = node

        // Format line in Codex Skyshot style
        let indent = String(repeating: "\t", count: depth)
        var parts: [String] = ["\(idx) \(role)"]

        var flags: [String] = []
        if !enabled { flags.append("disabled") }
        if settable { flags.append("settable") }
        if !flags.isEmpty {
            parts.append("(\(flags.joined(separator: ", ")))")
        }

        if !title.isEmpty {
            parts.append(cleanSingleLine(title))
        }
        if !desc.isEmpty && desc != title {
            parts.append("Description: \(cleanSingleLine(desc))")
        }
        if let v = value, !v.isEmpty, v != title {
            parts.append("Value: \(cleanSingleLine(v))")
        }
        if let ph = placeholder, !ph.isEmpty {
            parts.append("Placeholder: \(cleanSingleLine(ph))")
        }
        let secondaryActions = actions.filter { $0 != "AXPress" && $0 != "Press" }
        if !secondaryActions.isEmpty {
            parts.append("Secondary Actions: \(secondaryActions.joined(separator: ", "))")
        }

        lines.append(indent + parts.joined(separator: " "))

        // Collapsed menus expose hidden descendants too. Traverse only visible menus
        // so the open menu's commands fit within the bounded observation budget.
        if rawRole == kAXMenuRole as String, frame == nil || frame!.isEmpty { return }

        // Recurse into children
        var childrenRef: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
           let children = childrenRef as? [AXUIElement] {
            for child in children {
                if nodeMap.count >= maxElements { break }
                traverseAXElement(
                    child,
                    depth: depth + 1,
                    maxDepth: maxDepth,
                    maxElements: maxElements,
                    nextIndex: &nextIndex,
                    nodeMap: &nodeMap,
                    lines: &lines
                )
            }
        }
    }

    private func friendlyRoleName(rawRole: String, subrole: String?) -> String {
        if let sub = subrole {
            switch sub {
            case "AXStandardWindow": return "standard window"
            case "AXSearchField": return "search field"
            case "AXCloseButton": return "close button"
            case "AXMinimizeButton": return "minimize button"
            case "AXFullScreenButton": return "fullscreen button"
            default: break
            }
        }
        switch rawRole {
        case "AXWindow": return "window"
        case "AXButton": return "button"
        case "AXTextField": return "text field"
        case "AXTextArea": return "text area"
        case "AXStaticText": return "text"
        case "AXGroup", "AXLayoutArea", "AXSplitGroup": return "container"
        case "AXToolbar": return "toolbar"
        case "AXMenuBar": return "menu bar"
        case "AXMenuBarItem": return "menu bar item"
        case "AXMenu": return "menu"
        case "AXMenuItem": return "menu item"
        case "AXPopUpButton": return "pop-up button"
        case "AXCheckBox": return "tickbox"
        case "AXRadioButton": return "radio button"
        case "AXSlider": return "slider"
        case "AXLink": return "link"
        case "AXImage": return "image"
        case "AXScrollArea": return "scroll area"
        case "AXTable": return "table"
        case "AXRow": return "row"
        case "AXCell": return "cell"
        case "AXList": return "content list"
        case "AXHeading": return "heading"
        case "AXWebArea": return "AXWebArea"
        default:
            return rawRole.hasPrefix("AX") ? String(rawRole.dropFirst(2)).lowercased() : rawRole.lowercased()
        }
    }

    private func getStringAttribute(_ element: AXUIElement, _ attr: String) -> String? {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attr as CFString, &ref) == .success,
              let val = ref else { return nil }
        if let str = val as? String { return str }
        if let num = val as? NSNumber { return num.stringValue }
        return nil
    }

    private func getBoolAttribute(_ element: AXUIElement, _ attr: String) -> Bool? {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attr as CFString, &ref) == .success,
              let num = ref as? NSNumber else { return nil }
        return num.boolValue
    }

    private func isAttributeSettable(_ element: AXUIElement, _ attr: String) -> Bool {
        var settable: DarwinBoolean = false
        if AXUIElementIsAttributeSettable(element, attr as CFString, &settable) == .success {
            return settable.boolValue
        }
        return false
    }

    private func getFrame(of element: AXUIElement) -> CGRect? {
        var posRef: CFTypeRef?
        var sizeRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef) == .success,
              AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
              let pVal = posRef, CFGetTypeID(pVal) == AXValueGetTypeID(),
              let sVal = sizeRef, CFGetTypeID(sVal) == AXValueGetTypeID() else { return nil }

        var pt = CGPoint.zero
        var sz = CGSize.zero
        guard AXValueGetValue(pVal as! AXValue, .cgPoint, &pt),
              AXValueGetValue(sVal as! AXValue, .cgSize, &sz),
              pt.x.isFinite, pt.y.isFinite, sz.width.isFinite, sz.height.isFinite,
              sz.width >= 0, sz.height >= 0 else { return nil }
        return CGRect(origin: pt, size: sz)
    }

    private func getActions(of element: AXUIElement) -> [String] {
        var namesRef: CFArray?
        guard AXUIElementCopyActionNames(element, &namesRef) == .success,
              let names = namesRef as? [String] else { return [] }
        return names.map { $0.hasPrefix("AX") ? String($0.dropFirst(2)) : $0 }
    }

    private func cleanSingleLine(_ text: String) -> String {
        let cleaned = text.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ")
        if cleaned.count > 140 {
            return String(cleaned.prefix(140)) + "…"
        }
        return cleaned
    }

    private struct CGWinInfo {
        let windowId: UInt32
        let pid: Int32
        let title: String?
        let frame: CGRect
    }

    public func onScreenWindowID(pid: pid_t, frame: CGRect) -> UInt32? {
        fetchAllOnScreenWindows().first { $0.pid == pid && Self.framesMatch($0.frame, frame) }?.windowId
    }

    public func onScreenWindowFrame(windowID: UInt32) -> CGRect? {
        fetchAllOnScreenWindows().first { $0.windowId == windowID }?.frame
    }

    private func fetchAllOnScreenWindows() -> [CGWinInfo] {
        guard let infoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return []
        }
        var out: [CGWinInfo] = []
        for dict in infoList {
            guard let layer = dict[kCGWindowLayer as String] as? Int, layer == 0,
                  let wid = dict[kCGWindowNumber as String] as? UInt32,
                  let pid = dict[kCGWindowOwnerPID as String] as? Int32,
                  let boundsDict = dict[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
            let frame = CGRect(
                x: boundsDict["X"] ?? 0,
                y: boundsDict["Y"] ?? 0,
                width: boundsDict["Width"] ?? 0,
                height: boundsDict["Height"] ?? 0
            )
            if !frame.minX.isFinite || !frame.minY.isFinite || !frame.width.isFinite || !frame.height.isFinite || frame.width < 40 || frame.height < 40 { continue }
            let title = dict[kCGWindowName as String] as? String
            out.append(CGWinInfo(windowId: wid, pid: pid, title: title, frame: frame))
        }
        return out
    }

    private func appSpecificInstructions(for bundleId: String, displayName: String) -> String? {
        let lower = bundleId.lowercased()
        if lower.contains("com.apple.music") {
            return "## Music Computer Use\n- Click the Search row in the sidebar and use `set_value` on the search text field.\n- To play a track, double-click it (`click_count: 2`) or click the Play button."
        } else if lower.contains("slack") {
            return "## Slack Computer Use\n- Use `set_value` instead of `type_text` on the message composer to avoid inadvertently sending a multiline message before you're ready."
        } else if lower.contains("spotify") {
            return "## Spotify Computer Use\n- Ensure the search field is focused before pressing Return. After clicking Play, call `get_app_state` to confirm playback state."
        } else if lower.contains("notion") {
            return "## Notion Computer Use\n- Notion documents consist of blocks. Press `Return` after typing the page title to begin editing the body, or use `paste` with `format: \"md\"`."
        } else if lower.contains("numbers") {
            return "## Numbers Computer Use\n- Use 1 click on an empty cell or 3 clicks (`click_count: 3`) to replace existing cell contents."
        }
        return nil
    }

}
