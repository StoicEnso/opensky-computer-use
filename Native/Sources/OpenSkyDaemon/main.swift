import AppKit
import CoreGraphics
import Foundation
import Network
import Security
import Carbon.HIToolbox

private let inspectionMethods: Set<String> = ["ping", "status", "inspector", "agent_activity", "list_apps", "get_app_state", "screenshot_screen", "stop", "resume", "shutdown", "cursor_dismiss", "cursor_status"]

// MARK: - JSON-RPC Request & Dispatcher

public final class OpenSkyRPCDispatcher {
    public static let shared = OpenSkyRPCDispatcher()

    private init() {}

    public func dispatch(method: String, params: [String: Any]) -> [String: Any] {
        if let issue = validateRequest(method: method, params: params) { return ["ok": false, "error": issue, "error_code": "invalid_arguments"] }
        if let snapshot = params["snapshot_id"] as? String, let app = params["app"] as? String,
           !AXEngine.shared.validateSnapshot(appIdentifier: app, snapshotID: snapshot) {
            return ["ok": false, "error": "Snapshot is stale. Inspect the app again.", "error_code": "stale_snapshot"]
        }
        if SafetyController.shared.isStopped && !inspectionMethods.contains(method) {
            return ["ok": false, "error": "OpenSky is stopped. Resume from its menu or call resume.", "error_code": "stopped"]
        }
        let inputMethods: Set<String> = ["click", "drag", "scroll", "set_value", "type_text", "press_key", "paste", "perform_secondary_action", "select_text", "manage_window"]
        if inputMethods.contains(method) && !AXEngine.shared.isAXTrusted() {
            return ["ok": false, "error_code": "accessibility_permission_required", "error": "Enable OpenSky in System Settings > Privacy & Security > Accessibility, then restart OpenSky."]
        }
        let previousFeedback = PointerFeedbackContext.current
        let feedbackApp = params["app"] as? String
        PointerFeedbackContext.current = PointerFeedbackRequest(app: feedbackApp,
            windowID: asInt(params["window_id"]).map { UInt32($0) } ?? feedbackApp.flatMap { AXEngine.shared.pinnedWindowID(appIdentifier: $0) })
        defer { PointerFeedbackContext.current = previousFeedback }
        switch method {
        case "agent_activity":
            let action = params["action"] as? String ?? "status"
            guard ["status", "show", "close"].contains(action) else { return ["ok": false, "error_code": "invalid_arguments", "error": "Use status, show or close."] }
            let control = { residentMenu?.activityControl(action: action) ?? ["ok": false, "error_code": "native_ui_unavailable"] }
            return Thread.isMainThread ? control() : DispatchQueue.main.sync(execute: control)
        case "inspector":
            let action = params["action"] as? String ?? "status"
            guard ["status", "show", "close"].contains(action) else { return ["ok": false, "error_code": "invalid_arguments", "error": "Use status, show or close."] }
            let control = {
                residentMenu?.inspectorControl(action: action, activate: params["activate"] as? Bool ?? false)
                    ?? ["ok": false, "error_code": "native_ui_unavailable", "error": "The resident menu is not ready."]
            }
            return Thread.isMainThread ? control() : DispatchQueue.main.sync(execute: control)
        case "stop":
            SafetyController.shared.setStopped(true)
            CursorOverlayManager.shared.dismissCursor()
            return ["ok": true, "stopped": true]
        case "resume":
            SafetyController.shared.setStopped(false)
            return ["ok": true, "stopped": false]
        case "shutdown":
            SafetyController.shared.setStopped(true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { NSApplication.shared.terminate(nil) }
            return ["ok": true, "message": "OpenSky is shutting down."]
        case "ping", "status":
            if (params["promptScreen"] as? Bool) == true { _ = CGRequestScreenCaptureAccess() }
            if (params["promptPostEvent"] as? Bool) == true { _ = CGRequestPostEventAccess() }
            return [
                "ok": true,
                "service": "OpenSky Computer Use Daemon",
                "version": "1.3.0",
                "build_version": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1.4.2",
                "pid": ProcessInfo.processInfo.processIdentifier,
                "stopped": SafetyController.shared.isStopped,
                "screenRecordingTrusted": CGPreflightScreenCaptureAccess(),
                "eventPostingTrusted": CGPreflightPostEventAccess(),
                "coordinates": "global desktop points, origin at primary display top-left",
                "displays": NSScreen.screens.map { screen -> [String: Any] in
                    let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
                    let bounds = CGDisplayBounds(id)
                    return ["id": id, "name": screen.localizedName, "frame": [bounds.minX, bounds.minY, bounds.width, bounds.height], "scale": screen.backingScaleFactor]
                },
                "axTrusted": AXEngine.shared.isAXTrusted(prompt: (params["promptAX"] as? Bool) ?? false),
                "screen": [
                    "width": Int(CGDisplayBounds(CGMainDisplayID()).width),
                    "height": Int(CGDisplayBounds(CGMainDisplayID()).height)
                ]
            ]

        case "list_apps":
            let includeRunningOnly = (params["running_only"] as? Bool) ?? false
            let apps = AXEngine.shared.listApps(includeRunningOnly: includeRunningOnly)
            let encoded = apps.map { app -> [String: Any] in
                var dict: [String: Any] = [
                    "id": app.id,
                    "display_name": app.displayName ?? app.id,
                    "is_running": app.isRunning
                ]
                if let pid = app.pid { dict["pid"] = pid }
                if let wins = app.windows {
                    dict["windows"] = wins.map { w in
                        [
                            "id": w.id,
                            "app": w.app,
                            "title": w.title ?? "",
                            "frame": [w.frame.origin.x, w.frame.origin.y, w.frame.width, w.frame.height]
                        ]
                    }
                }
                return dict
            }
            return ["ok": true, "apps": encoded]

        case "get_app_state":
            let app = (params["app"] as? String) ?? "Finder"
            let disableDiff = (params["disableDiff"] as? Bool) ?? (params["disable_diff"] as? Bool) ?? false
            let includeScreenshot = (params["includeScreenshot"] as? Bool) ?? (params["include_screenshot"] as? Bool) ?? true
            let includeOCR = (params["includeOCR"] as? Bool) ?? (params["include_ocr"] as? Bool) ?? false

            // Briefly show thinking wiggle on the cursor while inspecting app state if requested
            if let showCursor = params["show_cursor"] as? Bool, showCursor {
                CursorOverlayManager.shared.setWiggle(id: "default", enabled: true, label: "Inspecting \(app)…")
            }
            let snap = AXEngine.shared.getAppState(
                appIdentifier: app,
                disableDiff: disableDiff,
                includeScreenshot: includeScreenshot,
                includeOCR: includeOCR,
                windowID: asInt(params["window_id"]).map { UInt32($0) }
            )
            if let showCursor = params["show_cursor"] as? Bool, showCursor {
                CursorOverlayManager.shared.setWiggle(id: "default", enabled: false)
            }
            var output = encodeSnapshot(snap)
            output["app"] = snap.app
            output["bundle_id"] = snap.bundleId
            output["display_name"] = snap.displayName
            output["pid"] = snap.pid
            output["ax_trusted"] = snap.axTrusted
            return output

        case "click":
            let app = params["app"] as? String
            let elementIndex = asInt(params["element_index"] ?? params["elementIndex"])
            let point = parsePoint(params["point"])
            let mouseButton = (params["mouse_button"] as? String) ?? (params["mouseButton"] as? String) ?? "left"
            let clickCount = asInt(params["click_count"] ?? params["clickCount"]) ?? 1
            let key = params["key"] as? String
            let duration = asDouble(params["duration"]) ?? 0.05
            let mode = (params["mode"] as? String) ?? "hybrid"
            let cursorId = (params["cursor_id"] as? String) ?? "default"
            let label = params["label"] as? String

            let res = ActionExecutor.shared.click(
                app: app,
                elementIndex: elementIndex,
                point: point,
                mouseButton: mouseButton,
                clickCount: clickCount,
                key: key,
                holdDuration: duration,
                mode: mode,
                cursorId: cursorId,
                label: label
            )
            return encodeActionResult(res)

        case "drag":
            let app = params["app"] as? String
            let startIdx = asInt(params["start_element_index"] ?? params["startElementIndex"])
            let startPt = parsePoint(params["start_point"] ?? params["startPoint"])
            let endIdx = asInt(params["end_element_index"] ?? params["endElementIndex"])
            let endPt = parsePoint(params["end_point"] ?? params["endPoint"])
            let mouseButton = (params["mouse_button"] as? String) ?? "left"
            let key = params["key"] as? String
            let duration = asDouble(params["duration"]) ?? 0.55
            let cursorId = (params["cursor_id"] as? String) ?? "default"

            let res = ActionExecutor.shared.drag(
                app: app,
                startElementIndex: startIdx,
                startPoint: startPt,
                endElementIndex: endIdx,
                endPoint: endPt,
                mouseButton: mouseButton,
                key: key,
                duration: duration,
                mode: (params["mode"] as? String) ?? "hybrid",
                cursorId: cursorId
            )
            return encodeActionResult(res)

        case "scroll":
            let app = params["app"] as? String
            let elementIndex = asInt(params["element_index"] ?? params["elementIndex"])
            let point = parsePoint(params["point"])
            let direction = (params["direction"] as? String) ?? "down"
            let pages = asDouble(params["pages"]) ?? 1.0
            let key = params["key"] as? String
            let cursorId = (params["cursor_id"] as? String) ?? "default"

            let res = ActionExecutor.shared.scroll(
                app: app,
                elementIndex: elementIndex,
                point: point,
                direction: direction,
                pages: pages,
                key: key,
                mode: (params["mode"] as? String) ?? "hybrid",
                cursorId: cursorId
            )
            return encodeActionResult(res)

        case "set_value":
            let app = (params["app"] as? String) ?? ""
            let elementIndex = asInt(params["element_index"] ?? params["elementIndex"]) ?? 0
            let value = (params["value"] as? String) ?? ""
            let cursorId = (params["cursor_id"] as? String) ?? "default"
            let res = ActionExecutor.shared.setValue(
                app: app,
                elementIndex: elementIndex,
                value: value,
                mode: (params["mode"] as? String) ?? "background",
                cursorId: cursorId
            )
            return encodeActionResult(res)

        case "type_text":
            let app = params["app"] as? String
            let text = (params["text"] as? String) ?? ""
            let mode = (params["mode"] as? String) ?? "hybrid"
            let res = ActionExecutor.shared.typeText(app: app, text: text, mode: mode)
            return encodeActionResult(res)

        case "press_key":
            let app = params["app"] as? String
            var keys: [String] = []
            if let kStr = params["key"] as? String {
                keys = [kStr]
            } else if let kArr = params["key"] as? [String] {
                keys = kArr
            } else if let kArr = params["keys"] as? [String] {
                keys = kArr
            }
            let mode = (params["mode"] as? String) ?? "hybrid"
            let res = ActionExecutor.shared.pressKey(app: app, keys: keys, mode: mode)
            return encodeActionResult(res)

        case "paste":
            let app = params["app"] as? String
            let content = (params["content"] as? String) ?? ""
            let format = (params["format"] as? String) ?? "text"
            let elementIndex = asInt(params["element_index"] ?? params["elementIndex"])
            let point = parsePoint(params["point"])
            let cursorId = (params["cursor_id"] as? String) ?? "default"
            let res = ActionExecutor.shared.paste(
                app: app,
                content: content,
                format: format,
                elementIndex: elementIndex,
                point: point,
                cursorId: cursorId
            )
            return encodeActionResult(res)

        case "perform_secondary_action":
            let app = (params["app"] as? String) ?? ""
            let elementIndex = asInt(params["element_index"] ?? params["elementIndex"]) ?? 0
            let action = (params["action"] as? String) ?? "ShowMenu"
            let cursorId = (params["cursor_id"] as? String) ?? "default"
            let res = ActionExecutor.shared.performSecondaryAction(
                app: app,
                elementIndex: elementIndex,
                action: action,
                cursorId: cursorId
            )
            return encodeActionResult(res)

        case "select_text":
            let app = (params["app"] as? String) ?? ""
            let elementIndex = asInt(params["element_index"] ?? params["elementIndex"]) ?? 0
            let prefix = (params["prefix"] as? String) ?? ""
            let suffix = (params["suffix"] as? String) ?? ""
            let selectionType = (params["selection_type"] as? String) ?? "SelectContent"
            let res = ActionExecutor.shared.selectText(
                app: app,
                elementIndex: elementIndex,
                prefix: prefix,
                suffix: suffix,
                selectionType: selectionType
            )
            return encodeActionResult(res)

        case "manage_window":
            let app = (params["app"] as? String) ?? ""
            let action = (params["action"] as? String) ?? "focus"
            var frame: CGRect? = nil
            if let fArr = params["frame"] as? [Any], fArr.count == 4,
               let x = asDouble(fArr[0]), let y = asDouble(fArr[1]),
               let w = asDouble(fArr[2]), let h = asDouble(fArr[3]) {
                frame = CGRect(x: x, y: y, width: w, height: h)
            }
            let res = ActionExecutor.shared.manageWindow(app: app, action: action, frame: frame)
            return encodeActionResult(res)

        case "run_applescript":
            let script = (params["script"] as? String) ?? ""
            let language = (params["language"] as? String) ?? "applescript"
            let (ok, output) = ActionExecutor.shared.runAppleScript(script: script, language: language)
            return [
                "ok": ok,
                "output": output
            ]

        case "cursor_move":
            let cursorId = (params["cursor_id"] as? String) ?? "default"
            let point = parsePoint(params["point"]) ?? CGPoint(x: 500, y: 400)
            let label = params["label"] as? String
            let duration = asDouble(params["duration"])
            var spotlight: CGRect? = nil
            if let sArr = params["spotlight"] as? [Any], sArr.count == 4,
               let x = asDouble(sArr[0]), let y = asDouble(sArr[1]),
               let w = asDouble(sArr[2]), let h = asDouble(sArr[3]) {
                spotlight = CGRect(x: x, y: y, width: w, height: h)
            }
            let sem = DispatchSemaphore(value: 0)
            CursorOverlayManager.shared.moveCursor(
                id: cursorId,
                to: point,
                label: label,
                duration: duration,
                spotlightRect: spotlight
            ) {
                sem.signal()
            }
            _ = sem.wait(timeout: .now() + (duration ?? 0.5) + 0.15)
            return ["ok": true, "cursor_id": cursorId, "point": [point.x, point.y]]

        case "cursor_wiggle":
            let cursorId = (params["cursor_id"] as? String) ?? "default"
            let enabled = (params["enabled"] as? Bool) ?? true
            let label = params["label"] as? String
            let duration = asDouble(params["duration"]) ?? 0.0
            CursorOverlayManager.shared.setWiggle(id: cursorId, enabled: enabled, label: label)
            if duration > 0 {
                let deadline = Date().addingTimeInterval(duration)
                while Date() < deadline && !SafetyController.shared.isStopped { Thread.sleep(forTimeInterval: 0.01) }
                CursorOverlayManager.shared.setWiggle(id: cursorId, enabled: false)
            }
            return ["ok": true, "cursor_id": cursorId, "wiggle": enabled]

        case "cursor_highlight":
            if let sArr = params["rect"] as? [Any], sArr.count == 4,
               let x = asDouble(sArr[0]), let y = asDouble(sArr[1]),
               let w = asDouble(sArr[2]), let h = asDouble(sArr[3]) {
                let rect = CGRect(x: x, y: y, width: w, height: h)
                let label = params["label"] as? String
                let duration = asDouble(params["duration"]) ?? 1.5
                CursorOverlayManager.shared.highlightElement(rect: rect, label: label, duration: duration)
                return ["ok": true]
            }
            return ["ok": false, "error": "Invalid rect [x, y, width, height]"]

        case "cursor_status":
            let read = { CursorOverlayManager.shared.feedbackStatus() }
            return Thread.isMainThread ? read() : DispatchQueue.main.sync(execute: read)

        case "cursor_dismiss":
            let cursorId = params["cursor_id"] as? String
            CursorOverlayManager.shared.dismissCursor(id: cursorId)
            return ["ok": true]

        case "cursor_demo":
            runCursorChoreographyDemo(blocking: true)
            return ["ok": true, "message": "Completed live OpenSky multi-cursor choreography demo!"]

        case "screenshot_screen":
            let result = VisionScreenshotEngine.shared.captureWindowResult(windowID: nil, windowFrame: nil)
            switch result {
            case .failure(let issue):
                return ["ok": false, "error": issue.message, "error_code": issue.code]
            case .success(let shot):
                var output: [String: Any] = ["ok": true, "path": shot.filePath, "url": shot.url,
                    "screenshot": ["path": shot.filePath, "url": shot.url, "width": shot.width, "height": shot.height],
                    "width": shot.width, "height": shot.height,
                    "frame": [shot.windowFrame.minX, shot.windowFrame.minY, shot.windowFrame.width, shot.windowFrame.height],
                    "scale_x": shot.scaleX, "scale_y": shot.scaleY, "capture_kind": shot.captureKind,
                    "coordinates": "frame is global desktop points; width and height are image pixels"]
                if (params["include_ocr"] as? Bool) ?? true, let image = shot.cgImage {
                    switch VisionScreenshotEngine.shared.recognizeTextResult(in: image, windowFrame: shot.windowFrame, startingIndex: 0) {
                    case .success(let items):
                        output["ocr_elements"] = items.map { ["text": $0.text,
                            "frame": [$0.frame.minX, $0.frame.minY, $0.frame.width, $0.frame.height],
                            "center": [$0.frame.midX, $0.frame.midY]] as [String: Any] }
                    case .failure(let issue):
                        output["ok"] = false; output["error"] = issue.message; output["error_code"] = issue.code
                    }
                }
                return output
            }

        default:
            return ["ok": false, "error": "Unknown method: \(method)"]
        }
    }

    private func encodeActionResult(_ res: ActionExecutionResult) -> [String: Any] {
        var out: [String: Any] = [
            "ok": res.success,
            "action": res.action,
            "message": res.message
        ]
        if let code = res.errorCode { out["error_code"] = code }
        if let pt = res.point {
            out["point"] = pt
        }
        if let snap = res.appState {
            for (key, value) in encodeSnapshot(snap) where key != "ok" { out[key] = value }
            out["observation_ok"] = snap.success
        }
        return out
    }

    private func validateRequest(method: String, params: [String: Any]) -> String? {
        for name in ["app", "mode", "text", "content", "value", "script", "language", "action", "direction", "mouse_button", "selection_type", "cursor_id", "label", "snapshot_id"] {
            if let value = params[name], !(value is String) { return "\(name) must be a string" }
        }
        if let cursor = params["cursor_id"] as? String, cursor.utf8.count > 128 { return "cursor_id exceeds 128 bytes" }
        if let label = params["label"] as? String, label.utf8.count > 512 { return "label exceeds 512 bytes" }
        if let app = params["app"] as? String, app.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "app must not be empty" }
        for name in ["include_screenshot", "include_ocr", "includeScreenshot", "includeOCR", "disable_diff", "disableDiff", "show_cursor", "running_only", "enabled", "activate", "promptAX", "promptScreen", "promptPostEvent"] {
            if let value = params[name], CFGetTypeID(value as CFTypeRef) != CFBooleanGetTypeID() { return "\(name) must be a boolean" }
        }
        if let value = params["keys"] { guard let keys = value as? [String], !keys.isEmpty, keys.count <= 256 else { return "keys must be a nonempty array of up to 256 strings" } }
        if let value = params["rect"] { guard let rect = value as? [Double], rect.count == 4, rect.allSatisfy({$0.isFinite}), rect[2] > 0, rect[3] > 0 else { return "rect must be [x,y,width,height] with positive dimensions" } }
        if let mode = params["mode"] as? String, !["background", "hybrid", "takeover"].contains(mode) { return "Invalid mode" }
        if let value = params["window_id"] {
            guard let number = asDouble(value), number.isFinite, number > 0,
                  number <= Double(UInt32.max), number.rounded() == number else { return "window_id must be a positive 32-bit integer" }
        }
        for name in ["duration", "pages"] {
            if let value = params[name] {
                guard let n = asDouble(value), n.isFinite, n >= 0, n <= 30 else { return "\(name) must be between 0 and 30" }
            }
        }
        for name in ["element_index", "elementIndex", "start_element_index", "startElementIndex", "end_element_index", "endElementIndex", "click_count", "clickCount"] {
            if let value = params[name] { guard let n = asDouble(value), n.isFinite, n >= 0, n <= Double(Int32.max), n.rounded() == n else { return "Invalid \(name)" } }
        }
        for name in ["point", "start_point", "end_point"] {
            if let value = params[name] { guard let array = value as? [Any], array.count == 2, let point = parsePoint(array), point.x.isFinite, point.y.isFinite else { return "\(name) must be [x,y] in global desktop points" } }
        }
        let required: [String: [String]] = ["get_app_state": ["app"], "set_value": ["app", "element_index", "value"], "type_text": ["text"], "paste": ["content"], "perform_secondary_action": ["app", "element_index", "action"], "select_text": ["app", "element_index"], "manage_window": ["app", "action"], "run_applescript": ["script"], "cursor_move": ["point"], "cursor_highlight": ["rect"]]
        for key in required[method] ?? [] where params[key] == nil { return "Missing argument: \(key)" }
        if method == "press_key" && params["keys"] == nil && params["key"] == nil { return "Missing keys" }
        if let text = (params["text"] ?? params["content"] ?? params["value"]) as? String, text.utf8.count > 65536 { return "Text exceeds 64 KiB; send smaller chunks" }
        return nil
    }

