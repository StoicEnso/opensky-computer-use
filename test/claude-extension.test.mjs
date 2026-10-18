import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildClaudeExtension } from '../scripts/build-claude-extension.mjs';

const root = path.resolve(import.meta.dirname, '..');
test('Desktop bundle contains only its manifest, branded adapter and license', { skip: process.platform !== 'darwin' }, t => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), '2026-10-18-opensky-bundle-Codex-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, 'OpenSky.mcpb');
  buildClaudeExtension(output);
  const files = execFileSync('/usr/bin/unzip', ['-Z', '-1', output], { encoding: 'utf8' }).trim().split('\n').filter(n => !n.endsWith('/')).sort();
  assert.deepEqual(files, ['LICENSE', 'icon.png', 'manifest.json', 'server/index.mjs']);
  const manifest = JSON.parse(execFileSync('/usr/bin/unzip', ['-p', output, 'manifest.json'], { encoding: 'utf8' }));
  assert.equal(manifest.version, JSON.parse(readFileSync(path.join(root, 'package.json'))).version);
  assert.equal(manifest.server.mcp_config.env.OPENSKY_HOME, '${user_config.runtime_directory}');
  assert.deepEqual(manifest.compatibility.platforms, ['darwin']);
  assert.equal(manifest.tools_generated, true);
  assert.equal(manifest.user_config.runtime_directory.required, false);
  assert.equal(manifest.user_config.runtime_directory.default, '', 'An unexpanded directory placeholder blocked real Claude setup.');
  assert.throws(() => buildClaudeExtension(output), /Refusing to replace/);
  const preconfigured = path.join(temporary, 'Preconfigured.mcpb');
  buildClaudeExtension(preconfigured, { runtimeDirectory: temporary });
  const local = JSON.parse(execFileSync('/usr/bin/unzip', ['-p', preconfigured, 'manifest.json'], { encoding: 'utf8' }));
  assert.equal(local.server.mcp_config.env.OPENSKY_HOME, temporary); assert.equal(local.user_config, undefined);
});

test('Desktop adapter uses an existing custom installation without starting or changing an engine', { timeout: 15000 }, async t => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "2026-10-18-opensky-claude-Codex-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const home = path.join(temporary, "runtime with spaces ' and Unicode ✓");
  mkdirSync(path.join(home, 'src'), { recursive: true });
  writeFileSync(path.join(home, '.opensky-install.json'), JSON.stringify({ product: 'opensky-computer-use', runtime: home, app: path.join(temporary, 'absent.app') }));
  writeFileSync(path.join(home, 'package.json'), JSON.stringify({ name: 'opensky-computer-use' }));
  writeFileSync(path.join(home, 'src/mcp-server.mjs'), `await import(${JSON.stringify(pathToFileURL(path.join(root, 'src/mcp-server.mjs')).href)});\n`);
  const sentinel = path.join(temporary, 'unexpected-engine');
  const executable = path.join(temporary, 'sentinel');
  writeFileSync(executable, '#!/bin/sh\ntouch "' + sentinel + '"\n', { mode: 0o755 });
  const environment = { ...process.env, OPENSKY_HOME: home + '/', OPENSKY_BINARY: executable, OPENSKY_PORT: '53788' };
  const adapter = path.join(root, 'extensions/claude-desktop/server.mjs');
  const client = new Client({ name: 'opensky-claude-extension-check', version: '1.0' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [adapter], env: environment, stderr: 'pipe' }));
  try {
    assert.equal(client.getServerVersion().version, JSON.parse(readFileSync(path.join(root, 'package.json'))).version);
    const tools = (await client.listTools()).tools.map(x => x.name);
    for (const name of ['status', 'browser_tabs', 'browser_upload', 'get_operating_guidance', 'interaction_mode']) assert.ok(tools.includes(name));
    assert.match(client.getInstructions(), /preserve an owner-selected auto idle policy/);
    const guidance = await client.callTool({ name: 'get_operating_guidance', arguments: {} });
    assert.equal(guidance.isError, false);
    assert.equal(existsSync(sentinel), false);
    for (const name of ['control-token', 'interaction-mode.json', 'browser-paused.json']) assert.equal(existsSync(path.join(home, name)), false);
  } finally { await client.close(); }
  const absent = path.join(temporary, 'missing');
  const failed = spawnSync(process.execPath, [adapter], { env: { ...environment, OPENSKY_HOME: absent }, encoding: 'utf8', timeout: 3000 });
  assert.equal(failed.status, 1); assert.match(failed.stderr, /install OpenSky first/);
  assert.equal(existsSync(absent), false);
});
