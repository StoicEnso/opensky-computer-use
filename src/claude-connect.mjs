import { readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, renameSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { connectionCommand } from '../scripts/config.mjs';
import { buildClaudeExtension } from '../scripts/build-claude-extension.mjs';
import { readInteractionMode } from './interaction-mode.mjs';

const execute = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const readJSON = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

function removeLegacyDuplicate(home, runtime, connection) {
  const file = path.join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
  if(!existsSync(file))return {};
  const raw=readFileSync(file,'utf8'); let config;
  try{config=JSON.parse(raw);}catch{return {legacyConfigurationPreserved:true};}
  const entry=config.mcpServers?.['opensky-computer-use']; if(!entry)return {};
  if(entry.command!==connection.command || JSON.stringify(entry.args||[])!==JSON.stringify(connection.args) || Object.keys(entry.env||{}).length) return {legacyConfigurationPreserved:true};
  const date=new Date().toLocaleDateString('sv-SE'),folder=path.join(runtime,`${date}-claude-setup-Codex`);
  mkdirSync(folder,{recursive:true,mode:0o700});
  writeFileSync(path.join(folder,`${date}-claude-desktop-${randomUUID()}-backup-Codex.json`),raw,{mode:0o600,flag:'wx'});
  delete config.mcpServers['opensky-computer-use'];
  const temporary=file+'.opensky-'+randomUUID()+'.tmp';
  try {
    writeFileSync(temporary,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
    if(readFileSync(file,'utf8')!==raw)return {legacyConfigurationPreserved:true,nextStep:'Claude configuration changed during setup. Re-run to check the duplicate; the concurrent changes were preserved.'};
    renameSync(temporary,file);return {legacyDuplicateRemoved:true};
  } finally {rmSync(temporary,{force:true});}
}

// Read only the selected extension's public manifest and enable/config metadata.
// Unsupported Claude storage layouts remain unknown; never edit its registry.
export function desktopConnection(home, runtime) {
  const base = path.join(home, 'Library/Application Support/Claude');
  const extensions = readJSON(path.join(base, 'extensions-installations.json'))?.extensions;
  if (!extensions || Array.isArray(extensions)) return { status: 'not_detected' };
  for (const [id, metadata] of Object.entries(extensions)) {
    if (metadata?.manifest?.name !== 'opensky-computer-use' || !/^[a-zA-Z0-9._-]+$/.test(id)) continue;
    const directory = path.join(base, 'Claude Extensions', id);
    const manifest = readJSON(path.join(directory, 'manifest.json'));
    const settings = readJSON(path.join(base, 'Claude Extensions Settings', id + '.json'));
    const entry = manifest?.server?.entry_point;
    if (!entry || path.resolve(directory, entry) !== path.join(directory, 'server/index.mjs')) return { status: 'unknown' };
    const selected = settings?.userConfig?.runtime_directory || manifest?.server?.mcp_config?.env?.OPENSKY_HOME;
    const defaultRuntime = path.join(home, '.local/share/opensky');
    const effective = !selected || selected === '${user_config.runtime_directory}' ? defaultRuntime : selected;
    const sameRuntime = typeof effective === 'string' && path.resolve(effective) === runtime;
    let currentAdapter = false;
    try { currentAdapter = hash(readFileSync(path.join(directory, entry))) === hash(readFileSync(path.join(runtime, 'extensions/claude-desktop/server.mjs'))); } catch {}
    return { status: settings?.isEnabled === true && sameRuntime && currentAdapter ? 'enabled' : 'needs_review',
      installed: true, enabled: settings?.isEnabled === true, sameRuntime, currentAdapter, version: manifest.version };
  }
  return { status: 'not_detected' };
}

export async function connectClaude({ runtime, home = os.homedir(), dryRun = false, openDesktop = true, skipDesktop = false,
  claudeConfigDirectory = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'),
  run = (command, args) => execute(command, args, { cwd: home, timeout: 15000, maxBuffer: 1024 * 1024 }),
  reveal = file => { const application = existsSync('/Applications/Claude.app') ? '/Applications/Claude.app' : path.join(home, 'Applications/Claude.app'); const child = spawn('/usr/bin/open', ['-g', '-a', application, file], { detached: true, stdio: 'ignore' }); child.on('error', () => {}); child.unref(); },
  desktopAvailable = existsSync('/Applications/Claude.app') || existsSync(path.join(home, 'Applications/Claude.app')),
  build = buildClaudeExtension
} = {}) {
  runtime = path.resolve(runtime || process.env.OPENSKY_HOME || path.join(home, '.local/share/opensky'));
  const installed = readJSON(path.join(runtime, '.opensky-install.json'));
  if (installed?.product !== 'opensky-computer-use' || installed.runtime !== runtime) throw Error('Install OpenSky first; connect reuses a managed installation.');
  const launcher = installed.launchers?.find(file => path.basename(file) === 'opensky-mcp');
  const connection = connectionCommand({ root: runtime, binDir: launcher ? path.dirname(launcher) : path.resolve(runtime, '../../bin') });
  const claude = existsSync(path.join(home, '.local/bin/claude')) ? path.join(home, '.local/bin/claude') : 'claude';
  const result = { ok: true, claudeCode: { status: 'not_detected' }, skill: { status: 'unchanged' },
    desktop: skipDesktop ? {status:'skipped'} : desktopAvailable ? desktopConnection(home, runtime) : { status: 'not_installed' },
    nativeAppChanged: false, permissionsChanged: false, cooperationChanged: false, dryRun };
  if (dryRun) {
    result.claudeCode.status='not_checked';
    result.plan = ['Register the installed MCP server with Claude Code in user scope if available', 'Install the OpenSky operating skill',
      'Reuse the enabled Desktop extension, or prepare a preconfigured bundle for its native review'];
    return result;
  }
  const skillSource = path.join(runtime, 'skills/opensky-computer-use/SKILL.md');
  // Managed runtimes before this connector did not include skills. Source installs
  // now copy them so a later connect has no dependency on a development checkout.
  if (!existsSync(skillSource)) throw Error('Update OpenSky with its current installer so the bundled Claude skill is available.');
  const skillDirectory = path.join(claudeConfigDirectory, 'skills/opensky-computer-use');
  const target = path.join(skillDirectory, 'SKILL.md');
  const source = readFileSync(skillSource);
  if (existsSync(target) && !/^name:\s*opensky-computer-use\s*$/m.test(readFileSync(target, 'utf8'))) throw Error('An unrelated skill occupies the OpenSky skill name; it was preserved.');
  if (!existsSync(target) || hash(readFileSync(target)) !== hash(source)) {
    mkdirSync(skillDirectory, { recursive: true });
    if (existsSync(target)) {
      const date = new Date().toLocaleDateString('sv-SE');
      const backupDirectory = path.join(runtime, `${date}-claude-setup-Codex`);
      mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
      const backup = path.join(backupDirectory, `${date}-opensky-skill-${randomUUID()}-backup-Codex.md`);
      copyFileSync(target, backup); chmodSync(backup, 0o600);
    }
    writeFileSync(target, source, { mode: 0o600 });
    result.skill.status = 'installed';
  } else result.skill.status = 'current';

  let prior;
  try { prior = await run(claude, ['mcp', 'get', 'opensky-computer-use']); }
  catch (error) {
    if (error.code === 'ENOENT') result.claudeCode = { status: 'not_installed' };
    else if (/No MCP server (?:found|named)|not found|does not exist/i.test((error.stdout || '') + (error.stderr || '') + error.message)) prior = null;
    else result.claudeCode = { status: 'check_failed', nextStep: 'Run claude mcp get opensky-computer-use to inspect the client error.' };
  }
  if (prior) {
    const command = prior.stdout.match(/^[ \t]*Command:[ \t]*(.*)$/m)?.[1]?.trim();
    const args = prior.stdout.match(/^[ \t]*Args:[ \t]*([^\n]*)/m)?.[1]?.trim() || '';
    if (command === connection.command && args === connection.args.join(' ')) result.claudeCode = { status: /Connected/.test(prior.stdout) ? 'connected' : 'connection_failed' };
    else result.claudeCode = { status: 'different_server_preserved', nextStep: 'The existing OpenSky server points elsewhere. Review it before replacing it.' };
  } else if (result.claudeCode.status === 'not_detected') {
    try {
      await run(claude, ['mcp', 'add', '--transport', 'stdio', '--scope', 'user', 'opensky-computer-use', '--', connection.command, ...connection.args]);
      const health = await run(claude, ['mcp', 'get', 'opensky-computer-use']);
      result.claudeCode = { status: /Connected/.test(health.stdout) ? 'connected' : 'connection_failed' };
    } catch { result.claudeCode = { status: 'setup_failed', nextStep: 'Inspect Claude Code with claude mcp get opensky-computer-use; no existing server was removed.' }; }
  }

  if(desktopAvailable && result.desktop.status==='enabled')Object.assign(result.desktop,removeLegacyDuplicate(home,runtime,connection));
  if (!skipDesktop && desktopAvailable && result.desktop.status !== 'enabled') {
    const folder = path.join(runtime, `${new Date().toLocaleDateString('sv-SE')}-claude-setup-Codex`);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const version = readJSON(path.join(runtime, 'package.json')).version;
    const fingerprint = hash(version + runtime + readFileSync(path.join(runtime, 'extensions/claude-desktop/server.mjs'), 'utf8')).slice(0, 12);
    const file = path.join(folder, `${new Date().toLocaleDateString('sv-SE')}-opensky-${version}-claude-${fingerprint}-Codex.mcpb`);
    if (!existsSync(file))try{build(file, { runtimeDirectory: runtime });}catch(error){if(error.code!=='EEXIST'||!existsSync(file))throw error;}
    const mode = readInteractionMode(runtime);
    const mayOpen = mode.ok && (mode.effective_mode || mode.interaction_mode) === 'desktop';
    if (openDesktop && mayOpen) reveal(file);
    result.desktop = { ...result.desktop, status: 'review_required', bundle: file, installerRequested: openDesktop && mayOpen,
      nextStep: 'Review OpenSky in Claude Desktop, install it and enable its toggle. The runtime path is already configured. Re-run this command to check setup.',
      ...(openDesktop && !mayOpen ? { deferredForOwnerActivity: true } : {}) };
  }
  if(result.claudeCode.status==='connection_failed') result.claudeCode.nextStep='Claude Code did not pass its MCP connection check. Run claude mcp get opensky-computer-use for its current error.';
  result.ok = ['connected', 'not_installed'].includes(result.claudeCode.status) && ['enabled', 'skipped', 'not_installed', 'review_required'].includes(result.desktop.status);
  result.complete = ['connected', 'not_installed'].includes(result.claudeCode.status) && ['enabled', 'skipped', 'not_installed'].includes(result.desktop.status);
  if (result.claudeCode.status === 'not_installed' && ['not_installed','skipped'].includes(result.desktop.status)) { result.ok = false; result.complete = false; }
  return result;
}
