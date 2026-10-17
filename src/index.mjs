import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, openSync, closeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSessionWithComputer, findElementsWithComputer } from "./session.mjs";
import { getOperatingGuidance } from "./operator-guidance.mjs";
import { NATIVE_API_VERSION,ownAXUpgradeRequired } from "./native-version.mjs";
import { performChromeTabs } from "./chrome.mjs";
import { readInteractionMode, writeInteractionMode, prepareInteraction } from "./interaction-mode.mjs";
import { browserRequest, setBrowserPaused } from "./browser/client.mjs";
import {readUserActivity} from './user-activity.mjs';
export { OpenSkyError, matchElements } from "./session.mjs";
export { getOperatingGuidance } from "./operator-guidance.mjs";
export { NATIVE_API_VERSION } from "./native-version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Embedded Node hosts may hide the process global. Defaults still support an
// already-installed local service; ordinary Node keeps environment overrides.
const environment = globalThis.process?.env ?? {};
export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const OPENSKY_HOME = environment.OPENSKY_HOME || path.join(os.homedir(), ".local", "share", "opensky");
export const TOKEN_PATH = path.join(OPENSKY_HOME, "control-token");
const bundledBinary = path.join(os.homedir(), "Applications", "OpenSky.app", "Contents", "MacOS", "OpenSky");
export const DAEMON_BINARY = environment.OPENSKY_BINARY || (existsSync(bundledBinary) ? bundledBinary : path.join(PROJECT_ROOT, "Native", ".build", "release", "opensky-daemon"));
export const DEFAULT_PORT = Number(environment.OPENSKY_PORT || 43821);
if (!Number.isInteger(DEFAULT_PORT) || DEFAULT_PORT < 1024 || DEFAULT_PORT > 65535) throw new Error("OPENSKY_PORT must be an integer from 1024 to 65535.");
export const DAEMON_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

