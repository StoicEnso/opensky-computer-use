import http from 'node:http';
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,copyFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {computer_use as computer,createSession} from '../src/index.mjs';

// Explicit opt-in: this test shares Chrome's own keyboard focus and needs a
// desktop turn. It adds two local-only tabs to the supplied disposable window.
const at=process.argv.indexOf('--window'),windowId=Number(process.argv[at+1]);
if(at===-1||!Number.isInteger(windowId)||windowId<1) throw new Error('Pass --window N for a disposable Chrome native window; keep Chrome idle during this test.');
const output=path.resolve('research/2026-10-17-opensky-parallel-onboarding-Codex');mkdirSync(output,{recursive:true,mode:0o700});
const resume=process.argv.includes('--resume');
const reportPath=path.join(output,'2026-10-17-native-parallel-Chrome-Codex.json');
const requests=resume?JSON.parse(readFileSync(reportPath,'utf8')).requests:[];
const server=http.createServer((req,res)=>{
  const match=/^\/workflow\/([AB])$/.exec(req.url);
  if(!match){res.writeHead(404);res.end();return;}
  const id=match[1],record={workflow:id,started:Date.now(),finished:null};requests.push(record);
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.write(`<!doctype html><title>OpenSky workflow ${id} · local parallel test</title><style>body{font:20px system-ui;margin:70px;color:#111a2e;background:#f3f6fb}h1{font-size:44px}input{font:inherit;padding:15px;width:440px;border:1px solid #bccce5;border-radius:8px}p{color:#526079}</style><h1>Workflow ${id}</h1><p>Local parallel test. No data leaves this Mac.</p>`);
  setTimeout(()=>{res.end(`<h2>Workflow ${id} ready</h2><label>Workflow ${id} note <input aria-label="Workflow ${id} note" value="Untouched ${id}"></label><p>Page loading has finished. This is a disposable test tab.</p>`);record.finished=Date.now();},10000);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const session=createSession({app:'com.google.Chrome',window_id:windowId,mode:'background'});
const report={date:'2026-10-17',transport:'OpenSky native Accessibility',windowId,requests,checks:[],scope:'Two local tabs; page loads overlap, AX interaction sequences remain serialized. This is not inactive-tab DOM control.'};
const checked=r=>{assert.equal(r.ok,true,r.error||r.message);return r;};
async function select(id){
  const s=await session.observe({include_screenshot:false});
  const tabs=s.elements.filter(e=>e.source==='ax'&&e.role==='radio button'&&e.title?.startsWith(`OpenSky workflow ${id} `)&&e.actions?.includes('Press'));
  assert.equal(tabs.length,1,'Need one exact live test tab');
  await session.click({name:tabs[0].title,role:tabs[0].role},{label:`Workflow ${id}`,cursor_id:`workflow-${id}`});
}
try{
  checked(await session.observe({include_screenshot:false}));
  for(const id of resume?[]:['A','B']){
    await session.click({name:'New tab',role:'button'},{label:`Open workflow ${id}`,cursor_id:`workflow-${id}`});
    await session.setValue({name:'Address and search bar',role:'text field'},`${origin}/workflow/${id}`);
    checked(await computer.press_key({app:'com.google.Chrome',keys:['Return'],mode:'background'}));
  }
  await session.waitFor({name:'Workflow B note',role:'text field'},{timeoutMs:20000});
  const firstA=requests.find(r=>r.workflow==='A'),firstB=requests.find(r=>r.workflow==='B');
  assert.ok(firstA&&firstB);assert.ok(firstB.started<firstA.finished,'The browser must begin B before A finishes');
  report.checks.push('Two Chrome page loads overlapped');
  await session.setValue({name:'Workflow B note',role:'text field'},'B completed independently ✓');
  await select('A');await session.waitFor({name:'Workflow A note',role:'text field'},{timeoutMs:15000});
  await session.setValue({name:'Workflow A note',role:'text field'},'A completed independently ✓');
  await session.waitFor({name:'Workflow A note',role:'text field',value:'A completed independently ✓'});
  await select('B');await session.waitFor({name:'Workflow B note',role:'text field',value:'B completed independently ✓'});
  report.checks.push('Separate tab values verified after switching A → B');
  const state=checked(await session.observe({include_screenshot:true}));
  copyFileSync(state.screenshot.path,path.join(output,'2026-10-17-native-parallel-Chrome-Codex.png'));
  report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{
  await computer.cursor_dismiss({}).catch(()=>{});server.close();server.closeAllConnections();
  if(resume)report.resumedExistingTestTabs=true;
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));
}