    private func encodeSnapshot(_ snap: AppSnapshotResult) -> [String: Any] {
        var output: [String: Any] = ["ok": snap.success, "text": snap.text, "element_count": snap.elementCount,
            "elements": snap.elements.map { $0.json },
            "warnings": snap.warnings.map { ["code": $0.code, "message": $0.message] }]
        if let id = snap.snapshotID { output["snapshot_id"] = id }
        if let error = snap.error { output["error"] = error.message; output["error_code"] = error.code }
        if let frame = snap.windowFrame { output["window_frame"] = [frame.minX, frame.minY, frame.width, frame.height] }
        if let window = snap.windowId { output["window_id"] = window }
        if let path = snap.screenshotPath {
            var shot: [String: Any] = ["path": path, "url": snap.screenshotUrl ?? ""]
            if let width = snap.screenshotWidth { shot["width"] = width }
            if let height = snap.screenshotHeight { shot["height"] = height }
            if let frame = snap.screenshotFrame { shot["frame"] = [frame.minX, frame.minY, frame.width, frame.height] }
            output["screenshot"] = shot
        }
        return output
    }

    private func asInt(_ val: Any?) -> Int? {
        if let i = val as? Int { return i }
        if let d = val as? Double { return Int(d) }
        if let s = val as? String { return Int(s) }
        return nil
    }

