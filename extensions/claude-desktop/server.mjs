import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Use the existing installation: its native identity, token, stop and mode stay shared.
try {
  const requested = process.env.OPENSKY_HOME || path.join(os.homedir(), '.local/share/opensky');
  if (!path.isAbsolute(requested)) throw Error('The OpenSky runtime directory must be an absolute path.');
  const home = path.resolve(requested);
  const manifest = JSON.parse(readFileSync(path.join(home, '.opensky-install.json'), 'utf8'));
  const product = JSON.parse(readFileSync(path.join(home, 'package.json'), 'utf8'));
  const entry = path.join(home, 'src/mcp-server.mjs');
  if (manifest.product !== 'opensky-computer-use' || manifest.runtime !== home || product.name !== 'opensky-computer-use' || !existsSync(entry)) {
    throw Error('Choose a managed OpenSky installation.');
  }
  process.env.OPENSKY_HOME = home;
  if (!process.env.OPENSKY_BINARY && typeof manifest.app === 'string' && path.isAbsolute(manifest.app)) {
    process.env.OPENSKY_BINARY = path.join(manifest.app, 'Contents/MacOS/OpenSky');
  }
  await import(pathToFileURL(entry).href);
} catch (error) {
  console.error('OpenSky Desktop extension: install OpenSky first, or select its runtime directory in extension settings. ' + error.message);
  process.exitCode = 1;
}
