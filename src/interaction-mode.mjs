import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const filename = 'interaction-mode.json';
const modes = new Set(['desktop', 'alongside']);

/** Shared by new MCP, CLI and SDK calls; never starts or resumes the engine. */
export function readInteractionMode(home) {
  try {
    const state = JSON.parse(readFileSync(path.join(home, filename), 'utf8'));
    if (!modes.has(state.mode)) throw new Error('Invalid interaction mode');
    return { ok: true, interaction_mode: state.mode };
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, interaction_mode: 'desktop' };
    return { ok: false, error_code: 'invalid_interaction_mode', error: 'Cannot read OpenSky interaction mode. Inspect or repair interaction-mode.json before sending input.' };
  }
}

export function writeInteractionMode(home, mode) {
  if (!modes.has(mode)) return { ok: false, error_code: 'invalid_interaction_mode', error: 'Use alongside or desktop.' };
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const temporary = path.join(home, `.${filename}.${randomUUID()}`);
  try {
    writeFileSync(temporary, JSON.stringify({ mode, updated_at: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path.join(home, filename));
  } finally { rmSync(temporary, { force: true }); }
  return { ok: true, interaction_mode: mode, message: mode === 'alongside'
    ? 'Alongside mode: background AX actions only. Defer shared-input steps and continue independent work; no permission question is needed for each deferred step.'
    : 'Desktop mode: execution modes may use shared keyboard, pointer and clipboard. Use only when the owner has made the desktop available.' };
}

const direct = new Set(['click', 'set_value', 'perform_secondary_action', 'select_text']);
const shared = new Set(['drag', 'scroll', 'type_text', 'press_key', 'paste', 'manage_window', 'run_applescript']);
const observations = new Set(['get_app_state']);

function deferred(method, reason, error_code = 'desktop_turn_required') {
  return { ok: false, error_code, deferred: true, interaction_mode: 'alongside', method,
    error: reason,
    next_step: 'Use a fresh exact-window AX control or direct field value; otherwise save this checkpoint and continue independent authorized work. Do not ask for each deferred step, retry input blindly, or switch to desktop mode while the owner is working.' };
}

/** A cooperation preference, not an authority boundary or a native input sandbox. */
export function prepareInteraction(home, method, params) {
  // Emergency controls and passive service checks must survive a damaged mode file.
  if (['stop', 'resume', 'shutdown', 'status'].includes(method)) return { params };
  const state = readInteractionMode(home);
  if (!state.ok) return { result: state };
  if (state.interaction_mode !== 'alongside') return { params };
  if (method === 'inspector' && params.activate === true) {
    return {result:deferred(method,'Open the Inspector without activation while working alongside the owner.')};
  }
  if (observations.has(method) && !Number.isInteger(params.window_id)) {
    return { result: deferred(method, 'Alongside inspection needs the exact task-owned window_id from list_apps.', 'window_required') };
  }
  if (shared.has(method)) return { result: deferred(method, 'This method uses shared desktop input or app keyboard focus. Alongside mode defers it without sending input.') };
  if (direct.has(method)) {
    if (params.mode && params.mode !== 'background') return { result: deferred(method, 'Foreground fallback is disabled in alongside mode. Use background AX actions.') };
    if (!params.app || !Number.isInteger(params.element_index) || !params.snapshot_id) {
      return { result: deferred(method, 'Use an app, element_index and snapshot_id from a fresh observation of the exact task-owned window.', 'fresh_target_required') };
    }
    return { params: { ...params, mode: 'background' } };
  }
  return { params };
}
