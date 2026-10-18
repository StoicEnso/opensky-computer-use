import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync, linkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
export function buildClaudeExtension(destination, { runtimeDirectory } = {}) {
  if (process.platform !== 'darwin') throw Error('This extension targets the macOS OpenSky engine.');
  destination = path.resolve(destination);
  if (existsSync(destination)) throw Error('Refusing to replace an existing extension archive.');
  if (runtimeDirectory && !path.isAbsolute(runtimeDirectory)) throw Error('The runtime directory must be absolute.');
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'opensky-claude-extension-'));
  let archive;
  try {
    mkdirSync(path.join(temporary, 'server'));
    copyFileSync(path.join(root, 'extensions/claude-desktop/server.mjs'), path.join(temporary, 'server/index.mjs'));
    copyFileSync(path.join(root, 'assets/2026-10-17-opensky-brand-Codex/2026-10-17-opensky-icon-Codex.png'), path.join(temporary, 'icon.png'));
    copyFileSync(path.join(root, 'LICENSE'), path.join(temporary, 'LICENSE'));
    const manifest = {
      manifest_version: '0.3', name: 'opensky-computer-use', display_name: 'OpenSky', version,
      description: 'Native Mac and background Chrome control through your installed OpenSky engine.',
      long_description: 'Connect Claude to the existing OpenSky app: app controls, screenshots, on-device OCR, animated pointers, background Chrome tabs and uploads. Requires a separately installed OpenSky engine with its normal macOS permissions. Uses the same emergency stop, saved cooperation mode and local credentials. No built-in telemetry or cloud relay; observations are sent to Claude and captures can persist locally. Applicable agent rules and actual task authority still apply.',
      author: { name: 'StoicEnso', url: 'https://github.com/StoicEnso' },
      repository: { type: 'git', url: 'https://github.com/StoicEnso/opensky-computer-use' },
      homepage: 'https://github.com/StoicEnso/opensky-computer-use',
      documentation: 'https://github.com/StoicEnso/opensky-computer-use#connect-an-agent',
      support: 'https://github.com/StoicEnso/opensky-computer-use/issues',
      icon: 'icon.png', license: 'MIT',
      privacy_policies: ['https://github.com/StoicEnso/opensky-computer-use/blob/main/PRIVACY.md'],
      server: { type: 'node', entry_point: 'server/index.mjs', mcp_config: {
        command: 'node', args: ['${__dirname}/server/index.mjs'], env: { OPENSKY_HOME: runtimeDirectory || '${user_config.runtime_directory}' }
      } },
      tools_generated: true,
      compatibility: { platforms: ['darwin'], runtimes: { node: '>=22.0.0' } },
      ...(!runtimeDirectory ? { user_config: { runtime_directory: { type: 'string', title: 'Custom OpenSky installation (optional)',
        description: 'Leave empty for the normal ~/.local/share/opensky installation. For a custom installation, enter its absolute runtime directory.',
        default: '', required: false } } } : {})
    };
    writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    mkdirSync(path.dirname(destination), { recursive: true });
    archive = path.join(path.dirname(destination), '.opensky-' + randomUUID() + '.mcpb');
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', temporary, archive]);
    // Readers see a complete archive; a competing setup cannot replace it.
    linkSync(archive, destination);
    return { destination, version, nativeAppBundled: false, requiresExistingInstallation: true };
  } finally { if(archive)rmSync(archive,{force:true});rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('Pass a dated absolute output .mcpb path.');
  console.log(JSON.stringify(buildClaudeExtension(process.argv[2])));
}
