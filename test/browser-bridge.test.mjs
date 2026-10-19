import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {nativeFrame,nativeFrameReader,jsonLineReader} from '../src/browser/framing.mjs';
import {browserSettings,browserToken} from '../src/browser/settings.mjs';
import {startBrowserBridge} from '../src/browser/server.mjs';
import {createBrowserController} from '../assets/browser-extension/controller.mjs';
import {installBrowserHost,removeBrowserHosts,browserHostStatus} from '../scripts/browser-install.mjs';
import {HOST_NAME,EXTENSION_ID} from '../src/browser/settings.mjs';
import {execFileSync} from 'node:child_process';

test('native framing handles fragmented Unicode and rejects oversized commands',()=>{
  const message={text:'ދިވެހި ✓ café'},received=[];
  const bytes=nativeFrame(message),read=nativeFrameReader(value=>received.push(value));
  for(const byte of bytes)read(Buffer.from([byte]));assert.deepEqual(received,[message]);
  const lines=[],lineRead=jsonLineReader(value=>lines.push(value));
  for(const byte of Buffer.from(JSON.stringify(message)+'\n'))lineRead(Buffer.from([byte]));assert.deepEqual(lines,[message]);
  assert.throws(()=>nativeFrame({text:'x'.repeat(1024*1024)}),/1 MiB/);
  assert.throws(()=>nativeFrameReader(()=>{})(Buffer.from([255,255,255,255])),/length/);
});

test('browser bridge authenticates, rejects origins, isolates profiles and does not retry input',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'opensky-browser-test-'));
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const settings=browserSettings({OPENSKY_HOME:home,OPENSKY_BROWSER_PORT:String(port),OPENSKY_PORT:'53786',OPENSKY_BROWSER_SOCKET:path.join(home,'bridge.sock')});
  const bridge=await startBrowserBridge(settings);t.after(async()=>{await bridge.close();await fs.rm(home,{recursive:true,force:true});});
  const token=browserToken(settings),headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  assert.equal((await fetch(settings.url+'/status')).status,403);
  assert.equal((await fetch(settings.url+'/status',{headers:{Authorization:'Bearer '+'é'.repeat(64)}})).status,403);
  assert.equal((await fetch(settings.url+'/status',{headers:{...headers,Origin:'https://untrusted.invalid'}})).status,403);
  const connect=async id=>{
    const socket=net.connect(settings.socket);await once(socket,'connect');let resolveReady;const ready=new Promise(r=>resolveReady=r);const requests=[];
    const reader=jsonLineReader(message=>{if(message.type==='ready')resolveReady();if(message.type==='request')requests.push(message);});socket.on('data',reader);socket.write(JSON.stringify({type:'hello',token,profile_id:id,version:'test'})+'\n');await ready;return{socket,requests};
  };
  const a=await connect('profile-a'),b=await connect('profile-b');t.after(()=>{a.socket.destroy();b.socket.destroy();});
  const rpc=(method,params={})=>fetch(settings.url+'/rpc',{method:'POST',headers,body:JSON.stringify({method,params})}).then(r=>r.json());
  assert.equal((await rpc('tabs_list')).error_code,'browser_profile_ambiguous');
  const operation=rpc('click',{profile_id:'profile-a',tab_id:'1',workflow_id:'task'});
  for(let i=0;!a.requests.length&&i<50;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(a.requests.length,1);assert.equal(b.requests.length,0);
  a.socket.destroy();assert.equal((await operation).error_code,'browser_disconnected');assert.equal(a.requests.length,1);
  const badUpload=await rpc('upload',{profile_id:'profile-b',files:['relative-file.txt']});assert.equal(badUpload.ok,false);assert.equal(b.requests.length,0);
  await fetch(settings.url+'/pause',{method:'POST',headers,body:JSON.stringify({paused:true})});
  assert.equal((await rpc('click',{profile_id:'profile-b'})).error_code,'stopped');assert.equal(b.requests.length,0);
});


