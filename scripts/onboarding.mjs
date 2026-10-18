import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {computer_use,daemonStatus,ensureDaemonRunning,OPENSKY_HOME} from '../src/index.mjs';
import {chromeAutomationEnabled} from '../src/chrome.mjs';
import {configSnippet} from './config.mjs';
import {browserBridgeStatus} from '../src/browser/client.mjs';
import {installBrowserHost,browserHostStatus} from './browser-install.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const execute=promisify(execFile);
export function createOnboardingServer({status=daemonStatus,computer=computer_use,start=ensureDaemonRunning,open=(url)=>execute('/usr/bin/open',[url]),config=configSnippet,demo=async()=>{const {runControlDemo}=await import('./control-demo.mjs');return runControlDemo({quick:true});},chromeEnabled=()=>chromeAutomationEnabled(OPENSKY_HOME),browserStatus=browserBridgeStatus,browserInstall=()=>installBrowserHost({runtime:root,home:OPENSKY_HOME}),browserInstallStatus=()=>browserHostStatus({runtime:root,home:OPENSKY_HOME}),revealFolder=(folder)=>execute('/usr/bin/open',['-R',folder])}={}) {
  const key=randomBytes(24).toString('hex');
  let origin;
  const base=`/setup/${key}`;
  const server=http.createServer(async(req,res)=>{
    const send=(code,value,type='application/json')=>{
      res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`});
      res.end(type==='application/json'?JSON.stringify(value):value);
    };
    // This is a short-lived local setup UI, not an unauthenticated RPC proxy.
    if(req.headers.host!==new URL(origin).host||!req.url?.startsWith(base+'/')||(req.headers.origin&&req.headers.origin!==origin)) return send(403,{ok:false,error:'Local setup origin required.'});
    const route=req.url.slice(base.length).split('?')[0];
    try {
      if(req.method==='GET'&&route==='/') return send(200,readFileSync(path.join(root,'assets/onboarding.html'),'utf8'),'text/html; charset=utf-8');
      if(req.method==='GET'&&route==='/app.js') return send(200,readFileSync(path.join(root,'assets/onboarding.js'),'utf8'),'text/javascript; charset=utf-8');
      if(req.method==='GET'&&route==='/icon.svg') return send(200,readFileSync(path.join(root,'assets/2026-10-17-opensky-brand-Codex/2026-10-17-opensky-icon-Codex.svg'),'utf8'),'image/svg+xml');
      if(req.method==='GET'&&route==='/state') {
        const [current,browser]=await Promise.all([status(),browserStatus()]);
        const registered=browserInstallStatus().native_host_registered===true,connected=browser.connected===true,paused=!!browser.paused||!!current.stopped;
        return send(200,{ok:true,running:!!current.running,stopped:!!current.stopped,accessibility:!!current.axTrusted,screenRecording:!!current.screenRecordingTrusted,eventPosting:!!current.eventPostingTrusted,chromeEnabled:chromeEnabled(),browserConnected:connected,browserHostRegistered:registered,browserPaused:paused,browserConnectionState:connected?(paused?'paused':'connected'):(registered?'waiting':'unregistered'),browserFolderRevealAvailable:true,browserExtensionPath:path.join(root,'assets/browser-extension'),configs:Object.fromEntries(['codex','claude','cursor','antigravity'].map(c=>[c,config(c)]))});
      }
      if(req.method!=='POST'||route!=='/action'||req.headers.origin!==origin||req.headers['content-type']!=='application/json') return send(403,{ok:false,error:'Use the local setup controls.'});
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2048)return send(413,{ok:false,error:'Request too large.'});}
      const {action}=JSON.parse(body);
      if(action==='start'){await start();return send(200,{ok:true,message:'OpenSky started. Refreshing readiness…'});}
      if(action==='accessibility'||action==='screen'||action==='events'){
        await start();
        if(action==='accessibility') await computer.status({promptAX:true});
        else if(action==='screen') await computer.status({promptScreen:true});
        else await computer.status({promptPostEvent:true});
        await open(`x-apple.systempreferences:com.apple.preference.security?${action==='screen'?'Privacy_ScreenCapture':'Privacy_Accessibility'}`);
        return send(200,{ok:true,message:'Enable OpenSky in the Mac setting, then return and check readiness.'});
      }
      if(action==='restart'){await computer.shutdown();await start();return send(200,{ok:true,message:'OpenSky restarted. Refreshing readiness…'});}
      if(action==='demo'){
        const current=await status();
        if(!current.running||!current.axTrusted||!current.screenRecordingTrusted||!current.eventPostingTrusted||current.stopped) return send(409,{ok:false,error:'The service must be running, unpaused and have all three access checks before the demo.'});
        const result=await demo();return send(result.ok?200:409,{ok:result.ok,message:result.ok?'Demo verified. The disposable window is ready to inspect.':result.error});
      }
      if(action==='chrome'){
        const result=await computer.chrome_tabs({action:'enable'});
        return send(result.ok?200:409,{ok:result.ok,message:result.ok?'Optional Chrome tab automation is enabled.':undefined,error:result.error});
      }
      if(action==='browser'){
        const result=browserInstall();
        return send(200,{ok:true,message:'Local host registered. Finish Load unpacked in your existing Chrome profile; this page will confirm when Chrome connects.',extension_path:result.extension_path});
      }
      if(action==='browser-folder'){
        await revealFolder(path.join(root,'assets/browser-extension'));
        return send(200,{ok:true,message:'Extension folder selected in Finder. Choose this folder in Chrome’s Load unpacked picker.'});
      }
      if(action==='close'){send(200,{ok:true,message:'Setup closed. OpenSky remains available to your agent.'});setImmediate(()=>server.close());return;}
      return send(400,{ok:false,error:'Unknown setup action.'});
    }catch(error){return send(500,{ok:false,error:error.message});}
  });
  return {server,async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;return origin+base+'/';}};
}

export async function runOnboarding({openBrowser=true}={}) {
  const setup=createOnboardingServer();const url=await setup.listen();
  console.log(`OpenSky setup: ${url}\nThis local page checks readiness without requesting optional permissions. Close setup when finished.`);
  if(openBrowser) await execute('/usr/bin/open',['-n','-a','Google Chrome','--args','--new-window',url]);
  const timer=setTimeout(()=>setup.server.close(),30*60*1000);timer.unref();
  await new Promise(resolve=>setup.server.on('close',resolve));clearTimeout(timer);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) runOnboarding({openBrowser:!process.argv.includes('--no-open')}).catch(e=>{console.error(e.message);process.exitCode=1;});
