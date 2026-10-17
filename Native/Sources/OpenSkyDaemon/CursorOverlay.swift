import AppKit
import SwiftUI
import QuartzCore
import CoreGraphics

// MARK: - Cursor Models & Motion Configuration (Codex SkyComputerUse + OpenSky Extended)

public enum CursorActivityState: String, Codable {
    case idle
    case moving
    case thinking // Playful wiggle while model reasons / waits for UI settle
    case pressing
    case dragging
    case success
}

public struct CursorMotionConfig {
    public var clickAngle: CGFloat = -14.0
    public var arcSize: CGFloat = 0.22
    public var arcFlow: CGFloat = 0.35
    public var straightPathDistanceThreshold: CGFloat = 48.0
    public var scootStretchMax: CGFloat = 1.24
    public var scootSquashMin: CGFloat = 0.84
    public var scootRotationMax: CGFloat = 18.0
    public var idleFadeOutSeconds: TimeInterval = 10.0

    public static let live = CursorMotionConfig()
}

public struct ClickRipple: Identifiable {
    public let id = UUID()
    public let point: CGPoint // In screen coordinates (top-left origin)
    public let color: NSColor
    public let createdAt: TimeInterval
    public let duration: TimeInterval = 0.65
}

public struct SpotlightRect: Identifiable {
    public let id = UUID()
    public let rect: CGRect // In screen coordinates (top-left origin)
    public let label: String?
    public let color: NSColor
    public let createdAt: TimeInterval
    public let duration: TimeInterval
}

public struct DragTrail: Identifiable {
    public let id = UUID()
    public let from: CGPoint
    public let to: CGPoint
    public let current: CGPoint
    public let color: NSColor
    public let createdAt: TimeInterval
    public let duration: TimeInterval = 0.85
}

public final class VirtualCursorState {
    public let id: String
    public var label: String
    public var position: CGPoint // Top-left global screen coordinates
    public var startPosition: CGPoint
    public var targetPosition: CGPoint
    public var controlPoint1: CGPoint
    public var controlPoint2: CGPoint

    public var moveStartTime: TimeInterval = 0
    public var moveDuration: TimeInterval = 0.42
    public var isMoving: Bool = false

    public var velocity: CGVector = .zero
    public var stretchScaleX: CGFloat = 1.0
    public var squashScaleY: CGFloat = 1.0
    public var tiltAngleDegrees: CGFloat = 0.0
    public var stretchAngleDegrees: CGFloat = 0.0

    public var activityState: CursorActivityState = .idle
    public var isPressed: Bool = false
    public var pressStartTime: TimeInterval = 0
    public var opacity: CGFloat = 0.0
    public var targetOpacity: CGFloat = 1.0
    public var lastInteractionTime: TimeInterval = CACurrentMediaTime()

    public var accentColor: NSColor
    public var secondaryColor: NSColor

    public init(id: String, label: String, initialPosition: CGPoint, accentColor: NSColor) {
        self.id = id
        self.label = label
        self.position = initialPosition
        self.startPosition = initialPosition
        self.targetPosition = initialPosition
        self.controlPoint1 = initialPosition
        self.controlPoint2 = initialPosition
        self.accentColor = accentColor
        self.secondaryColor = accentColor.blended(withFraction: 0.45, of: .white) ?? .cyan
    }
}

// MARK: - Dynamic Wallpaper Palette Extractor

public final class WallpaperColorSampler {
    public static let shared = WallpaperColorSampler()
    private var cachedColors: [CGPoint] = []
    private var wallpaperBitmap: NSBitmapImageRep?
    private var lastSampledAt: TimeInterval = 0

