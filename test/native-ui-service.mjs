// Opt-in: runs a disposable UI service, never upgrades the installed app or requests access.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {nativeProcessIdentity} from '../src/native-process.mjs';

const source=path.resolve(process.argv[2]??'.build/OpenSky.app');
assert.ok(fs.existsSync(path.join(source,'Contents/MacOS/OpenSky')),'Build an app bundle first, then pass its path.');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'2026-10-17-opensky-ui-service-Codex-'));
const candidate=path.join(root,'OpenSkyFixture.app');
const fixtureBundle='dev.opensky.fixture.nativeui.'+randomUUID().replaceAll('-','');
const front=()=>execFileSync('/usr/bin/lsappinfo',['front'],{encoding:'utf8'}).trim();
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
let sky,daemonStatus;
try {
  fs.cpSync(source,candidate,{recursive:true});
  execFileSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleIdentifier '+fixtureBundle,path.join(candidate,'Contents/Info.plist')]);
  execFileSync('/usr/bin/codesign',['--force','--sign','-','--identifier',fixtureBundle,candidate],{stdio:'ignore'});
  execFileSync('/usr/bin/codesign',['--verify','--strict',candidate],{stdio:'ignore'});
  // App-owned runtime/logs belong outside protected Documents/iCloud paths.
  process.env.OPENSKY_HOME=path.join(root,'runtime');
  process.env.OPENSKY_PORT=String(await freePort());process.env.OPENSKY_BROWSER_PORT=String(await freePort());
  process.env.OPENSKY_BINARY=path.join(candidate,'Contents/MacOS/OpenSky');
  const sdk=await import('../src/index.mjs');sky=sdk.computer_use;daemonStatus=sdk.daemonStatus;
  assert.equal(sdk.OPENSKY_HOME,process.env.OPENSKY_HOME,'Abort before input if the SDK was loaded with another runtime.');
  assert.equal(sdk.DEFAULT_PORT,Number(process.env.OPENSKY_PORT),'Fixture service port must be isolated before any request.');
  assert.equal(sdk.DAEMON_BINARY,process.env.OPENSKY_BINARY,'Fixture binary must be selected before any request.');
  const before=front();await sky.interaction_mode({mode:'alongside'});await sdk.ensureDaemonRunning();
  const native=await daemonStatus();
  const identity=await nativeProcessIdentity(native.pid,path.join(candidate,'Contents/MacOS/OpenSky'));
  assert.equal(identity.binaryMatches,true,'LaunchServices started a different app copy.');
  const activityPath=path.join(process.env.OPENSKY_HOME,'user-activity.json');
  for(let i=0;i<30&&!fs.existsSync(activityPath);i++)await new Promise(r=>setTimeout(r,50));
  const activity=JSON.parse(fs.readFileSync(activityPath,'utf8'));
  assert.equal(activity.monitor_ready,false,'Alongside fixtures must not enable activity monitoring.');
  assert.equal(activity.input_contents_recorded,false);assert.equal(activity.own_input_filtered,true);
  assert.equal(fs.statSync(activityPath).mode&0o777,0o600);
  const control=params=>sdk.callDaemon('inspector',params,{autoStart:false});
  const initial=await control({action:'status'});
  const panel=params=>sdk.callDaemon('agent_activity',params,{autoStart:false});
  assert.equal((await panel({action:'status'})).visible,false);
  assert.equal((await panel({action:'show'})).error_code,'desktop_turn_required','Activity panels must not appear over an active owner.');
  assert.equal((await panel({action:'unknown'})).error_code,'invalid_arguments');
  assert.equal(initial.ok,true);assert.equal(initial.visible,false);assert.equal(initial.tray_image_template,true);assert.equal(initial.tray_title,'');
  if(!native.axTrusted||!native.screenRecordingTrusted)assert.match(initial.tray_accessibility_label,/permissions needed/);
  assert.equal((await control({action:'show',activate:'wrong'})).error_code,'invalid_arguments');
  assert.equal((await control({action:'unknown'})).error_code,'invalid_arguments');
  const shown=await control({action:'show'});assert.equal(shown.visible,true);assert.ok(shown.window_id>0);
  assert.equal((await control({action:'show',activate:true})).error_code,'desktop_turn_required');
  await sky.stop();
  let paused;for(let i=0;i<30;i++){paused=await control({action:'status'});if(paused.tray_accessibility_label.includes('paused'))break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(paused.control_paused,true);assert.ok(paused.tray_accessibility_label.includes('paused'));
  const closed=await control({action:'close'});assert.equal(closed.visible,false);assert.equal(closed.inspector_element_count,0);
  assert.equal((await panel({action:'close'})).visible,false,'Activity recovery remains available while paused.');
  const ids=new Set([shown.window_id]);
  for(let cycle=0;cycle<3;cycle++){
    const next=await control({action:'show'});assert.equal(next.visible,true);assert.ok(!ids.has(next.window_id),'Reopening must not reuse a closed Accessibility window.');ids.add(next.window_id);
    let ready;for(let n=0;n<40;n++){ready=await control({action:'status'});if(ready.window_ready)break;await new Promise(r=>setTimeout(r,50));}assert.equal(ready.window_ready,true,'Rendered and logical window frames must settle before input.');
    assert.equal((await control({action:'show'})).window_id,next.window_id,'Showing an existing Inspector must preserve its current window.');
    assert.equal((await control({action:'close'})).visible,false);
  }
  assert.equal(front(),before,'Background Inspector presentation must preserve the frontmost app.');
  console.log(JSON.stringify({passed:true,distinctDisposableBundleIdentity:true,nativeBuild:native.build_version,backgroundInspectorOpened:true,threeFreshReopenWindowsAndSettledFramesPassed:true,liveTrayTemplateAndNoText:true,pausedTrayLabelVerified:true,invalidRequestsRejected:true,foregroundActivationDeferred:true,inspectorClosedWhilePaused:true,frontmostAppUnchanged:true,thirdPartyWindowInspectionVerified:false,installedAppPermissionsVerified:false,permissionsRequested:false}));
} finally {
  if(daemonStatus&&(await daemonStatus()).running)await sky.shutdown();
  fs.rmSync(root,{recursive:true,force:true});
}
