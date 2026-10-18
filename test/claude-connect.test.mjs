import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectClaude, desktopConnection } from '../src/claude-connect.mjs';

function fixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), '2026-10-18-opensky-claude-connect-Codex-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const runtime = path.join(home, 'OpenSky runtime with spaces');
  for (const directory of ['src', 'skills/opensky-computer-use', 'extensions/claude-desktop']) mkdirSync(path.join(runtime, directory), { recursive: true });
  writeFileSync(path.join(runtime, '.opensky-install.json'), JSON.stringify({ product: 'opensky-computer-use', runtime }));
  writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  writeFileSync(path.join(runtime, 'src/mcp-server.mjs'), '// No production server is started by these connection fixtures.');
  writeFileSync(path.join(runtime, 'extensions/claude-desktop/server.mjs'), 'fixture adapter');
  writeFileSync(path.join(runtime, 'skills/opensky-computer-use/SKILL.md'), '---\nname: opensky-computer-use\n---\nCurrent instructions.\n');
  writeFileSync(path.join(runtime, 'control-token'), 'private fixture token', { mode: 0o600 });
  writeFileSync(path.join(runtime, 'interaction-mode.json'), '{"mode":"alongside"}\n');
  const config = path.join(home, 'claude-config');
  return { home, runtime, config, options: { home, runtime, claudeConfigDirectory: config, desktopAvailable: false,
    reveal: () => { throw Error('A fixture must never open the real application.'); } } };
}

test('Claude setup registers in user scope once, backs up the owned skill and preserves unrelated settings', async t => {
  const f = fixture(t), calls = [];
  const skill = path.join(f.config, 'skills/opensky-computer-use/SKILL.md');
  mkdirSync(path.dirname(skill), { recursive: true });
  const original = '---\nname: opensky-computer-use\n---\nOwner additions.\n'; writeFileSync(skill, original);
  let configured;
  const unrelated = { mcpServers: { other: { command: '/preserve/this', env: { KEY: 'fixture-private' } } }, preference: true };
  const configFile = path.join(f.home, 'fixture-client.json'); writeFileSync(configFile, JSON.stringify(unrelated));
  const run = async (command, args) => {
    calls.push(args);
    if (args[1] === 'add') {
      const start = args.indexOf('--') + 1; configured = { command: args[start], args: args.slice(start + 1) };
      const saved = JSON.parse(readFileSync(configFile)); saved.mcpServers['opensky-computer-use'] = configured; writeFileSync(configFile, JSON.stringify(saved)); return { stdout: 'Added' };
    }
    if (!configured) throw Error('No MCP server found with name: opensky-computer-use');
    return { stdout: `Scope: User config\nStatus: ✔ Connected\nCommand: ${configured.command}\nArgs: ${configured.args.join(' ')}\nEnvironment:\n` };
  };
  const first = await connectClaude({ ...f.options, run });
  assert.equal(first.claudeCode.status, 'connected'); assert.equal(first.complete, true);
  assert.ok(calls.some(args => args.includes('--scope') && args[args.indexOf('--scope') + 1] === 'user'));
  const second = await connectClaude({ ...f.options, run });
  assert.equal(second.skill.status, 'current'); assert.equal(calls.filter(a => a[1] === 'add').length, 1);
  const saved = JSON.parse(readFileSync(configFile)); assert.deepEqual(saved.mcpServers.other, unrelated.mcpServers.other); assert.equal(saved.preference, true);
  const backups = readdirSync(f.runtime).filter(n => n.endsWith('claude-setup-Codex')).flatMap(n => readdirSync(path.join(f.runtime, n)).map(file => path.join(f.runtime, n, file)));
  assert.equal(backups.length, 1); assert.equal(readFileSync(backups[0], 'utf8'), original); assert.equal(statSync(backups[0]).mode & 0o777, 0o600);
  configured = { command: '/different/owner/server', args: [] };
  assert.equal((await connectClaude({ ...f.options, run })).claudeCode.status, 'different_server_preserved');
  assert.equal(calls.filter(a => a[1] === 'add').length, 1);
  assert.equal(readFileSync(path.join(f.runtime, 'control-token'), 'utf8'), 'private fixture token');
  assert.equal(readFileSync(path.join(f.runtime, 'interaction-mode.json'), 'utf8'), '{"mode":"alongside"}\n');
});