    public func sampleColor(at screenPoint: CGPoint) -> NSColor {
        let now = CACurrentMediaTime()
        if wallpaperBitmap == nil || (now - lastSampledAt) > 30.0 {
            refreshWallpaper()
            lastSampledAt = now
        }

        if let bitmap = wallpaperBitmap {
            let screenFrame = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
            let normX = max(0.0, min(0.99, screenPoint.x / max(1.0, screenFrame.width)))
            let normY = max(0.0, min(0.99, screenPoint.y / max(1.0, screenFrame.height)))
            let px = Int(normX * CGFloat(bitmap.pixelsWide))
            let py = Int(normY * CGFloat(bitmap.pixelsHigh))
            if let sampled = bitmap.colorAt(x: px, y: py) {
                // Boost saturation and brightness so the fog glow is vibrant and visible
                var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
                if let rgb = sampled.usingColorSpace(.sRGB) {
                    rgb.getHue(&h, saturation: &s, brightness: &b, alpha: &a)
                    return NSColor(hue: h, saturation: max(0.68, min(0.95, s * 1.35)), brightness: max(0.82, min(1.0, b * 1.25)), alpha: 1.0)
                }
            }
        }

        // Fallback expressive gradient based on screen coordinates
        let screenFrame = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
        let hue = fmod(0.55 + (screenPoint.x / max(1, screenFrame.width)) * 0.28 + (screenPoint.y / max(1, screenFrame.height)) * 0.15, 1.0)
        return NSColor(hue: hue, saturation: 0.78, brightness: 0.96, alpha: 1.0)
    }

    private func refreshWallpaper() {
        guard let screen = NSScreen.main,
              let url = NSWorkspace.shared.desktopImageURL(for: screen),
              let image = NSImage(contentsOf: url) else {
            return
        }
        // Downsample to a tiny 64x64 thumbnail for ultra-fast real-time color sampling
        let smallSize = NSSize(width: 64, height: 64)
        let smallImage = NSImage(size: smallSize)
        smallImage.lockFocus()
        image.draw(in: NSRect(origin: .zero, size: smallSize),
                   from: NSRect(origin: .zero, size: image.size),
                   operation: .copy,
                   fraction: 1.0)
        smallImage.unlockFocus()
        self.wallpaperBitmap = smallImage.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0) }
    }
}

// Helper for pointer syntax above
private func saturation(_ ptr: UnsafeMutablePointer<CGFloat>) -> UnsafeMutablePointer<CGFloat> { ptr }

// MARK: - Custom CoreGraphics / AppKit Overlay Canvas View

public final class CursorCanvasView: NSView {
    public unowned let manager: CursorOverlayManager
    private let globalFrame: CGRect

    public init(frame: NSRect, globalFrame: CGRect, manager: CursorOverlayManager) {
        self.manager = manager
        self.globalFrame = globalFrame
        super.init(frame: frame)
        self.wantsLayer = true
        self.layer?.backgroundColor = NSColor.clear.cgColor
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    public override var isFlipped: Bool {
        // Use top-left origin to match CGEvent / ScreenCaptureKit / Accessibility coordinates!
        return true
    }

    public override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.clear(dirtyRect)
        ctx.saveGState()
        defer { ctx.restoreGState() }
        // Each display gets its own window, including when Spaces are separate.
        ctx.translateBy(x: -globalFrame.minX, y: -globalFrame.minY)

        let now = CACurrentMediaTime()

        // 1. Draw Spotlight Element Highlights
        for spotlight in manager.spotlights {
            let age = now - spotlight.createdAt
            guard age < spotlight.duration else { continue }
            let progress = CGFloat(age / spotlight.duration)
            let alpha = (1.0 - progress) * 0.85

            ctx.saveGState()
            let insetRect = spotlight.rect.insetBy(dx: -3, dy: -3)
            let path = CGPath(roundedRect: insetRect, cornerWidth: 8, cornerHeight: 8, transform: nil)

            ctx.setShadow(offset: .zero, blur: 14, color: spotlight.color.withAlphaComponent(alpha).cgColor)
            ctx.setStrokeColor(spotlight.color.withAlphaComponent(alpha).cgColor)
            ctx.setLineWidth(2.2)
            ctx.addPath(path)
            ctx.strokePath()

            ctx.setFillColor(spotlight.color.withAlphaComponent(alpha * 0.10).cgColor)
            ctx.addPath(path)
            ctx.fillPath()

            if let label = spotlight.label, !label.isEmpty {
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: NSFont.systemFont(ofSize: 11, weight: .semibold),
                    .foregroundColor: NSColor.white.withAlphaComponent(alpha)
                ]
                let size = (label as NSString).size(withAttributes: attrs)
                let badgeRect = CGRect(
                    x: insetRect.minX,
                    y: max(4, insetRect.minY - size.height - 6),
                    width: size.width + 12,
                    height: size.height + 4
                )
                let badgePath = CGPath(roundedRect: badgeRect, cornerWidth: 5, cornerHeight: 5, transform: nil)
                ctx.setFillColor(NSColor.black.withAlphaComponent(alpha * 0.78).cgColor)
                ctx.addPath(badgePath)
                ctx.fillPath()
                (label as NSString).draw(at: CGPoint(x: badgeRect.minX + 6, y: badgeRect.minY + 2), withAttributes: attrs)
            }
            ctx.restoreGState()
        }

