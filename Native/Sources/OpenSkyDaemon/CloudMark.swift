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
    /// Stable-width, monochrome status mark. Auto's A is policy; the glyph is
    /// effective behavior. Keep the original cloud intact at native menu size.
    static func statusImage(mode: InteractionModeDisplay, stopped: Bool = false) -> NSImage {
        let image = NSImage(size: NSSize(width: 43, height: 18), flipped: false) { _ in
            CloudMark.image(stopped: stopped).draw(in: NSRect(x: 0, y: 0, width: 20, height: 18))
            let config = NSImage.SymbolConfiguration(pointSize: 11, weight: .medium)
            let symbol = NSImage(systemSymbolName: mode.symbol, accessibilityDescription: nil)?.withSymbolConfiguration(config)
            if let symbol {
                let scale = min(13 / symbol.size.width, 13 / symbol.size.height)
                let size = NSSize(width: symbol.size.width * scale, height: symbol.size.height * scale)
                symbol.draw(in: NSRect(x: 24 + (13 - size.width) / 2, y: (18 - size.height) / 2, width: size.width, height: size.height))
            }
            if mode.automatic || mode.reason == .temporary {
                if mode.reason == .temporary {
                    NSImage(systemSymbolName: "clock", accessibilityDescription: nil)?
                        .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 7, weight: .semibold))?
                        .draw(in: NSRect(x: 36, y: 1, width: 7, height: 7))
                } else {
                    ("A" as NSString).draw(at: NSPoint(x: 37, y: 1), withAttributes: [
                        .font: NSFont.systemFont(ofSize: 8, weight: .bold), .foregroundColor: NSColor.black])
                }
            }
            return true
        }
        image.isTemplate = true
        return image
    }

}
