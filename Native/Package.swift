// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "OpenSkyNative",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "opensky-daemon", targets: ["OpenSkyDaemon"])
    ],
    targets: [
        .executableTarget(
            name: "OpenSkyDaemon",
            path: "Sources/OpenSkyDaemon",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("Vision"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("QuartzCore")
            ]
        )
    ]
)
