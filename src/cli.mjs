#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computer_use, getOperatingGuidance, DAEMON_BINARY, DAEMON_URL, OPENSKY_HOME, TOKEN_PATH, callDaemon, daemonStatus, ensureDaemonRunning } from "./index.mjs";
import {nativeProcessIdentity} from './native-process.mjs';
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
  mode [alongside|desktop|auto]           Read/set shared desktop cooperation (no launch)
  activity                              Read external-input idle time (aggregate only)
  web install                            Register OpenSky's Chrome native host; print extension setup
  web status                             Read the independent browser bridge status
  web shutdown                           Pause browser control and stop its local bridge
  web <tabs|snapshot|frames|click|fill|upload|press_key|select_option|screenshot> JSON
                                         Background page control through the OpenSky extension
  onboard                                Open local guided setup and permission checks in Chrome
  browser list                           List exact Chrome tab/window IDs (after optional setup)
  browser enable                         Explicit one-time Chrome Automation setup
  browser open URL [--window ID]          Dedicated window by default; optional exact Chrome window
  browser navigate TAB_ID URL             Navigate an exact tab without selecting it
  browser select TAB_ID                   Select exact tab; --activate brings Chrome forward
  browser close TAB_ID                    Close an exact tab; preserve unrelated tabs
  doctor                                 Check installation, daemon, and permissions (no launch)
  status                                 Query an existing daemon (no launch)
  inspector [status|show|close]           Read/open/close OpenSky Inspector; show stays behind other apps
  daemon [start|stop]                     Start daemon, or shut it down
  stop | emergency-stop                  Pause actions and dismiss cursors (no launch)
  resume                                 Explicitly resume a paused daemon (no launch)
  shutdown                               Exit the daemon (no launch)
  config [codex|claude-code|claude-desktop|cursor|antigravity|all]
                                         Print MCP configuration; does not write client files
  rpc <method> [JSON|-]                   Call any native method; '-' reads JSON from stdin
  apps [--running]                       List macOS apps and windows
  state <App> [--window ID] [--ocr]       Inspect an exact window and capture it
  find <App> <exact name> [--window ID]   Find structured AX controls by name
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
Native state/find support --window ID; click/set-value support --snapshot ID.
Alongside mode requires exact-window observations and fresh snapshot targets.
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
function mode(fallback) {
  if (args.includes("--takeover") && args.includes("--background")) throw new Error("Choose either --takeover or --background.");
  return args.includes("--takeover") ? "takeover" : args.includes("--background") ? "background" : fallback;
}
function nativeMetadata() {
  const result = {};
  for (const [flag, key] of [['--window', 'window_id'], ['--snapshot', 'snapshot_id']]) {
    const at = args.indexOf(flag);
    if (at === -1) continue;
    const value = required(args[at + 1], flag);
    if (key === 'window_id') {
      const id = number(value, 'Window ID');
      if (!Number.isInteger(id) || id < 1 || id > 4294967295) throw new Error('Window ID must be a positive 32-bit integer.');
      result[key] = id;
    } else result[key] = value;
  }
  return result;
}
function nativeText(start) {
  const words = [];
  for (let i = start; i < args.length; i++) {
    if (['--window', '--snapshot'].includes(args[i])) { required(args[++i], 'option value'); continue; }
    if (!['--background', '--takeover'].includes(args[i])) words.push(args[i]);
  }
  return words.join(' ');
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
  const nativeProcess = await nativeProcessIdentity(daemon.running ? daemon.pid : null, DAEMON_BINARY);
  const cooperation=await computer_use.interaction_mode();
  let tokenOwnerOnly = null;
  if (existsSync(TOKEN_PATH)) tokenOwnerOnly = (statSync(TOKEN_PATH).mode & 0o077) === 0;
  const report = {
    ok: process.platform === "darwin" && Number(process.versions.node.split(".")[0]) >= 22 && existsSync(DAEMON_BINARY) && daemon.running === true && daemon.axTrusted === true && daemon.screenRecordingTrusted === true && tokenOwnerOnly === true && nativeProcess.binaryMatches !== false,
    version, platform: process.platform, architecture: process.arch, node: process.versions.node,
    binary: DAEMON_BINARY, binaryExists: existsSync(DAEMON_BINARY), runtime: OPENSKY_HOME,
    endpoint: DAEMON_URL, tokenExists: existsSync(TOKEN_PATH), tokenOwnerOnly, daemon, cooperation, ...nativeProcess,
    nextSteps: []
  };
  if (!report.binaryExists) report.nextSteps.push("Run ./install.sh from the source checkout to build and install the native app.");
  if (!daemon.running) report.nextSteps.push("Run opensky daemon, then opensky setup.");
  if (nativeProcess.binaryMatches === false) report.nextSteps.push(`A different OpenSky copy is running at ${nativeProcess.runningBinary}. At a quiet checkpoint, quit that copy and reopen ${DAEMON_BINARY.replace(/\/Contents\/MacOS\/[^/]+$/, '')}. Verify the running path before changing macOS permission entries.`);
  if(cooperation.interaction_mode==='auto'&&!cooperation.user_activity?.ok)report.nextSteps.push('Auto activity data is unavailable; background control remains available. Native UI build 1.3.3 or later with Accessibility access supplies the filtered monitor data. Verify opensky activity before relying on automatic desktop availability.');
  if (daemon.running && !daemon.axTrusted) report.nextSteps.push("Allow OpenSky in System Settings > Privacy & Security > Accessibility.");
  if (daemon.running && !daemon.screenRecordingTrusted) report.nextSteps.push("Allow OpenSky in System Settings > Privacy & Security > Screen & System Audio Recording, then restart OpenSky.");
  if (tokenOwnerOnly === false) report.nextSteps.push("Restrict the local token file to your user before controlling the daemon.");
  output(report);
  if (!report.ok) process.exitCode = 1;
}

