import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnboardingServer} from '../scripts/onboarding.mjs';

test('onboarding checks are passive and cross-origin requests cannot trigger setup actions',async t=>{
  let starts=0,prompts=0,browserInstalls=0,opened=[],revealed=[];
  const setup=createOnboardingServer({status:async()=>({running:true,axTrusted:true,screenRecordingTrusted:true}),computer:{status:async()=>{prompts++;}},start:async()=>{starts++;},open:async url=>opened.push(url),revealFolder:async folder=>revealed.push(folder),config:client=>`configuration for ${client}`,chromeEnabled:()=>false,browserStatus:async()=>({connected:false}),browserInstallStatus:()=>({native_host_registered:false}),browserInstall:()=>{browserInstalls++;return {extension_path:'/test/extension'};}});
  const url=await setup.listen();t.after(()=>{setup.server.close();setup.server.closeAllConnections();});const origin=new URL(url).origin;
  const page=await fetch(url);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const state=await (await fetch(url+'state')).json();assert.equal(state.running,true);assert.equal(state.chromeEnabled,false);assert.equal(starts,0);assert.equal(prompts,0);
  for(const headers of [{Origin:'https://example.test','Content-Type':'application/json'},{'Content-Type':'application/json'}]){
    const rejected=await fetch(url+'action',{method:'POST',headers,body:JSON.stringify({action:'accessibility'})});assert.equal(rejected.status,403);
  }
  assert.equal(starts,0);assert.equal(prompts,0);assert.deepEqual(opened,[]);assert.deepEqual(revealed,[]);
  const rejectedReveal=await fetch(url+'action',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({action:'browser-folder'})});assert.equal(rejectedReveal.status,403);assert.deepEqual(revealed,[]);
  assert.equal(browserInstalls,0);
  const browser=await fetch(url+'action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'browser'})});
  assert.equal(browser.status,200);assert.equal(browserInstalls,1);assert.equal(prompts,0);assert.equal(starts,0);
  const reveal=await fetch(url+'action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'browser-folder',path:'/unrelated/owner/file'})});assert.equal(reveal.status,200);assert.equal(revealed.length,1);assert.ok(revealed[0].endsWith('/assets/browser-extension'));assert.equal(prompts,0);assert.equal(starts,0);
  const changed=await fetch(url+'action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'accessibility'})});assert.equal(changed.status,200);assert.equal(prompts,1);assert.equal(opened.length,1);
  const arbitrary=await fetch(url+'action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'run_applescript',script:'unsafe'})});assert.equal(arbitrary.status,400);assert.equal(prompts,1);
});

test('host registration, actual Chrome connection and pause remain separate passive setup states',async t=>{
  let registered=false,connected=false,paused=false,stopped=false,mutations=0;
  const setup=createOnboardingServer({status:async()=>({running:true,axTrusted:true,screenRecordingTrusted:true,stopped}),browserStatus:async()=>({connected,paused}),browserInstallStatus:()=>({native_host_registered:registered}),config:()=>'',chromeEnabled:()=>false,start:async()=>{mutations++;},browserInstall:()=>{mutations++;},revealFolder:async()=>{mutations++;}});
  const url=await setup.listen();t.after(()=>{setup.server.close();setup.server.closeAllConnections();});
  const state=async()=>{const r=await fetch(url+'state');assert.equal(r.status,200);return r.json();};
  assert.equal((await state()).browserConnectionState,'unregistered');
  registered=true;let s=await state();assert.equal(s.browserConnectionState,'waiting');assert.equal(s.browserConnected,false);
  connected=true;s=await state();assert.equal(s.browserConnectionState,'connected');assert.equal(s.browserConnected,true);
  paused=true;s=await state();assert.equal(s.browserConnectionState,'paused');assert.equal(s.browserPaused,true);
  paused=false;stopped=true;assert.equal((await state()).browserConnectionState,'paused');
  assert.equal(mutations,0,'Readiness changed installation, pause or app UI.');
});

test('onboarding does not run its demo when readiness is missing or control is paused',async t=>{
  let demos=0;
  const setup=createOnboardingServer({status:async()=>({running:true,axTrusted:true,screenRecordingTrusted:true,stopped:true}),config:()=>'',chromeEnabled:()=>false,demo:async()=>{demos++;return{ok:true};}});
  const url=await setup.listen();t.after(()=>{setup.server.close();setup.server.closeAllConnections();});
  const response=await fetch(url+'action',{method:'POST',headers:{Origin:new URL(url).origin,'Content-Type':'application/json'},body:JSON.stringify({action:'demo'})});
  assert.equal(response.status,409);assert.equal(demos,0);
});
