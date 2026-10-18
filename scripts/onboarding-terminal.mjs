import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {computer_use,daemonStatus,ensureDaemonRunning,OPENSKY_HOME} from '../src/index.mjs';
import {connectClaude} from '../src/claude-connect.mjs';

const execute=promisify(execFile);
const permissions=[
  {key:'axTrusted',name:'Accessibility',prompt:'promptAX',setting:'Privacy_Accessibility'},
  {key:'screenRecordingTrusted',name:'Screen Recording',prompt:'promptScreen',setting:'Privacy_ScreenCapture'},
  {key:'eventPostingTrusted',name:'Event synthesizing',prompt:'promptPostEvent',setting:'Privacy_Accessibility'},
];
export async function runTerminalOnboarding({claude=false,claudeDesktop=true,interactive=!!process.stdout.isTTY,
  status=daemonStatus,start=ensureDaemonRunning,computer=computer_use,
  open=url=>execute('/usr/bin/open',[url]),connect=connectClaude,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now,timeoutMs=180000,log=console.log}={}) {
  log('OpenSky setup — one-time Mac access, then Claude. Keep this Terminal open.');
  let current=await status();
  const result=()=>({ok:!!current.running&&!current.stopped&&permissions.every(p=>current[p.key]===true),
    permissions:Object.fromEntries(permissions.map(p=>[p.name,current[p.key]===true])),paused:!!current.stopped});
  if(current.stopped){log('OpenSky is paused. Setup preserved the pause; resume explicitly when ready.');return result();}
  if(!interactive){
    log('Noninteractive session: no apps or settings were opened. In Terminal run: ~/.local/bin/opensky onboard --terminal'+(claude?' --claude':''));
    return {...result(),pending:'interactive_setup'};
  }
  if(!current.running){await start();current=await status();}
  for(const permission of permissions) {
    if(current[permission.key]===true){log(`${permission.name}: verified`);continue;}
    log(`${permission.name}: enable the installed OpenSky.app in the Mac setting. Use your Mac password or Touch ID only in macOS if asked. Choose Quit & Reopen when offered. This guide verifies the result automatically.`);
    await computer.status({[permission.prompt]:true});
    await open(`x-apple.systempreferences:com.apple.preference.security?${permission.setting}`);
    const deadline=now()+timeoutMs;
    do {
      await sleep(1000);current=await status();
      if(current.stopped){log('OpenSky was paused. Setup stopped without resuming it.');return result();}
      // A normal Quit & Reopen can briefly leave no process. Start the exact
      // managed app, never a direct child that inherits an agent’s consent.
      if(!current.running){await start();current=await status();}
    }while(current[permission.key]!==true&&now()<deadline);
    if(current[permission.key]!==true){
      log(`${permission.name} is still pending. No access was assumed. Finish the Mac setting, then run opensky onboard --terminal${claude?' --claude':''} to continue from here.`);
      return {...result(),pending:permission.name};
    }
    log(`${permission.name}: verified`);
  }
  const report=result();
  if(claude) {
    const client=await connect({runtime:OPENSKY_HOME,openDesktop:true,skipDesktop:!claudeDesktop});
    report.claude={code:client.claudeCode.status,desktop:client.desktop.status};
    log(`Claude Code: ${client.claudeCode.status}. Claude Desktop: ${client.desktop.status}.`);
    if(client.desktop.bundle)log(`One-time Desktop review: open ${client.desktop.bundle}, choose Install, then enable OpenSky. Its runtime path is already filled. Run opensky connect claude to verify afterward.`);
    if(!client.ok)report.ok=false;
    if(!client.complete)report.pending='claude_review';
    log('Sign in to Claude in its app or run claude if this is your first use. MCP setup does not sign you in or buy a plan.');
  }
  log('Mac permissions verified. Run opensky doctor to recheck, or opensky demo for a checked disposable task. Pause: Control+Option+Command+Escape.');
  log('Optional background browser: opensky web install, then review/load its extension in your Chrome profile. No browser was installed or switched.');
  return report;
}
