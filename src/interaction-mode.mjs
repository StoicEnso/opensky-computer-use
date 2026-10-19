import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {readUserActivity} from './user-activity.mjs';

const filename = 'interaction-mode.json';
const modes = new Set(['desktop', 'alongside', 'auto']);
export const AUTO_IDLE_SECONDS=120;

function resolveAuto(activityProbe,home) {
  let activity;try{activity=activityProbe({home});}catch{activity={ok:false,idle_seconds:null,error_code:'user_activity_unavailable'};}
  const idle=activity.ok===true&&Number.isFinite(activity.idle_seconds)&&activity.idle_seconds>=AUTO_IDLE_SECONDS;
  return {ok:true,interaction_mode:'auto',effective_mode:idle?'desktop':'alongside',idle_threshold_seconds:AUTO_IDLE_SECONDS,user_activity:activity};
}

/** Shared by new MCP, CLI and SDK calls; never starts or resumes the engine. */
export function readInteractionMode(home,{activityProbe=readUserActivity,now=Date.now}={}) {
  try {
    const state = JSON.parse(readFileSync(path.join(home, filename), 'utf8'));
    if (!modes.has(state.mode)) throw new Error('Invalid interaction mode');
    const saved = (state.mode==='auto'||state.mode==='alongside'&&state.cooperation_policy==='auto')
      ? resolveAuto(activityProbe,home):{ ok: true, interaction_mode: state.mode };
    if(state.desktop_override_until!==undefined) {
      if(!Number.isFinite(state.desktop_override_until))throw Error('Invalid desktop override');
      if(now()<state.desktop_override_until)return {...saved,effective_mode:'desktop',desktop_override:true,desktop_override_until:new Date(state.desktop_override_until).toISOString(),message:'Temporary desktop turn under explicit owner direction. The saved cooperation mode resumes automatically at expiry; emergency pause remains in force.'};
    }
    return saved;
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, interaction_mode: 'desktop' };
    return { ok: false, error_code: 'invalid_interaction_mode', error: 'Cannot read OpenSky interaction mode. Inspect or repair interaction-mode.json before sending input.' };
  }
}

export function writeInteractionMode(home, mode, {durationSeconds}={}) {
  if (!modes.has(mode)) return { ok: false, error_code: 'invalid_interaction_mode', error: 'Use alongside, desktop or auto.' };
  if(durationSeconds!==undefined) {
    if(mode!=='desktop'||!Number.isInteger(durationSeconds)||durationSeconds<1||durationSeconds>3600)return {ok:false,error_code:'invalid_interaction_mode',error:'A temporary desktop turn needs mode desktop and duration_seconds from 1 to 3600. Use only after explicit owner direction.'};
    let saved={mode:'desktop'};
    try{saved=JSON.parse(readFileSync(path.join(home,filename),'utf8'));if(!modes.has(saved.mode))throw Error('Invalid mode');}
    catch(error){if(error.code!=='ENOENT')return {ok:false,error_code:'invalid_interaction_mode',error:'Repair the saved mode before requesting a temporary desktop turn.'};}
    mkdirSync(home,{recursive:true,mode:0o700});
    const temporary=path.join(home,`.${filename}.${randomUUID()}`);
    try{writeFileSync(temporary,JSON.stringify({...saved,desktop_override_until:Date.now()+durationSeconds*1000,updated_at:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});renameSync(temporary,path.join(home,filename));}
    finally{rmSync(temporary,{force:true});}
    return readInteractionMode(home);
  }
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const temporary = path.join(home, `.${filename}.${randomUUID()}`);
  try {
    // Older MCP processes understand alongside but reject an unknown auto mode.
    // Keep their background path working while fresh clients resolve the policy.
    writeFileSync(temporary, JSON.stringify({ mode:mode==='auto'?'alongside':mode,...(mode==='auto'?{cooperation_policy:'auto'}:{}), updated_at: new Date().toISOString(), ...(Number.isSafeInteger(globalThis.process?.pid)?{updated_by_pid:globalThis.process.pid}:{}), ...(Number.isSafeInteger(globalThis.process?.ppid)?{updated_by_parent_pid:globalThis.process.ppid}:{}) }) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path.join(home, filename));
  } finally { rmSync(temporary, { force: true }); }
  return { ...readInteractionMode(home), message: mode==='auto'
    ? 'Auto cooperation: shared desktop input is available after 120 seconds of filtered external-input idle time. Activity or an unavailable idle signal restores alongside restrictions on the next request. This never resumes an emergency pause; an input already delivered may finish.'
    : mode === 'alongside'
    ? 'Alongside mode: background AX actions only. Defer shared-input steps and continue independent work; no permission question is needed for each deferred step.'
    : 'Desktop mode: execution modes may use shared keyboard, pointer and clipboard. Use only when the owner has made the desktop available.' };
}

const direct = new Set(['click', 'set_value', 'perform_secondary_action', 'select_text']);
const shared = new Set(['drag', 'scroll', 'type_text', 'press_key', 'paste', 'manage_window', 'run_applescript']);
const observations = new Set(['get_app_state']);

function deferred(method, reason, error_code = 'desktop_turn_required') {
  return { ok: false, error_code, deferred: true, interaction_mode: 'alongside', method,
    error: reason,
    next_step: 'Use a fresh exact-window AX control or direct field value; otherwise save this checkpoint and continue independent authorized work. If the owner explicitly directed desktop use now, request a bounded interaction_mode desktop turn with duration_seconds and return to the saved mode when finished. The idle threshold is a default scheduling preference. Do not ask for each deferred step or retry uncertain input blindly.' };
}

/** A cooperation preference, not an authority boundary or a native input sandbox. */
export function prepareInteraction(home, method, params, options) {
  // Emergency controls and passive service checks must survive a damaged mode file.
  if (['stop', 'resume', 'shutdown', 'status'].includes(method)) return { params };
  const state = readInteractionMode(home,options);
  if (!state.ok) return { result: state };
  if ((state.effective_mode??state.interaction_mode) !== 'alongside') return { params };
  const defer=(...args)=>({...deferred(...args),...(state.interaction_mode==='auto'
    ? {interaction_mode:'auto',effective_mode:'alongside',idle_threshold_seconds:AUTO_IDLE_SECONDS,user_activity:state.user_activity}: {})});
  if (method === 'inspector' && params.activate === true) {
    return {result:defer(method,'Open the Inspector without activation while working alongside the owner.')};
  }
  if(method==='agent_activity'&&params.action==='show') {
    return {result:defer(method,'The menu-bar activity panel uses shared foreground UI. Its passive summary remains available through agent_activity or opensky agents.')};
  }
  if (observations.has(method) && !Number.isInteger(params.window_id)) {
    return { result: defer(method, 'Alongside inspection needs the exact task-owned window_id from list_apps.', 'window_required') };
  }
  if (shared.has(method)) return { result: defer(method, 'This method uses shared desktop input or app keyboard focus. Alongside mode defers it without sending input.') };
  if (direct.has(method)) {
    if (params.mode && params.mode !== 'background') return { result: defer(method, 'Foreground fallback is disabled in alongside mode. Use background AX actions.') };
    if (!params.app || !Number.isInteger(params.element_index) || !params.snapshot_id) {
      return { result: defer(method, 'Use an app, element_index and snapshot_id from a fresh observation of the exact task-owned window.', 'fresh_target_required') };
    }
    return { params: { ...params, mode: 'background' } };
  }
  return { params };
}
