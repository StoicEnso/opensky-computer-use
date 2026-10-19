import AppKit

/// Original OpenSky cloud silhouette. Punch-outs remain readable at menu-bar size.
enum CloudMark {
    enum Expression { case alongside, desktop, paused, waiting }
    static func expression(mode: InteractionModeDisplay, stopped: Bool) -> Expression {
        if stopped { return .paused }
        switch mode.effective {
        case .alongside: return .alongside
        case .desktop: return .desktop
        case nil: return .waiting
        }
    }
    static func image(stopped: Bool = false) -> NSImage {
        image(expression: stopped ? .paused : .desktop)
    }
    private static func image(expression: Expression) -> NSImage {
        let image = NSImage(size: NSSize(width: 20, height: 18), flipped: true) { _ in
            let cloud = NSBezierPath()
            cloud.move(to: NSPoint(x: 5, y: 14))
            cloud.curve(to: NSPoint(x: 4.5, y: 5.5), controlPoint1: NSPoint(x: -0.5, y: 14), controlPoint2: NSPoint(x: -0.5, y: 6))
            cloud.curve(to: NSPoint(x: 14.7, y: 5), controlPoint1: NSPoint(x: 4.3, y: -0.2), controlPoint2: NSPoint(x: 13.3, y: -0.5))
            cloud.curve(to: NSPoint(x: 16, y: 14), controlPoint1: NSPoint(x: 21.5, y: 4.3), controlPoint2: NSPoint(x: 22, y: 14))
            cloud.close()
            NSColor.black.setFill(); cloud.fill()
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current?.compositingOperation = .destinationOut
            NSColor.black.setFill()
            switch expression {
            case .paused:
                NSBezierPath(roundedRect: NSRect(x: 7, y: 6.5, width: 1.8, height: 5), xRadius: 0.5, yRadius: 0.5).fill()
                NSBezierPath(roundedRect: NSRect(x: 11.2, y: 6.5, width: 1.8, height: 5), xRadius: 0.5, yRadius: 0.5).fill()
            case .alongside:
                NSColor.black.setStroke()
                for x in [CGFloat(6.0), CGFloat(11.1)] {
                    let eye = NSBezierPath(); eye.lineWidth = 1.35; eye.lineCapStyle = .round
                    eye.move(to: NSPoint(x: x, y: 8.9))
                    eye.curve(to: NSPoint(x: x + 3, y: 8.9),
                        controlPoint1: NSPoint(x: x + 0.6, y: 10.1), controlPoint2: NSPoint(x: x + 2.4, y: 10.1))
                    eye.stroke()
                }
            case .desktop:
                for x in [CGFloat(6.4), CGFloat(11.5)] { NSBezierPath(ovalIn: NSRect(x: x, y: 6.6, width: 2.1, height: 3.3)).fill() }
            case .waiting:
                for x in [CGFloat(6.2), CGFloat(9.3), CGFloat(12.4)] { NSBezierPath(ovalIn: NSRect(x: x, y: 8, width: 1.6, height: 1.6)).fill() }
            }
            NSGraphicsContext.restoreGraphicsState()
            return true
        }
        image.isTemplate = true
        return image
    }
    /// The face shows available control, independent of how the policy chose it.
    /// Auto, manual and temporary desktop turns share the same compact cloud.
    static func statusImage(mode: InteractionModeDisplay, stopped: Bool = false) -> NSImage {
        image(expression: expression(mode: mode, stopped: stopped))
    }
}
