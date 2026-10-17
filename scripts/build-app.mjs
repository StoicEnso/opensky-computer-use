import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_API_VERSION, NATIVE_BUILD_VERSION } from "../src/native-version.mjs";

export const BUNDLE_ID = "dev.opensky.computeruse";
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function buildApp(destination, { root = projectRoot, scratchPath } = {}) {
  if (process.platform !== "darwin") throw new Error("OpenSky's native app requires macOS 14 or later.");
  const version = NATIVE_API_VERSION;
  // Always invoke SwiftPM: it incrementally rebuilds changed source instead of trusting an old binary.
  const buildArgs = ["build", "-c", "release", "--package-path", path.join(root, "Native"), ...(scratchPath ? ["--scratch-path", path.resolve(scratchPath)] : [])];
  execFileSync("swift", buildArgs, { stdio: "inherit" });
  const binDirectory = execFileSync("swift", [...buildArgs, "--show-bin-path"], { encoding: "utf8" }).trim();
  const macOSDirectory = path.join(destination, "Contents", "MacOS");
  mkdirSync(macOSDirectory, { recursive: true });
  mkdirSync(path.join(destination, "Contents", "Resources"), { recursive: true });
  copyFileSync(path.join(root,'assets/2026-10-17-opensky-brand-Codex/OpenSky.icns'),path.join(destination,'Contents/Resources/OpenSky.icns'));
  copyFileSync(path.join(binDirectory, "opensky-daemon"), path.join(macOSDirectory, "OpenSky"));
  chmodSync(path.join(macOSDirectory, "OpenSky"), 0o755);
  writeFileSync(path.join(destination, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>OpenSky</string>
<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
<key>CFBundleName</key><string>OpenSky</string>
<key>CFBundleDisplayName</key><string>OpenSky</string>
<key>CFBundleIconFile</key><string>OpenSky</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${NATIVE_BUILD_VERSION}</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSAccessibilityUsageDescription</key><string>OpenSky uses Accessibility to inspect and operate apps at your request.</string>
<key>NSScreenCaptureUsageDescription</key><string>OpenSky captures app windows and screens for visual inspection and on-device text recognition.</string>
<key>NSAppleEventsUsageDescription</key><string>OpenSky runs the AppleScript or JXA commands you request.</string>
</dict></plist>\n`);
  execFileSync("/usr/bin/plutil", ["-lint", path.join(destination, "Contents", "Info.plist")], { stdio: "inherit" });
  // Finder/iCloud may decorate a generated bundle between builds. These two
  // metadata attributes are forbidden by codesign; preserve all other attributes.
  const clearSigningMetadata = () => {
    for (const attribute of ["com.apple.FinderInfo", "com.apple.ResourceFork"]) {
      try { execFileSync("/usr/bin/xattr", ["-dr", attribute, destination], { stdio: "ignore" }); }
      catch (error) { if (error.status !== 1) throw error; } // Missing attributes return 1; signing still validates the result.
    }
  };
  clearSigningMetadata();
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", "--identifier", BUNDLE_ID, destination], { stdio: "inherit" });
  // A file provider can re-add FinderInfo while codesign is writing its signature.
  clearSigningMetadata();
  execFileSync("/usr/bin/codesign", ["--verify", "--strict", destination], { stdio: "inherit" });
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(buildApp(path.resolve(process.argv[2] || path.join(projectRoot, ".build", "OpenSky.app")))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
