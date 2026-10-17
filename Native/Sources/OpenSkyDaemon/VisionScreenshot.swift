import AppKit
import Foundation
import Vision
import CoreGraphics

/// Machine-readable observation failures. Permission checks never trigger a prompt.
public struct ObservationIssue: Error, Codable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

public struct OCRTextElement: Codable {
    public let index: Int
    public let text: String
    public let confidence: Float
    /// Global Quartz screen coordinates, in points, with the main display's top-left at (0, 0).
    /// Displays to the left or above the main display can have negative coordinates.
    public let frame: CGRect
    public var center: CGPoint { CGPoint(x: frame.midX, y: frame.midY) }
}

public struct ScreenshotResult {
    public let filePath: String
    public let url: String
    /// Image dimensions are pixels; windowFrame is in global Quartz points.
    public let width: Int
    public let height: Int
    public let windowFrame: CGRect
    public let cgImage: CGImage?
    public let captureKind: String
    public let displayID: CGDirectDisplayID?
    public var scaleX: CGFloat { CGFloat(width) / windowFrame.width }
    public var scaleY: CGFloat { CGFloat(height) / windowFrame.height }
}

public final class VisionScreenshotEngine {
    public static let shared = VisionScreenshotEngine()
    private let screenshotsDir: URL

    private init() {
        let override = ProcessInfo.processInfo.environment["OPENSKY_HOME"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let root = override.flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath, isDirectory: true) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/opensky", isDirectory: true)
        self.screenshotsDir = root.appendingPathComponent("screenshots", isDirectory: true)
    }

    /// Compatibility wrapper. Call captureWindowResult to preserve the reason for failure.
    public func captureWindow(windowID: CGWindowID?, windowFrame: CGRect?) -> ScreenshotResult? {
        try? captureWindowResult(windowID: windowID, windowFrame: windowFrame).get()
    }

