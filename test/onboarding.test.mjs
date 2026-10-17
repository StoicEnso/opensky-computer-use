import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnboardingServer} from '../scripts/onboarding.mjs';

test('onboarding checks are passive and cross-origin requests cannot trigger setup actions',async t=>{
  let starts=0,prompts=0,opened=[];
  const setup=createOnboardingServer({status:async()=>({running:true,axTrusted:true,screenRecordingTrusted:true}),computer:{status:async()=>{prompts++;}},start:async()=>{starts++;},open:async url=>opened.push(url),config:client=>`configuration for ${client}`,chromeEnabled:()=>false});
  const url=await setup.listen();t.after(()=>{setup.server.close();setup.server.closeAllConnections();});const origin=new URL(url).origin;
  const page=await fetch(url);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const state=await (await fetch(url+'state')).json();assert.equal(state.running,true);assert.equal(state.chromeEnabled,false);assert.equal(starts,0);assert.equal(prompts,0);
  for(const headers of [{Origin:'https://example.test','Content-Type':'application/json'},{'Content-Type':'application/json'}]){
    const rejected=await fetch(url+'action',{method:'POST',headers,body:JSON.stringify({action:'accessibility'})});assert.equal(rejected.status,403);
  }
  assert.equal(starts,0);assert.equal(prompts,0);assert.deepEqual(opened,[]);
  const changed=await fetch(url+'action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'accessibility'})});assert.equal(changed.status,200);assert.equal(prompts,1);assert.equal(opened.length,1);
  const arbitrary=await fetch(url+'action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'run_applescript',script:'unsafe'})});assert.equal(arbitrary.status,400);assert.equal(prompts,1);
});

test('onboarding does not run its demo when readiness is missing or control is paused',async t=>{
  let demos=0;
  const setup=createOnboardingServer({status:async()=>({running:true,axTrusted:true,screenRecordingTrusted:true,stopped:true}),config:()=>'',chromeEnabled:()=>false,demo:async()=>{demos++;return{ok:true};}});
  const url=await setup.listen();t.after(()=>{setup.server.close();setup.server.closeAllConnections();});
  const response=await fetch(url+'action',{method:'POST',headers:{Origin:new URL(url).origin,'Content-Type':'application/json'},body:JSON.stringify({action:'demo'})});
  assert.equal(response.status,409);assert.equal(demos,0);
});
