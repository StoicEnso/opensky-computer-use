import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync,lstatSync,mkdirSync,rmSync,symlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createActivityRecorder,readAgentActivity,activityClientName} from '../src/agent-activity.mjs';

function fixture(run) {
  const home=mkdtempSync(path.join(os.tmpdir(),'2026-10-19-opensky-activity-Codex-'));
  let time=new Date(2026,9,19,12).getTime();
  const now=()=>time,advance=ms=>{time+=ms;};
  const read=()=>readAgentActivity({home,now,isAlive:pid=>pid!==9999});
  try{return run({home,now,advance,read});}finally{rmSync(home,{recursive:true,force:true});}
}
test('active clients are distinct sessions, not requests; latency and counters reconcile',()=>fixture(({home,now,advance,read})=>{
  const a=createActivityRecorder({home,now,pid:123,client:{name:'Codex',interface:'MCP'}});
  const b=createActivityRecorder({home,now,pid:124,client:{name:'Claude Code',interface:'MCP'}});
  const a1=a.begin('native.click'),a2=a.begin('browser.fill'),b1=b.begin('browser.upload');
  assert.equal(read().working,2);assert.equal(read().clients[0].pending+read().clients[1].pending,3);
  advance(250);a1({ok:true});a1({ok:true});a2({ok:false,error_code:'desktop_turn_required'});
  assert.equal(read().working,1);assert.equal(read().recent,1);
  advance(750);b1({ok:false,error_code:'browser_target_stale'});
  const result=read();assert.equal(result.working,0);assert.equal(result.calls,3);assert.equal(result.deferred,1);assert.equal(result.failed,1);assert.equal(result.average_ms,500);
  assert.equal(result.buckets.reduce((sum,bin)=>sum+bin.calls,0),3);
  const stored=readdirSync(path.join(home,'agent-activity')).map(file=>JSON.parse(readFileSync(path.join(home,'agent-activity',file),'utf8')));
  for(const record of stored){assert.deepEqual(Object.keys(record).sort(),['schema','id','pid','name','interface','updated_at','day','calls','failed','deferred','duration_ms','pending','buckets'].sort());}
}));
test('dead processes, stale pending requests and old clients never remain working',()=>fixture(({home,now,advance,read})=>{
  createActivityRecorder({home,now,pid:9999}).begin('native.click');
  createActivityRecorder({home,now,pid:123}).begin('browser.upload');
  assert.equal(read().working,1);advance(90001);assert.equal(read().working,0);assert.equal(read().recent,0);
}));
test('day rollover resets today counters and fifteen-minute graph ages independently',()=>fixture(({home,now,advance,read})=>{
  const recorder=createActivityRecorder({home,now,pid:123});recorder.begin('native.click')({ok:true});
  advance(16*60000);assert.equal(read().calls,1);assert.equal(read().buckets.reduce((sum,bin)=>sum+bin.calls,0),0);
  advance(86400000);assert.equal(read().calls,0);recorder.begin('browser.fill')({ok:true});assert.equal(read().calls,1);
}));
test('status polling and counters-disabled mode never create activity files',()=>fixture(({home,now})=>{
  createActivityRecorder({home,now,pid:123}).begin('native.status')({ok:true});assert.deepEqual(readdirSync(home),[]);
  const script=`import {trackAgentOperation} from ${JSON.stringify(new URL('../src/agent-activity.mjs',import.meta.url).href)};await trackAgentOperation(process.env.OPENSKY_HOME,'native.click',()=>({ok:true}));`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,OPENSKY_HOME:home,OPENSKY_ACTIVITY:'0'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(readdirSync(home),[]);
}));
test('local counters have private permissions and never serialize inputs or error content',()=>fixture(({home,now,read})=>{
  const secret='never-log-this-password';
  const finish=createActivityRecorder({home,now,pid:123}).begin('native.type_text',{text:secret});
  finish({ok:false,error:secret,password:secret});
  const directory=path.join(home,'agent-activity'),file=path.join(directory,readdirSync(directory)[0]);
  assert.equal(lstatSync(directory).mode&0o777,0o700);assert.equal(lstatSync(file).mode&0o777,0o600);
  assert.equal(readFileSync(file,'utf8').includes(secret),false);assert.equal(read().failed,1);
  const blocker=path.join(home,'blocked');writeFileSync(blocker,'not a directory');
  assert.doesNotThrow(()=>createActivityRecorder({home:blocker,now,pid:123}).begin('native.click')({ok:true}));
}));
test('malformed, future, oversized and symlink files are ignored; arbitrary client labels are not displayed',()=>fixture(({home,now,read})=>{
  const recorder=createActivityRecorder({home,now,pid:123,client:{name:'private raw string',interface:'unexpected'}});recorder.begin('native.click')({ok:true});
  const dir=path.join(home,'agent-activity');
  const validFile=path.join(dir,readdirSync(dir)[0]),validRecord=JSON.parse(readFileSync(validFile,'utf8'));
  writeFileSync(path.join(dir,'11111111-1111-1111-1111-111111111111.json'),'{broken');
  symlinkSync(path.join(dir,readdirSync(dir)[0]),path.join(dir,'22222222-2222-2222-2222-222222222222.json'));
  writeFileSync(path.join(dir,'33333333-3333-3333-3333-333333333333.json'),' '.repeat(70000));
  assert.equal(read().calls,1);assert.equal(read().clients[0].name,'MCP client');assert.equal(read().clients[0].interface,'SDK');
  writeFileSync(validFile,JSON.stringify({...validRecord,updated_at:now()+5000}));assert.equal(read().calls,0);
  writeFileSync(validFile,JSON.stringify({...validRecord,pending:[null]}));assert.equal(read().calls,0);
  writeFileSync(validFile,JSON.stringify(validRecord));assert.equal(read().calls,1);
  assert.equal(activityClientName('claude-code'),'Claude Code');assert.equal(activityClientName('Codex Desktop'),'Codex');assert.equal(activityClientName('private raw string'),'MCP client');
}));
test('one exited CLI process retains totals without looking like a live agent',()=>fixture(({home})=>{
  const script=`import {createActivityRecorder} from ${JSON.stringify(new URL('../src/agent-activity.mjs',import.meta.url).href)};createActivityRecorder({home:process.env.OPENSKY_HOME,client:{name:'Terminal',interface:'CLI'}}).begin('native.list_apps')({ok:true});`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,OPENSKY_HOME:home},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const state=readAgentActivity({home});assert.equal(state.calls,1);assert.equal(state.working,0);assert.equal(state.recent,0);
}));
