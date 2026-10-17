#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computer_use, getOperatingGuidance, matchElements, DAEMON_BINARY, DAEMON_URL, OPENSKY_HOME, TOKEN_PATH, callDaemon, daemonStatus, ensureDaemonRunning } from "./index.mjs";
import { configSnippet } from "../scripts/config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawArgs = process.argv.slice(2);
const wantsJSON = rawArgs.includes("--json");
const args = rawArgs.filter((argument) => argument !== "--json");
const command = (args[0] || "help").toLowerCase();
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;

function help() {
  console.log(`OpenSky ${version} — open-source macOS computer use

Usage: opensky <command> [arguments] [--json]

  setup                                  Print permission and connection instructions
  guidance                               Read default auto workflow guidance (no launch)
  doctor                                 Check installation, daemon, and permissions (no launch)
  status                                 Query an existing daemon (no launch)
  daemon [start|stop]                     Start daemon, or shut it down
  stop | emergency-stop                  Pause actions and dismiss cursors (no launch)
  resume                                 Explicitly resume a paused daemon (no launch)
  shutdown                               Exit the daemon (no launch)
  config [codex|claude-code|claude-desktop|cursor|antigravity|all]
                                         Print MCP configuration; does not write client files
  rpc <method> [JSON|-]                   Call any native method; '-' reads JSON from stdin
  apps [--running]                       List macOS apps and windows
  state <App> [--ocr] [--full]            Inspect app tree and capture its window
  find <App> <exact name>                 Find structured AX controls by name
  click <App> <index|x,y> [--background|--takeover] [--double|--right]
  set-value <App> <index> <text> [--takeover]
                                         Set an AX value; foreground fallback is opt-in
  type <App> <text>                       Type Unicode text (takes focus)
  key <App> <key...>                      Send keys/chords, such as super+c Return
  scroll <App> <up|down|left|right> [pages]
  drag <App> <x,y> <x,y> [--takeover]      Drag between screen points
  paste <App> <text> [--md|--html]         Paste and restore clipboard when possible
  window <App> <action>                  focus|minimize|maximize|center
  osascript <script> [--jxa]              Execute requested AppleScript or JXA
  screen [--ocr]                         Capture the screen, optionally with OCR
  cursor move <x,y> [label]               Animate a virtual pointer
  cursor wiggle [seconds] [label]         Animate a thinking pointer
  cursor dismiss                         Dismiss pointers
  demo [--control] [--quick]              Open a disposable window and verify real control
  demo --pointers-only                    Preview pointer effects without input
  uninstall [--dry-run]                  Remove managed app/code; keep captures and client config
  version                                Print package version

App and text arguments containing spaces should be quoted. Coordinates use global
macOS screen points. Use a fresh state before selecting an element index.
Actions can start the daemon automatically. status, doctor, stop, resume, and
shutdown never start it. The local endpoint requires its owner-only access token.`);
}

