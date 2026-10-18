import AppKit
import ApplicationServices
import Carbon.HIToolbox
import CoreGraphics
import Darwin
import Foundation

public struct ActionExecutionResult: Codable {
    public let success: Bool
    public let action: String
    public let message: String
    public let point: [Double]?
    public let appState: AppSnapshotResult?
    public var errorCode: String? = nil
}

public final class ActionExecutor {
    public static let shared = ActionExecutor()

    private init() {}

    // MARK: - 1. Click (Element Index or Screen Coordinates, Background or Takeover)

    public func click(
        app: String?,
        elementIndex: Int?,
        point: CGPoint?,
        mouseButton: String = "left",
        clickCount: Int = 1,
        key: String? = nil,
        holdDuration: TimeInterval = 0.05,
        mode: String = "hybrid",
        cursorId: String = "default",
        label: String? = nil,
        returnState: Bool = true
    ) -> ActionExecutionResult {
        guard let executionMode = ExecutionMode(rawValue: mode.lowercased()) else {
            return failure("click", "Invalid mode. Use background, hybrid, or takeover.")
        }
        guard !SafetyController.shared.isStopped else { return stopped("click") }
        guard validButton(mouseButton), (1...3).contains(clickCount),
              holdDuration.isFinite, (0...5).contains(holdDuration), validModifiers(key) else {
            return failure("click", "Invalid button, click count (1–3), duration (0–5 seconds), or modifier.")
        }
        let target = resolveTarget(app)
        if app != nil && target == nil { return invalidTarget("click", app) }
        if elementIndex != nil && target == nil {
            return failure("click", "An app is required when using an element index.")
        }
        var node: IndexedAXNode?
        if let index = elementIndex, let app = app {
            guard let found = AXEngine.shared.lookupNode(appIdentifier: app, elementIndex: index) else {
                return invalidIndex("click", index)
            }
            node = found
        }
        let resolvedPoint = node?.centerPoint ?? (elementIndex == nil ? point : nil)
        if node == nil, let resolvedPoint = resolvedPoint, !validPoint(resolvedPoint) {
            return failure("click", "Click point must be finite and on an active display.")
        }
        let isSimpleClick = mouseButton.lowercased() == "left" && clickCount == 1
            && (key == nil || key!.isEmpty) && holdDuration <= 0.15
        if executionMode != .takeover, isSimpleClick, let node = node, let element = node.axElement {
            guard !SafetyController.shared.isStopped else { return stopped("click") }
            if OpenSkyAXActions.perform(element, kAXPressAction as CFString) == .success {
                animateClick(at: resolvedPoint, node: node, cursorId: cursorId, label: label, clickCount: clickCount)
                return completed("click (AXPress background)", "Pressed element #\(node.index) via Accessibility.",
                                 app: app, point: resolvedPoint, returnState: returnState)
            }
        }
        guard executionMode != .background else {
            return failure("click", "This click cannot be performed with AXPress. Background mode never posts physical mouse events; use hybrid or takeover for a coordinate or modified click.")
        }
        guard let targetPoint = resolvedPoint, validPoint(targetPoint) else {
            return failure("click", "Provide a valid element index from the latest app state or a point on an active display.")
        }
        guard CGPreflightPostEventAccess() else { return postingPermissionFailure("click") }
        guard prepareHardwareTarget(target) else { return focusFailure("click") }
        guard waitForPointOwnership(targetPoint, target) else {
            return failure("click", "The click point is covered by another app or is outside the target app. Refresh app state.")
        }
        animateClick(at: targetPoint, node: node, cursorId: cursorId, label: label, clickCount: clickCount)
        if let failed = performCGMouseClick(at: targetPoint, button: mouseButton, clickCount: clickCount,
                                  flags: parseModifierFlags(from: key), holdDuration: holdDuration, target: target, expectedNode: node) {
            return ActionExecutionResult(success: false, action: "click", message: failed.message,
                                         point: nil, appState: nil, errorCode: failed.code)
        }
        return completed("click", "Clicked at (\(Int(targetPoint.x)), \(Int(targetPoint.y))).",
                         app: app, point: targetPoint, returnState: returnState)
    }

    // MARK: - 2. Drag (Hardware execution requires foreground target)

    public func drag(
        app: String?,
        startElementIndex: Int?,
        startPoint: CGPoint?,
        endElementIndex: Int?,
        endPoint: CGPoint?,
        mouseButton: String = "left",
        key: String? = nil,
        duration: TimeInterval = 0.55,
        mode: String = "hybrid",
        cursorId: String = "default",
        returnState: Bool = true
    ) -> ActionExecutionResult {
        guard let executionMode = ExecutionMode(rawValue: mode.lowercased()) else {
            return failure("drag", "Invalid mode. Use background, hybrid, or takeover.")
        }
        guard !SafetyController.shared.isStopped else { return stopped("drag") }
        guard executionMode != .background else {
            return failure("drag", "Background dragging is unsupported. Use hybrid or takeover to activate the target and drag.")
        }
        guard validButton(mouseButton), validModifiers(key), duration.isFinite, (0.05...30).contains(duration) else {
            return failure("drag", "Invalid button, modifier, or duration (0.05–30 seconds).")
        }
        let target = resolveTarget(app)
        if app != nil && target == nil { return invalidTarget("drag", app) }
        if (startElementIndex != nil || endElementIndex != nil) && target == nil {
            return failure("drag", "An app is required when using element indices.")
        }
        var from = startPoint
        var to = endPoint
        var startNode: IndexedAXNode?
        if let app = app {
            if let index = startElementIndex {
                guard let node = AXEngine.shared.lookupNode(appIdentifier: app, elementIndex: index) else {
                    return invalidIndex("drag", index)
                }
                from = node.centerPoint
                startNode = node
            }
            if let index = endElementIndex {
                guard let node = AXEngine.shared.lookupNode(appIdentifier: app, elementIndex: index) else {
                    return invalidIndex("drag", index)
                }
                to = node.centerPoint
            }
        }
        guard let start = from, let end = to, validPoint(start), validPoint(end) else {
            return failure("drag", "Both drag endpoints must resolve to finite points on active displays.")
        }
        guard CGPreflightPostEventAccess() else { return postingPermissionFailure("drag") }
        guard prepareHardwareTarget(target) else { return focusFailure("drag") }
        guard waitForPointOwnership(start, target), pointMatchesNode(start, startNode) else {
            return failure("drag", "The drag start is outside the target app or covered by another element/app. Refresh app state.")
        }
        let flags = parseModifierFlags(from: key)
        let source = UserActivityTracker.eventSource()
        let types = mouseTypes(mouseButton)
        guard positionMouse(at: start, target: target) else { return focusFailure("drag") }
        guard let down = CGEvent(mouseEventSource: source, mouseType: types.down, mouseCursorPosition: start, mouseButton: types.button),
              let up = CGEvent(mouseEventSource: source, mouseType: types.up, mouseCursorPosition: start, mouseButton: types.button) else {
            return failure("drag", "Could not create mouse events.")
        }
        guard canContinue(target) else { return stopped("drag") }
        CursorOverlayManager.shared.animateDrag(id: cursorId, from: start, to: end, label: "Dragging", duration: duration)
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        var releasePoint = start
        var released = false
        // Every exit after mouse-down releases the button, including emergency stop.
        defer {
            if !released {
                up.location = releasePoint
                up.post(tap: .cghidEventTap)
            }
        }
        let steps = max(12, Int(duration * 60))
        for step in 1...steps {
            guard canContinue(target) else {
                return failure("drag", "Drag stopped; the mouse button was released.")
            }
            let t = CGFloat(step) / CGFloat(steps)
            let point = CGPoint(x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t)
            guard let event = CGEvent(mouseEventSource: source, mouseType: types.drag, mouseCursorPosition: point, mouseButton: types.button) else {
                return failure("drag", "Drag event creation failed; the mouse button was released.")
            }
            event.flags = flags
            event.post(tap: .cghidEventTap)
            releasePoint = point
            Thread.sleep(forTimeInterval: duration / Double(steps))
        }
        // Release before reading the resulting app state rather than waiting for defer.
        up.location = end
        up.post(tap: .cghidEventTap)
        released = true
        return completed("drag", "Dragged from (\(Int(start.x)), \(Int(start.y))) to (\(Int(end.x)), \(Int(end.y))).",
                         app: app, point: end, returnState: returnState)
    }