        // 2. Draw Drag Trails
        for trail in manager.dragTrails {
            let age = now - trail.createdAt
            guard age < trail.duration else { continue }
            let alpha = CGFloat(max(0, 1.0 - age / trail.duration))
            ctx.saveGState()
            ctx.setStrokeColor(trail.color.withAlphaComponent(alpha * 0.75).cgColor)
            ctx.setLineWidth(3.0)
            ctx.setLineCap(.round)
            ctx.setLineDash(phase: 0, lengths: [6, 4])
            ctx.move(to: trail.from)
            ctx.addLine(to: trail.current)
            ctx.strokePath()
            ctx.restoreGState()
        }

        // 3. Draw Click Ripples
        for ripple in manager.ripples {
            let age = now - ripple.createdAt
            guard age < ripple.duration else { continue }
            let t = CGFloat(age / ripple.duration)
            let easeOut = 1.0 - pow(1.0 - t, 3)
            let radius = 6.0 + easeOut * 34.0
            let alpha = (1.0 - t) * 0.85

            ctx.saveGState()
            let rect = CGRect(x: ripple.point.x - radius, y: ripple.point.y - radius, width: radius * 2, height: radius * 2)
            ctx.setStrokeColor(ripple.color.withAlphaComponent(alpha).cgColor)
            ctx.setLineWidth(2.5 * (1.0 - t * 0.6))
            ctx.strokeEllipse(in: rect)

            // Inner secondary ring
            let innerRadius = 3.0 + easeOut * 18.0
            let innerRect = CGRect(x: ripple.point.x - innerRadius, y: ripple.point.y - innerRadius, width: innerRadius * 2, height: innerRadius * 2)
            ctx.setFillColor(ripple.color.withAlphaComponent(alpha * 0.25).cgColor)
            ctx.fillEllipse(in: innerRect)
            ctx.restoreGState()
        }

