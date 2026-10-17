#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, renameSync, rmSync, chmodSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { buildApp, BUNDLE_ID, projectRoot } from "./build-app.mjs";
import { replaceManagedFiles } from "./install-transaction.mjs";
import { NATIVE_API_VERSION } from "../src/native-version.mjs";

const markerName = ".opensky-install.json";
const wrapperMarker = "# OpenSky managed launcher v1";
const shellQuote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

export function parseOptions(args) {
  const options = { prefix: path.join(os.homedir(), ".local"), appDir: path.join(os.homedir(), "Applications"), skills: [], dryRun: false, uninstall: false, runtimeOnly: false };
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === "--help" || argument === "-h") { options.help = true; continue; }
    if (argument === "--dry-run") { options.dryRun = true; continue; }
    if (argument === "--uninstall") { options.uninstall = true; continue; }
    if (argument === "--runtime-only") { options.runtimeOnly = true; continue; }
    if (["--prefix", "--app-dir", "--skill"].includes(argument)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      if (argument === "--prefix") options.prefix = path.resolve(value);
      if (argument === "--app-dir") options.appDir = path.resolve(value);
      if (argument === "--skill") {
        if (!["codex", "claude", "all"].includes(value)) throw new Error("--skill accepts codex, claude, or all.");
        options.skills.push(...(value === "all" ? ["codex", "claude"] : [value]));
      }
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  if (options.runtimeOnly && options.uninstall) throw new Error("--runtime-only cannot be combined with --uninstall.");
  options.runtime = path.resolve(process.env.OPENSKY_HOME || path.join(options.prefix, "share", "opensky"));
  options.app = path.join(options.appDir, "OpenSky.app");
  options.binDir = path.join(options.prefix, "bin");
  return options;
}

export function wrapperSource(runtime, app, script, node = process.execPath) {
  return `#!/bin/sh\n${wrapperMarker}\nif [ -z "\${OPENSKY_HOME:-}" ]; then OPENSKY_HOME=${shellQuote(runtime)}; fi\nexport OPENSKY_HOME\nif [ -z "\${OPENSKY_BINARY:-}" ]; then OPENSKY_BINARY=${shellQuote(path.join(app, "Contents", "MacOS", "OpenSky"))}; fi\nexport OPENSKY_BINARY\nif [ -x ${shellQuote(node)} ]; then\n  exec ${shellQuote(node)} ${shellQuote(path.join(runtime, "src", script))} "$@"\nfi\nif command -v node >/dev/null 2>&1; then\n  exec node ${shellQuote(path.join(runtime, "src", script))} "$@"\nfi\necho "OpenSky requires Node.js 22 or later. Reinstall OpenSky after installing Node.js." >&2\nexit 1\n`;
}

function loadManifest(runtime) {
  const file = path.join(runtime, markerName);
  if (!existsSync(file)) return null;
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.schema !== 1 || manifest.product !== "opensky-computer-use" || manifest.runtime !== runtime) throw new Error(`Unrecognized installation manifest: ${file}`);
  return manifest;
}