    private func asDouble(_ val: Any?) -> Double? {
        if let value = val, CFGetTypeID(value as CFTypeRef) == CFBooleanGetTypeID() { return nil }
        if let d = val as? Double { return d }
        if let i = val as? Int { return Double(i) }
        if let s = val as? String { return Double(s) }
        return nil
    }

    private func parsePoint(_ val: Any?) -> CGPoint? {
        if let arr = val as? [Any], arr.count >= 2,
           let x = asDouble(arr[0]), let y = asDouble(arr[1]) {
            return CGPoint(x: x, y: y)
        }
        if let dict = val as? [String: Any],
           let x = asDouble(dict["x"]), let y = asDouble(dict["y"]) {
            return CGPoint(x: x, y: y)
        }
        return nil
    }
}

// MARK: - Live Multi-Cursor Choreography Demo

public func runCursorChoreographyDemo(blocking: Bool = false) {
    let screen = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
    let cx = screen.width / 2.0
    let cy = screen.height / 2.0

    let generation = SafetyController.shared.operationGeneration
    func pause(_ duration: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(duration)
        while Date() < deadline {
            if !SafetyController.shared.isCurrent(generation) || SafetyController.shared.isStopped { return false }
            Thread.sleep(forTimeInterval: 0.01)
        }
        return true
    }
    let work = {
        guard SafetyController.shared.isCurrent(generation), !SafetyController.shared.isStopped else { return }
        // Primary cursor glides in along a curved Bezier path
        CursorOverlayManager.shared.moveCursor(
            id: "codex-main",
            to: CGPoint(x: cx - 220, y: cy - 120),
            label: "OpenSky Agent · Inspecting UI",
            duration: 0.55,
            spotlightRect: CGRect(x: cx - 310, y: cy - 155, width: 180, height: 70)
        )
        guard pause(0.6) else { return }

        // Click ripple + press tilt
        CursorOverlayManager.shared.animateClick(
            id: "codex-main",
            at: CGPoint(x: cx - 220, y: cy - 120),
            label: "OpenSky Agent · Clicked!",
            clickCount: 1,
            Spotlight: CGRect(x: cx - 310, y: cy - 155, width: 180, height: 70)
        )

        // Spawn a parallel secondary subagent cursor simultaneously!
        CursorOverlayManager.shared.moveCursor(
            id: "subagent-2",
            to: CGPoint(x: cx + 220, y: cy - 90),
            label: "Named pointer · visual preview",
            duration: 0.6,
            spotlightRect: CGRect(x: cx + 130, y: cy - 125, width: 180, height: 70)
        )
        guard pause(0.45) else { return }

        // Primary cursor sweeps across the screen in a long Bezier arc showing Scoot Stretch, Squash & Tilt
        CursorOverlayManager.shared.moveCursor(
            id: "codex-main",
            to: CGPoint(x: cx + 180, y: cy + 140),
            label: "OpenSky Agent · Fast Scoot Arc",
            duration: 0.52
        )
        CursorOverlayManager.shared.animateClick(
            id: "subagent-2",
            at: CGPoint(x: cx + 220, y: cy - 90),
            label: "Named pointer · click preview",
            clickCount: 2
        )
        guard pause(0.55) else { return }

        // Thinking wiggle micro-interaction
        CursorOverlayManager.shared.setWiggle(
            id: "codex-main",
            enabled: true,
            label: "OpenSky Agent · Thinking…"
        )
        CursorOverlayManager.shared.moveCursor(
            id: "subagent-2",
            to: CGPoint(x: cx - 180, y: cy + 130),
            label: "Subagent #2 · Done",
            duration: 0.5
        )
        guard pause(1.1) else { return }

        // Converge to center and double-click
        CursorOverlayManager.shared.setWiggle(id: "codex-main", enabled: false)
        CursorOverlayManager.shared.moveCursor(
            id: "codex-main",
            to: CGPoint(x: cx, y: cy),
            label: "OpenSky Ready ✨",
            duration: 0.45,
            spotlightRect: CGRect(x: cx - 110, y: cy - 36, width: 220, height: 72)
        )
        guard pause(0.48) else { return }
        CursorOverlayManager.shared.animateClick(
            id: "codex-main",
            at: CGPoint(x: cx, y: cy),
            label: "OpenSky Ready ✨",
            clickCount: 2
        )
        CursorOverlayManager.shared.dismissCursor(id: "subagent-2")
        guard pause(0.9) else { return }
    }

    if blocking {
        SafetyController.shared.withGeneration(generation) { work() }
    } else {
        DispatchQueue.global(qos: .userInteractive).async { SafetyController.shared.withGeneration(generation) { work() } }
    }
}