        // 4. Draw Each Active Virtual Cursor (with Fog Glow, Scoot Stretch/Tilt, Wiggle, and HUD Pill)
        for (_, cursor) in manager.cursors where cursor.opacity > 0.01 {
            drawVirtualCursor(ctx: ctx, cursor: cursor, now: now)
        }
    }

    private func drawVirtualCursor(ctx: CGContext, cursor: VirtualCursorState, now: TimeInterval) {
        ctx.saveGState()

        var drawPos = cursor.position
        var extraWiggleAngle: CGFloat = 0.0

        // Playful Thinking Wiggle (Codex signature micro-interaction)
        if cursor.activityState == .thinking {
            let phase = CGFloat(now * 10.5)
            drawPos.x += sin(phase) * 3.2
            drawPos.y += cos(phase * 2.0) * 1.8
            extraWiggleAngle = sin(phase * 1.15) * 14.0
        }

        let alpha = cursor.opacity

        // 4A. Ambient Fog Glow (Codex FogCursorStyle dynamic wallpaper-tinted halo)
        let fogRadius: CGFloat = cursor.activityState == .thinking ? (28.0 + CGFloat(sin(now * 6.0)) * 5.0) : 24.0
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let fogColors = [
            cursor.accentColor.withAlphaComponent(0.52 * alpha).cgColor,
            cursor.secondaryColor.withAlphaComponent(0.22 * alpha).cgColor,
            cursor.accentColor.withAlphaComponent(0.0).cgColor
        ] as CFArray
        let locations: [CGFloat] = [0.0, 0.45, 1.0]
        if let gradient = CGGradient(colorsSpace: colorSpace, colors: fogColors, locations: locations) {
            let fogCenter = CGPoint(x: drawPos.x + 6, y: drawPos.y + 8)
            ctx.drawRadialGradient(
                gradient,
                startCenter: fogCenter,
                startRadius: 1.0,
                endCenter: fogCenter,
                endRadius: fogRadius,
                options: .drawsAfterEndLocation
            )
        }

        // 4B. Transform for Scoot Stretch, Squash, Click Press & Tilt
        ctx.saveGState()
        ctx.translateBy(x: drawPos.x, y: drawPos.y)

        let totalAngleDeg = cursor.tiltAngleDegrees + extraWiggleAngle + (cursor.isPressed ? CursorMotionConfig.live.clickAngle : 0.0)
        let totalAngleRad = totalAngleDeg * (.pi / 180.0)
        ctx.rotate(by: totalAngleRad)

        let pressScale: CGFloat = cursor.isPressed ? 0.85 : 1.0
        ctx.scaleBy(x: cursor.stretchScaleX * pressScale, y: cursor.squashScaleY * pressScale)

        // Smooth rounded custom AI pointer arrow path (hotspot at 0,0)
        let pointerPath = CGMutablePath()
        pointerPath.move(to: CGPoint(x: 0, y: 0))
        pointerPath.addLine(to: CGPoint(x: 0, y: 21.5))
        pointerPath.addQuadCurve(to: CGPoint(x: 2.2, y: 22.4), control: CGPoint(x: 0, y: 23.0))
        pointerPath.addLine(to: CGPoint(x: 6.4, y: 17.8))
        pointerPath.addLine(to: CGPoint(x: 10.2, y: 25.0))
        pointerPath.addQuadCurve(to: CGPoint(x: 13.4, y: 23.4), control: CGPoint(x: 12.1, y: 26.2))
        pointerPath.addLine(to: CGPoint(x: 9.6, y: 16.2))
        pointerPath.addLine(to: CGPoint(x: 15.8, y: 15.6))
        pointerPath.addQuadCurve(to: CGPoint(x: 16.5, y: 13.4), control: CGPoint(x: 17.4, y: 15.4))
        pointerPath.addLine(to: CGPoint(x: 1.8, y: 0.4))
        pointerPath.addQuadCurve(to: CGPoint(x: 0, y: 0), control: CGPoint(x: 0.6, y: -0.4))
        pointerPath.closeSubpath()

        // Dynamic shadow
        ctx.setShadow(offset: CGSize(width: 0, height: 3), blur: 8, color: NSColor.black.withAlphaComponent(0.45 * alpha).cgColor)

        // Fill pointer with vibrant wallpaper-derived color gradient
        ctx.saveGState()
        ctx.addPath(pointerPath)
        ctx.clip()
        let bodyColors = [
            cursor.secondaryColor.withAlphaComponent(alpha).cgColor,
            cursor.accentColor.withAlphaComponent(alpha).cgColor
        ] as CFArray
        if let bodyGrad = CGGradient(colorsSpace: colorSpace, colors: bodyColors, locations: [0.0, 1.0]) {
            ctx.drawLinearGradient(bodyGrad, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 16, y: 25), options: [])
        }
        ctx.restoreGState()

        // Crisp white outer border
        ctx.setShadow(offset: .zero, blur: 0, color: nil)
        ctx.addPath(pointerPath)
        ctx.setStrokeColor(NSColor.white.withAlphaComponent(0.95 * alpha).cgColor)
        ctx.setLineWidth(1.8)
        ctx.setLineJoin(.round)
        ctx.strokePath()

        ctx.restoreGState()

        // 4C. Floating Agent Label Pill (next to pointer)
        if !cursor.label.isEmpty {
            let statusPrefix: String
            switch cursor.activityState {
            case .thinking: statusPrefix = "✦ "
            case .pressing: statusPrefix = "● "
            case .dragging: statusPrefix = "⇄ "
            case .moving:   statusPrefix = "▸ "
            case .idle, .success: statusPrefix = "✦ "
            }
            let pillText = statusPrefix + cursor.label
            let font = NSFont.systemFont(ofSize: 11.5, weight: .semibold)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: NSColor.white.withAlphaComponent(alpha)
            ]
            let textSize = (pillText as NSString).size(withAttributes: attrs)
            let pillWidth = textSize.width + 18
            let pillHeight = textSize.height + 7

            let screenWidth = bounds.width > 0 ? bounds.width : 1440
            var pillX = drawPos.x + 20
            var pillY = drawPos.y + 18
            if pillX + pillWidth > screenWidth - 12 {
                pillX = drawPos.x - pillWidth - 8
            }
            if pillY + pillHeight > bounds.height - 12 {
                pillY = drawPos.y - pillHeight - 8
            }

            let pillRect = CGRect(x: pillX, y: pillY, width: pillWidth, height: pillHeight)
            let pillPath = CGPath(roundedRect: pillRect, cornerWidth: pillHeight / 2, cornerHeight: pillHeight / 2, transform: nil)

            ctx.saveGState()
            ctx.setShadow(offset: CGSize(width: 0, height: 4), blur: 10, color: NSColor.black.withAlphaComponent(0.38 * alpha).cgColor)
            ctx.setFillColor(NSColor(calibratedWhite: 0.08, alpha: 0.86 * alpha).cgColor)
            ctx.addPath(pillPath)
            ctx.fillPath()

            ctx.setShadow(offset: .zero, blur: 0, color: nil)
            ctx.setStrokeColor(cursor.accentColor.withAlphaComponent(0.75 * alpha).cgColor)
            ctx.setLineWidth(1.25)
            ctx.addPath(pillPath)
            ctx.strokePath()

            (pillText as NSString).draw(
                at: CGPoint(x: pillRect.minX + 9, y: pillRect.minY + 3.5),
                withAttributes: attrs
            )
            ctx.restoreGState()
        }

        ctx.restoreGState()
    }
}