    // MARK: - 3. Scroll (PID-targeted background or foreground hardware)

    public func scroll(
        app: String?,
        elementIndex: Int?,
        point: CGPoint?,
        direction: String = "down",
        pages: Double = 1.0,
        key: String? = nil,
        mode: String = "hybrid",
        cursorId: String = "default",
        returnState: Bool = true
    ) -> ActionExecutionResult {
        guard let executionMode = ExecutionMode(rawValue: mode.lowercased()) else {
            return failure("scroll", "Invalid mode. Use background, hybrid, or takeover.")
        }
        guard !SafetyController.shared.isStopped else { return stopped("scroll") }
        let direction = direction.lowercased()
        guard ["up", "down", "left", "right"].contains(direction), pages.isFinite,
              pages > 0, pages <= 100, validModifiers(key) else {
            return failure("scroll", "Direction must be up/down/left/right; pages must be greater than 0 and at most 100; modifiers must be known.")
        }
        let target = resolveTarget(app)
        if app != nil && target == nil { return invalidTarget("scroll", app) }
        if executionMode == .background && target == nil {
            return failure("scroll", "Background scrolling requires an app.")
        }
        var resolvedPoint = point
        if let index = elementIndex {
            guard let app = app, let node = AXEngine.shared.lookupNode(appIdentifier: app, elementIndex: index) else {
                return invalidIndex("scroll", index)
            }
            resolvedPoint = node.centerPoint
        } else if resolvedPoint == nil, let app = app,
                  let window = AXEngine.shared.lookupWindowInfo(appIdentifier: app) {
            resolvedPoint = CGPoint(x: window.frame.midX, y: window.frame.midY)
        }
        guard let scrollPoint = resolvedPoint, validPoint(scrollPoint) else {
            return failure("scroll", "Provide a valid point/element, or inspect the app first to obtain its window position.")
        }
        let background = executionMode == .background
        guard CGPreflightPostEventAccess() else { return postingPermissionFailure("scroll") }
        if !background {
            guard prepareHardwareTarget(target) else { return focusFailure("scroll") }
            guard waitForPointOwnership(scrollPoint, target) else {
                return failure("scroll", "The scroll point is outside the target app or covered by another app.")
            }
        }
        CursorOverlayManager.shared.moveCursor(id: cursorId, to: scrollPoint, label: "Scroll \(direction)")
        if !background {
            guard positionMouse(at: scrollPoint, target: target) else {
                return failure("scroll", "Could not position the pointer for foreground scrolling.")
            }
        }
        let total = max(1, Int32((pages * 380).rounded()))
        let chunks: Int32 = 8
        let flags = parseModifierFlags(from: key)
        for chunk in 0..<chunks {
            guard !SafetyController.shared.isStopped, background || canContinue(target), target?.isTerminated != true else {
                return failure("scroll", "Scrolling interrupted by emergency stop, focus change, or target exit.")
            }
            // Cumulative division retains the remainder, including small scroll distances.
            let amount = ((chunk + 1) * total / chunks) - (chunk * total / chunks)
            let dy: Int32 = direction == "down" ? -amount : direction == "up" ? amount : 0
            let dx: Int32 = direction == "right" ? -amount : direction == "left" ? amount : 0
            guard let event = CGEvent(scrollWheelEvent2Source: UserActivityTracker.eventSource(), units: .pixel, wheelCount: 2,
                                      wheel1: dy, wheel2: dx, wheel3: 0) else {
                return failure("scroll", "Could not create scroll event.")
            }
            event.location = scrollPoint
            event.flags = flags
            if background, let target = target {
                event.postToPid(target.processIdentifier)
            } else {
                event.post(tap: .cghidEventTap)
            }
            Thread.sleep(forTimeInterval: 0.025)
        }
        let message = background ? "Posted background scroll events to the target process; app support determines delivery." : "Scrolled \(direction) by \(pages) page(s)."
        return completed("scroll", message, app: app, point: scrollPoint, returnState: returnState)
    }

    // MARK: - 4. Set Value (Direct AX Value Injection with Keyboard Fallback)

