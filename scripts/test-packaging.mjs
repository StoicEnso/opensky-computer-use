#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parseOptions, wrapperSource } from "./install.mjs";
import { connectionCommand, configSnippet } from "./config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(path.join(os.tmpdir(), "2026-10-17-opensky-packaging-Codex-"));
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }
function equal(actual, expected, message = "Values should match") { assert.deepEqual(actual, expected, message); assertions++; }
try {
  assert.throws(() => parseOptions(["--bogus"]), /Unknown option/); assertions++;
  assert.throws(() => parseOptions(["--skill", "bogus"]), /--skill accepts/); assertions++;
  equal(parseOptions(["--skill", "all"]).skills, ["codex", "claude"]);

  const runtime = path.join(temporary, "spaces ' apostrophe $(touch NOPE) `whoami`");
  const app = path.join(temporary, "App Folder", "OpenSky.app");
  const wrapper = wrapperSource(runtime, app, "cli.mjs", "/missing/node");
  const environmentPart = wrapper.slice(0, wrapper.indexOf("if [ -x"));
  const evaluated = spawnSync("/bin/sh", ["-c", `${environmentPart}\nprintf '%s\\n%s\\n' "$OPENSKY_HOME" "$OPENSKY_BINARY"`], { encoding: "utf8", env: { PATH: process.env.PATH } });
  equal(evaluated.status, 0);
  equal(evaluated.stdout.trimEnd().split("\n"), [runtime, path.join(app, "Contents", "MacOS", "OpenSky")], "Launcher must preserve literal path characters without executing them.");
  const overridden = spawnSync("/bin/sh", ["-c", `${environmentPart}\nprintf '%s' "$OPENSKY_HOME"`], { encoding: "utf8", env: { PATH: process.env.PATH, OPENSKY_HOME: "custom-home" } });
  equal(overridden.stdout, "custom-home");

  const binDir = path.join(temporary, "bin"); mkdirSync(binDir);
  const mcp = path.join(binDir, "opensky-mcp");
  writeFileSync(mcp, wrapperSource("/some/other/root", app, "mcp-server.mjs"));
  equal(connectionCommand({ root: runtime, binDir }).command, process.execPath, "A stale launcher must not be advertised for a different checkout.");
  writeFileSync(mcp, wrapperSource(runtime, app, "mcp-server.mjs"));
  equal(connectionCommand({ root: runtime, binDir }).command, mcp);
  const config = JSON.parse(configSnippet("cursor", { root: runtime, binDir }));
  equal(config.mcpServers["opensky-computer-use"].command, mcp);
  equal(config.mcpServers["opensky-computer-use"].type, "stdio");
  equal(JSON.parse(configSnippet("antigravity", {root: runtime, binDir})).mcpServers["opensky-computer-use"], {command:mcp,args:[]});
  check(configSnippet("codex", { root: runtime, binDir }).includes("[mcp_servers.opensky-computer-use]"));

  const noStartRuntime = path.join(temporary, "never-started");
  const sentinel = path.join(temporary, "daemon-sentinel");
  const sentinelResult = path.join(temporary, "spawned");
  writeFileSync(sentinel, `#!/bin/sh\ntouch '${sentinelResult}'\n`, { mode: 0o755 });
  for (const args of [["status"], ["doctor"], ["stop"], ["resume"], ["shutdown"], ["rpc", "status", "{}"]]) {
    const run = spawnSync(process.execPath, [path.join(root, "src", "cli.mjs"), ...args, "--json"], { encoding: "utf8", env: { ...process.env, OPENSKY_HOME: noStartRuntime, OPENSKY_BINARY: sentinel, OPENSKY_PORT: "53791" } });
    equal(run.status, 1, `${args.join(" ")} must fail when absent.`);
    check(!existsSync(sentinelResult), `${args.join(" ")} must never launch a daemon.`);
    check(!existsSync(noStartRuntime), `${args.join(" ")} must not create runtime data.`);
  }

  if (process.platform === "darwin") {
    const previewRuntime = path.join(temporary, "preview-runtime");
    const preview = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "--dry-run", "--prefix", path.join(temporary, "prefix"), "--app-dir", path.join(temporary, "Applications")], { encoding: "utf8", env: { ...process.env, OPENSKY_HOME: previewRuntime } });
    equal(preview.status, 0, preview.stderr);
    equal(JSON.parse(preview.stdout).clientRegistration, "manual only");
    check(!existsSync(previewRuntime), "Dry-run must not create runtime folders.");

    const uninstallRuntime = path.join(temporary, "uninstall-runtime"); mkdirSync(uninstallRuntime);
    const launchers = [path.join(temporary, "opensky"), path.join(temporary, "unrelated-mcp")];
    writeFileSync(launchers[0], wrapperSource(uninstallRuntime, app, "cli.mjs"));
    writeFileSync(launchers[1], "unrelated launcher");
    mkdirSync(path.join(uninstallRuntime, "src"));
    writeFileSync(path.join(uninstallRuntime, "control-token"), "retained credential", { mode: 0o600 });
    writeFileSync(path.join(uninstallRuntime, "unrelated.json"), "preserved");
    writeFileSync(path.join(uninstallRuntime, ".opensky-install.json"), JSON.stringify({ schema: 1, product: "opensky-computer-use", runtime: uninstallRuntime, app, launchers, installedFiles: ["src", "../unrelated.json"] }));
    const uninstall = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "--uninstall"], { encoding: "utf8", env: { ...process.env, OPENSKY_HOME: uninstallRuntime } });
    equal(uninstall.status, 0, uninstall.stderr);
    check(!existsSync(launchers[0]), "Uninstall must remove owned launcher.");
    equal(readFileSync(launchers[1], "utf8"), "unrelated launcher");
    equal(readFileSync(path.join(uninstallRuntime, "control-token"), "utf8"), "retained credential");
    equal(readFileSync(path.join(uninstallRuntime, "unrelated.json"), "utf8"), "preserved");
    check(!existsSync(path.join(uninstallRuntime, "src")), "Uninstall must remove managed code.");
  }
  console.log(`Packaging checks passed (${assertions} assertions). No user installation or client configuration was changed.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
