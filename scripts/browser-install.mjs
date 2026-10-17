import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {EXTENSION_ID,HOST_NAME} from '../src/browser/settings.mjs';

export function browserHostStatus({runtime=path.resolve(import.meta.dirname,'..'),browser='chrome',manifestDir,home=process.env.OPENSKY_HOME||runtime}={}) {
  const product={chrome:'Google/Chrome','chrome-for-testing':'Google/ChromeForTesting',chromium:'Chromium'}[browser];
  if(!product)throw new Error('Use chrome, chrome-for-testing or chromium.');
  const manifest=path.join(manifestDir||path.join(os.homedir(),'Library/Application Support',product,'NativeMessagingHosts'),HOST_NAME+'.json');
  const launcher=path.join(home,'browser-host');let registered=false;
  try{
    const value=JSON.parse(fs.readFileSync(manifest,'utf8'));
    fs.accessSync(launcher,fs.constants.X_OK);
    registered=value.name===HOST_NAME&&value.path===launcher&&value.type==='stdio'&&Array.isArray(value.allowed_origins)&&value.allowed_origins.includes(`chrome-extension://${EXTENSION_ID}/`)&&fs.readFileSync(launcher,'utf8').includes('OpenSky managed browser native host v1');
  }catch{/* Missing or unrelated files are reported without creating or changing them. */}
  return {native_host_registered:registered,extension_path:path.join(runtime,'assets/browser-extension'),manifest};
}

export function installBrowserHost({runtime=path.resolve(import.meta.dirname,'..'),browser='chrome',manifestDir,home=process.env.OPENSKY_HOME||runtime,environment={}}={}) {
  if(!['chrome','chrome-for-testing','chromium'].includes(browser))throw new Error('Use chrome, chrome-for-testing or chromium.');
  const product={chrome:'Google/Chrome','chrome-for-testing':'Google/ChromeForTesting',chromium:'Chromium'}[browser];
  const directory=manifestDir||path.join(os.homedir(),'Library/Application Support',product,'NativeMessagingHosts');
  const launcher=path.join(home,'browser-host');
  const quote=s=>`'${s.replaceAll("'",`'\\''`)}'`;
  const exports=Object.entries({OPENSKY_HOME:home,...environment}).map(([key,value])=>{if(!/^OPENSKY_(BROWSER_PORT|BROWSER_SOCKET|PORT|HOME)$/.test(key))throw new Error('Unknown browser-host environment option.');return `export ${key}=${quote(String(value))}`;}).join('\n');
  const source=`#!/bin/sh\n# OpenSky managed browser native host v1\n${exports}\nexec ${quote(process.execPath)} ${quote(path.join(runtime,'src/browser/native-host.mjs'))} "$@"\n`;
  if(fs.existsSync(launcher)&&!fs.readFileSync(launcher,'utf8').includes('OpenSky managed browser native host v1'))throw new Error('Refusing to replace an unrelated launcher.');
  const destination=path.join(directory,HOST_NAME+'.json');
  if(fs.existsSync(destination)){const current=JSON.parse(fs.readFileSync(destination,'utf8'));if(current.name!==HOST_NAME||!current.allowed_origins?.includes(`chrome-extension://${EXTENSION_ID}/`))throw new Error('Refusing to replace an unrelated native host.');}
  fs.mkdirSync(home,{recursive:true,mode:0o700});fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(launcher,source,{mode:0o700});fs.chmodSync(launcher,0o700);
  fs.writeFileSync(destination,JSON.stringify({name:HOST_NAME,description:'OpenSky local browser control',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${EXTENSION_ID}/`]},null,2)+'\n',{mode:0o600});
  const registry=path.join(home,'browser-hosts.json');let hosts=[];try{hosts=JSON.parse(fs.readFileSync(registry,'utf8')).manifests??[];}catch{}if(!hosts.includes(destination))hosts.push(destination);fs.writeFileSync(registry,JSON.stringify({manifests:hosts,launcher},null,2)+'\n',{mode:0o600});
  return {ok:true,native_host_registered:true,extension_id:EXTENSION_ID,extension_path:path.join(runtime,'assets/browser-extension'),manifest:destination,next_step:'Host registration is complete; Chrome connection is not yet verified. In the existing Chrome profile, open chrome://extensions, enable Developer mode, choose Load unpacked and select extension_path. In the chooser, Command+Shift+G can open this exact folder path. Review Chrome\'s debugger/tabs/native-messaging access, then verify opensky web status reports connected. No extension was silently installed, no browser restarted and no Mac permission requested.'};
}
export function removeBrowserHosts(home,{dryRun=false}={}) {
  const registry=path.join(home,'browser-hosts.json'),launcher=path.join(home,'browser-host'),removed=[];
  let hosts=[];try{hosts=JSON.parse(fs.readFileSync(registry,'utf8')).manifests??[];}catch{return removed;}
  for(const file of hosts){try{const value=JSON.parse(fs.readFileSync(file,'utf8'));if(path.basename(file)!==HOST_NAME+'.json'||value.name!==HOST_NAME||value.path!==launcher||!value.allowed_origins?.includes(`chrome-extension://${EXTENSION_ID}/`))continue;removed.push(file);if(!dryRun)fs.rmSync(file);}catch{/* An unrelated/changed manifest is preserved. */}}
  if(fs.existsSync(launcher)&&fs.readFileSync(launcher,'utf8').includes('OpenSky managed browser native host v1')){removed.push(launcher);if(!dryRun)fs.rmSync(launcher);}
  if(!dryRun)fs.rmSync(registry,{force:true});return removed;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(installBrowserHost({browser:process.argv[2]||'chrome'}),null,2));