// MARK: - Authenticated loopback-only transport

public final class LocalHTTPServer {
    private let port: UInt16
    private let token: String
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "opensky.http", attributes: .concurrent)
    private let actions = DispatchQueue(label: "opensky.actions")
    private let maxBody = 2 * 1024 * 1024
    private let pendingLock = NSLock()
    private var pendingActions = 0
    private let maxPendingActions = 64

    public init(port: UInt16, token: String) { self.port = port; self.token = token }

    public func start() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        let listener = try NWListener(using: parameters)
        listener.newConnectionHandler = { [weak self] connection in self?.handle(connection) }
        listener.stateUpdateHandler = { state in
            if case .failed(let error) = state { fputs("OpenSky listener failed: \(error)\n", stderr); exit(1) }
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 120) { connection.cancel() }
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
            guard let self else { return }
            var bytes = buffer
            if let data { bytes.append(data) }
            guard bytes.count <= self.maxBody + 16384 else { self.respond(connection, status: 413, body: ["ok": false, "error": "Request too large"]); return }
            if let end = bytes.range(of: Data("\r\n\r\n".utf8)) {
                guard end.lowerBound <= 16384, let header = String(data: bytes[..<end.lowerBound], encoding: .utf8) else { self.respond(connection, status: 400, body: ["ok": false, "error": "Invalid headers"]); return }
                let lines = header.components(separatedBy: "\r\n")
                var headers = [String: String]()
                for line in lines.dropFirst() {
                    let parts = line.split(separator: ":", maxSplits: 1)
                    guard parts.count == 2 else { self.respond(connection, status: 400, body: ["ok": false, "error": "Invalid header"]); return }
                    let key = parts[0].lowercased()
                    guard headers[key] == nil else { self.respond(connection, status: 400, body: ["ok": false, "error": "Duplicate header"]); return }
                    headers[key] = parts[1].trimmingCharacters(in: .whitespaces)
                }
                guard headers["transfer-encoding"] == nil, let size = Int(headers["content-length"] ?? "0"), size >= 0, size <= self.maxBody else { self.respond(connection, status: 400, body: ["ok": false, "error": "Invalid Content-Length"]); return }
                if bytes.count - end.upperBound >= size {
                    self.process(connection, line: lines.first ?? "", headers: headers, data: bytes.subdata(in: end.upperBound..<(end.upperBound + size)))
                    return
                }
            } else if bytes.count > 16384 { self.respond(connection, status: 431, body: ["ok": false, "error": "Headers too large"]); return }
            if complete || error != nil { connection.cancel() } else { self.receive(connection, buffer: bytes) }
        }
    }

    private func process(_ connection: NWConnection, line: String, headers: [String: String], data: Data) {
        // Browser origins are never clients of this local machine-control API.
        guard headers["origin"] == nil else { respond(connection, status: 403, body: ["ok": false, "error": "Browser-origin requests are not allowed"]); return }
        let parts = line.split(separator: " ")
        guard parts.count == 3 else { respond(connection, status: 400, body: ["ok": false, "error": "Invalid request"]); return }
        let route = String(parts[1])
        if parts[0] == "GET" && route == "/health" {
            respond(connection, body: ["ok": true, "service": "OpenSky Computer Use Daemon", "version": "1.3.0"]); return
        }
        guard headers["authorization"] == "Bearer \(token)" else { respond(connection, status: 401, body: ["ok": false, "error": "Unauthorized"]); return }
        if parts[0] == "GET" && route == "/status" {
            respond(connection, body: OpenSkyRPCDispatcher.shared.dispatch(method: "status", params: [:])); return
        }
        guard parts[0] == "POST", route == "/rpc" else { respond(connection, status: 404, body: ["ok": false, "error": "Unknown route"]); return }
        guard headers["content-type"]?.lowercased().hasPrefix("application/json") == true,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let method = json["method"] as? String,
              let params = json["params"] as? [String: Any] else { respond(connection, status: 400, body: ["ok": false, "error": "Expected {method,params} JSON"]); return }
        let passiveInspector = ["inspector", "agent_activity"].contains(method) && ["status", "close"].contains(params["action"] as? String ?? "status")
        let priority = passiveInspector || ["stop", "resume", "shutdown", "status", "ping", "cursor_status", "cursor_dismiss"].contains(method)
        let generation = SafetyController.shared.operationGeneration
        let enqueuedAt = ProcessInfo.processInfo.systemUptime
        // Reject control submitted during a pause even if resume arrives before dispatch.
        if !priority && !inspectionMethods.contains(method) && SafetyController.shared.isStopped {
            respond(connection, body: ["ok": false, "error_code": "stopped", "error": "OpenSky is stopped. Resume before submitting new actions."])
            return
        }
        if !priority {
            pendingLock.lock()
            let full = pendingActions >= maxPendingActions
            if !full { pendingActions += 1 }
            pendingLock.unlock()
            if full {
                respond(connection, status: 429, body: ["ok": false, "error_code": "queue_full", "error": "OpenSky's action queue is full. Wait for current work to finish."])
                return
            }
        }
        let work = {
            defer {
                if !priority { self.pendingLock.lock(); self.pendingActions -= 1; self.pendingLock.unlock() }
            }
            var result: [String: Any]
            if !priority && !SafetyController.shared.isCurrent(generation) {
                result = ["ok": false, "error_code": "cancelled", "error": "Cancelled by emergency stop. Submit a new request after resuming."]
            } else if !priority && ProcessInfo.processInfo.systemUptime - enqueuedAt > 5 {
                result = ["ok": false, "error_code": "queue_expired", "error": "This request waited more than five seconds. Observe again before submitting new input."]
            } else {
                result = SafetyController.shared.withGeneration(generation) {
                    OpenSkyRPCDispatcher.shared.dispatch(method: method, params: params)
                }
                // Stop/resume cannot erase cancellation of an operation already in progress.
                if !priority && !SafetyController.shared.isCurrent(generation) {
                    result = ["ok": false, "error_code": "cancelled", "error": "Interrupted by emergency stop. Completed input cannot be undone."]
                }
            }
            if let id = json["id"] { result["id"] = id }
            self.respond(connection, body: result)
        }
        // Stop and status remain responsive during input or capture.
        if priority { work() } else { actions.async(execute: work) }
    }

    private func respond(_ connection: NWConnection, status: Int = 200, body: [String: Any]) {
        let data = (try? JSONSerialization.data(withJSONObject: body)) ?? Data("{}".utf8)
        let header = "HTTP/1.1 \(status) Response\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: \(data.count)\r\nConnection: close\r\n\r\n"
        var bytes = Data(header.utf8); bytes.append(data)
        connection.send(content: bytes, completion: .contentProcessed { _ in connection.cancel() })
    }
}

