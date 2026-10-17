import { cpSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const present = file => { try { lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

/** Replace only prevalidated managed paths; roll every completed replacement back on failure. */
export function replaceManagedFiles(files) {
  const changes = [];
  try {
    for (const { source, destination } of files) {
      mkdirSync(path.dirname(destination), { recursive: true });
      const suffix = randomUUID();
      const staged = path.join(path.dirname(destination), `.opensky-new-${suffix}`);
      const backup = path.join(path.dirname(destination), `.opensky-backup-${suffix}`);
      const change = { destination, staged, backup, moved: false, installed: false };
      changes.push(change);
      // Stage on the destination filesystem before moving any existing item.
      cpSync(source, staged, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
      if (present(destination)) { renameSync(destination, backup); change.moved = true; }
      renameSync(staged, destination); change.installed = true;
    }
  } catch (error) {
    const recovery = [];
    for (const change of changes.reverse()) {
      try {
        if (change.installed) rmSync(change.destination, { recursive: true, force: true });
        if (change.moved) renameSync(change.backup, change.destination);
        rmSync(change.staged, { recursive: true, force: true });
      } catch { recovery.push(change.backup); }
    }
    if (recovery.length) throw new Error(`Install failed: ${error.message}. Recovery copies remain at: ${recovery.join(', ')}`, { cause: error });
    throw error;
  }
  for (const change of changes) {
    if (existsSync(change.backup) || present(change.backup)) rmSync(change.backup, { recursive: true, force: true });
  }
}
