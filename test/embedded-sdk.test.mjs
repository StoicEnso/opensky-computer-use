import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('SDK imports in embedded Node hosts without a process global', () => {
  const source = `
    globalThis.process = undefined;
    const sdk = await import(${JSON.stringify(new URL('../src/index.mjs', import.meta.url).href)});
    if (sdk.DEFAULT_PORT !== 43821 || !sdk.OPENSKY_HOME.endsWith('/.local/share/opensky')) throw new Error('Missing embedded defaults');
    if (typeof sdk.computer_use.get_app_state !== 'function') throw new Error('Missing SDK');
  `;
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--input-type=module', '-e', source]));
});
