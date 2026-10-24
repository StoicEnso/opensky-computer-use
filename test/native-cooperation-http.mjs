// Isolated authenticated native HTTP transport, real queue/script process, no desktop input.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'2026-10-24-opensky-native-yield-Codex-'));
const token='b'.repeat(64);fs.writeFileSync(path.join(home,'control-token'),token,{mode:0o600});
const mode=value=>fs.writeFileSync(path.join(home,'interaction-mode.json'),JSON.stringify({mode:value}));mode('desktop');
const portServer=net.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
const binary=path.join(home,'isolated-native');fs.copyFileSync(path.resolve(process.argv[2]??'Native/.build/release/opensky-daemon'),binary);fs.chmodSync(binary,0o755);
const child=spawn(binary,['--test-cooperation-http'],{env:{...process.env,OPENSKY_HOME:home,OPENSKY_PORT:String(port)},stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',x=>stderr+=x);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const url=`http://127.0.0.1:${port}`;
const rpc=async(method,params={})=>(await fetch(url+'/rpc',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({method,params}),signal:AbortSignal.timeout(5000)})).json();
try {
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url+'/health')).ok;if(ready)break;}catch{}await sleep(20);}assert.ok(ready,stderr);
  const active=rpc('run_applescript',{script:'delay 10\nreturn "should not finish"'});await sleep(100);
  const queued=rpc('run_applescript',{script:'return "must not execute"'});await sleep(20);
  const started=Date.now();mode('alongside');
  const [a,b]=await Promise.all([active,queued]);
  assert.equal(a.error_code,'desktop_yielded');assert.equal(a.input_may_have_been_delivered,true);
  assert.equal(b.error_code,'desktop_yielded');assert.equal(b.input_may_have_been_delivered,false);
  assert.ok(Date.now()-started<1500);
  assert.equal((await rpc('run_applescript',{script:'return "blocked"'})).input_may_have_been_delivered,false);
  // Exact-window background actions are admitted. An invalid target should
  // fail target validation, not receive a desktop yield.
  const background=await rpc('set_value',{app:'dev.opensky.nonexistent.fixture',element_index:0,value:'fixture',mode:'background'});
  assert.notEqual(background.error_code,'desktop_yielded');
  mode('desktop');await sleep(60);
  assert.equal((await rpc('run_applescript',{script:'return "new work"'})).ok,true);
  await rpc('stop');mode('alongside');await sleep(40);mode('desktop');await sleep(40);
  assert.equal((await rpc('run_applescript',{script:'return "paused"'})).error_code,'stopped');
  await rpc('resume');assert.equal((await rpc('run_applescript',{script:'return "explicit resume"'})).ok,true);
  console.log(JSON.stringify({ok:true,active_yielded:true,queued_yielded_before_dispatch:true,background_admitted:true,new_work_after_availability:true,emergency_pause_preserved:true,no_desktop_input:true}));
}finally {child.kill();await new Promise(r=>child.once('exit',r));fs.rmSync(home,{recursive:true,force:true});}