private func loadControlToken() throws -> String {
    if let token = ProcessInfo.processInfo.environment["OPENSKY_AUTH_TOKEN"], token.count == 64 { return token }
    let home = ProcessInfo.processInfo.environment["OPENSKY_HOME"] ?? NSHomeDirectory() + "/.local/share/opensky"
    try FileManager.default.createDirectory(atPath: home, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let path = home + "/control-token"
    if !FileManager.default.fileExists(atPath: path) {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw NSError(domain: "OpenSky", code: 1) }
        let value = bytes.map { String(format: "%02x", $0) }.joined()
        let fd = open(path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
        if fd >= 0 { _ = value.withCString { write(fd, $0, 64) }; close(fd) }
    }
    let token = try String(contentsOfFile: path, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
    guard token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw NSError(domain: "OpenSky invalid token", code: 2) }
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
    return token
}

// MARK: - Main Entrypoint

let args = CommandLine.arguments
let portEnv = ProcessInfo.processInfo.environment["OPENSKY_PORT"].flatMap { UInt16($0) } ?? 43821

if args.contains("--rpc") {
    print("{\"ok\":false,\"error\":\"Use the authenticated resident daemon.\"}")
    exit(1)
}

var residentServer: LocalHTTPServer?
private var residentMenu: OpenSkyMenu?
var stopMonitor: Any?
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

// Offscreen fixture rendering never starts control, creates a status item or asks for access.
if let flag = args.firstIndex(of: "--render-ui-preview") {
    guard args.indices.contains(flag + 1), !args[flag + 1].hasPrefix("--") else {
        fputs("--render-ui-preview requires an output directory.\n", stderr); exit(64)
    }
    do { try renderUIPreview(to: URL(fileURLWithPath: args[flag + 1])); exit(0) }
    catch { fputs("UI preview failed: \(error)\n", stderr); exit(1) }
}

DispatchQueue.main.async {
    // Initialize transparent click-through overlay window
    _ = CursorOverlayManager.shared

    if args.contains("--demo-once") {
        DispatchQueue.global(qos: .userInteractive).async {
            runCursorChoreographyDemo(blocking: true)
            DispatchQueue.main.async {
                NSApplication.shared.terminate(nil)
            }
        }
        return
    }

    do {
        let server = LocalHTTPServer(port: portEnv, token: try loadControlToken())
        try server.start()
        residentServer = server
        residentMenu = OpenSkyMenu()
        UserActivityTracker.shared.start(home: ProcessInfo.processInfo.environment["OPENSKY_HOME"] ?? NSHomeDirectory() + "/.local/share/opensky")
        stopMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { event in
            let required: NSEvent.ModifierFlags = [.control, .option, .command]
            if event.keyCode == 53 && event.modifierFlags.intersection(required) == required { residentMenu?.stopControl() }
        }
        fputs("OpenSky Daemon listening on http://127.0.0.1:\(portEnv)\n", stderr)
    } catch {
        fputs("OpenSky Daemon failed to start on port \(portEnv): \(error)\n", stderr)
        exit(1)
    }

    if args.contains("--demo") {
        runCursorChoreographyDemo(blocking: false)
    }
}

app.run()
