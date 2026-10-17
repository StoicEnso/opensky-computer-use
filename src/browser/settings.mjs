import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';

export const BROWSER_SERVICE='OpenSky Browser Bridge';
export const BROWSER_PROTOCOL=1;
export const EXTENSION_ID='opgiiekonjaanhocifjmjkfjphknjbem';
export const HOST_NAME='dev.opensky.browser';
export function browserSettings(env=globalThis.process?.env??{}) {
  const home=env.OPENSKY_HOME||path.join(os.homedir(),'.local/share/opensky');
  const port=Number(env.OPENSKY_BROWSER_PORT||43822);
  if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Invalid OPENSKY_BROWSER_PORT.');
  return {home,port,url:`http://127.0.0.1:${port}`,socket:env.OPENSKY_BROWSER_SOCKET||path.join(os.tmpdir(),`opensky-browser-${createHash('sha256').update(home).digest('hex').slice(0,12)}.sock`),tokenPath:path.join(home,'control-token'),pausePath:path.join(home,'browser-paused.json'),nativePort:Number(env.OPENSKY_PORT||43821)};
}
export function browserToken(settings,create=false) {
  try {const token=fs.readFileSync(settings.tokenPath,'utf8').trim();if(!/^[a-f0-9]{64}$/.test(token))throw new Error('Invalid local control token.');return token;}
  catch(error){if(error.code!=='ENOENT'||!create) return null;}
  fs.mkdirSync(settings.home,{recursive:true,mode:0o700});
  try{fs.writeFileSync(settings.tokenPath,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  return browserToken(settings);
}
export function browserPaused(settings) {
  try{return JSON.parse(fs.readFileSync(settings.pausePath,'utf8')).paused!==false;}catch(e){return e.code!=='ENOENT';}
}
export function writeBrowserPaused(settings,paused) {
  fs.mkdirSync(settings.home,{recursive:true,mode:0o700});
  fs.writeFileSync(settings.pausePath,JSON.stringify({paused,updated_at:new Date().toISOString()})+'\n',{mode:0o600});
}
export async function nativeStopped(settings) {
  const token=browserToken(settings);if(!token)return false;
  try{const response=await fetch(`http://127.0.0.1:${settings.nativePort}/status`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(700)});const value=await response.json();return response.ok&&value.service==='OpenSky Computer Use Daemon'&&value.stopped===true;}catch{return false;}
}
export const browserReads=new Set(['status','tabs_list','snapshot','frames','screenshot']);
export const browserMethods=new Set([...browserReads,'tab_open','tab_claim','tab_navigate','tab_close','tab_release','click','fill','upload','press_key','select_option']);