test('native tray pause cancels once, preserves fresh reads, and resumes only its own browser pause',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'opensky-native-pause-test-'));
  const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  let stopped=false,unavailable=false;
  const native=http.createServer((req,res)=>{if(unavailable){res.statusCode=503;res.end('{}');return;}res.end(JSON.stringify({service:'OpenSky Computer Use Daemon',stopped}));});
  await new Promise(r=>native.listen(0,'127.0.0.1',r));
  const settings=browserSettings({OPENSKY_HOME:home,OPENSKY_BROWSER_PORT:String(await freePort()),OPENSKY_PORT:String(native.address().port),OPENSKY_BROWSER_SOCKET:path.join(home,'bridge.sock')});
  const bridge=await startBrowserBridge(settings),token=browserToken(settings),headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const socket=net.connect(settings.socket);await once(socket,'connect');const messages=[];
  socket.on('data',jsonLineReader(m=>{messages.push(m);if(m.type==='request'&&m.method==='snapshot')setTimeout(()=>{if(!socket.destroyed)socket.write(JSON.stringify({type:'result',id:m.id,result:{ok:true}})+'\n');},550);}));
  socket.write(JSON.stringify({type:'hello',token,profile_id:'fixture',version:'test'})+'\n');
  t.after(async()=>{socket.destroy();await bridge.close();await new Promise(r=>native.close(r));await fs.rm(home,{recursive:true,force:true});});
  const rpc=method=>fetch(settings.url+'/rpc',{method:'POST',headers,body:JSON.stringify({method,params:{profile_id:'fixture'}})}).then(r=>r.json());
  const wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Native pause fixture timed out');};
  await wait(()=>messages.some(m=>m.type==='ready'));
  const input=rpc('click');await wait(()=>messages.some(m=>m.type==='request'&&m.method==='click'));
  stopped=true;assert.equal((await input).error_code,'cancelled');
  const cancellations=messages.filter(m=>m.type==='cancel').length;
  assert.equal((await rpc('click')).error_code,'stopped');
  assert.equal((await rpc('snapshot')).ok,true,'Settled native pause must permit fresh read-only requests across polling intervals.');
  assert.equal(messages.filter(m=>m.type==='cancel').length,cancellations,'A settled pause must not repeatedly cancel requests.');
  unavailable=true;await new Promise(r=>setTimeout(r,450));assert.equal(messages.some(m=>m.type==='resume'),false,'An unavailable native status must never resume a native pause.');unavailable=false;
  stopped=false;await wait(()=>messages.some(m=>m.type==='resume'));assert.equal(bridge.status().connected,true);
  const resumes=messages.filter(m=>m.type==='resume').length;
  stopped=true;assert.equal((await rpc('click')).error_code,'stopped');
  await fetch(settings.url+'/pause',{method:'POST',headers,body:JSON.stringify({paused:true})});
  stopped=false;await new Promise(r=>setTimeout(r,450));
  assert.equal(bridge.status().paused,true,'Native resume must preserve a separate SDK or extension pause.');
  assert.equal(messages.filter(m=>m.type==='resume').length,resumes);
});

function chromeFixture(){
  const listeners=()=>({handlers:[],addListener(fn){this.handlers.push(fn);}});
  const tabs=new Map([[1,{id:1,windowId:1,url:'https://example.test',active:true,status:'complete'}]]),calls=[],data={};let id=1;
  return {calls,tabs,storage:{session:{async get(key){return{[key]:data[key]};},async set(value){Object.assign(data,value);}}},debugger:{onDetach:listeners(),onEvent:listeners(),async attach(){},async sendCommand(target,method,params){calls.push(['cdp',method,params]);if(method==='Page.navigate')tabs.get(target.tabId).url=params.url;return{};},async detach(){calls.push('detach');}},tabsApi:{onRemoved:listeners(),onUpdated:listeners(),async query(){return [...tabs.values()];},async get(n){if(!tabs.has(n))throw Error('Tab gone');return tabs.get(n);},async create(value){calls.push(['create',value]);const t={id:++id,windowId:1,...value};tabs.set(t.id,t);return t;},async update(n,value){calls.push(['update',n,value]);Object.assign(tabs.get(n),value);return tabs.get(n);},async remove(n){calls.push(['remove',n]);tabs.delete(n);}}};
}
test('owned background tabs never activate or silently substitute another workflow',async()=>{
  const fixture=chromeFixture(),chrome={...fixture,tabs:fixture.tabsApi},controller=createBrowserController(chrome);
  const opened=await controller.run('tab_open',{url:'https://example.test/a',workflow_id:'a'});assert.equal(opened.ok,true);assert.equal(opened.active,false);
  const tab_id=opened.tab_id;
  assert.equal((await controller.run('tab_claim',{tab_id,workflow_id:'b'})).error_code,'tab_owned_by_other_workflow');
  assert.equal((await controller.run('tab_navigate',{tab_id,workflow_id:'b',url:'https://example.test/b'})).error_code,'tab_not_owned');
  assert.equal((await controller.run('tab_navigate',{tab_id,workflow_id:'a',url:'https://example.test/next'})).ok,true);
  assert.equal(fixture.tabs.get(1).active,true);
  assert.equal(fixture.tabs.get(Number(tab_id)).url,'https://example.test/next');assert.equal(fixture.calls.some(c=>c[0]==='update'),false);
  await controller.run('tab_close',{tab_id,workflow_id:'a'});assert.equal(fixture.tabs.has(1),true);
  fixture.tabsApi.query=async()=>[];
  const creates=fixture.calls.filter(c=>c[0]==='create').length;
  assert.equal((await controller.run('tab_open',{workflow_id:'a',url:'https://example.test'})).error_code,'browser_window_required');
  assert.equal(fixture.calls.filter(c=>c[0]==='create').length,creates,'A background request created a new window.');
});
test('cancelling a browser turn prevents a queued input action',async()=>{
  const fixture=chromeFixture();let release,started;
  const running=new Promise(r=>started=r),hold=new Promise(r=>release=r);let writes=0;
  fixture.debugger.sendCommand=async(target,method)=>{if(method==='Page.navigate'){writes++;started();await hold;}return{};};
  const controller=createBrowserController({...fixture,tabs:fixture.tabsApi});
  await controller.run('tab_claim',{tab_id:'1',workflow_id:'a'});
  const first=controller.run('tab_navigate',{tab_id:'1',workflow_id:'a',url:'https://example.test/a'});await running;
  const queued=controller.run('tab_navigate',{tab_id:'1',workflow_id:'a',url:'https://example.test/b'});controller.cancel();release();await first;
  assert.equal((await queued).error_code,'cancelled');assert.equal(writes,1);
});