function validateDestinations(options) {
  const manifest = loadManifest(options.runtime);
  if (existsSync(options.runtime) && !manifest && readdirSync(options.runtime).some((name) => !["control-token", "daemon.log", "screenshots"].includes(name))) {
    throw new Error(`Refusing to overwrite an unrecognized directory: ${options.runtime}`);
  }
  for (const name of ["opensky", "opensky-mcp"]) {
    const launcher = path.join(options.binDir, name);
    if (existsSync(launcher) || (() => { try { return lstatSync(launcher).isSymbolicLink(); } catch { return false; } })()) {
      let owned = !lstatSync(launcher).isSymbolicLink() && readFileSync(launcher, "utf8").includes(wrapperMarker);
      if (lstatSync(launcher).isSymbolicLink() && existsSync(launcher)) {
        try {
          const target = realpathSync(launcher);
          const product = JSON.parse(readFileSync(path.join(path.dirname(target), "..", "package.json"), "utf8"));
          owned = product.name === "opensky-computer-use" && ["cli.mjs", "mcp-server.mjs"].includes(path.basename(target));
        } catch {}
      }
      if (!owned) throw new Error(`Refusing to replace an existing launcher not managed by this installer: ${launcher}`);
    }
  }
  if (existsSync(options.app)) {
    let identity;
    try { identity = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", path.join(options.app, "Contents", "Info.plist")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
    if (identity !== BUNDLE_ID) throw new Error(`Refusing to replace an unrelated app: ${options.app}`);
  }
  for (const client of new Set(options.skills)) {
    const target = path.join(os.homedir(), client === "codex" ? ".codex" : ".claude", "skills", "opensky-computer-use", "SKILL.md");
    if (existsSync(target) && !readFileSync(target, "utf8").includes("name: opensky-computer-use")) throw new Error(`Unrecognized skill file: ${target}`);
  }
  return manifest;
}

function uninstall(options) {
  const manifest = loadManifest(options.runtime);
  if (!manifest) throw new Error(`No managed OpenSky installation found in ${options.runtime}.`);
  const planned = [...manifest.launchers, manifest.app, ...manifest.installedFiles.map((name) => path.join(options.runtime, name)), path.join(options.runtime, markerName)];
  if (options.dryRun) { console.log(JSON.stringify({ action: "uninstall", remove: planned, preserve: ["runtime credentials and captures", "client MCP configurations", "installed skill files"] }, null, 2)); return; }
  // Contact only the instance using this installation's local credentials.
  try {
    execFileSync(process.execPath, [path.join(options.runtime, "src", "cli.mjs"), "shutdown"], { env: { ...process.env, OPENSKY_HOME: options.runtime }, stdio: "ignore", timeout: 5000 });
  } catch { /* A daemon that is already stopped does not prevent file removal. */ }
  for (const launcher of manifest.launchers) {
    if (path.basename(launcher) && existsSync(launcher) && !lstatSync(launcher).isSymbolicLink() && readFileSync(launcher, "utf8").includes(wrapperMarker) && readFileSync(launcher, "utf8").includes(options.runtime)) rmSync(launcher);
  }
  if (existsSync(manifest.app)) {
    let identity;
    try { identity = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", path.join(manifest.app, "Contents", "Info.plist")], { encoding: "utf8" }).trim(); } catch {}
    if (identity === BUNDLE_ID) rmSync(manifest.app, { recursive: true });
  }
  for (const name of manifest.installedFiles) {
    if (!["src", "scripts", "package.json", "README.md", "PRIVACY.md", "SECURITY.md", "LICENSE"].includes(name)) continue;
    rmSync(path.join(options.runtime, name), { recursive: true, force: true });
  }
  rmSync(path.join(options.runtime, markerName), { force: true });
  console.log("OpenSky app, runtime code, and managed launchers removed. Local credentials, captures, skills, and client configurations were preserved.");
}

export function install(options) {
  if (options.uninstall) return uninstall(options);
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22 or later is required.");
  if (process.platform !== "darwin") throw new Error("OpenSky requires macOS 14 or later.");
  const previous = validateDestinations(options);
  if (options.runtimeOnly) {
    if (!previous || !existsSync(path.join(options.app,"Contents/MacOS/OpenSky"))) throw new Error("A managed OpenSky native installation is required for --runtime-only. Run a full install first.");
    if (previous.app !== options.app) throw new Error("--runtime-only must use the existing installation's --app-dir.");
    const nativeVersion=execFileSync("/usr/libexec/PlistBuddy",["-c","Print :CFBundleShortVersionString",path.join(options.app,"Contents/Info.plist")],{encoding:"utf8"}).trim();
    if (nativeVersion !== NATIVE_API_VERSION) throw new Error(`Runtime needs native engine ${NATIVE_API_VERSION}; found ${nativeVersion}. Run a full install.`);
    execFileSync("/usr/bin/codesign",["--verify","--strict",options.app],{stdio:"ignore"});
  }
  const manifest = { schema: 1, product: "opensky-computer-use", runtime: options.runtime, app: options.app,
    nativeApiVersion: NATIVE_API_VERSION,
    launchers: [path.join(options.binDir, "opensky"), path.join(options.binDir, "opensky-mcp")],
    installedFiles: ["src", "scripts", "package.json", "README.md", "PRIVACY.md", "SECURITY.md", "LICENSE"],
    installedAt: new Date().toISOString(), version: JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")).version,
    skillFiles: previous?.skillFiles || [] };
  if (options.dryRun) { console.log(JSON.stringify({ action: options.runtimeOnly ? "runtime-update" : "install", ...manifest, skills: [...new Set(options.skills)], clientRegistration: "manual only", build: options.runtimeOnly ? "preserve existing native app and running service" : "Swift release, fresh bundle, verified ad-hoc signature" }, null, 2)); return; }
  const osVersion = execFileSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
  if (Number(osVersion.split(".")[0]) < 14) throw new Error(`macOS 14 or later is required (found ${osVersion}).`);
  if (!options.runtimeOnly) execFileSync("xcrun", ["--find", "swift"], { stdio: "ignore" });
  const stagingParent=options.runtimeOnly ? path.dirname(options.runtime) : options.appDir;
  mkdirSync(stagingParent, { recursive: true });
  const stage = mkdtempSync(path.join(stagingParent, ".opensky-install-"));
  try {
    const replacements = [];
    if (!options.runtimeOnly) replacements.push({source:buildApp(path.join(stage,"OpenSky.app")),destination:options.app});
    for (const name of manifest.installedFiles) replacements.push({ source: path.join(projectRoot, name), destination: path.join(options.runtime, name) });
    for (const [i, script] of ["cli.mjs", "mcp-server.mjs"].entries()) {
      const launcher = path.join(stage, `launcher-${i}`);
      writeFileSync(launcher, wrapperSource(options.runtime, options.app, script), { mode: 0o755, flag: "wx" });
      replacements.push({ source: launcher, destination: manifest.launchers[i] });
    }
    for (const client of new Set(options.skills)) {
      const skillFile = path.join(os.homedir(), client === "codex" ? ".codex" : ".claude", "skills", "opensky-computer-use", "SKILL.md");
      replacements.push({ source: path.join(projectRoot, "skills", "opensky-computer-use", "SKILL.md"), destination: skillFile });
      if (!manifest.skillFiles.includes(skillFile)) manifest.skillFiles.push(skillFile);
    }
    const stagedManifest = path.join(stage, markerName);
    writeFileSync(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    replacements.push({ source: stagedManifest, destination: path.join(options.runtime, markerName) });
    // Stop the existing helper before changing the app or its JavaScript runtime.
    if (!options.runtimeOnly && previous && existsSync(path.join(options.runtime, "src/cli.mjs"))) {
      try { execFileSync(process.execPath, [path.join(options.runtime, "src/cli.mjs"), "shutdown"], { env: { ...process.env, OPENSKY_HOME: options.runtime }, timeout: 6000, stdio: "ignore" }); }
      catch {
        let status;
        try { status = JSON.parse(execFileSync(process.execPath, [path.join(options.runtime, "src/cli.mjs"), "status", "--json"], { env: { ...process.env, OPENSKY_HOME: options.runtime }, timeout: 4000, encoding: "utf8" })); }
        catch (error) { try { status = JSON.parse(error.stdout); } catch {} }
        if (!status || status.running !== false) throw new Error("The old OpenSky service could not be stopped. Stop it before reinstalling.");
      }
    }
    mkdirSync(options.runtime, { recursive: true, mode: 0o700 });
    chmodSync(options.runtime, 0o700);
    replaceManagedFiles(replacements);
    console.log(`Installed OpenSky runtime ${manifest.version}\nNative engine: ${NATIVE_API_VERSION}${options.runtimeOnly ? " (preserved; no restart)" : ""}\nApp: ${options.app}\nRuntime: ${options.runtime}\nCLI: ${manifest.launchers[0]}\n\nAdd ${options.binDir} to PATH if needed.\nNext: opensky doctor; reconnect MCP clients to load updated instructions.\nNo MCP client configuration was changed.`);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log(`Usage: ./install.sh [--prefix PATH] [--app-dir PATH] [--skill codex|claude|all] [--dry-run]\n       ./install.sh --runtime-only [--prefix PATH] [--app-dir PATH] [--skill codex|claude|all] [--dry-run]\n       ./install.sh --uninstall [--prefix PATH] [--app-dir PATH] [--dry-run]\n\nFull installs rebuild the native app. --runtime-only requires a compatible managed native app and preserves its files, permissions and running service.\nSkills are opt-in; MCP client registration is always manual.\nUninstall preserves local credentials, captures, skills, and client configurations.`);
    else install(options);
  } catch (error) { console.error(`OpenSky installer: ${error.message}`); process.exitCode = 1; }
}
