// OpenSky's own extension/native-host end-to-end test. No Codex browser tools.
// Uses Chrome for Testing headlessly with a disposable, unsigned-in profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {installBrowserHost} from '../scripts/browser-install.mjs';
import {EXTENSION_ID,HOST_NAME} from '../src/browser/settings.mjs';

const binary=process.env.OPENSKY_TEST_CHROME;
if(!binary||!fs.existsSync(binary))throw new Error('Set OPENSKY_TEST_CHROME to a Chrome for Testing executable. The owner\'s Chrome is never launched or changed.');
const root=path.resolve(import.meta.dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'opensky-browser-live-'));
const runtime=path.join(temporary,'runtime'),profile=path.join(temporary,'profile');fs.mkdirSync(runtime);fs.mkdirSync(profile);
fs.cpSync(path.join(root,'src'),path.join(runtime,'src'),{recursive:true});
fs.mkdirSync(path.join(runtime,'assets'));fs.cpSync(path.join(root,'assets/browser-extension'),path.join(runtime,'assets/browser-extension'),{recursive:true});
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const home=path.join(temporary,'home');fs.mkdirSync(home);
process.env.OPENSKY_HOME=home;process.env.OPENSKY_BROWSER_PORT=String(port);process.env.OPENSKY_PORT='53785';process.env.OPENSKY_BROWSER_SOCKET=path.join(temporary,'browser.sock');
const manifestDirectory=path.join(profile,'NativeMessagingHosts'),manifest=path.join(manifestDirectory,HOST_NAME+'.json');
const previous=fs.existsSync(manifest)?fs.readFileSync(manifest):null;
installBrowserHost({runtime,home,browser:'chrome-for-testing',manifestDir:manifestDirectory,environment:{OPENSKY_BROWSER_PORT:String(port),OPENSKY_BROWSER_SOCKET:process.env.OPENSKY_BROWSER_SOCKET,OPENSKY_PORT:process.env.OPENSKY_PORT}});
const {computer_use:browser}=await import('../src/index.mjs');
const {setBrowserPaused}=await import('../src/browser/client.mjs');
const hits=[],uploads=[];
const server=http.createServer(async(req,res)=>{
  if(req.url==='/upload'){
    const parts=[];for await(const c of req)parts.push(c);const body=Buffer.concat(parts);uploads.push({bytes:body.length,hasFile:body.includes(Buffer.from('OpenSky independent upload ✓')),hasPrompt:body.includes(Buffer.from('Background value ✓'))});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,bytes:body.length}));return;
  }
  hits.push({url:req.url,time:Date.now()});
  if(req.url==='/frame'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<label>Frame field<input id=frame-field></label>');return;}
  if(req.url?.includes('delay'))await new Promise(r=>setTimeout(r,1500));
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>OpenSky local browser fixture</title><style>body{font:18px system-ui;padding:30px}label,input,button,output{display:block;margin:18px 0}button{padding:12px}</style>
  <label>Task prompt<input id="prompt" name="prompt"></label><label>Output format<select id="format"><option value="png">PNG image</option><option value="jpg">JPEG image</option></select></label><label>Fixture option<input type="checkbox"></label><button id="count">Increment counter</button><output id="counter">0</output><output id="trusted">Not clicked</output>
  <input type="file" id="files" name="files" multiple style="display:none"><button id="choose">Upload local file</button><output id="selected">No file</output><button id="submit">Send local upload</button><output id="result">Not sent</output>
  <iframe title="Cross-origin fixture" src="http://localhost:${server.address().port}/frame"></iframe><script>let count=0;document.querySelector('#count').onclick=e=>{document.querySelector('#counter').textContent=String(++count);document.querySelector('#trusted').textContent='Trusted click: '+e.isTrusted};document.querySelector('#choose').onclick=()=>document.querySelector('#files').click();document.querySelector('#files').onchange=()=>document.querySelector('#selected').textContent=Array.from(document.querySelector('#files').files,f=>f.name).join(',');document.querySelector('#submit').onclick=async()=>{const data=new FormData();data.append('prompt',document.querySelector('#prompt').value);for(const f of document.querySelector('#files').files)data.append('files',f);const result=await fetch('/upload',{method:'POST',body:data}).then(r=>r.json());document.querySelector('#result').textContent=result.ok?'Upload received':'Failed'};</script>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(binary,['--headless=new','--use-mock-keychain','--password-store=basic','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update',`--user-data-dir=${profile}`,'--remote-debugging-port=0',`--disable-extensions-except=${path.join(runtime,'assets/browser-extension')}`,`--load-extension=${path.join(runtime,'assets/browser-extension')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let diagnostics='';chrome.stderr.on('data',c=>{diagnostics+=c;if(diagnostics.length>50000)diagnostics=diagnostics.slice(-50000);});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,timeout=15000){const end=Date.now()+timeout;let result;while(Date.now()<end){try{result=await fn();if(result)return result;}catch{}await delay(75);}throw new Error('Timed out waiting for observable state. '+JSON.stringify(result));}
async function checked(promise){const value=await promise;assert.equal(value.ok,true,JSON.stringify(value));return value;}
let ws,bridgePid,client;
try{
  const activeFile=path.join(profile,'DevToolsActivePort');
  const [debugPort,debugPath]=await waitFor(()=>{if(!fs.existsSync(activeFile))return false;const lines=fs.readFileSync(activeFile,'utf8').trim().split('\n');return Number(lines[0])>0&&lines[1]?.startsWith('/devtools/browser/')?lines:false;});
  ws=new WebSocket(`ws://127.0.0.1:${debugPort}${debugPath}`);await once(ws,'open');let seq=0;const pending=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error(m.error.message));else p?.resolve(m.result);}});
  const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  let connection;
  try{connection=await waitFor(async()=>{const s=await browser.browser_status();return s.connected?s:false;},12000);}
  catch(error){
    const target=await cdp('Target.createTarget',{url:`chrome-extension://${EXTENSION_ID}/status.html`,background:true});const session=await cdp('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    const state=await cdp('Runtime.evaluate',{expression:'chrome.runtime.sendMessage({action:"status"})',awaitPromise:true,returnByValue:true},session.sessionId);
    throw new Error(error.message+' Extension state: '+JSON.stringify(state.result?.value)+' Chrome: '+diagnostics.slice(-3000));
  }
  bridgePid=connection.pid;
  client=new Client({name:'opensky-browser-live',version:'1.0'},{capabilities:{}});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/mcp-server.mjs')],env:process.env,stderr:'pipe'}));
  const tools=(await client.listTools()).tools;assert.equal(tools.filter(t=>t.name.startsWith('browser_')).length,10);
  const originalTabs=await checked(browser.browser_tabs({action:'list'}));const activeBefore=originalTabs.tabs.filter(t=>t.active).map(t=>t.tab_id);
  const [a,b]=await Promise.all(['a','b'].map(workflow_id=>checked(browser.browser_tabs({action:'open',workflow_id,url:base+'/delay-'+workflow_id}))));
  assert.equal(a.active,false);assert.equal(b.active,false);
  const contexts=[{tab_id:a.tab_id,workflow_id:'a'},{tab_id:b.tab_id,workflow_id:'b'}];
  const lastObservations={};
  const snapshots=await Promise.all(contexts.map(params=>waitFor(async()=>{const s=await browser.browser_snapshot(params);lastObservations[params.tab_id]=s;return s.ok&&s.elements.some(e=>e.name==='Task prompt')?s:false;}))).catch(async error=>{throw new Error(error.message+' Last snapshots: '+JSON.stringify(lastObservations).slice(0,6500)+' Tabs: '+JSON.stringify(await browser.browser_tabs({action:'list'}))+' Hits: '+JSON.stringify(hits));});
  assert.ok(Math.abs(hits.find(h=>h.url==='/delay-a').time-hits.find(h=>h.url==='/delay-b').time)<1300,'Tab page loads did not overlap.');
  for(let i=0;i<2;i++){
    const field=snapshots[i].elements.find(e=>e.name==='Task prompt');
    await checked(browser.browser_fill({...contexts[i],snapshot_id:snapshots[i].snapshot_id,element_id:field.element_id,value:i?'Independent B ✓':'Background value ✓'}));
  }
  let s=await checked(browser.browser_snapshot(contexts[0]));
  assert.equal(s.elements.find(e=>e.name==='Fixture option').role,'checkbox');
  const format=s.elements.find(e=>e.role==='combobox');
  assert.equal(format.options.find(o=>o.label==='JPEG image').value,'jpg');
  await checked(browser.browser_select_option({...contexts[0],snapshot_id:s.snapshot_id,element_id:format.element_id,value:'jpg'}));
  s=await checked(browser.browser_snapshot(contexts[0]));assert.equal(s.elements.find(e=>e.role==='combobox').value,'jpg');
  const count=s.elements.find(e=>e.name==='Increment counter');await checked(browser.browser_click({...contexts[0],snapshot_id:s.snapshot_id,element_id:count.element_id}));
  s=await checked(browser.browser_snapshot(contexts[0]));assert.ok(s.text.includes('1'));assert.ok(s.text.includes('Trusted click: true'));
  const mcpFrames=await client.callTool({name:'browser_frames',arguments:contexts[0]});assert.equal(mcpFrames.isError,false);assert.ok(mcpFrames.structuredContent.frames.length>=2);
  const frame=await waitFor(async()=>{const result=await browser.browser_frames(contexts[0]);return result.frames?.find(f=>f.parent_id&&f.url.endsWith('/frame'));});
  const child={...contexts[0],frame_id:frame.frame_id};
  const frameState=await checked(browser.browser_snapshot(child));
  await checked(browser.browser_fill({...child,snapshot_id:frameState.snapshot_id,element_id:frameState.elements.find(e=>e.name==='Frame field').element_id,value:'Frame-specific ✓'}));
  assert.equal((await checked(browser.browser_snapshot(child))).elements.find(e=>e.name==='Frame field').value,'Frame-specific ✓');
  assert.ok((await checked(browser.browser_snapshot(contexts[0]))).url.includes('/delay-a'),'Child frame replaced the main frame.');
  const capture=await checked(browser.browser_screenshot(contexts[0]));assert.ok(fs.statSync(capture.screenshot.path).size>100);
  s=await checked(browser.browser_snapshot(contexts[0]));
  const uploadPath=path.join(temporary,'2026-10-17-ދިވެހި-upload-Codex.txt');fs.writeFileSync(uploadPath,'OpenSky independent upload ✓');
  const secondPath=path.join(temporary,'2026-10-17-second-upload-Codex.txt');fs.writeFileSync(secondPath,'Second file');
  const direct=s.elements.find(e=>e.type==='file');
  const directResult=await checked(browser.browser_upload({...contexts[0],snapshot_id:s.snapshot_id,element_id:direct.element_id,files:[uploadPath,secondPath]}));assert.equal(directResult.file_count,2);
  s=await checked(browser.browser_snapshot(contexts[0]));
  const choose=s.elements.find(e=>e.name==='Upload local file');
  const mcpUpload=await client.callTool({name:'browser_upload',arguments:{...contexts[0],snapshot_id:s.snapshot_id,element_id:choose.element_id,files:[uploadPath]}});assert.equal(mcpUpload.isError,false);const uploaded=await checked(Promise.resolve(mcpUpload.structuredContent));assert.equal(uploaded.file_count,1);assert.equal(uploaded.files[0].name,path.basename(uploadPath));
  s=await checked(browser.browser_snapshot(contexts[0]));const submit=s.elements.find(e=>e.name==='Send local upload');await checked(browser.browser_click({...contexts[0],snapshot_id:s.snapshot_id,element_id:submit.element_id}));
  await waitFor(()=>uploads.length===1);assert.equal(uploads[0].hasFile,true);assert.equal(uploads[0].hasPrompt,true);
  const bState=await checked(browser.browser_snapshot(contexts[1]));assert.equal(bState.elements.find(e=>e.name==='Task prompt').value,'Independent B ✓');
  const forbidden=await browser.browser_fill({...contexts[0],workflow_id:'b',snapshot_id:s.snapshot_id,element_id:submit.element_id,value:'wrong'});assert.equal(forbidden.error_code,'tab_not_owned');
  await setBrowserPaused(true);
  assert.equal((await browser.browser_click({...contexts[0],snapshot_id:s.snapshot_id,element_id:submit.element_id})).error_code,'stopped');
  await checked(browser.browser_snapshot(contexts[0]));await setBrowserPaused(false);
  s=await checked(browser.browser_snapshot(contexts[0]));
  const oldSnapshot=s;await checked(browser.browser_tabs({action:'navigate',...contexts[0],url:base+'/new-document'}));
  assert.equal((await browser.browser_click({...contexts[0],snapshot_id:oldSnapshot.snapshot_id,element_id:submit.element_id})).error_code,'stale_browser_snapshot');
  const activeAfter=(await checked(browser.browser_tabs({action:'list'}))).tabs.filter(t=>t.active).map(t=>t.tab_id);assert.deepEqual(activeAfter,activeBefore,'Owner tab selection changed.');
  const folder=path.join(root,'research/2026-10-17-opensky-browser-learning-Codex');fs.mkdirSync(folder,{recursive:true});
  const report={passed:true,transport:'OpenSky MV3 extension + native messaging + local broker',codexBrowserToolsUsed:false,headlessTestProfile:true,backgroundTabs:2,overlappingLoads:true,independentFieldValues:true,chooserUploadVerifiedAtLocalServer:true,directMultipleFiles:true,crossOriginFrameFill:true,selectOptionsObservedAndSelected:true,tabScreenshot:true,mcpUploadVerified:true,mcpBrowserTools:10,stopRejectsInput:true,trustedRootClick:true,unicodeFilename:true,ownershipConflictRejected:true,staleDocumentRejected:true,activeTabPreserved:true,uploadBytes:uploads[0].bytes};
  fs.writeFileSync(path.join(folder,'2026-10-17-browser-live-results-Codex.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
  await client?.close();ws?.close();chrome.kill('SIGTERM');await Promise.race([once(chrome,'exit'),delay(3000)]);if(chrome.exitCode===null)chrome.kill('SIGKILL');
  if(previous)fs.writeFileSync(manifest,previous);else fs.rmSync(manifest,{force:true});
  if(!bridgePid){try{bridgePid=(await browser.browser_status()).pid;}catch{}}
  if(bridgePid)try{process.kill(bridgePid,'SIGTERM');}catch{}
  await new Promise(resolve=>server.close(resolve));
  // Keep failed diagnostics and paths for a bounded repair; never touch owner data.
  if(diagnostics)fs.writeFileSync(path.join(root,'research/2026-10-17-opensky-browser-learning-Codex/2026-10-17-headless-chrome-diagnostics-Codex.txt'),diagnostics);
  fs.rmSync(temporary,{recursive:true,force:true});
}