function controlToken(create = true) {
  if (!existsSync(TOKEN_PATH)) {
    if (!create) return null;
    mkdirSync(OPENSKY_HOME, { recursive: true, mode: 0o700 });
    try { writeFileSync(TOKEN_PATH, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  chmodSync(TOKEN_PATH, 0o600);
  const token = readFileSync(TOKEN_PATH, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error(`Invalid OpenSky control token file: ${TOKEN_PATH}`);
  return token;
}

/** Inspect the daemon without starting it. Never returns the control token. */
export async function daemonStatus() {
  try {
    const token = controlToken(false);
    if (!token) return { ok: false, running: false, error: "OpenSky has not been started." };
    const response = await fetch(`${DAEMON_URL}/status`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
    const result = await response.json();
    return { ...result, running: response.ok && result.service === "OpenSky Computer Use Daemon" };
  } catch (error) { return { ok: false, running: false, error: error.message }; }
}

/**
 * Ensures the resident OpenSky native macOS daemon (with the 60fps floating
 * click-through virtual cursor overlay window and stateful AX tree engine) is running.
 */
export async function ensureDaemonRunning() {
  try {
    const res = await fetch(`${DAEMON_URL}/health`, { signal: AbortSignal.timeout(600) });
    if (res.ok) {
      const health = await res.json();
      if (health.service !== "OpenSky Computer Use Daemon" || health.version !== NATIVE_API_VERSION) throw new Error("Port is occupied by an incompatible daemon. Stop it or choose another OPENSKY_PORT.");
      const status = await daemonStatus();
      if (!status.running) throw new Error("OpenSky is running with a different control token. Use the same OPENSKY_HOME.");
      return true;
    }
  } catch (error) {
    if (/incompatible daemon|different control token/.test(error.message)) throw error;
    // Not running yet; spawn detached background daemon
  }

  if (!existsSync(DAEMON_BINARY)) {
    throw new Error(`OpenSky native binary not found at ${DAEMON_BINARY}. Run 'npm run build:native' first.`);
  }

  const token = controlToken();
  const logPath = path.join(OPENSKY_HOME, "daemon.log");
  const logFd = openSync(logPath, "a", 0o600);
  const bundle = path.resolve(DAEMON_BINARY, "../../..");
  const isAppBundle = bundle.endsWith(".app") && existsSync(path.join(bundle, "Contents", "Info.plist"));
  // LaunchServices gives the approved app its own macOS permission identity.
  // A direct child of an agent can instead inherit the agent's responsibility chain.
  const launchCommand = isAppBundle ? "/usr/bin/open" : DAEMON_BINARY;
  const launchArgs = isAppBundle
    ? ["-g", "-n", "-a", bundle, "--env", `OPENSKY_PORT=${DEFAULT_PORT}`, "--env", `OPENSKY_HOME=${OPENSKY_HOME}`, "--stderr", logPath, "--stdout", logPath]
    : [];
  if (isAppBundle && environment.OPENSKY_REDUCE_MOTION) launchArgs.push("--env", `OPENSKY_REDUCE_MOTION=${environment.OPENSKY_REDUCE_MOTION}`);
  const child = spawn(launchCommand, launchArgs, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...environment, OPENSKY_PORT: String(DEFAULT_PORT), OPENSKY_HOME, OPENSKY_AUTH_TOKEN: token }
  });
  child.on("error", () => {});
  closeSync(logFd);
  child.unref();

  // LaunchServices can take longer than a direct executable launch.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const status = await daemonStatus();
      if (status.running) return true;
    } catch { /* Readiness will be retried until the startup deadline. */ }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`OpenSky did not start. Check ${path.join(OPENSKY_HOME, "daemon.log")}.`);
}

/**
 * Low-level RPC caller to the OpenSky native daemon.
 * Automatically starts the resident daemon if not already running, with authenticated local transport.
 */
export async function callDaemon(method, params = {}, { autoStart = true } = {}) {
  if (['stop','shutdown'].includes(method)) await setBrowserPaused(true);
  const prepared = prepareInteraction(OPENSKY_HOME, method, params);
  if (prepared.result) return prepared.result;
  params = prepared.params;
  if (autoStart) await ensureDaemonRunning();
  if(ownAXUpgradeRequired(method,params,undefined)) {
    const native=await daemonStatus();
    if(ownAXUpgradeRequired(method,params,native.build_version))return {ok:false,error_code:'native_ui_upgrade_required',error:'Automating OpenSky’s own SwiftUI controls requires native build 1.3.3 or later. Older builds can crash on self-directed AX actions. The Inspector can still be opened and used normally; upgrade the native app at a quiet checkpoint and complete any real macOS consent. No input was sent.'};
  }
  // Recheck after startup/status waits: the owner may have returned meanwhile.
  const latest=prepareInteraction(OPENSKY_HOME,method,params);
  if(latest.result)return latest.result;
  params=latest.params;
  const token = controlToken(autoStart);
  if (!token) throw new Error("OpenSky is not running.");
    const res = await fetch(`${DAEMON_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(60000)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `OpenSky HTTP ${res.status}`);
    if (method === 'resume' && result.ok) await setBrowserPaused(false);
    if (method === "shutdown" && result.ok) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 75));
        if (!(await daemonStatus()).running) return result;
      }
      throw new Error("OpenSky acknowledged shutdown but did not exit within 3 seconds.");
    }
    return result;
}

/**
 * OpenSky computer-use SDK using public macOS APIs.
 * Can be imported directly in Node.js, Codex REPL, Claude scripts, or Antigravity tools.
 */
export const computer_use = {
  async user_activity() {return readUserActivity();},
  async browser_status() { return browserRequest('status'); },
  async browser_tabs(params = {}) {
    const action=params.action??'list';
    const method={list:'tabs_list',open:'tab_open',claim:'tab_claim',navigate:'tab_navigate',close:'tab_close',release:'tab_release'}[action];
    if(!method)return {ok:false,error_code:'invalid_browser_action',error:'Use list, open, claim, navigate, close or release.'};
    return browserRequest(method,params);
  },
  async browser_snapshot(params = {}) { return browserRequest('snapshot',params); },
  async browser_frames(params = {}) { return browserRequest('frames',params); },
  async browser_click(params = {}) { return browserRequest('click',params); },
  async browser_fill(params = {}) { return browserRequest('fill',params); },
  async browser_upload(params = {}) { return browserRequest('upload',params); },
  async browser_press_key(params = {}) { return browserRequest('press_key',params); },
  async browser_select_option(params = {}) { return browserRequest('select_option',params); },
  async browser_screenshot(params = {}) {
    const result=await browserRequest('screenshot',params);if(!result.ok)return result;
    const directory=path.join(OPENSKY_HOME,'screenshots');mkdirSync(directory,{recursive:true,mode:0o700});
    const now=new Date(),date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
    const filename=path.join(directory,`${date}-browser-${params.tab_id}-${randomBytes(5).toString('hex')}-Codex.png`);
    writeFileSync(filename,Buffer.from(result.image_base64,'base64'),{mode:0o600});return {ok:true,tab_id:result.tab_id,screenshot:{path:filename}};
  },
  async interaction_mode(params = {}) {
    return params.mode === undefined ? readInteractionMode(OPENSKY_HOME) : writeInteractionMode(OPENSKY_HOME, params.mode);
  },
  async chrome_tabs(params = {}) { return performChromeTabs(computer_use,params,{home:OPENSKY_HOME}); },
  async get_operating_guidance() { return getOperatingGuidance(); },
  async stop() { return callDaemon("stop", {}, { autoStart: false }); },
  async resume() { return callDaemon("resume", {}, { autoStart: false }); },
  async shutdown() { return callDaemon("shutdown", {}, { autoStart: false }); },
  /** Check daemon status, screen dimensions, and macOS Accessibility trust */
  async status(params = {}) {
    return callDaemon("status", params);
  },

  /** List running and installed macOS applications with their on-screen windows */
  async list_apps(params = {}) {
    const res = await callDaemon("list_apps", params);
    return res.apps || [];
  },

  /**
   * Capture an application's hierarchical Accessibility Tree (with full snapshots),
   * window screenshot (`file://` path), and hybrid Apple Vision OCR elements.
   */
  async get_app_state(params = {}) {
    return callDaemon("get_app_state", params);
  },
  /** Inspect exact-window AX/OCR matches without screenshots or input. */
  async find_elements(params = {}) {
    return findElementsWithComputer(computer_use, params);
  },

  /**
   * Click an element by `element_index` (from `get_app_state`) or screen `[x, y]` `point`.
   * Animates the curved Bezier virtual cursor with velocity stretch/tilt, spotlight, and click ripple.
   * Supports `mode`: `"hybrid"` (default: background AXPress first, hardware CGEvent fallback),
   * `"background"` (AX only; no physical input fallback), or `"takeover"` (activates app and clicks directly).
   */
  async click(params = {}) {
    return callDaemon("click", params);
  },

  /** Drag between elements or coordinates with animated cursor trail */
  async drag(params = {}) {
    return callDaemon("drag", params);
  },

  /** Scroll up/down/left/right on an element or window by `pages` */
  async scroll(params = {}) {
    return callDaemon("scroll", params);
  },

  /** Set an AX value. Foreground keyboard fallback requires explicit hybrid/takeover mode. */
  async set_value(params = {}) {
    return callDaemon("set_value", params);
  },

  /** Type arbitrary Unicode text into the target app */
  async type_text(params = {}) {
    return callDaemon("type_text", params);
  },

  /** Press one or more xdotool-compatible keys or modifier chords (e.g. `["super+c"]`, `["Return"]`) */
  async press_key(params = {}) {
    return callDaemon("press_key", params);
  },

  /** Paste plain text, Markdown (`md`), or HTML (`html`) while preserving the user's clipboard */
  async paste(params = {}) {
    return callDaemon("paste", params);
  },

  /** Perform a secondary Accessibility action (`ShowMenu`, `Confirm`, `Increment`, `Decrement`, `Pick`) */
  async perform_secondary_action(params = {}) {
    return callDaemon("perform_secondary_action", params);
  },

  /** Select text inside an element by prefix/suffix or move insertion cursor */
  async select_text(params = {}) {
    return callDaemon("select_text", params);
  },

  // --- Window, scripting and pointer controls ---

  /** Move/resize, center, maximize, minimize, or focus any app window */
  async manage_window(params = {}) {
    return callDaemon("manage_window", params);
  },

  /** Execute AppleScript or JXA (JavaScript for Automation) for deep system/app scripting */
  async run_applescript(params = {}) {
    return callDaemon("run_applescript", params);
  },

  /** Capture the entire macOS screen with full Apple Vision OCR coordinate mapping */
  async screenshot_screen(params = {}) {
    return callDaemon("screenshot_screen", params);
  },

  /** Move a named virtual AI cursor (`cursor_id`) along a curved Bezier path with optional spotlight */
  async cursor_move(params = {}) {
    return callDaemon("cursor_move", params);
  },

  /** Toggle the playful Codex thinking wiggle animation on a virtual cursor */
  async cursor_wiggle(params = {}) {
    return callDaemon("cursor_wiggle", params);
  },

  /** Draw a glowing spotlight rectangle over `[x, y, width, height]` on screen */
  async cursor_highlight(params = {}) {
    return callDaemon("cursor_highlight", params);
  },

  /** Dismiss one or all virtual cursors immediately */
  async cursor_dismiss(params = {}) {
    return callDaemon("cursor_dismiss", params);
  },

  /** Run the live multi-cursor choreography showcase on screen */
  async cursor_demo(params = {}) {
    return callDaemon("cursor_demo", params);
  }
};

export default computer_use;

/** Select controls by exact accessible name/role with fresh snapshot validation. */
export function createSession(options) { return createSessionWithComputer(computer_use, options); }