    /// Capture exactly the requested window, or the main display when no window is requested.
    /// A failed app-window capture must never silently become a desktop screenshot.
    public func captureWindowResult(
        windowID: CGWindowID?, windowFrame: CGRect?
    ) -> Result<ScreenshotResult, ObservationIssue> {
        guard CGPreflightScreenCaptureAccess() else {
            return .failure(ObservationIssue(code: "screen_recording_permission_required",
                message: "Screen Recording permission is required for screenshots. Enable it for OpenSky in System Settings > Privacy & Security, then restart the daemon."))
        }
        let resolvedFrame: CGRect
        if let wid = windowID {
            guard wid > 0, let frame = windowFrame, Self.validFrame(frame) else {
                return .failure(ObservationIssue(code: "invalid_window_frame", message: "A window capture requires a valid window ID and its global frame."))
            }
            guard let info = CGWindowListCopyWindowInfo(.optionIncludingWindow, wid) as? [[String: Any]],
                  let window = info.first(where: { ($0[kCGWindowNumber as String] as? UInt32) == wid }),
                  let bounds = window[kCGWindowBounds as String] as? [String: CGFloat] else {
                return .failure(ObservationIssue(code: "window_unavailable", message: "The requested window no longer exists."))
            }
            let live = CGRect(x: bounds["X"] ?? 0, y: bounds["Y"] ?? 0,
                width: bounds["Width"] ?? 0, height: bounds["Height"] ?? 0)
            guard abs(frame.minX - live.minX) <= 1, abs(frame.minY - live.minY) <= 1,
                  abs(frame.width - live.width) <= 1, abs(frame.height - live.height) <= 1 else {
                return .failure(ObservationIssue(code: "window_moved", message: "The window moved or resized during observation. Observe it again before using screenshot coordinates."))
            }
            resolvedFrame = frame
        } else {
            // NSScreen.main follows the focused application and may be a secondary display.
            // screencapture -m always captures CGMainDisplayID instead.
            resolvedFrame = CGDisplayBounds(CGMainDisplayID())
        }
        guard Self.validFrame(resolvedFrame) else {
            return .failure(ObservationIssue(code: "display_unavailable", message: "No active display frame is available."))
        }
        do {
            try FileManager.default.createDirectory(at: screenshotsDir, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: screenshotsDir.path)
        } catch {
            return .failure(ObservationIssue(code: "screenshot_storage_failed", message: "Could not create screenshot storage: \(error.localizedDescription)"))
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let filename = "\(formatter.string(from: Date()))-screenshot-\(UUID().uuidString)-Codex.png"
        let outURL = screenshotsDir.appendingPathComponent(filename)
        let process = Process()
        let errorPipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.standardOutput = FileHandle.nullDevice
        process.standardError = errorPipe
        if let wid = windowID {
            // -o excludes the window shadow, so pixels map to the supplied AX/CG frame.
            process.arguments = ["-x", "-o", "-l", String(wid), outURL.path]
        } else {
            // Otherwise screencapture writes additional, untracked files for secondary displays.
            process.arguments = ["-x", "-m", outURL.path]
        }
        let completion = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in completion.signal() }
        do { try process.run() } catch {
            return .failure(ObservationIssue(code: "screenshot_process_failed", message: "Could not start screen capture: \(error.localizedDescription)"))
        }
        guard completion.wait(timeout: .now() + 15) == .success else {
            process.terminate()
            try? FileManager.default.removeItem(at: outURL)
            return .failure(ObservationIssue(code: "screenshot_timeout", message: "Screen capture did not finish within 15 seconds."))
        }
        guard process.terminationStatus == 0 else {
            let data = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let detail = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            try? FileManager.default.removeItem(at: outURL)
            return .failure(ObservationIssue(code: "screenshot_failed", message: detail.isEmpty ? "The requested screenshot could not be captured." : String(detail.prefix(500))))
        }
        guard let image = NSImage(contentsOf: outURL),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            try? FileManager.default.removeItem(at: outURL)
            return .failure(ObservationIssue(code: "screenshot_decode_failed", message: "Screen capture did not produce a readable image."))
        }
        do {
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: outURL.path)
        } catch {
            try? FileManager.default.removeItem(at: outURL)
            return .failure(ObservationIssue(code: "screenshot_storage_failed", message: "Could not restrict screenshot file permissions."))
        }
        return .success(ScreenshotResult(filePath: outURL.path, url: outURL.absoluteString,
            width: cgImage.width, height: cgImage.height, windowFrame: resolvedFrame, cgImage: cgImage,
            captureKind: windowID == nil ? "display" : "window", displayID: windowID == nil ? CGMainDisplayID() : nil))
    }

    /// Convert Vision's bottom-left normalized coordinates into global, top-left Quartz points.
    public static func globalFrame(normalizedBox box: CGRect, captureFrame: CGRect) -> CGRect {
        CGRect(x: captureFrame.minX + box.minX * captureFrame.width,
               y: captureFrame.minY + (1 - box.maxY) * captureFrame.height,
               width: box.width * captureFrame.width, height: box.height * captureFrame.height)
    }

    /// Compatibility wrapper. Call recognizeTextResult to distinguish failure from no detected text.
    public func recognizeText(in cgImage: CGImage, windowFrame: CGRect, startingIndex: Int = 1000) -> [OCRTextElement] {
        (try? recognizeTextResult(in: cgImage, windowFrame: windowFrame, startingIndex: startingIndex).get()) ?? []
    }

    public func recognizeTextResult(
        in cgImage: CGImage, windowFrame: CGRect, startingIndex: Int = 1000
    ) -> Result<[OCRTextElement], ObservationIssue> {
        guard Self.validFrame(windowFrame), startingIndex >= 0 else {
            return .failure(ObservationIssue(code: "invalid_ocr_frame", message: "OCR requires a valid capture frame and nonnegative starting index."))
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        do {
            try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        } catch {
            return .failure(ObservationIssue(code: "ocr_failed", message: "Text recognition failed: \(error.localizedDescription)"))
        }
        // perform is synchronous. The previous completion semaphore could wait five seconds
        // after an error and then report an empty result as a successful observation.
        var elements = (request.results ?? []).compactMap { observation -> OCRTextElement? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return OCRTextElement(index: 0, text: text, confidence: candidate.confidence,
                frame: Self.globalFrame(normalizedBox: observation.boundingBox, captureFrame: windowFrame))
        }
        // A strict lexicographic ordering avoids the non-transitive comparator produced by
        // pairwise 'within 10 px' row grouping. Quantized rows remain stable across a capture.
        elements.sort {
            let aRow = Int(floor($0.frame.minY / 10)), bRow = Int(floor($1.frame.minY / 10))
            if aRow != bRow { return aRow < bRow }
            if $0.frame.minX != $1.frame.minX { return $0.frame.minX < $1.frame.minX }
            return $0.text < $1.text
        }
        return .success(elements.enumerated().map { offset, element in
            OCRTextElement(index: startingIndex + offset, text: element.text,
                confidence: element.confidence, frame: element.frame)
        })
    }

    private static func validFrame(_ frame: CGRect) -> Bool {
        !frame.isNull && !frame.isInfinite && frame.origin.x.isFinite && frame.origin.y.isFinite &&
            frame.width.isFinite && frame.height.isFinite && frame.width > 0 && frame.height > 0
    }
}
