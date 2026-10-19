import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {browserSettings,browserToken,browserPaused,writeBrowserPaused,BROWSER_SERVICE,BROWSER_PROTOCOL,browserReads} from './settings.mjs';
import {trackAgentOperation} from '../agent-activity.mjs';

const settings=browserSettings();
export async function browserBridgeStatus() {
  const token=browserToken(settings);if(!token)return {ok:false,connected:false,error_code:'browser_setup_required',error:'Install the OpenSky Chrome extension and native host with opensky web install.'};
  try{const response=await fetch(settings.url+'/status',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(1000)});const state=await response.json();if(!response.ok||state.service!==BROWSER_SERVICE||state.protocol!==BROWSER_PROTOCOL)throw new Error('Incompatible browser bridge or credentials.');return state;}
  catch(error){return {ok:false,connected:false,error_code:'browser_bridge_unavailable',error:error.message};}
}
export async function ensureBrowserBridge() {
  const current=await browserBridgeStatus();if(current.service===BROWSER_SERVICE)return current;
  browserToken(settings,true);
  const log=fs.openSync(path.join(settings.home,'browser-bridge.log'),'a',0o600);
  const child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{detached:true,stdio:['ignore',log,log],env:process.env});fs.closeSync(log);child.on('error',()=>{});child.unref();
  const deadline=Date.now()+3000;
  while(Date.now()<deadline){const state=await browserBridgeStatus();if(state.service===BROWSER_SERVICE)return state;await new Promise(r=>setTimeout(r,75));}
  throw new Error('OpenSky browser bridge did not start. Check browser-bridge.log.');
}
export async function browserRequest(method,params={}) {
  return trackAgentOperation(settings.home,`browser.${method}`,()=>performBrowserRequest(method,params));
}
async function performBrowserRequest(method,params={}) {
  if(method==='status')return browserBridgeStatus();
  if(!browserReads.has(method)&&browserPaused(settings))return {ok:false,error_code:'stopped',error:'OpenSky browser control is paused. Resume explicitly before new input.'};
  const state=await ensureBrowserBridge();
  if(!state.connected)return {ok:false,error_code:'browser_extension_disconnected',error:'The OpenSky Chrome extension is not connected. Run opensky web install for the one-time setup; no browser or OS dialog was opened.'};
  try {
    const response=await fetch(settings.url+'/rpc',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${browserToken(settings)}`},body:JSON.stringify({method,params}),signal:AbortSignal.timeout(45000)});
    return await response.json();
  } catch(error){return {ok:false,error_code:'browser_request_uncertain',error:error.message,outcome:browserReads.has(method)?'Observation unavailable.':'Input may have been delivered. Inspect before repeating; no automatic retry was sent.'};}
}
export async function setBrowserPaused(paused) {
  const token=browserToken(settings);if(!token)return;
  writeBrowserPaused(settings,paused);
  try{await fetch(settings.url+'/pause',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({paused}),signal:AbortSignal.timeout(500)});}catch{/* Persisted choice is checked when the bridge starts. */}
}
export async function shutdownBrowserBridge() {
  const token=browserToken(settings);if(!token)return {ok:true,running:false};
  const state=await browserBridgeStatus();if(state.service!==BROWSER_SERVICE)return {ok:true,running:false};
  const response=await fetch(settings.url+'/shutdown',{method:'POST',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(1500)});return response.json();
}