async function main() {
  if (['--help', '-h'].includes(args[1])) { help(); return; }
  switch (command) {
    case "help": case "--help": case "-h": help(); break;
    case "version": case "--version": case "-v": output(version); break;
    case "guidance": {const guidance=getOperatingGuidance();output(wantsJSON?guidance:guidance.instructions);break;}
    case "mode": {actionOutput(await computer_use.interaction_mode({mode:args[1]}));break;}
    case 'activity': {actionOutput(await computer_use.user_activity());break;}
    case "inspector": {
      const action=args[1]??'status';
      if(!['status','show','close'].includes(action))throw new Error('Use inspector status, show or close.');
      const result=await callDaemon('inspector',{action},{autoStart:action==='show'});
      actionOutput(!result.ok&&result.error?.startsWith('Unknown method')
        ? {...result,error_code:'native_ui_upgrade_required',error:'This Inspector command needs native UI build 1.3.2 or later. Upgrade the native app and complete any macOS consent; existing browser/native workflows can keep using the installed helper.'}
        : result);break;
    }
    case 'web': {
      const action=args[1]??'status';
      if(action==='shutdown'){const {shutdownBrowserBridge}=await import('./browser/client.mjs');output(await shutdownBrowserBridge());break;}
      if(action==='install'){const {installBrowserHost}=await import('../scripts/browser-install.mjs');output(installBrowserHost({runtime:root,home:OPENSKY_HOME}));break;}
      const method='browser_'+action;if(typeof computer_use[method]!=='function')throw new Error('Unknown web action. Run opensky web --help.');
      const source=args[2]==='-'?readFileSync(0,'utf8'):args.slice(2).join(' ')||'{}';let params;try{params=JSON.parse(source);}catch{throw new Error('Web parameters must be a JSON object.');}
      if(!params||typeof params!=='object'||Array.isArray(params))throw new Error('Web parameters must be an object.');
      actionOutput(await computer_use[method](params));break;
    }
    case 'onboard': {const {runOnboarding}=await import('../scripts/onboarding.mjs');await runOnboarding({openBrowser:!args.includes('--no-open')});break;}
    case 'browser': {
      const action=args[1]||'list';
      const params={action};
      if(action==='open') {
        params.url=required(args[2],'destination URL');
        const at=args.indexOf('--window');if(at!==-1) params.chrome_window_id=required(args[at+1],'Chrome window ID');
      }
      if(['navigate','select','close'].includes(action)) params.tab_id=required(args[2],'Chrome tab ID');
      if(action==='navigate') params.url=required(args[3],'destination URL');
      if(args.includes('--activate')) params.activate=true;
      actionOutput(await computer_use.chrome_tabs(params));break;
    }
    case "setup":
      output(`OpenSky setup\n\nRun opensky onboard for guided local setup in Chrome. It checks actual readiness, opens only the settings you choose, shows agent configuration, and offers a verified disposable demo. Normal readiness checks request no permissions.\n\nText path: opensky daemon; allow OpenSky Accessibility and Screen Recording in System Settings > Privacy & Security; opensky doctor; opensky config all. Restart OpenSky after granting screen capture.\n\nFor inactive Chrome tabs and uploads, use opensky web install for the one-time OpenSky extension setup; then opensky web status. Chrome tab Automation is a separate legacy option and off until explicitly enabled in onboarding or with opensky browser enable. Native Accessibility control works without it. macOS owns OS consent; OpenSky adds no chat approval cards or per-click approval gate. Existing agent rules still apply.\n\nNo client configuration was changed. Rebuilding an ad-hoc signed app can require Mac permission again. Emergency pause: Control+Option+Command+Escape, or opensky stop. Continue only with opensky resume. Exit with opensky shutdown.`); break;
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
      const result = await computer_use.get_app_state({ app: args[1] || "Finder", ...nativeMetadata(), include_ocr: args.includes("--ocr"), disable_diff: args.includes("--full") || args.includes("--no-diff"), show_cursor: true });
      if (!checkResult(result)) break;
      if (wantsJSON) output(result); else { output(result.text); if (result.screenshot?.path) output(`Screenshot: ${result.screenshot.path}`); }
      break;
    }
    case "find": {
      const result = await computer_use.find_elements({ app: required(args[1], "app"), ...nativeMetadata(), selector: { name: required(nativeText(2), "exact accessible name") } });
      if (checkResult(result)) output(result);break;
    }
    case "click": {
      const target = required(args[2], "element index or x,y coordinates");
      const params = { app: required(args[1], "app"), ...nativeMetadata(), mode: mode(), click_count: args.includes("--triple") ? 3 : args.includes("--double") ? 2 : 1, mouse_button: args.includes("--right") ? "right" : "left" };
      if (target.includes(",")) params.point = point(target); else params.element_index = index(target);
      actionOutput(await computer_use.click(params)); break;
    }
    case "set-value": case "set_value":
      actionOutput(await computer_use.set_value({ app: required(args[1], "app"), ...nativeMetadata(), element_index: index(args[2]), value: required(nativeText(3), "text"), mode: mode("background") })); break;
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