test('interrupted background keys restore renderer focus emulation without delivering input',async()=>{
  for(const interruption of ['cancel','target-disappeared']){
    const fixture=chromeFixture();let emulated=false,inputs=0,controller;
    fixture.debugger.sendCommand=async(target,method,params)=>{
      if(method==='Page.getFrameTree')return{frameTree:{frame:{id:'root',url:'https://example.test'}}};
      if(method==='Page.createIsolatedWorld')return{executionContextId:1};
      if(method==='Runtime.evaluate')return{result:params.returnByValue?{value:{elements:[{element_id:'field',name:'Task field'}]}}:{objectId:'observed-field'}};
      if(method==='Emulation.setFocusEmulationEnabled'){
        emulated=params.enabled;if(emulated&&interruption==='cancel')controller.cancel();
      }
      if(method==='DOM.focus'&&interruption==='target-disappeared')throw Error('Observed field was removed');
      if(method.startsWith('Input.'))inputs++;
      return{};
    };
    controller=createBrowserController({...fixture,tabs:fixture.tabsApi});
    const task={tab_id:'1',workflow_id:'a'};await controller.run('tab_claim',task);
    const snapshot=await controller.run('snapshot',task);assert.equal(snapshot.ok,true);
    const result=await controller.run('press_key',{...task,snapshot_id:snapshot.snapshot_id,element_id:'field',key:'Enter'});
    assert.equal(result.ok,false);assert.equal(inputs,0);assert.equal(emulated,false,'Failed input left focus emulation enabled.');
  }
});

test('background keys wait for exact renderer focus and reject an unconfirmed field before input',async()=>{
  for(const focusAvailable of [true,false]) {
    const fixture=chromeFixture();let release,ready,inputs=0,emulated=false;
    const entered=new Promise(r=>ready=r),hold=new Promise(r=>release=r);
    fixture.debugger.sendCommand=async(target,method,params)=>{
      if(method==='Page.getFrameTree')return{frameTree:{frame:{id:'root',url:'https://example.test'}}};
      if(method==='Page.createIsolatedWorld')return{executionContextId:1};
      if(method==='Runtime.evaluate')return{result:params.returnByValue?{value:{elements:[{element_id:'field',name:'Task field'}]}}:{objectId:'observed-field'}};
      if(method==='Emulation.setFocusEmulationEnabled')emulated=params.enabled;
      if(method==='Runtime.callFunctionOn'){ready();await hold;return{result:{value:focusAvailable}};}
      if(method.startsWith('Input.'))inputs++;
      return{};
    };
    const controller=createBrowserController({...fixture,tabs:fixture.tabsApi}),task={tab_id:'1',workflow_id:'focus-test'};
    await controller.run('tab_claim',task);const snapshot=await controller.run('snapshot',task);
    const input=controller.run('press_key',{...task,snapshot_id:snapshot.snapshot_id,element_id:'field',key:'Enter'});
    await entered;assert.equal(inputs,0,'A key was sent before focus verification completed.');release();
    const result=await input;assert.equal(result.ok,focusAvailable);assert.equal(inputs,focusAvailable?2:0);assert.equal(emulated,false);
    if(!focusAvailable)assert.equal(result.error_code,'browser_focus_unavailable');
  }
});

