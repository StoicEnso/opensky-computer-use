import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {OpenSkyError} from './session.mjs';

const actions = new Set(['list','open','navigate','select','close','enable']);
const setupPath = home => path.join(home,'chrome-automation.json');
export function chromeAutomationEnabled(home) {
  try { return JSON.parse(readFileSync(setupPath(home),'utf8')).enabled === true; } catch { return false; }
}

function validate(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new OpenSkyError('invalid_argument','Chrome parameters must be an object.');
  const allowed = new Set(['action','tab_id','chrome_window_id','url','new_window','activate']);
  for (const key of Object.keys(params)) if (!allowed.has(key)) throw new OpenSkyError('invalid_argument',`Unknown Chrome parameter: ${key}`);
  const request = {action:'list',...params};
  if (!actions.has(request.action)) throw new OpenSkyError('invalid_action','Use list, open, navigate, select, close or enable.');
  for (const key of ['tab_id','chrome_window_id']) {
    if (request[key] === undefined) continue;
    if (!['number','string'].includes(typeof request[key]) || !/^\d+$/.test(String(request[key])) || String(request[key]).length > 20) throw new OpenSkyError('invalid_id',`${key} must be an observed Chrome ID.`);
    request[key] = String(request[key]);
  }
  for (const key of ['new_window','activate']) if (request[key] !== undefined && typeof request[key] !== 'boolean') throw new OpenSkyError('invalid_argument',`${key} must be boolean.`);
  if (['navigate','select','close'].includes(request.action) && !request.tab_id) throw new OpenSkyError('missing_tab','An exact tab_id from Chrome discovery is required.');
  if (['open','navigate'].includes(request.action)) {
    if (typeof request.url !== 'string' || !request.url.trim() || request.url.length > 32768) throw new OpenSkyError('invalid_url','Provide an absolute destination URL.');
    try { new URL(request.url); } catch { throw new OpenSkyError('invalid_url','Provide an absolute destination URL.'); }
  }
  if (request.action === 'open') {
    request.new_window ??= !request.chrome_window_id;
    if (request.new_window && request.chrome_window_id) throw new OpenSkyError('invalid_argument','Choose new_window or an existing chrome_window_id.');
    if (!request.new_window && !request.chrome_window_id) throw new OpenSkyError('missing_window','Opening a tab in an existing window requires its exact chrome_window_id.');
  }
  return request;
}

/** Uses Chrome's public scripting dictionary; never enables page JavaScript execution. */
export function buildChromeScript(params) {
  const request = validate(params);
  const encoded = JSON.stringify(request).replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
  return `(function(request) {
    var chrome = Application('com.google.Chrome');
    function fail(code,message) { return {ok:false,error_code:code,error:message}; }
    if (!chrome.running()) return JSON.stringify(fail('chrome_not_running','Open the existing Google Chrome profile first.'));
    function windows() { return chrome.windows(); }
    function windowById(id) {
      var found = windows().filter(function(w) { return String(w.id()) === id; });
      return found.length === 1 ? found[0] : null;
    }
    function info(w,t,index) { return {tab_id:String(t.id()),chrome_window_id:String(w.id()),tab_index:index+1,active:w.activeTabIndex()===index+1,title:String(t.title()),url:String(t.url()),loading:!!t.loading(),window_title:String(w.name())}; }
    function records(w) { return w.tabs().map(function(t,i) { return info(w,t,i); }); }
    var selectedWindow = request.chrome_window_id ? windowById(request.chrome_window_id) : null;
    if (request.chrome_window_id && !selectedWindow) return JSON.stringify(fail('chrome_window_unavailable','The exact Chrome window no longer exists. Rediscover; no substitute was selected.'));
    if (request.action === 'list' || request.action === 'enable') {
      var tabs = [];
      (selectedWindow ? [selectedWindow] : windows()).forEach(function(w) { tabs = tabs.concat(records(w)); });
      return JSON.stringify({ok:true,tabs:tabs});
    }
    if (request.action === 'open') {
      var win,tab;
      if (request.new_window) {
        win = chrome.Window(); chrome.windows.push(win); tab = win.activeTab(); tab.url = request.url;
      } else { win = selectedWindow; tab = chrome.Tab({url:request.url}); win.tabs.push(tab); }
      if (request.activate) chrome.activate();
      var created = records(win).filter(function(t) { return t.tab_id === String(tab.id()); });
      return JSON.stringify({ok:true,tab:created[0],navigation_requested:true});
    }
    var matches = [];
    (selectedWindow ? [selectedWindow] : windows()).forEach(function(w) { w.tabs().forEach(function(t,i) { if (String(t.id()) === request.tab_id) matches.push({w:w,t:t,index:i}); }); });
    if (matches.length !== 1) return JSON.stringify(fail('chrome_tab_unavailable','The exact tab no longer exists. Rediscover; no substitute was selected.'));
    var target = matches[0];
    if (request.action === 'close') {
      target.t.close();
      var remaining = [];
      windows().forEach(function(w) { remaining = remaining.concat(records(w)); });
      if (remaining.some(function(t) { return t.tab_id === request.tab_id; })) return JSON.stringify(fail('chrome_close_unconfirmed','The tab is still present; inspect before retrying.'));
      return JSON.stringify({ok:true,closed_tab_id:request.tab_id});
    }
    if (request.action === 'navigate') target.t.url = request.url;
    if (request.action === 'select') target.w.activeTabIndex = target.index + 1;
    if (request.activate) chrome.activate();
    return JSON.stringify({ok:true,tab:info(target.w,target.t,target.index),navigation_requested:request.action==='navigate'});
  })(${encoded});`;
}

export async function performChromeTabs(computer, params, {home}) {
  const request = validate(params);
  // Optional integration setup is deliberate: normal native AX work never asks
  // for Apple Events access just because an agent discovers browser tools.
  if (request.action !== 'enable' && !chromeAutomationEnabled(home)) return {
    ok:false,error_code:'chrome_setup_required',
    error:'Optional Chrome tab automation is not enabled. Native Accessibility control remains available. Enable it once from opensky onboard, or explicitly run opensky browser enable; macOS may ask for Automation access.'
  };
  const result = await computer.run_applescript({language:'jxa',script:buildChromeScript(request)});
  if (!result.ok) return {ok:false,error_code:'chrome_automation_failed',error:result.output || result.error || 'Chrome automation failed.',outcome:'unknown; inspect the target before repeating a mutation'};
  let output;
  try { output = JSON.parse(result.output); } catch { return {ok:false,error_code:'chrome_response_invalid',error:'Chrome returned an unreadable response. Inspect the target before repeating any mutation.'}; }
  if (request.action === 'enable' && output.ok) {
    mkdirSync(home,{recursive:true,mode:0o700});
    writeFileSync(setupPath(home),JSON.stringify({enabled:true,verifiedAt:new Date().toISOString()})+'\n',{mode:0o600});
    return {ok:true,enabled:true,tab_count:output.tabs.length};
  }
  return output;
}
