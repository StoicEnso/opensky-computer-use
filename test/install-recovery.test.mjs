import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, readlinkSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { replaceManagedFiles } from '../scripts/install-transaction.mjs';

test('a mid-upgrade failure restores old runtime files and launcher symlinks', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), '2026-10-17-opensky-recovery-Codex-'));
  try {
    const file = name => path.join(root, name);
    writeFileSync(file('runtime'), 'old working runtime');writeFileSync(file('new'), 'new runtime');symlinkSync('/previous/launcher', file('launcher'));
    assert.throws(() => replaceManagedFiles([
      { source: file('new'), destination: file('runtime') },
      { source: file('new'), destination: file('launcher') },
      { source: file('missing-source'), destination: file('manifest') }
    ]), /ENOENT/);
    assert.equal(readFileSync(file('runtime'), 'utf8'), 'old working runtime');
    assert.equal(readlinkSync(file('launcher')), '/previous/launcher');
    assert.equal(readdirSync(root).some(name => name.startsWith('.opensky-')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('successful upgrades replace the managed paths and remove recovery copies', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), '2026-10-17-opensky-recovery-Codex-'));
  try {
    const old = path.join(root, 'old'), fresh = path.join(root, 'fresh');writeFileSync(old, 'v1');writeFileSync(fresh, 'v2');
    replaceManagedFiles([{ source: fresh, destination: old }]);
    assert.equal(readFileSync(old, 'utf8'), 'v2');assert.equal(readdirSync(root).length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