test('extension startup and installation events create only one native connection',async()=>{
  const event=()=>({handlers:[],addListener(fn){this.handlers.push(fn);}});
  let resolveLocal,connections=0;
  const fixture=chromeFixture(),ports=[];
  const fake={...fixture,tabs:fixture.tabsApi,storage:{...fixture.storage,local:{get:()=>new Promise(r=>resolveLocal=r),set:async()=>{}}},runtime:{id:EXTENSION_ID,getManifest:()=>({version:'1.5.0'}),onMessage:event(),onInstalled:event(),onStartup:event(),connectNative(){connections++;const port={onMessage:event(),onDisconnect:event(),postMessage(){},disconnect(){for(const fn of this.onDisconnect.handlers)fn();}};ports.push(port);return port;}},alarms:{onAlarm:event(),create:async()=>{}}};
  const old=globalThis.chrome;globalThis.chrome=fake;
  try{
    await import('../assets/browser-extension/worker.mjs?startup-race');for(const handler of fake.runtime.onInstalled.handlers)handler();for(const handler of fake.runtime.onStartup.handlers)handler();resolveLocal({profile_id:'fixture-profile'});await new Promise(r=>setImmediate(r));assert.equal(connections,1);
    for(const fn of ports[0].onMessage.handlers)await fn({type:'shutdown'});
    for(const fn of fake.alarms.onAlarm.handlers)fn({name:'opensky-reconnect'});
    await new Promise(r=>setImmediate(r));assert.equal(connections,1,'Explicit shutdown was undone by reconnect.');
    await new Promise(resolve=>fake.runtime.onMessage.handlers[0]({action:'connect'},{id:EXTENSION_ID},resolve));
    assert.equal(connections,2,'Explicit Connect should restore the local bridge.');
  }finally{globalThis.chrome=old;}
});

test('native-host setup quotes paths and removes only its registered files',async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'opensky-host-'));t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const home=path.join(temporary,"owner's runtime"),manifestDir=path.join(temporary,'NativeMessagingHosts');
  assert.equal(browserHostStatus({runtime:home,home,manifestDir}).native_host_registered,false);
  await assert.rejects(fs.access(home),'Passive status created the runtime folder.');
  const setup=installBrowserHost({runtime:home,home,manifestDir});assert.equal(setup.extension_id,EXTENSION_ID);
  assert.equal(browserHostStatus({runtime:home,home,manifestDir}).native_host_registered,true);
  execFileSync('/bin/sh',['-n',path.join(home,'browser-host')]);
  const manifest=JSON.parse(await fs.readFile(path.join(manifestDir,HOST_NAME+'.json'),'utf8'));assert.deepEqual(manifest.allowed_origins,[`chrome-extension://${EXTENSION_ID}/`]);
  assert.equal((await fs.stat(setup.manifest)).mode&0o777,0o600);
  const unrelated=path.join(manifestDir,'unrelated.json');await fs.writeFile(unrelated,'unrelated');
  const savedLauncher=await fs.readFile(path.join(home,'browser-host'),'utf8');
  const conflictingDir=path.join(temporary,'conflicting-hosts');await fs.mkdir(conflictingDir);
  await fs.writeFile(path.join(conflictingDir,HOST_NAME+'.json'),JSON.stringify({name:'someone-else'}));
  assert.equal(browserHostStatus({runtime:home,home,manifestDir:conflictingDir}).native_host_registered,false);
  assert.throws(()=>installBrowserHost({runtime:'/changed/runtime',home,manifestDir:conflictingDir}),/unrelated native host/);
  assert.equal(await fs.readFile(path.join(home,'browser-host'),'utf8'),savedLauncher);
  const planned=removeBrowserHosts(home,{dryRun:true});assert.equal(planned.length,2);await fs.access(setup.manifest);
  removeBrowserHosts(home);await assert.rejects(fs.access(setup.manifest),{code:'ENOENT'});assert.equal(await fs.readFile(unrelated,'utf8'),'unrelated');
  assert.equal(browserHostStatus({runtime:home,home,manifestDir}).native_host_registered,false);
});