function output(value) {
  if (value !== undefined) console.log(typeof value === "string" && !wantsJSON ? value : JSON.stringify(value, null, 2));
}
function required(value, name) {
  if (value === undefined || value === "") throw new Error(`Missing ${name}. Run 'opensky help' for usage.`);
  return value;
}
function number(value, name, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number.`);
  return parsed;
}
function index(value) {
  const parsed = number(required(value, "element index"), "Element index");
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Element index must be a nonnegative integer.");
  return parsed;
}
function point(value) {
  const components = required(value, "x,y coordinates").split(",");
  if (components.length !== 2 || components.some((part) => part.trim() === "")) throw new Error("Coordinates must have the form x,y.");
  return components.map((part) => number(part, "Coordinate"));
}
function mode(fallback = "hybrid") {
  if (args.includes("--takeover") && args.includes("--background")) throw new Error("Choose either --takeover or --background.");
  return args.includes("--takeover") ? "takeover" : args.includes("--background") ? "background" : fallback;
}
function checkResult(result) {
  if (result && typeof result === "object" && (result.ok === false || (result.ok === undefined && result.error))) {
    output(result); process.exitCode = 1; return false;
  }
  return true;
}
function actionOutput(result) {
  if (!checkResult(result)) return;
  if (wantsJSON) output(result);
  else if (result?.message) {
    output(result.message);
    if (result.observation_ok === false) console.error(`Observation warning: ${result.error || "Refresh the app state before further input."}`);
    if (result.text) output(result.text);
  }
  else output(result);
}

async function doctor() {
  const daemon = await daemonStatus();
  let tokenOwnerOnly = null;
  if (existsSync(TOKEN_PATH)) tokenOwnerOnly = (statSync(TOKEN_PATH).mode & 0o077) === 0;
  const report = {
    ok: process.platform === "darwin" && Number(process.versions.node.split(".")[0]) >= 22 && existsSync(DAEMON_BINARY) && daemon.running === true && daemon.axTrusted === true && daemon.screenRecordingTrusted === true && tokenOwnerOnly === true,
    version, platform: process.platform, architecture: process.arch, node: process.versions.node,
    binary: DAEMON_BINARY, binaryExists: existsSync(DAEMON_BINARY), runtime: OPENSKY_HOME,
    endpoint: DAEMON_URL, tokenExists: existsSync(TOKEN_PATH), tokenOwnerOnly, daemon,
    nextSteps: []
  };
  if (!report.binaryExists) report.nextSteps.push("Run ./install.sh from the source checkout to build and install the native app.");
  if (!daemon.running) report.nextSteps.push("Run opensky daemon, then opensky setup.");
  if (daemon.running && !daemon.axTrusted) report.nextSteps.push("Allow OpenSky in System Settings > Privacy & Security > Accessibility.");
  if (daemon.running && !daemon.screenRecordingTrusted) report.nextSteps.push("Allow OpenSky in System Settings > Privacy & Security > Screen & System Audio Recording, then restart OpenSky.");
  if (tokenOwnerOnly === false) report.nextSteps.push("Restrict the local token file to your user before controlling the daemon.");
  output(report);
  if (!report.ok) process.exitCode = 1;
}

async function main() {
  switch (command) {
    case "help": case "--help": case "-h": help(); break;
    case "version": case "--version": case "-v": output(version); break;
    case "guidance": {const guidance=getOperatingGuidance();output(wantsJSON?guidance:guidance.instructions);break;}
    case "setup":
      output(`OpenSky setup\n\n1. Run opensky daemon.\n2. Run opensky rpc status '{"promptAX":true,"promptScreen":true}' to request Accessibility access.\n3. Enable OpenSky in System Settings > Privacy & Security > Accessibility.\n4. Enable OpenSky in Screen & System Audio Recording (called Screen Recording on some macOS versions). Restart OpenSky after granting access. Use opensky rpc status with promptScreen:true for the initial screen-capture request.\n5. Run opensky doctor to check permissions and the local connection.\n6. Run opensky config all and add the chosen entry to your agent's MCP configuration. Restart that client.\n\nNo client configuration was changed. macOS may require permission to be granted again after rebuilding an ad-hoc signed app.\nEmergency pause: Control+Option+Command+Escape, or opensky stop. Continue only with opensky resume. Exit with opensky shutdown.`); break;
    case "config": output(configSnippet(args[1] || "all")); break;
    case "doctor": await doctor(); break;
    case "status": case "ping": {
      const result = args.includes("--prompt-ax") ? await callDaemon("status", { promptAX: true }, { autoStart: false }) : await daemonStatus();
      output(result); if (result.running === false || result.ok === false) process.exitCode = 1; break;
    }
    case "daemon": {
      if (args[1] === "stop") { actionOutput(await callDaemon("shutdown", {}, { autoStart: false })); break; }
      if (args[1] && args[1] !== "start") throw new Error("Use opensky daemon start or opensky daemon stop.");
      await ensureDaemonRunning(); output(await daemonStatus()); break;
    }
    case "stop": case "emergency-stop": case "resume": case "shutdown":
      actionOutput(await callDaemon(command === "emergency-stop" ? "stop" : command, {}, { autoStart: false })); break;
    case "uninstall": {
      const result = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "--uninstall", ...args.slice(1)], { stdio: "inherit" });
      if (result.error) throw result.error; process.exitCode = result.status ?? 1; break;
    }
    case "rpc": {
      const method = required(args[1], "RPC method");
      const text = args[2] === "-" ? readFileSync(0, "utf8") : args.slice(2).join(" ") || "{}";
      let params; try { params = JSON.parse(text); } catch { throw new Error("RPC parameters must be valid JSON."); }
      if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("RPC parameters must be a JSON object.");
      const result = await callDaemon(method, params, { autoStart: !["ping", "status", "stop", "resume", "shutdown"].includes(method) });
      if (checkResult(result)) output(result); break;
    }
    case "apps": case "list_apps": {
      const apps = await computer_use.list_apps({ running_only: args.includes("--running") });
      if (wantsJSON) output(apps);
      else for (const app of apps) console.log(`${app.is_running ? `running (pid ${app.pid})` : "installed"}\t${app.display_name || app.id}\t${app.id}${app.windows ? `\t${app.windows.length} window(s)` : ""}`);
      break;
    }
    case "state": case "get_app_state": {
      const result = await computer_use.get_app_state({ app: args[1] || "Finder", include_ocr: args.includes("--ocr"), disable_diff: args.includes("--full") || args.includes("--no-diff"), show_cursor: true });
      if (!checkResult(result)) break;
      if (wantsJSON) output(result); else { output(result.text); if (result.screenshot?.path) output(`Screenshot: ${result.screenshot.path}`); }
      break;
    }
    case "find": {
      const state = await computer_use.get_app_state({ app: required(args[1], "app"), include_screenshot: false });
      if (!checkResult(state)) break;
      const matches = matchElements(state, { name: required(args.slice(2).join(" "), "exact accessible name") });
      output({ ok: true, snapshot_id: state.snapshot_id, matches, match_count: matches.length });break;
    }
    case "click": {
      const target = required(args[2], "element index or x,y coordinates");
      const params = { app: required(args[1], "app"), mode: mode(), click_count: args.includes("--triple") ? 3 : args.includes("--double") ? 2 : 1, mouse_button: args.includes("--right") ? "right" : "left" };
      if (target.includes(",")) params.point = point(target); else params.element_index = index(target);
      actionOutput(await computer_use.click(params)); break;
    }
    case "set-value": case "set_value":
      actionOutput(await computer_use.set_value({ app: required(args[1], "app"), element_index: index(args[2]), value: required(args.slice(3).filter(item => !["--background", "--takeover"].includes(item)).join(" "), "text"), mode: mode("background") })); break;
    case "type": case "type_text":
      actionOutput(await computer_use.type_text({ app: required(args[1], "app"), text: required(args.slice(2).filter((item) => !["--background", "--takeover"].includes(item)).join(" "), "text"), mode: mode("takeover") })); break;
    case "key": case "press_key":
      actionOutput(await computer_use.press_key({ app: required(args[1], "app"), keys: [required(args[2], "key"), ...args.slice(3)], mode: "takeover" })); break;
    case "scroll":
      actionOutput(await computer_use.scroll({ app: required(args[1], "app"), direction: args[2] || "down", pages: number(args[3], "Pages", 1), mode: mode() })); break;
    case "drag":
      actionOutput(await computer_use.drag({ app: required(args[1], "app"), start_point: point(args[2]), end_point: point(args[3]), mode: mode("takeover") })); break;
    case "paste":
      actionOutput(await computer_use.paste({ app: required(args[1], "app"), format: args.includes("--md") ? "md" : args.includes("--html") ? "html" : "text", content: required(args.slice(2).filter((item) => !["--md", "--html"].includes(item)).join(" "), "text") })); break;
    case "window":
      actionOutput(await computer_use.manage_window({ app: required(args[1], "app"), action: args[2] || "focus" })); break;
    case "osascript": case "applescript": {
      const result = await computer_use.run_applescript({ script: required(args.slice(1).filter((item) => item !== "--jxa").join(" "), "script"), language: args.includes("--jxa") ? "jxa" : "applescript" });
      if (!checkResult(result)) break; output(wantsJSON ? result : result.output ?? result); break;
    }
    case "screen": actionOutput(await computer_use.screenshot_screen({ include_ocr: args.includes("--ocr") })); break;
    case "demo": {
      if (args.includes("--pointers-only")) actionOutput(await computer_use.cursor_demo({}));
      else { const { runControlDemo } = await import("../scripts/control-demo.mjs");actionOutput(await runControlDemo({ quick: args.includes("--quick") })); }
      break;
    }
    case "cursor": {
      const sub = args[1] || "demo";
      if (sub === "move") actionOutput(await computer_use.cursor_move({ point: point(args[2]), label: args.slice(3).join(" ") || "OpenSky" }));
      else if (sub === "wiggle") actionOutput(await computer_use.cursor_wiggle({ enabled: true, duration: number(args[2], "Duration", 2), label: args.slice(3).join(" ") || "Thinking…" }));
      else if (sub === "dismiss") actionOutput(await computer_use.cursor_dismiss({}));
      else if (sub === "demo") actionOutput(await computer_use.cursor_demo({}));
      else throw new Error(`Unknown cursor command: ${sub}`);
      break;
    }
    default: throw new Error(`Unknown command: ${command}. Run 'opensky help' for usage.`);
  }
}

main().catch((error) => {
  if (wantsJSON) console.error(JSON.stringify({ ok: false, error: error.message || String(error) }));
  else console.error(`OpenSky: ${error.message || error}`);
  process.exitCode = 1;
});
