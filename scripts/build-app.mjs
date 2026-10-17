import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUNDLE_ID = "dev.opensky.computeruse";
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function buildApp(destination, { root = projectRoot } = {}) {
  if (process.platform !== "darwin") throw new Error("OpenSky's native app requires macOS 14 or later.");
  const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  // Always invoke SwiftPM: it incrementally rebuilds changed source instead of trusting an old binary.
  execFileSync("swift", ["build", "-c", "release", "--package-path", path.join(root, "Native")], { stdio: "inherit" });
  const binDirectory = execFileSync("swift", ["build", "-c", "release", "--package-path", path.join(root, "Native"), "--show-bin-path"], { encoding: "utf8" }).trim();
  const macOSDirectory = path.join(destination, "Contents", "MacOS");
  mkdirSync(macOSDirectory, { recursive: true });
  mkdirSync(path.join(destination, "Contents", "Resources"), { recursive: true });
  copyFileSync(path.join(binDirectory, "opensky-daemon"), path.join(macOSDirectory, "OpenSky"));
  chmodSync(path.join(macOSDirectory, "OpenSky"), 0o755);
  writeFileSync(path.join(destination, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>OpenSky</string>
<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
<key>CFBundleName</key><string>OpenSky</string>
<key>CFBundleDisplayName</key><string>OpenSky</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSAccessibilityUsageDescription</key><string>OpenSky uses Accessibility to inspect and operate apps at your request.</string>
<key>NSScreenCaptureUsageDescription</key><string>OpenSky captures app windows and screens for visual inspection and on-device text recognition.</string>
<key>NSAppleEventsUsageDescription</key><string>OpenSky runs the AppleScript or JXA commands you request.</string>
</dict></plist>\n`);
  execFileSync("/usr/bin/plutil", ["-lint", path.join(destination, "Contents", "Info.plist")], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", "--identifier", BUNDLE_ID, destination], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", ["--verify", "--strict", destination], { stdio: "inherit" });
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(buildApp(path.resolve(process.argv[2] || path.join(projectRoot, ".build", "OpenSky.app")))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