    public func setValue(
        app: String,
        elementIndex: Int,
        value: String,
        mode: String = "background",
        cursorId: String = "default",
        returnState: Bool = true
    ) -> ActionExecutionResult {
        guard let executionMode = ExecutionMode(rawValue: mode.lowercased()) else {
            return failure("set_value", "Invalid mode. Use background, hybrid, or takeover.")
        }
        guard !SafetyController.shared.isStopped else { return stopped("set_value") }
        guard resolveTarget(app) != nil else { return invalidTarget("set_value", app) }
        guard let node = AXEngine.shared.lookupNode(appIdentifier: app, elementIndex: elementIndex) else {
            return invalidIndex("set_value", elementIndex)
        }
        var writable = DarwinBoolean(false)
        let valueWritable = node.axElement.map { AXUIElementIsAttributeSettable($0, kAXValueAttribute as CFString, &writable) == .success && writable.boolValue } ?? false
        if executionMode == .background && !valueWritable {
            return failure("set_value", "The field does not expose a writable Accessibility value. Background mode never falls back to foreground clicks or keyboard input.")
        }
        if let element = node.axElement,
           OpenSkyAXActions.set(element, kAXValueAttribute as CFString, value as CFTypeRef) == .success {
            if let point = node.centerPoint {
                CursorOverlayManager.shared.moveCursor(id: cursorId, to: point, label: "Set Value #\(elementIndex)", spotlightRect: node.frame)
            }
            return completed("set_value (AX direct)", "Set the value of element #\(elementIndex).",
                             app: app, point: node.centerPoint, returnState: returnState)
        }
        guard executionMode != .background else {
            return failure("set_value", "The Accessibility value write failed. Background mode never falls back to foreground clicks or keyboard input. Inspect the field before choosing another action.")
        }
        guard let element = node.axElement else {
            return failure("set_value", "This element has no editable Accessibility reference. Use an explicit click and type_text if appropriate.")
        }
        var rawRole: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &rawRole)
        guard let role = rawRole as? String, ["AXTextField", "AXTextArea", "AXComboBox"].contains(role) else {
            return failure("set_value", "Direct value setting failed and this element is not a text input. No keyboard fallback was sent.")
        }
        // Never type if an earlier targeting/focus action failed.
        let clickResult = click(app: app, elementIndex: elementIndex, point: nil, mode: "takeover",
                                cursorId: cursorId, returnState: false)
        guard clickResult.success else { return failure("set_value", clickResult.message) }
        let keyResult = pressKey(app: app, keys: ["super+a", "BackSpace"], mode: "takeover", returnState: false)
        guard keyResult.success else { return failure("set_value", keyResult.message) }
        let textResult = typeText(app: app, text: value, mode: "takeover", returnState: false)
        guard textResult.success else { return failure("set_value", textResult.message) }
        return completed("set_value (fallback type)", "Sent select-all and replacement text to element #\(elementIndex).",
                         app: app, point: node.centerPoint, returnState: returnState)
    }

    // MARK: - 5. Type Text (Complete Unicode scalars, never split surrogate pairs)

    public func typeText(
        app: String?,
        text: String,
        mode: String = "hybrid",
        returnState: Bool = true
    ) -> ActionExecutionResult {
        guard let executionMode = ExecutionMode(rawValue: mode.lowercased()) else {
            return failure("type_text", "Invalid mode. Use background, hybrid, or takeover.")
        }
        guard !SafetyController.shared.isStopped else { return stopped("type_text") }
        let resolvedTarget = resolveTarget(app)
        if app != nil && resolvedTarget == nil { return invalidTarget("type_text", app) }
        let target = resolvedTarget ?? (app == nil ? NSWorkspace.shared.frontmostApplication : nil)
        guard target != nil else { return failure("type_text", "No foreground app was found. Provide a running app.") }
        let background = executionMode == .background
        guard !background || resolvedTarget != nil else { return failure("type_text", "Background typing requires an app.") }
        guard CGPreflightPostEventAccess() else { return postingPermissionFailure("type_text") }
        if !background && !prepareHardwareTarget(target) { return focusFailure("type_text") }
        let source = UserActivityTracker.eventSource()
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        for scalar in normalized.unicodeScalars {
            guard !SafetyController.shared.isStopped, background || canContinue(target), target?.isTerminated != true else {
                return failure("type_text", "Typing interrupted by emergency stop, focus change, or target exit.")
            }
            if scalar.value == 10 {
                guard sendSingleKeyCode(CGKeyCode(kVK_Return), flags: [], pid: background ? target?.processIdentifier : nil) else {
                    return failure("type_text", "Could not create Return key events.")
                }
                continue
            }
            var units = Array(String(scalar).utf16)
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
                return failure("type_text", "Could not create text input events.")
            }
            // Literal text must not inherit modifiers from a preceding shortcut.
            down.flags = []
            up.flags = []
            units.withUnsafeMutableBufferPointer { buffer in
                down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
                up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
            }
            if background, let target = target {
                down.postToPid(target.processIdentifier)
                up.postToPid(target.processIdentifier)
            } else {
                down.post(tap: .cghidEventTap)
                up.post(tap: .cghidEventTap)
            }
            Thread.sleep(forTimeInterval: 0.008)
        }
        let message = background ? "Posted \(text.count) characters to the target process; app support determines delivery." : "Typed \(text.count) characters."
        return completed("type_text", message, app: app, returnState: returnState)
    }

    // MARK: - 6. Press Key (Validate every chord before sending any keys)

    public func pressKey(
        app: String?,
        keys: [String],
        mode: String = "hybrid",
        returnState: Bool = true
    ) -> ActionExecutionResult {
        guard let executionMode = ExecutionMode(rawValue: mode.lowercased()) else {
            return failure("press_key", "Invalid mode. Use background, hybrid, or takeover.")
        }
        guard !SafetyController.shared.isStopped else { return stopped("press_key") }
        guard !keys.isEmpty else { return failure("press_key", "Provide at least one key chord.") }
        var resolved: [(CGKeyCode, CGEventFlags)] = []
        for chord in keys {
            let parts = chord.components(separatedBy: "+").map { $0.trimmingCharacters(in: .whitespaces) }
            guard let main = parts.last, !main.isEmpty, !parts.contains(""),
                  validModifiers(parts.dropLast().joined(separator: "+")),
                  let (code, shift) = resolveKeyCode(for: main) else {
                return failure("press_key", "Unknown key or modifier in '\(chord)'. No keys were sent. Use the name 'plus' for +.")
            }
            var flags = parseModifierFlags(from: parts.dropLast().joined(separator: "+"))
            if shift { flags.insert(.maskShift) }
            resolved.append((code, flags))
        }
        let resolvedTarget = resolveTarget(app)
        if app != nil && resolvedTarget == nil { return invalidTarget("press_key", app) }
        let target = resolvedTarget ?? (app == nil ? NSWorkspace.shared.frontmostApplication : nil)
        guard target != nil else { return failure("press_key", "No foreground app was found. Provide a running app.") }
        let background = executionMode == .background
        guard !background || resolvedTarget != nil else { return failure("press_key", "Background keys require an app.") }
        guard CGPreflightPostEventAccess() else { return postingPermissionFailure("press_key") }
        if !background && !prepareHardwareTarget(target) { return focusFailure("press_key") }
        for (code, flags) in resolved {
            guard !SafetyController.shared.isStopped, background || canContinue(target), target?.isTerminated != true else {
                return failure("press_key", "Key sequence interrupted by emergency stop, focus change, or target exit.")
            }
            guard sendSingleKeyCode(code, flags: flags, pid: background ? target?.processIdentifier : nil) else {
                return failure("press_key", "Could not create key events.")
            }
            Thread.sleep(forTimeInterval: 0.04)
        }
        return completed("press_key", "Sent \(keys.count) key chord(s).", app: app, returnState: returnState)
    }

    // MARK: - 7. Clipboard-preserving paste

    public func paste(
        app: String?,
        content: String,
        format: String = "text",
        elementIndex: Int? = nil,
        point: CGPoint? = nil,
        cursorId: String = "default",
        returnState: Bool = true
    ) -> ActionExecutionResult {
        guard !SafetyController.shared.isStopped else { return stopped("paste") }
        guard CGPreflightPostEventAccess() else { return postingPermissionFailure("paste") }
        guard ["text", "md", "markdown", "html"].contains(format.lowercased()) else {
            return failure("paste", "Format must be text, markdown, or html.")
        }
        let resolvedTarget = resolveTarget(app)
        if app != nil && resolvedTarget == nil { return invalidTarget("paste", app) }
        let target = resolvedTarget ?? (app == nil ? NSWorkspace.shared.frontmostApplication : nil)
        guard target != nil else { return failure("paste", "No foreground app was found. Provide a running app.") }
        if elementIndex != nil || point != nil {
            let result = click(app: app, elementIndex: elementIndex, point: point, mode: "takeover", cursorId: cursorId, returnState: false)
            guard result.success else { return failure("paste", result.message) }
        } else if !prepareHardwareTarget(target) {
            return focusFailure("paste")
        }
        guard canContinue(target) else { return stopped("paste") }
        let pasteboard = NSPasteboard.general
        let backup: [[NSPasteboard.PasteboardType: Data]] = (pasteboard.pasteboardItems ?? []).map { item in
            var values: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types { if let data = item.data(forType: type) { values[type] = data } }
            return values
        }
        pasteboard.clearContents()
        guard pasteboard.setString(content, forType: .string) else {
            restorePasteboard(pasteboard, items: backup)
            return failure("paste", "Could not write the clipboard.")
        }
        if format.lowercased() == "html", let data = content.data(using: .utf8) {
            pasteboard.setData(data, forType: .html)
        }
        let ownedChange = pasteboard.changeCount
        defer {
            // Do not overwrite a clipboard update the user/app made while paste was running.
            if pasteboard.changeCount == ownedChange { restorePasteboard(pasteboard, items: backup) }
        }
        guard canContinue(target), sendSingleKeyCode(CGKeyCode(kVK_ANSI_V), flags: .maskCommand, pid: nil) else {
            return failure("paste", "Paste interrupted or key event creation failed.")
        }
        Thread.sleep(forTimeInterval: 0.22)
        return completed("paste", "Sent paste for \(content.count) characters; restored the clipboard when unchanged.", app: app, returnState: returnState)
    }

    // MARK: - 8. Perform Secondary Action (AXShowMenu, AXIncrement, AXConfirm, etc.)

    public func performSecondaryAction(
        app: String,
        elementIndex: Int,
        action: String,
        cursorId: String = "default",
        returnState: Bool = true
    ) -> ActionExecutionResult {
        guard !SafetyController.shared.isStopped else { return stopped("perform_secondary_action") }
        guard resolveTarget(app) != nil else { return invalidTarget("perform_secondary_action", app) }
        guard let node = AXEngine.shared.lookupNode(appIdentifier: app, elementIndex: elementIndex),
              let axEl = node.axElement else {
            return ActionExecutionResult(
                success: false,
                action: "perform_secondary_action",
                message: "AX Element #\(elementIndex) not found for \(app).",
                point: nil,
                appState: nil
            )
        }

        if let pt = node.centerPoint {
            CursorOverlayManager.shared.moveCursor(id: cursorId, to: pt, label: "\(action) #\(elementIndex)", spotlightRect: node.frame)
        }

        let normalized = action.hasPrefix("AX") ? action : "AX\(action)"
        let err = OpenSkyAXActions.perform(axEl, normalized as CFString)
        Thread.sleep(forTimeInterval: 0.15)
        let snap = returnState ? AXEngine.shared.getAppState(appIdentifier: app, launchIfNeeded: false, windowID: AXEngine.shared.pinnedWindowID(appIdentifier: app)) : nil
        return ActionExecutionResult(
            success: err == .success,
            action: "perform_secondary_action (\(normalized))",
            message: err == .success ? "Performed \(normalized) on element #\(elementIndex)." : "AX action \(normalized) returned error code \(err.rawValue).",
            point: node.centerPoint.map { [Double($0.x), Double($0.y)] },
            appState: snap
        )
    }

    // MARK: - 9. Select Text (By Prefix/Suffix or Element Range)

    public func selectText(
        app: String,
        elementIndex: Int,
        prefix: String = "",
        suffix: String = "",
        selectionType: String = "SelectContent",
        returnState: Bool = true
    ) -> ActionExecutionResult {
        guard !SafetyController.shared.isStopped else { return stopped("select_text") }
        guard resolveTarget(app) != nil else { return invalidTarget("select_text", app) }
        guard ["SelectContent", "MoveCursorToStart", "MoveCursorToEnd"].contains(selectionType) else {
            return failure("select_text", "Unknown selection type.")
        }
        guard let node = AXEngine.shared.lookupNode(appIdentifier: app, elementIndex: elementIndex),
              let axEl = node.axElement else {
            return ActionExecutionResult(
                success: false,
                action: "select_text",
                message: "AX Element #\(elementIndex) not found for \(app).",
                point: nil,
                appState: nil
            )
        }

        let fullText = node.value ?? node.title
        let nsText = fullText as NSString
        var startLoc = 0
        var endLoc = nsText.length

        if !prefix.isEmpty {
            let r = nsText.range(of: prefix)
            guard r.location != NSNotFound else { return failure("select_text", "Selection prefix was not found. No selection changed.") }
            startLoc = r.location
        }
        if !suffix.isEmpty {
            let searchRange = NSRange(location: startLoc, length: max(0, nsText.length - startLoc))
            let r = nsText.range(of: suffix, options: [], range: searchRange)
            guard r.location != NSNotFound else { return failure("select_text", "Selection suffix was not found after the prefix. No selection changed.") }
            endLoc = r.location + r.length
        }

        var cfRange: CFRange
        switch selectionType {
        case "MoveCursorToStart":
            cfRange = CFRange(location: startLoc, length: 0)
        case "MoveCursorToEnd":
            cfRange = CFRange(location: endLoc, length: 0)
        default:
            cfRange = CFRange(location: startLoc, length: max(0, endLoc - startLoc))
        }

        guard !SafetyController.shared.isStopped else { return stopped("select_text") }
        guard let rangeVal = AXValueCreate(.cfRange, &cfRange) else {
            return failure("select_text", "Could not create the selected text range.")
        }
        let status = OpenSkyAXActions.set(axEl, kAXSelectedTextRangeAttribute as CFString, rangeVal)
        guard status == .success else { return failure("select_text", "Selection failed with Accessibility error \(status.rawValue).") }

        let snap = returnState ? AXEngine.shared.getAppState(appIdentifier: app, launchIfNeeded: false, windowID: AXEngine.shared.pinnedWindowID(appIdentifier: app)) : nil
        return ActionExecutionResult(
            success: true,
            action: "select_text",
            message: "Selected text range [\(cfRange.location), len=\(cfRange.length)] in element #\(elementIndex).",
            point: node.centerPoint.map { [Double($0.x), Double($0.y)] },
            appState: snap
        )
    }

    // MARK: - 10. OpenSky Extras: Window Management & AppleScript / JXA

    public func manageWindow(
        app: String,
        action: String,
        frame: CGRect? = nil
    ) -> ActionExecutionResult {
        guard !SafetyController.shared.isStopped else { return stopped("manage_window") }
        let action = action.lowercased()
        guard ["focus", "activate", "minimize", "maximize", "center", "move_resize"].contains(action) else {
            return failure("manage_window", "Unknown window action. Use focus, minimize, maximize, center, or move_resize.")
        }
        if let frame = frame, (!frame.origin.x.isFinite || !frame.origin.y.isFinite || !frame.width.isFinite || !frame.height.isFinite || frame.width <= 0 || frame.height <= 0) {
            return failure("manage_window", "Window frame must contain finite coordinates and positive width and height.")
        }
        if action == "move_resize" && frame == nil { return failure("manage_window", "move_resize requires a frame.") }
        guard let target = AXEngine.shared.resolveOrLaunchApp(identifier: app, launchIfNeeded: true) else {
            return invalidTarget("manage_window", app)
        }
        let axApp = AXUIElementCreateApplication(target.processIdentifier)
        var reference: CFTypeRef?
        var window: AXUIElement?
        if AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &reference) == .success,
           let reference = reference, CFGetTypeID(reference) == AXUIElementGetTypeID() {
            window = (reference as! AXUIElement)
        } else if AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &reference) == .success,
                  let windows = reference as? [AXUIElement] {
            window = windows.first
        }
        if action == "focus" || action == "activate" {
            // Activation alone does not reopen a windowless document app. An explicit
            // focus request may send the normal LaunchServices reopen event.
            if window == nil, let url = target.bundleURL {
                _ = AXEngine.shared.resolveOrLaunchApp(identifier: url.path, launchIfNeeded: true,
                    launchInBackground: false, reopenIfRunning: true)
                var reopened: CFTypeRef?
                if AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &reopened) == .success,
                   let reopened = reopened, CFGetTypeID(reopened) == AXUIElementGetTypeID() {
                    window = (reopened as! AXUIElement)
                }
            }
            guard prepareHardwareTarget(target) else { return focusFailure("manage_window") }
            if let window = window {
                let result = OpenSkyAXActions.perform(window, kAXRaiseAction as CFString)
                guard result == .success else { return failure("manage_window", "App activated, but raising its window failed with Accessibility error \(result.rawValue).") }
            }
            return completed("manage_window", "Activated \(app).", app: app, returnState: true)
        }
        guard let window = window else { return failure("manage_window", "The app has no available window.") }
        guard !SafetyController.shared.isStopped else { return stopped("manage_window") }
        if action == "minimize" {
            let result = OpenSkyAXActions.set(window, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
            guard result == .success else { return failure("manage_window", "Minimize failed with Accessibility error \(result.rawValue).") }
        } else {
            let existing = accessibilityFrame(window)
            guard let existing = existing,
                  let windowID = AXEngine.shared.onScreenWindowID(pid: target.processIdentifier, frame: existing) else {
                return failure("manage_window", "Could not match the focused Accessibility window to its on-screen window. Observe the app again before moving it.")
            }
            let screen = quartzVisibleScreen(containing: CGPoint(x: existing.midX, y: existing.midY))
            let desired: CGRect
            switch action {
            case "move_resize": desired = frame!
            case "maximize":
                guard let screen = screen else { return failure("manage_window", "No active screen was found.") }
                desired = screen
            default:
                guard let screen = screen else {
                    return failure("manage_window", "Could not determine the window size and active screen.")
                }
                let size = frame?.size ?? existing.size
                desired = CGRect(x: screen.midX - size.width / 2, y: screen.midY - size.height / 2, width: size.width, height: size.height)
            }
            var size = desired.size
            var position = desired.origin
            guard let sizeValue = AXValueCreate(.cgSize, &size), let positionValue = AXValueCreate(.cgPoint, &position) else {
                return failure("manage_window", "Could not create the requested window frame.")
            }
            // Move first: a display transition can otherwise restore the old size.
            let positionResult = OpenSkyAXActions.set(window, kAXPositionAttribute as CFString, positionValue)
            guard positionResult == .success else { return failure("manage_window", "Move failed with Accessibility error \(positionResult.rawValue).") }
            Thread.sleep(forTimeInterval: 0.25)
            guard !SafetyController.shared.isStopped else { return stopped("manage_window") }
            let sizeResult = OpenSkyAXActions.set(window, kAXSizeAttribute as CFString, sizeValue)
            guard sizeResult == .success else { return failure("manage_window", "Window moved, but resizing it failed with Accessibility error \(sizeResult.rawValue).") }
            // AppKit animates AX resizing. Setting position before that animation
            // finishes can cancel it at an intermediate size. Observe the size first.
            let sizeDeadline = Date().addingTimeInterval(1.5)
            // AX can report the requested destination before WindowServer has
            // reached it. Use the actual on-screen geometry to await completion.
            while AXEngine.shared.onScreenWindowFrame(windowID: windowID).map({ abs($0.width - desired.width) > 2 || abs($0.height - desired.height) > 2 }) ?? true,
                  Date() < sizeDeadline, !SafetyController.shared.isStopped {
                Thread.sleep(forTimeInterval: 0.05)
            }
            guard !SafetyController.shared.isStopped else { return stopped("manage_window") }
            guard let sized = AXEngine.shared.onScreenWindowFrame(windowID: windowID), abs(sized.width - desired.width) <= 2, abs(sized.height - desired.height) <= 2 else {
                return failure("manage_window", "The app constrained or did not finish resizing to \(desired.size). Actual frame: \(String(describing: AXEngine.shared.onScreenWindowFrame(windowID: windowID))). Refresh app state.")
            }
            // Resizing across displays can shift the origin to keep the window on
            // its former display. Finish the frame operation by setting its origin.
            let finalPosition = OpenSkyAXActions.set(window, kAXPositionAttribute as CFString, positionValue)
            guard finalPosition == .success else { return failure("manage_window", "Final window positioning failed with Accessibility error \(finalPosition.rawValue).") }
            let deadline = Date().addingTimeInterval(1.5)
            var actual = AXEngine.shared.onScreenWindowFrame(windowID: windowID)
            while actual.map({ !Self.framesClose($0, desired) }) ?? true,
                  Date() < deadline, !SafetyController.shared.isStopped {
                Thread.sleep(forTimeInterval: 0.05)
                actual = AXEngine.shared.onScreenWindowFrame(windowID: windowID)
            }
            guard !SafetyController.shared.isStopped else { return stopped("manage_window") }
            guard let actual = actual, Self.framesClose(actual, desired) else {
                return failure("manage_window", "The app constrained or did not apply the requested frame \(desired). Actual frame: \(String(describing: actual)). Refresh app state before using coordinates.")
            }
        }
        return completed("manage_window", "Applied window action '\(action)' to \(app).", app: app, returnState: true)
    }

    public func runAppleScript(script: String, language: String = "applescript") -> (success: Bool, output: String) {
        guard !SafetyController.shared.isStopped else { return (false, "Computer control is stopped.") }
        let language = language.lowercased()
        guard ["applescript", "jxa", "javascript"].contains(language) else { return (false, "Language must be applescript or jxa.") }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = language == "applescript" ? ["-e", script] : ["-l", "JavaScript", "-e", script]
        // Files avoid a full stdout/stderr pipe deadlocking the child. Spool and returned
        // output are bounded, and transient files are owner-only and removed on every exit.
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("opensky-script-" + UUID().uuidString, isDirectory: true)
        let stdoutURL = directory.appendingPathComponent("stdout")
        let stderrURL = directory.appendingPathComponent("stderr")
        let limit = 64 * 1024
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            defer { try? FileManager.default.removeItem(at: directory) }
            guard FileManager.default.createFile(atPath: stdoutURL.path, contents: nil, attributes: [.posixPermissions: 0o600]),
                  FileManager.default.createFile(atPath: stderrURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
                return (false, "Could not prepare script output files.")
            }
            let stdout = try FileHandle(forWritingTo: stdoutURL)
            let stderr = try FileHandle(forWritingTo: stderrURL)
            defer { try? stdout.close(); try? stderr.close() }
            process.standardOutput = stdout
            process.standardError = stderr
            try process.run()
            let deadline = Date().addingTimeInterval(30)
            var interrupted: String?
            while process.isRunning {
                let bytes = [stdoutURL, stderrURL].reduce(UInt64(0)) { sum, url in
                    sum + (((try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber)?.uint64Value ?? 0)
                }
                if SafetyController.shared.isStopped { interrupted = "Script interrupted by emergency stop." }
                else if Date() >= deadline { interrupted = "Script exceeded the 30-second timeout." }
                else if bytes > UInt64(limit) { interrupted = "Script exceeded the 64 KiB output limit." }
                if interrupted != nil {
                    process.terminate()
                    let killDeadline = Date().addingTimeInterval(0.5)
                    while process.isRunning && Date() < killDeadline { Thread.sleep(forTimeInterval: 0.01) }
                    if process.isRunning { Darwin.kill(process.processIdentifier, SIGKILL) }
                    break
                }
                Thread.sleep(forTimeInterval: 0.01)
            }
            process.waitUntilExit()
            let totalBytes = [stdoutURL, stderrURL].reduce(UInt64(0)) { sum, url in
                sum + (((try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber)?.uint64Value ?? 0)
            }
            if interrupted == nil && totalBytes > UInt64(limit) { interrupted = "Script exceeded the 64 KiB output limit." }
            let outReader = try FileHandle(forReadingFrom: stdoutURL)
            let errReader = try FileHandle(forReadingFrom: stderrURL)
            defer { try? outReader.close(); try? errReader.close() }
            let outData = try outReader.read(upToCount: limit) ?? Data()
            let errData = try errReader.read(upToCount: max(1, limit - outData.count)) ?? Data()
            let out = String(decoding: outData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            let err = String(decoding: errData.prefix(limit - outData.count), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            if let interrupted = interrupted { return (false, interrupted + (err.isEmpty ? "" : "\n" + err)) }
            if process.terminationStatus != 0 { return (false, err.isEmpty ? out : err) }
            return (true, out)
        } catch {
            if process.isRunning { process.terminate() }
            return (false, error.localizedDescription)
        }
    }

    // MARK: - Targeting, validation, and CGEvent helpers

    private enum ExecutionMode: String { case background, hybrid, takeover }

    private func failure(_ action: String, _ message: String) -> ActionExecutionResult {
        ActionExecutionResult(success: false, action: action, message: message, point: nil, appState: nil)
    }

    private func postingPermissionFailure(_ action: String) -> ActionExecutionResult {
        ActionExecutionResult(success: false, action: action,
            message: "macOS event-synthesizing access is unavailable for this OpenSky process. Complete its native permission setup; no input events were sent. Background AX controls remain available.",
            point: nil, appState: nil, errorCode: "event_posting_permission_required")
    }

    private func stopped(_ action: String) -> ActionExecutionResult {
        failure(action, "Action stopped. Resume computer control before sending more input.")
    }

    private func invalidTarget(_ action: String, _ app: String?) -> ActionExecutionResult {
        failure(action, "Could not uniquely resolve running app '\(app ?? "")'. Use an exact bundle ID from list_apps.")
    }

    private func invalidIndex(_ action: String, _ index: Int) -> ActionExecutionResult {
        failure(action, "Element #\(index) is missing or stale. Refresh get_app_state and use an index from that response.")
    }

    private func focusFailure(_ action: String) -> ActionExecutionResult {
        failure(action, "Could not confirm the target app is active, or control was stopped. No hardware input was sent.")
    }

    private func completed(_ action: String, _ message: String, app: String?, point: CGPoint? = nil,
                           returnState: Bool) -> ActionExecutionResult {
        Thread.sleep(forTimeInterval: 0.12)
        let pinnedWindow = app.flatMap { AXEngine.shared.pinnedWindowID(appIdentifier: $0) }
        var snapshot = returnState ? app.map { AXEngine.shared.getAppState(appIdentifier: $0, launchIfNeeded: false, windowID: pinnedWindow) } : nil
        // Only repeat observations, never the delivered input. WindowServer may lag
        // AX during a sheet transition, resize, or new-window animation.
        let deadline = Date().addingTimeInterval(0.8)
        while let observed = snapshot, !observed.success,
              ["app_window_unavailable", "window_moved"].contains(observed.error?.code ?? ""),
              let app = app, Date() < deadline, !SafetyController.shared.isStopped {
            Thread.sleep(forTimeInterval: 0.1)
            snapshot = AXEngine.shared.getAppState(appIdentifier: app, launchIfNeeded: false, windowID: pinnedWindow)
        }
        return ActionExecutionResult(success: true, action: action, message: message,
                                     point: point.map { [Double($0.x), Double($0.y)] }, appState: snapshot)
    }

    private static func framesClose(_ actual: CGRect, _ requested: CGRect) -> Bool {
        abs(actual.minX - requested.minX) <= 2 && abs(actual.minY - requested.minY) <= 2
            && abs(actual.width - requested.width) <= 2 && abs(actual.height - requested.height) <= 2
    }

    private func resolveTarget(_ app: String?) -> NSRunningApplication? {
        guard let app = app, !app.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return AXEngine.shared.resolveOrLaunchApp(identifier: app, launchIfNeeded: false)
    }

    private func prepareHardwareTarget(_ target: NSRunningApplication?) -> Bool {
        guard !SafetyController.shared.isStopped else { return false }
        guard let target = target else { return true } // Explicit global screen/keyboard operation.
        guard !target.isTerminated else { return false }
        if target.processIdentifier == ProcessInfo.processInfo.processIdentifier {
            let pinned = target.bundleIdentifier.flatMap { AXEngine.shared.pinnedWindowID(appIdentifier: $0) }
            let result = OpenSkyAXActions.run(AXUIElementCreateApplication(target.processIdentifier)) {
                if let pinned, let window = NSApp.windows.first(where: { $0.windowNumber == Int(pinned) && $0.canBecomeKey }) {
                    window.makeKeyAndOrderFront(nil)
                }
                NSApp.activate(ignoringOtherApps: true)
                return .success
            }
            guard result == .success else { return false }
        } else { target.activate() }
        let deadline = Date().addingTimeInterval(0.5)
        repeat {
            if canContinue(target) { return true }
            if SafetyController.shared.isStopped || target.isTerminated { return false }
            Thread.sleep(forTimeInterval: 0.02)
        } while Date() < deadline
        return false
    }

    private func canContinue(_ target: NSRunningApplication?) -> Bool {
        guard !SafetyController.shared.isStopped else { return false }
        guard let target = target else { return true }
        return !target.isTerminated && NSWorkspace.shared.frontmostApplication?.processIdentifier == target.processIdentifier
    }

    private func validPoint(_ point: CGPoint) -> Bool {
        guard point.x.isFinite, point.y.isFinite else { return false }
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return false }
        var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return false }
        return displays.prefix(Int(count)).contains { CGDisplayBounds($0).contains(point) }
    }

    private func waitForPointOwnership(_ point: CGPoint, _ target: NSRunningApplication?) -> Bool {
        let deadline = Date().addingTimeInterval(0.6)
        repeat {
            guard canContinue(target) else { return false }
            if pointBelongsToTarget(point, target) { return true }
            Thread.sleep(forTimeInterval: 0.03)
        } while Date() < deadline
        return false
    }

    private func pointBelongsToTarget(_ point: CGPoint, _ target: NSRunningApplication?) -> Bool {
        guard let target = target else { return true }
        var element: AXUIElement?
        if AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &element) == .success,
           let element = element {
            var pid: pid_t = 0
            // An own-process AX hit can be the click-through pointer overlay.
            // Resolve it through normal-layer windows, including the Inspector.
            if AXUIElementGetPid(element, &pid) == .success {
                if pid != ProcessInfo.processInfo.processIdentifier { return pid == target.processIdentifier }
                // Popup menus can extend outside the Inspector's normal window.
                // Do not reject a real own menu as if it were a pointer overlay.
                if OwnMenuHitTesting.containsMenu(element, targetPID: target.processIdentifier) { return true }
            }
        }
        // AX hit-testing may be unavailable for custom-rendered windows. Check front-to-back
        // WindowServer ownership. Layer-zero app windows include our Inspector;
        // the pointer overlays are click-through windows above the normal layer.
        guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return false }
        for window in windows {
            if let id = window[kCGWindowNumber as String] as? UInt32, CursorOverlayManager.shared.isOverlayWindow(id) { continue }
            guard let pid = window[kCGWindowOwnerPID as String] as? Int32,
                  let layer = window[kCGWindowLayer as String] as? Int, layer == 0,
                  let bounds = window[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.contains(point),
                  (window[kCGWindowAlpha as String] as? Double ?? 1) > 0 else { continue }
            return pid == target.processIdentifier
        }
        return false
    }

    private func pointMatchesNode(_ point: CGPoint, _ node: IndexedAXNode?) -> Bool {
        guard let expected = node?.axElement else { return true }
        var hit: AXUIElement?
        guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &hit) == .success else { return false }
        // A label/subview may receive the hit-test inside its indexed button or field.
        // Reject a different control (for example a sheet covering an old snapshot).
        for _ in 0..<24 {
            guard let current = hit else { return false }
            if CFEqual(current, expected) { return true }
            var parent: CFTypeRef?
            guard AXUIElementCopyAttributeValue(current, kAXParentAttribute as CFString, &parent) == .success,
                  let parent = parent, CFGetTypeID(parent) == AXUIElementGetTypeID() else { return false }
            hit = (parent as! AXUIElement)
        }
        return false
    }

    private func accessibilityFrame(_ element: AXUIElement) -> CGRect? {
        var positionRef: CFTypeRef?
        var sizeRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionRef) == .success,
              AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
              let positionRef = positionRef, let sizeRef = sizeRef,
              CFGetTypeID(positionRef) == AXValueGetTypeID(), CFGetTypeID(sizeRef) == AXValueGetTypeID() else { return nil }
        var position = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetValue(positionRef as! AXValue, .cgPoint, &position),
              AXValueGetValue(sizeRef as! AXValue, .cgSize, &size) else { return nil }
        return CGRect(origin: position, size: size)
    }

    private func quartzVisibleScreen(containing point: CGPoint?) -> CGRect? {
        let readScreens = { () -> CGRect? in
            // AppKit uses a bottom-left origin; AX/CGEvent use the main display's top-left.
            let mainHeight = CGDisplayBounds(CGMainDisplayID()).height
            let screens = NSScreen.screens.map { screen -> (CGRect, CGRect) in
                let full = screen.frame
                let visible = screen.visibleFrame
                return (CGRect(x: full.minX, y: mainHeight - full.maxY, width: full.width, height: full.height),
                        CGRect(x: visible.minX, y: mainHeight - visible.maxY, width: visible.width, height: visible.height))
            }
            return (point.flatMap { point in screens.first(where: { $0.0.contains(point) }) } ?? screens.first)?.1
        }
        return Thread.isMainThread ? readScreens() : DispatchQueue.main.sync(execute: readScreens)
    }

    private func validButton(_ button: String) -> Bool {
        ["left", "right", "middle", "center"].contains(button.lowercased())
    }

    private func mouseTypes(_ button: String) -> (down: CGEventType, drag: CGEventType, up: CGEventType, button: CGMouseButton) {
        switch button.lowercased() {
        case "right": return (.rightMouseDown, .rightMouseDragged, .rightMouseUp, .right)
        case "middle", "center": return (.otherMouseDown, .otherMouseDragged, .otherMouseUp, .center)
        default: return (.leftMouseDown, .leftMouseDragged, .leftMouseUp, .left)
        }
    }

    private func animateClick(at point: CGPoint?, node: IndexedAXNode?, cursorId: String, label: String?, clickCount: Int) {
        guard let point = point, validPoint(point) else { return }
        let actionLabel = label ?? node.map { "Click \($0.role) #\($0.index)" } ?? "Click"
        let generation = SafetyController.shared.operationGeneration
        CursorOverlayManager.shared.moveCursor(id: cursorId, to: point, label: actionLabel, spotlightRect: node?.frame) {
            guard SafetyController.shared.isCurrent(generation), !SafetyController.shared.isStopped else { return }
            CursorOverlayManager.shared.animateClick(id: cursorId, at: point, label: actionLabel,
                                                    clickCount: clickCount, Spotlight: node?.frame)
        }
    }

    private func restorePasteboard(_ pasteboard: NSPasteboard, items: [[NSPasteboard.PasteboardType: Data]]) {
        pasteboard.clearContents()
        let restored = items.map { values -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in values { item.setData(data, forType: type) }
            return item
        }
        if !restored.isEmpty { pasteboard.writeObjects(restored) }
    }

    private func performCGMouseClick(at point: CGPoint, button: String, clickCount: Int,
                                     flags: CGEventFlags, holdDuration: TimeInterval,
                                     target: NSRunningApplication?, expectedNode: IndexedAXNode?) -> (code: String, message: String)? {
        let source = UserActivityTracker.eventSource()
        let types = mouseTypes(button)
        guard positionMouse(at: point, target: target) else {
            return ("click_position_interrupted", "Pointer positioning was interrupted before a button event. Re-observe the target and cooperation state.")
        }
        for index in 1...clickCount {
            guard canContinue(target) else {
                return ("click_interrupted_before_button", "Focus or stop state changed before the next button event. Earlier clicks in a multi-click action may already be delivered.")
            }
            guard pointBelongsToTarget(point, target) else {
                return ("click_target_covered", "The target point became covered before the next button event. Re-observe before retrying.")
            }
            guard pointMatchesNode(point, expectedNode) else {
                return ("click_target_changed", "The hit control no longer matches the observed control. Re-observe before retrying; no button event for this click was sent.")
            }
            guard let down = CGEvent(mouseEventSource: source, mouseType: types.down, mouseCursorPosition: point, mouseButton: types.button),
                  let up = CGEvent(mouseEventSource: source, mouseType: types.up, mouseCursorPosition: point, mouseButton: types.button) else {
                return ("click_event_creation_failed", "Could not create the next button event. Earlier clicks in a multi-click action may already be delivered.")
            }
            down.flags = flags
            up.flags = flags
            down.setIntegerValueField(.mouseEventClickState, value: Int64(index))
            up.setIntegerValueField(.mouseEventClickState, value: Int64(index))
            down.post(tap: .cghidEventTap)
            let deadline = Date().addingTimeInterval(holdDuration)
            while Date() < deadline && canContinue(target) { Thread.sleep(forTimeInterval: min(0.01, holdDuration)) }
            // A stop or focus change must never leave a held mouse button behind.
            up.post(tap: .cghidEventTap)
            guard canContinue(target) else {
                return ("click_interrupted_after_button", "Focus or stop state changed after button input was sent. Verify the outcome before retrying.")
            }
            if index < clickCount { Thread.sleep(forTimeInterval: 0.04) }
        }
        return nil
    }

    /// WindowServer routing must see an actual pointer move before a synthetic press.
    private func positionMouse(at point: CGPoint, target: NSRunningApplication?) -> Bool {
        guard canContinue(target), pointBelongsToTarget(point, target),
              CGWarpMouseCursorPosition(point) == .success,
              let move = CGEvent(mouseEventSource: UserActivityTracker.eventSource(), mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else { return false }
        move.flags = []
        move.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.03)
        return canContinue(target)
    }

    @discardableResult
    private func sendSingleKeyCode(_ code: CGKeyCode, flags: CGEventFlags, pid: Int32?) -> Bool {
        guard !SafetyController.shared.isStopped else { return false }
        let source = UserActivityTracker.eventSource()
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else { return false }
        down.flags = flags
        // Release the synthetic chord rather than leaving Command/Shift latched
        // in the HID event source for the next typing operation.
        up.flags = []
        if let pid = pid { down.postToPid(pid); up.postToPid(pid) }
        else { down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap) }
        return true
    }

    private func modifierFlag(_ name: String) -> CGEventFlags? {
        switch name.lowercased() {
        case "super", "cmd", "command", "meta", "super_l", "super_r": return .maskCommand
        case "shift", "shift_l", "shift_r": return .maskShift
        case "alt", "option", "opt", "alt_l", "alt_r": return .maskAlternate
        case "ctrl", "control", "control_l", "control_r": return .maskControl
        default: return nil
        }
    }

    private func validModifiers(_ chord: String?) -> Bool {
        guard let chord = chord, !chord.isEmpty else { return true }
        return chord.components(separatedBy: "+").allSatisfy { modifierFlag($0.trimmingCharacters(in: .whitespaces)) != nil }
    }

    private func parseModifierFlags(from chord: String?) -> CGEventFlags {
        guard let chord = chord else { return [] }
        return chord.components(separatedBy: "+").reduce(CGEventFlags()) { flags, name in
            flags.union(modifierFlag(name.trimmingCharacters(in: .whitespaces)) ?? [])
        }
    }

    private func resolveKeyCode(for keyName: String) -> (CGKeyCode, Bool)? {
        switch keyName.lowercased() {
        case "return", "enter": return (CGKeyCode(kVK_Return), false)
        case "kp_enter": return (CGKeyCode(kVK_ANSI_KeypadEnter), false)
        case "tab": return (CGKeyCode(kVK_Tab), false)
        case "space": return (CGKeyCode(kVK_Space), false)
        case "backspace": return (CGKeyCode(kVK_Delete), false)
        case "delete", "forwarddelete": return (CGKeyCode(kVK_ForwardDelete), false)
        case "escape", "esc": return (CGKeyCode(kVK_Escape), false)
        case "up", "arrowup": return (CGKeyCode(kVK_UpArrow), false)
        case "down", "arrowdown": return (CGKeyCode(kVK_DownArrow), false)
        case "left", "arrowleft": return (CGKeyCode(kVK_LeftArrow), false)
        case "right", "arrowright": return (CGKeyCode(kVK_RightArrow), false)
        case "home": return (CGKeyCode(kVK_Home), false)
        case "end": return (CGKeyCode(kVK_End), false)
        case "page_up", "pageup": return (CGKeyCode(kVK_PageUp), false)
        case "page_down", "pagedown": return (CGKeyCode(kVK_PageDown), false)
        case "f1": return (CGKeyCode(kVK_F1), false)
        case "f2": return (CGKeyCode(kVK_F2), false)
        case "f3": return (CGKeyCode(kVK_F3), false)
        case "f4": return (CGKeyCode(kVK_F4), false)
        case "f5": return (CGKeyCode(kVK_F5), false)
        case "f6": return (CGKeyCode(kVK_F6), false)
        case "f7": return (CGKeyCode(kVK_F7), false)
        case "f8": return (CGKeyCode(kVK_F8), false)
        case "f9": return (CGKeyCode(kVK_F9), false)
        case "f10": return (CGKeyCode(kVK_F10), false)
        case "f11": return (CGKeyCode(kVK_F11), false)
        case "f12": return (CGKeyCode(kVK_F12), false)
        default:
            let shifted: [String: String] = [
                "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
                "_": "-", "+": "=", "plus": "=", "{": "[", "}": "]", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/", "|": "\\", "~": "`"
            ]
            let lower = shifted[keyName.lowercased()] ?? keyName.lowercased()
            let needsShift = shifted[keyName.lowercased()] != nil || (keyName.count == 1 && keyName.uppercased() == keyName && keyName.lowercased() != keyName)
            let map: [String: Int] = [
                "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D,
                "e": kVK_ANSI_E, "f": kVK_ANSI_F, "g": kVK_ANSI_G, "h": kVK_ANSI_H,
                "i": kVK_ANSI_I, "j": kVK_ANSI_J, "k": kVK_ANSI_K, "l": kVK_ANSI_L,
                "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O, "p": kVK_ANSI_P,
                "q": kVK_ANSI_Q, "r": kVK_ANSI_R, "s": kVK_ANSI_S, "t": kVK_ANSI_T,
                "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X,
                "y": kVK_ANSI_Y, "z": kVK_ANSI_Z,
                "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3,
                "4": kVK_ANSI_4, "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7,
                "8": kVK_ANSI_8, "9": kVK_ANSI_9,
                "-": kVK_ANSI_Minus, "minus": kVK_ANSI_Minus,
                "=": kVK_ANSI_Equal, "equal": kVK_ANSI_Equal, "plus": kVK_ANSI_Equal,
                "[": kVK_ANSI_LeftBracket, "bracketleft": kVK_ANSI_LeftBracket,
                "]": kVK_ANSI_RightBracket, "bracketright": kVK_ANSI_RightBracket,
                ";": kVK_ANSI_Semicolon, "semicolon": kVK_ANSI_Semicolon,
                "'": kVK_ANSI_Quote, "apostrophe": kVK_ANSI_Quote,
                ",": kVK_ANSI_Comma, "comma": kVK_ANSI_Comma,
                ".": kVK_ANSI_Period, "period": kVK_ANSI_Period,
                "/": kVK_ANSI_Slash, "slash": kVK_ANSI_Slash,
                "\\": kVK_ANSI_Backslash, "backslash": kVK_ANSI_Backslash,
                "`": kVK_ANSI_Grave, "grave": kVK_ANSI_Grave
            ]
            if let code = map[lower] {
                return (CGKeyCode(code), needsShift)
            }
            return nil
        }
    }
}
