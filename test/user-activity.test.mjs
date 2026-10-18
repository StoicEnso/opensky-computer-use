import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {readUserActivity} from '../src/user-activity.mjs';
import {readInteractionMode,writeInteractionMode,prepareInteraction} from '../src/interaction-mode.mjs';

test('activity accepts only a fresh, live, private aggregate record from the native monitor',()=>{
  const record={schema:1,pid:123,sampled_at_ms:100000,external_idle_seconds:300,observed_for_seconds:310,monitor_ready:true,own_input_filtered:true,input_contents_recorded:false};
  const options={platform:'darwin',home:'/fixture',read:()=>JSON.stringify(record),stat:()=>({mode:0o600,uid:process.getuid()}),now:()=>100100,running:pid=>pid===123};
  const reconnecting=readUserActivity({...options,read:()=>JSON.stringify({...record,monitor_ready:false,monitor_status:'reconnecting'})});assert.equal(reconnecting.ok,false);assert.equal(reconnecting.idle_seconds,null);assert.equal(reconnecting.monitor_status,'reconnecting');
  assert.equal(readUserActivity({...options,read:()=>JSON.stringify({...record,monitor_ready:false,monitor_status:'untrusted text'})}).monitor_status,undefined);
  const sample=readUserActivity(options);assert.equal(sample.ok,true);assert.equal(sample.idle_seconds,300.1);assert.equal(sample.input_contents_recorded,false);assert.equal(sample.own_input_filtered,true);
  for(const override of [{now:()=>102000},{now:()=>99000},{running:()=>false},{stat:()=>({mode:0o644,uid:process.getuid()})},{platform:'linux'},{read:()=>'{invalid'},{read:()=>JSON.stringify({...record,monitor_ready:false})},{read:()=>JSON.stringify({...record,own_input_filtered:false})},{read:()=>JSON.stringify({...record,external_idle_seconds:400})}])assert.equal(readUserActivity({...options,...override}).ok,false);
});

test('auto cooperation crosses the exact five-minute boundary and yields on renewed input',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'opensky-auto-'));let seconds=299.999;
  const options={activityProbe:()=>({ok:true,idle_seconds:seconds})};
  try {
    writeInteractionMode(root,'auto');
    assert.equal(readInteractionMode(root,options).effective_mode,'alongside');
    assert.equal(prepareInteraction(root,'press_key',{keys:['Return']},options).result.error_code,'desktop_turn_required');
    seconds=300;assert.equal(readInteractionMode(root,options).effective_mode,'desktop');
    assert.deepEqual(prepareInteraction(root,'press_key',{keys:['Return']},options),{params:{keys:['Return']}});
    seconds=0.01;assert.equal(readInteractionMode(root,options).effective_mode,'alongside');
    assert.equal(prepareInteraction(root,'inspector',{action:'show',activate:true},options).result.deferred,true);
    const target={app:'Fixture',element_index:1,snapshot_id:'fresh'};
    assert.equal(prepareInteraction(root,'click',target,options).params.mode,'background');
    for(const activityProbe of [()=>({ok:false,idle_seconds:null}),()=>({ok:true,idle_seconds:NaN}),()=>{throw Error('signal lost');}])assert.equal(readInteractionMode(root,{activityProbe}).effective_mode,'alongside');
    for(const method of ['stop','resume','shutdown','status'])assert.deepEqual(prepareInteraction(root,method,{},options),{params:{}});
    assert.equal(fs.existsSync(path.join(root,'control-token')),false,'Mode/activity checks must never start or resume a service.');
    const stored=JSON.parse(fs.readFileSync(path.join(root,'interaction-mode.json')));
    assert.equal(stored.cooperation_policy,'auto','Effective transitions must not overwrite the saved owner preference.');
    assert.equal(stored.updated_by_pid,process.pid,'Keep local writer provenance for concurrent-client diagnosis.');
    assert.equal(stored.updated_by_parent_pid,process.ppid);
    assert.equal(stored.mode,'alongside','Older MCP clients must keep their supported background path.');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