test('Preview is read-only and repeated Desktop setup reuses its pending bundle without opening over owner activity', async t => {
  const f = fixture(t); let calls = 0, builds = 0, reveals = 0;
  const options = { ...f.options, desktopAvailable: true, reveal: () => { reveals++; },
    run: async () => { calls++; const e = Error('Claude absent'); e.code = 'ENOENT'; throw e; },
    build: (file, { runtimeDirectory }) => { builds++; assert.equal(runtimeDirectory, f.runtime); writeFileSync(file, 'fixture bundle'); } };
  const preview = await connectClaude({ ...options, dryRun: true });
  assert.equal(preview.dryRun, true); assert.equal(calls + builds + reveals, 0); assert.equal(existsSync(f.config), false);
  const first = await connectClaude(options), second = await connectClaude(options);
  assert.equal(first.desktop.status, 'review_required'); assert.equal(first.complete, false);
  assert.equal(first.desktop.deferredForOwnerActivity, true); assert.equal(reveals, 0);
  assert.equal(first.desktop.bundle, second.desktop.bundle); assert.equal(builds, 1);
});

test('An enabled matching Desktop extension is reused; only the exact legacy duplicate is removed', async t => {
  const f = fixture(t), id = 'local.mcpb.stoicenso.opensky-computer-use';
  const base = path.join(f.home, 'Library/Application Support/Claude'), directory = path.join(base, 'Claude Extensions', id);
  mkdirSync(path.join(directory, 'server'), { recursive: true }); mkdirSync(path.join(base, 'Claude Extensions Settings'), { recursive: true });
  writeFileSync(path.join(base, 'extensions-installations.json'), JSON.stringify({ extensions: { [id]: { manifest: { name: 'opensky-computer-use' } } } }));
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ version: '1.0.0', server: { entry_point: 'server/index.mjs' } }));
  writeFileSync(path.join(directory, 'server/index.mjs'), 'fixture adapter');
  const settings = path.join(base, 'Claude Extensions Settings', id + '.json');
  writeFileSync(settings, JSON.stringify({ isEnabled: true, userConfig: { runtime_directory: f.runtime } }));
  assert.equal(desktopConnection(f.home, f.runtime).status, 'enabled');
  const legacy=path.join(base,'claude_desktop_config.json');
  const other={command:'/preserve/other',env:{KEY:'private fixture'}};
  writeFileSync(legacy,JSON.stringify({mcpServers:{other,'opensky-computer-use':{command:process.execPath,args:[path.join(f.runtime,'src/mcp-server.mjs')]}},preference:'keep'}));
  const run=async()=>{const e=Error('Claude Code not installed');e.code='ENOENT';throw e;};
  const connected=await connectClaude({...f.options,desktopAvailable:true,run});
  assert.equal(connected.desktop.status,'enabled');assert.equal(connected.desktop.legacyDuplicateRemoved,true);
  assert.deepEqual(JSON.parse(readFileSync(legacy)),{mcpServers:{other},preference:'keep'});
  writeFileSync(legacy,JSON.stringify({mcpServers:{'opensky-computer-use':{command:'/owner/custom',args:[]}}}));
  assert.equal((await connectClaude({...f.options,desktopAvailable:true,run})).desktop.legacyConfigurationPreserved,true);
  assert.equal(JSON.parse(readFileSync(legacy)).mcpServers['opensky-computer-use'].command,'/owner/custom');
  writeFileSync(settings, JSON.stringify({ isEnabled: true, userConfig: { runtime_directory: '/different/runtime' } }));
  assert.equal(desktopConnection(f.home, f.runtime).status, 'needs_review');
  writeFileSync(settings, JSON.stringify({ isEnabled: true, userConfig: { runtime_directory: f.runtime } }));
  writeFileSync(path.join(directory, 'server/index.mjs'), 'different adapter');
  assert.equal(desktopConnection(f.home, f.runtime).status, 'needs_review');
});
