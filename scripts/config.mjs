import path from "node:path";
import os from "node:os";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quoteShell = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
const quoteToml = (value) => JSON.stringify(value);

export function connectionCommand({ root = sourceRoot, binDir = path.join(os.homedir(), ".local", "bin") } = {}) {
  const wrapper = path.join(binDir, "opensky-mcp");
  let belongsToRoot = false;
  if (existsSync(wrapper)) {
    try {
      belongsToRoot = realpathSync(wrapper) === path.join(root, "src", "mcp-server.mjs") ||
        (readFileSync(wrapper, "utf8").includes("# OpenSky managed launcher v1") && readFileSync(wrapper, "utf8").includes(quoteShell(root)));
    } catch {}
  }
  return belongsToRoot
    ? { command: wrapper, args: [] }
    : { command: process.execPath, args: [path.join(root, "src", "mcp-server.mjs")] };
}

export function configSnippet(client = "all", options = {}) {
  const connection = connectionCommand(options);
  const server = "opensky-computer-use";
  const json = JSON.stringify({ mcpServers: { [server]: connection } }, null, 2);
  const codex = `[mcp_servers.${server}]\ncommand = ${quoteToml(connection.command)}\nargs = ${JSON.stringify(connection.args)}\n`;
  const claude = `claude mcp add --transport stdio --scope user ${server} -- ${[connection.command, ...connection.args].map(quoteShell).join(" ")}`;
  switch (client) {
    case "codex": return codex;
    case "claude-code": return claude;
    case "claude":
    case "claude-desktop":
    case "antigravity":
    case "json": return json;
    case "cursor": return JSON.stringify({ mcpServers: { [server]: { type: "stdio", ...connection } } }, null, 2);
    case "all": return `Codex (~/.codex/config.toml):\n${codex}\nClaude Code (run explicitly):\n${claude}\n\nClaude Desktop / Antigravity (merge into the client MCP configuration):\n${json}\n\nCursor (~/.cursor/mcp.json):\n${configSnippet("cursor", options)}\n`;
    default: throw new Error(`Unknown client '${client}'. Choose codex, claude-code, claude-desktop, cursor, antigravity, json, or all.`);
  }
}