// MARK: - Overlay Window & Animation Loop Manager

public final class CursorOverlayManager {
    public static let shared = CursorOverlayManager()

    public private(set) var cursors: [String: VirtualCursorState] = [:]
    public private(set) var ripples: [ClickRipple] = []
    public private(set) var spotlights: [SpotlightRect] = []
    public private(set) var dragTrails: [DragTrail] = []

    private var overlayWindows: [NSWindow] = []
    private var canvasViews: [CursorCanvasView] = []
    private var screenObserver: NSObjectProtocol?
    private var animationTimer: Timer?
    private let motionConfig = CursorMotionConfig.live

    private init() {
        screenObserver = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self, !self.overlayWindows.isEmpty else { return }
            self.overlayWindows.forEach { $0.close() }
            self.overlayWindows.removeAll(); self.canvasViews.removeAll()
            self.ensureOverlayWindow()
        }
    }

    public func ensureOverlayWindow() {
        if !overlayWindows.isEmpty { return }
        for screen in NSScreen.screens {
            let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? CGMainDisplayID()
            let window = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.isOpaque = false; window.backgroundColor = .clear; window.hasShadow = false
            window.ignoresMouseEvents = true
            window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.screenSaverWindow)))
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
            let view = CursorCanvasView(frame: NSRect(origin: .zero, size: screen.frame.size), globalFrame: CGDisplayBounds(id), manager: self)
            window.contentView = view
            window.orderFrontRegardless()
            overlayWindows.append(window); canvasViews.append(view)
        }
        startAnimationLoop()
    }

    private func startAnimationLoop() {
        animationTimer?.invalidate()
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            self?.tick()
        }
        RunLoop.main.add(timer, forMode: .common)
        self.animationTimer = timer
    }

    public func getOrCreateCursor(id: String = "default", label: String? = nil) -> VirtualCursorState {
        ensureOverlayWindow()
        if let existing = cursors[id] {
            if let label = label { existing.label = label }
            existing.lastInteractionTime = CACurrentMediaTime()
            existing.targetOpacity = 1.0
            return existing
        }

        if cursors.count >= 32, let oldest = cursors.min(by: { $0.value.lastInteractionTime < $1.value.lastInteractionTime })?.key {
            cursors.removeValue(forKey: oldest)
        }
        let screenFrame = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
        let startPt = CGPoint(x: screenFrame.width * 0.5, y: screenFrame.height * 0.5)
        let sampledColor = WallpaperColorSampler.shared.sampleColor(at: startPt)
        let cursor = VirtualCursorState(
            id: id,
            label: label ?? (id == "default" ? "OpenSky" : id),
            initialPosition: startPt,
            accentColor: sampledColor
        )
        cursor.opacity = 1.0
        cursor.targetOpacity = 1.0
        cursors[id] = cursor
        return cursor
    }

    /// Animate cursor along a playful curved cubic Bezier trajectory with velocity stretch & tilt
    public func moveCursor(
        id: String = "default",
        to target: CGPoint,
        label: String? = nil,
        duration: TimeInterval? = nil,
        spotlightRect: CGRect? = nil,
        completion: (() -> Void)? = nil
    ) {
        let generation = SafetyController.shared.operationGeneration
        DispatchQueue.main.async {
            guard SafetyController.shared.isCurrent(generation), !SafetyController.shared.isStopped else { completion?(); return }
            let cursor = self.getOrCreateCursor(id: id, label: label)
            let start = cursor.position
            let dx = target.x - start.x
            let dy = target.y - start.y
            let distance = hypot(dx, dy)

            let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion || ProcessInfo.processInfo.environment["OPENSKY_REDUCE_MOTION"] == "1"
            let actualDuration = reduced ? 0.01 : (duration ?? max(0.16, min(0.48, Double(distance) / 1800.0 + 0.12)))
            cursor.startPosition = start
            cursor.targetPosition = target
            cursor.moveStartTime = CACurrentMediaTime()
            cursor.moveDuration = actualDuration
            cursor.isMoving = true
            cursor.activityState = .moving
            cursor.lastInteractionTime = CACurrentMediaTime()
            cursor.targetOpacity = 1.0

            if let rect = spotlightRect {
                self.spotlights.append(
                    SpotlightRect(
                        rect: rect,
                        label: label,
                        color: cursor.accentColor,
                        createdAt: CACurrentMediaTime(),
                        duration: actualDuration + 0.85
                    )
                )
            }

            // Compute playful curved Bezier handles (Codex MotionConfiguration style)
            if !reduced && distance > self.motionConfig.straightPathDistanceThreshold {
                let perpX = -dy / distance
                let perpY = dx / distance
                // Alternate arc direction subtly based on direction so paths feel alive
                let sign: CGFloat = (dx >= 0) ? -1.0 : 1.0
                let arcOffset = min(140.0, distance * self.motionConfig.arcSize) * sign

                cursor.controlPoint1 = CGPoint(
                    x: start.x + dx * 0.28 + perpX * arcOffset,
                    y: start.y + dy * 0.28 + perpY * arcOffset
                )
                cursor.controlPoint2 = CGPoint(
                    x: start.x + dx * 0.72 + perpX * (arcOffset * 0.55),
                    y: start.y + dy * 0.72 + perpY * (arcOffset * 0.55)
                )
            } else {
                cursor.controlPoint1 = CGPoint(x: start.x + dx * 0.33, y: start.y + dy * 0.33)
                cursor.controlPoint2 = CGPoint(x: start.x + dx * 0.66, y: start.y + dy * 0.66)
            }

            if let completion = completion {
                DispatchQueue.main.asyncAfter(deadline: .now() + actualDuration) {
                    completion()
                }
            }
        }
    }

    public func animateClick(
        id: String = "default",
        at point: CGPoint? = nil,
        label: String? = nil,
        clickCount: Int = 1,
        Spotlight: CGRect? = nil
    ) {
        let generation = SafetyController.shared.operationGeneration
        DispatchQueue.main.async {
            guard SafetyController.shared.isCurrent(generation), !SafetyController.shared.isStopped else { return }
            let cursor = self.getOrCreateCursor(id: id, label: label)
            let clickPt = point ?? cursor.position
            cursor.lastInteractionTime = CACurrentMediaTime()
            cursor.targetOpacity = 1.0
            cursor.isPressed = true
            cursor.activityState = .pressing
            cursor.pressStartTime = CACurrentMediaTime()

            for i in 0..<max(1, clickCount) {
                DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.12) {
                    guard SafetyController.shared.isCurrent(generation), !SafetyController.shared.isStopped else { return }
                    self.ripples.append(
                        ClickRipple(
                            point: clickPt,
                            color: cursor.accentColor,
                            createdAt: CACurrentMediaTime()
                        )
                    )
                }
            }

            if let rect = Spotlight {
                self.spotlights.append(
                    SpotlightRect(
                        rect: rect,
                        label: label,
                        color: cursor.accentColor,
                        createdAt: CACurrentMediaTime(),
                        duration: 1.1
                    )
                )
            }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                guard SafetyController.shared.isCurrent(generation) else { return }
                cursor.isPressed = false
                if cursor.activityState == .pressing {
                    cursor.activityState = .idle
                }
            }
        }
    }

    public func setWiggle(id: String = "default", enabled: Bool, label: String? = nil) {
        let generation = SafetyController.shared.operationGeneration
        DispatchQueue.main.async {
            guard SafetyController.shared.isCurrent(generation), !SafetyController.shared.isStopped else { return }
            let cursor = self.getOrCreateCursor(id: id, label: label)
            cursor.lastInteractionTime = CACurrentMediaTime()
            cursor.targetOpacity = 1.0
            let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion || ProcessInfo.processInfo.environment["OPENSKY_REDUCE_MOTION"] == "1"
            cursor.activityState = enabled && !reduced ? .thinking : .idle
        }
    }

    public func highlightElement(rect: CGRect, label: String? = nil, duration: TimeInterval = 1.4) {
        let generation = SafetyController.shared.operationGeneration
        DispatchQueue.main.async {
            guard SafetyController.shared.isCurrent(generation), !SafetyController.shared.isStopped else { return }
            self.ensureOverlayWindow()
            let color = WallpaperColorSampler.shared.sampleColor(at: CGPoint(x: rect.midX, y: rect.midY))
            self.spotlights.append(
                SpotlightRect(
                    rect: rect,
                    label: label,
                    color: color,
                    createdAt: CACurrentMediaTime(),
                    duration: duration
                )
            )
        }
    }

    public func animateDrag(id: String = "default", from: CGPoint, to: CGPoint, label: String? = nil, duration: TimeInterval = 0.55) {
        let generation = SafetyController.shared.operationGeneration
        DispatchQueue.main.async {
            guard SafetyController.shared.isCurrent(generation), !SafetyController.shared.isStopped else { return }
            let cursor = self.getOrCreateCursor(id: id, label: label ?? "Dragging")
            cursor.position = from
            cursor.isPressed = true
            cursor.activityState = .dragging
            self.moveCursor(id: id, to: to, label: label ?? "Dragging", duration: duration) {
                cursor.isPressed = false
                cursor.activityState = .idle
            }
            self.dragTrails.append(
                DragTrail(from: from, to: to, current: to, color: cursor.accentColor, createdAt: CACurrentMediaTime())
            )
        }
    }

    public func dismissCursor(id: String? = nil) {
        DispatchQueue.main.async {
            if let id = id {
                self.cursors.removeValue(forKey: id)
            } else {
                self.cursors.removeAll()
                self.spotlights.removeAll()
                self.ripples.removeAll()
                self.dragTrails.removeAll()
            }
            self.canvasViews.forEach { $0.needsDisplay = true }
        }
    }

    private func tick() {
        let now = CACurrentMediaTime()
        var needsRedraw = false

        // Clean up expired ripples, spotlights, and drag trails
        let oldRippleCount = ripples.count
        ripples.removeAll { now - $0.createdAt >= $0.duration }
        if ripples.count != oldRippleCount || !ripples.isEmpty { needsRedraw = true }

        let oldSpotlightCount = spotlights.count
        spotlights.removeAll { now - $0.createdAt >= $0.duration }
        if spotlights.count != oldSpotlightCount || !spotlights.isEmpty { needsRedraw = true }

        let oldTrailCount = dragTrails.count
        dragTrails.removeAll { now - $0.createdAt >= $0.duration }
        if dragTrails.count != oldTrailCount || !dragTrails.isEmpty { needsRedraw = true }

        for (_, cursor) in cursors {
            // A disconnected agent cannot leave an unbounded thinking animation alive.
            let idleTime = now - cursor.lastInteractionTime
            if idleTime > 30 && cursor.activityState == .thinking { cursor.activityState = .idle }
            if idleTime > motionConfig.idleFadeOutSeconds && cursor.activityState != .thinking {
                cursor.targetOpacity = 0.0
            }

            if abs(cursor.opacity - cursor.targetOpacity) > 0.005 {
                cursor.opacity += (cursor.targetOpacity - cursor.opacity) * 0.16
                needsRedraw = true
            }

            if cursor.isMoving {
                needsRedraw = true
                let rawT = min(1.0, max(0.0, (now - cursor.moveStartTime) / max(0.01, cursor.moveDuration)))
                // Spring-like smoothstep with subtle overshoot settle
                let t = springEase(CGFloat(rawT))

                let prevPos = cursor.position
                let newPos = cubicBezier(
                    t: t,
                    p0: cursor.startPosition,
                    p1: cursor.controlPoint1,
                    p2: cursor.controlPoint2,
                    p3: cursor.targetPosition
                )
                cursor.position = newPos

                // Dynamic wallpaper color adaptation along the path!
                let targetColor = WallpaperColorSampler.shared.sampleColor(at: newPos)
                cursor.accentColor = cursor.accentColor.blended(withFraction: 0.12, of: targetColor) ?? targetColor
                cursor.secondaryColor = cursor.accentColor.blended(withFraction: 0.45, of: .white) ?? .cyan

                // Velocity-based Scoot Stretch, Squash & Tilt
                let vx = (newPos.x - prevPos.x) * 60.0
                let vy = (newPos.y - prevPos.y) * 60.0
                let speed = hypot(vx, vy)
                let normalizedSpeed = min(1.0, speed / 1800.0)

                cursor.stretchScaleX = 1.0 + normalizedSpeed * (motionConfig.scootStretchMax - 1.0)
                cursor.squashScaleY = 1.0 - normalizedSpeed * (1.0 - motionConfig.scootSquashMin)
                let targetTilt = max(-motionConfig.scootRotationMax, min(motionConfig.scootRotationMax, (vx / 90.0)))
                cursor.tiltAngleDegrees += (targetTilt - cursor.tiltAngleDegrees) * 0.25

                if rawT >= 1.0 {
                    cursor.isMoving = false
                    cursor.position = cursor.targetPosition
                    if cursor.activityState == .moving {
                        cursor.activityState = .idle
                    }
                }
            } else {
                // Relax stretch/squash/tilt back to rest with spring damping
                if abs(cursor.stretchScaleX - 1.0) > 0.002 || abs(cursor.tiltAngleDegrees) > 0.05 {
                    cursor.stretchScaleX += (1.0 - cursor.stretchScaleX) * 0.25
                    cursor.squashScaleY += (1.0 - cursor.squashScaleY) * 0.25
                    cursor.tiltAngleDegrees *= 0.75
                    needsRedraw = true
                }
                if cursor.activityState == .thinking || cursor.isPressed {
                    needsRedraw = true
                }
            }
        }

        let expired = cursors.filter { now - $0.value.lastInteractionTime > motionConfig.idleFadeOutSeconds + 2 && $0.value.targetOpacity == 0 && $0.value.opacity < 0.01 }.map { $0.key }
        for id in expired { cursors.removeValue(forKey: id) }
        if !expired.isEmpty { needsRedraw = true }
        if needsRedraw {
            canvasViews.forEach { $0.needsDisplay = true }
        }
    }

    private func cubicBezier(t: CGFloat, p0: CGPoint, p1: CGPoint, p2: CGPoint, p3: CGPoint) -> CGPoint {
        let u = 1.0 - t
        let tt = t * t
        let uu = u * u
        let uuu = uu * u
        let ttt = tt * t

        let x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x
        let y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
        return CGPoint(x: x, y: y)
    }

    private func springEase(_ x: CGFloat) -> CGFloat {
        // Under-damped spring curve matching natural human/Sky cursor arrival
        let c4 = (2.0 * CGFloat.pi) / 3.0
        if x <= 0 { return 0 }
        if x >= 1 { return 1 }
        return 1.0 - pow(2.0, -8.5 * x) * cos((x * 1.15) * c4 * 0.5)
    }
}
