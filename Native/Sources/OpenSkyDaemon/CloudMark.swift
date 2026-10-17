import AppKit

/// Original OpenSky cloud silhouette. Punch-outs remain readable at menu-bar size.
enum CloudMark {
    static func image(stopped: Bool = false) -> NSImage {
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
            if stopped {
                NSBezierPath(roundedRect: NSRect(x: 7, y: 6.5, width: 1.8, height: 5), xRadius: 0.5, yRadius: 0.5).fill()
                NSBezierPath(roundedRect: NSRect(x: 11.2, y: 6.5, width: 1.8, height: 5), xRadius: 0.5, yRadius: 0.5).fill()
            } else {
                for x in [CGFloat(6.4), CGFloat(11.5)] { NSBezierPath(ovalIn: NSRect(x: x, y: 6.9, width: 2.1, height: 2.9)).fill() }
            }
            NSGraphicsContext.restoreGraphicsState()
            return true
        }
        image.isTemplate = true
        return image
    }
}
