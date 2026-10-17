// Opt-in native rendering check. Uses only disposable background windows and
// a separately signed helper; no owner app input, screenshot or permission request.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';import {spawn,execFileSync} from 'node:child_process';
const installed=process.argv.includes('--installed');
const app=path.resolve(process.argv.slice(2).find(a=>a!=='--installed')??'.build/OpenSky.app');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'2026-10-17-opensky-feedback-Codex-'));
const helper=path.join(root,'OpenSkyFeedbackHelper.app'),fixture=path.join(root,'OpenSkyFeedbackFixture.app');
const helperID='dev.opensky.fixture.feedbackhelper.'+randomUUID().replaceAll('-',''),fixtureID='dev.opensky.fixture.feedbacktarget.'+randomUUID().replaceAll('-','');
const front=()=>execFileSync('/usr/bin/lsappinfo',['front'],{encoding:'utf8'}).trim();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function wait(fn){const end=Date.now()+5000;while(Date.now()<end){const r=await fn();if(r)return r;await delay(50);}throw Error('Disposable feedback state not observed.');}
const output=path.join(root,'state.json'),control=path.join(root,'control');
let sdk,child;
try {
  if(!installed){
  fs.cpSync(app,helper,{recursive:true});
  execFileSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier '+helperID,path.join(helper,'Contents/Info.plist')]);
  execFileSync('/usr/bin/codesign',['--force','--sign','-','--identifier',helperID,helper],{stdio:'ignore'});
  }
  fs.mkdirSync(path.join(fixture,'Contents/MacOS'),{recursive:true});
  fs.writeFileSync(path.join(fixture,'Contents/Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${fixtureID}</string><key>CFBundleName</key><string>OpenSky Feedback Fixture</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`);
  execFileSync('swiftc',['-O','-framework','AppKit',path.join(import.meta.dirname,'fixtures/WindowFeedbackFixture.swift'),'-o',path.join(fixture,'Contents/MacOS/Fixture')]);
  execFileSync('/usr/bin/codesign',['--force','--sign','-','--identifier',fixtureID,fixture],{stdio:'ignore'});
  execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-f',fixture]);
  if(!installed){
  process.env.OPENSKY_HOME=path.join(root,'runtime');process.env.OPENSKY_PORT=String(await port());process.env.OPENSKY_BROWSER_PORT=String(await port());process.env.OPENSKY_BINARY=path.join(helper,'Contents/MacOS/OpenSky');
  }
  sdk=await import('../src/index.mjs');
  if(!installed){await sdk.computer_use.interaction_mode({mode:'alongside'});await sdk.ensureDaemonRunning();}
  const originalNative=await sdk.daemonStatus();assert.equal(originalNative.running,true);assert.ok(/^1\.3\.(?:[4-9]|[1-9]\d+)$/.test(originalNative.build_version),'Window-feedback checks need native UI 1.3.4 or later.');
  if(installed)assert.equal(execFileSync('/bin/ps',['-ww','-p',String(originalNative.pid),'-o','comm='],{encoding:'utf8'}).trim(),path.join(app,'Contents/MacOS/OpenSky'));
  const originalMode=(await sdk.computer_use.interaction_mode()).interaction_mode;
  const originalBrowser=installed?await sdk.computer_use.browser_status():null;
  const rpc=(method,params={})=>sdk.callDaemon(method,params,{autoStart:false});
  const initial=await rpc('cursor_status');assert.equal(initial.visible,false,'A different workflow owns visible feedback; preserve its checkpoint.');assert.ok(initial.focused_window_id,'No observed focused window; preserve the owner session.');
  const before=front();
  const overlaps=(a,b)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
  const displays=(await sdk.daemonStatus()).displays;
  const positions=displays.flatMap(({frame:[x,y,w,h]})=>[[x+35,y+55,460,312],[x+w-495,y+h-347,460,312]]);
  const placement=positions.find(p=>!overlaps(p,initial.focused_window_frame));
  assert.ok(placement,'No fixture area outside the focused window; preserve the owner session.');
  child=spawn(path.join(fixture,'Contents/MacOS/Fixture'),[],{env:{...process.env,OPENSKY_FEEDBACK_FIXTURE_OUTPUT:output,OPENSKY_FEEDBACK_FIXTURE_CONTROL:control,OPENSKY_FEEDBACK_FIXTURE_BELOW:String(initial.focused_window_id),OPENSKY_FEEDBACK_FIXTURE_FRAME:JSON.stringify(placement)},stdio:'ignore'});
  const state=await wait(()=>fs.existsSync(output)&&JSON.parse(fs.readFileSync(output,'utf8')));
  await wait(async()=>{const r=await sdk.computer_use.list_apps({running_only:true});return r.some(a=>a.id===fixtureID&&a.windows?.some(w=>w.id===state.target)&&a.windows?.some(w=>w.id===state.cover));}).catch(async error=>{const r=await sdk.computer_use.list_apps({running_only:true});throw Error(error.message+' Own fixture: '+JSON.stringify(state)+' Inventory: '+JSON.stringify(r.filter(a=>a.pid===state.pid)));});
  assert.equal(front(),before,'Fixture setup changed foreground app.');
  const [x,y,w,h]=state.target_frame,point=[x+70,y+h/2];
  const target={app:fixtureID,window_id:state.target,point,label:'Background fixture',duration:0.05};
  assert.equal((await rpc('cursor_move',target)).ok,true);
  const trace=[];const visible=await wait(async()=>{const r=await rpc('cursor_status');if(trace.length<8)trace.push(r);return r.visible&&r.ordered_above_target&&r.ordered_below_focused_window&&r.visible_regions.reduce((n,p)=>n+p[2]*p[3],0)<w*h?r:false;}).catch(async error=>{fs.writeFileSync(control,'probe');await delay(100);throw Error(error.message+' Feedback: '+JSON.stringify(await rpc('cursor_status'))+' Trace: '+JSON.stringify(trace)+' Foreground unchanged: '+(front()===before)+' Fixture: '+fs.readFileSync(output,'utf8'));});
  assert.equal(visible.scope_window_id,state.target);assert.equal(visible.overlay_normal_level,true);assert.equal(visible.click_through,true);
  assert.equal(visible.ordered_above_target,true);assert.equal(visible.ordered_below_focused_window,true);
  const area=r=>r.reduce((sum,p)=>sum+p[2]*p[3],0),partial=area(visible.visible_regions);
  fs.writeFileSync(control,'uncover');await wait(()=>JSON.parse(fs.readFileSync(output,'utf8')).command==='uncover');
  const uncovered=await wait(async()=>{const r=await rpc('cursor_status');return r.visible&&area(r.visible_regions)>partial?r:false;});
  fs.writeFileSync(control,'cover');await wait(()=>JSON.parse(fs.readFileSync(output,'utf8')).command==='cover');
  await wait(async()=>!(await rpc('cursor_status')).visible);
  fs.writeFileSync(control,'uncover');await wait(()=>JSON.parse(fs.readFileSync(output,'utf8')).command==='uncover');await delay(100);
  assert.equal((await rpc('cursor_status')).visible,false,'Uncovering must not resurrect retired feedback.');
  const moving=rpc('cursor_move',{...target,duration:0.4});await delay(30);await rpc('cursor_dismiss');await moving;await delay(550);
  assert.equal((await rpc('cursor_status')).visible,false,'Dismissed delayed feedback reappeared.');
  assert.equal((await rpc('cursor_move',target)).ok,true);await delay(3600);assert.equal((await rpc('cursor_status')).visible,false,'A disconnected agent left persistent feedback.');
  assert.equal(front(),before,'Foreground changed during the check; owner activity or another app may have interrupted it. Focus preservation is inconclusive.');
  assert.equal((await sdk.daemonStatus()).pid,originalNative.pid);assert.equal((await sdk.daemonStatus()).stopped,originalNative.stopped);assert.equal((await sdk.computer_use.interaction_mode()).interaction_mode,originalMode);
  if(installed){const browser=await sdk.computer_use.browser_status();assert.equal(browser.pid,originalBrowser.pid);assert.equal(browser.paused,originalBrowser.paused);assert.equal(browser.connected,originalBrowser.connected);}
  console.log(JSON.stringify({passed:true,installedExistingNative:installed,nativeProcessAndStopPreserved:true,savedCooperationPreserved:true,browserConnectionPreserved:installed?true:null,nativeBuild:(await sdk.daemonStatus()).build_version,distinctDisposableHelper:!installed,backgroundWindowVisibleWhileOwnerActive:true,partialCoverClipped:true,normalLevelAboveTargetAndBelowFocusedWindow:true,uncoverExpandsVisibleRegion:true,fullCoverRetiresFeedback:true,noResurrectionAfterUncover:true,noResurrectionAfterDismiss:true,shortExpiry:true,clickThrough:true,frontmostAppUnchanged:true,ownerInputSent:false,ownerScreenshotCaptured:false,permissionsRequested:false}));
} finally {
  try{fs.writeFileSync(control,'quit');}catch{}
  if(child&&child.exitCode===null)child.kill('SIGTERM');
  if(!installed&&sdk&&(await sdk.daemonStatus()).running)await sdk.computer_use.shutdown();
  for(const bundle of installed?[fixture]:[fixture,helper])try{execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',['-u',bundle],{stdio:'ignore'});}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}
