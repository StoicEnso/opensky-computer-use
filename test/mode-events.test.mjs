import test from 'node:test';
import assert from 'node:assert/strict';
import {cooperationState,watchInteractionMode,waitForInteractionMode} from '../src/mode-events.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('cooperation events deduplicate samples, report both edges, and clean up',async()=>{
  let mode={ok:true,interaction_mode:'auto',effective_mode:'desktop',user_activity:{ok:true,idle_seconds:121}};
  const events=[],readMode=()=>mode;
  const close=watchInteractionMode(e=>events.push(e),{readMode,intervalMs:5});
  try {
    await sleep(20);assert.equal(events.length,1);
    mode.user_activity.idle_seconds=122;await sleep(20);assert.equal(events.length,1);
    mode={...mode,effective_mode:'alongside'};await sleep(20);assert.equal(events.at(-1).event,'alongside');
    mode={...mode,effective_mode:'desktop'};await sleep(20);assert.equal(events.at(-1).event,'desktop_available');
    mode={...mode,desktop_override:true};await sleep(20);assert.equal(events.at(-1).reason,'explicit_desktop_turn');
    assert.equal(JSON.stringify(events).includes('idle_seconds'),false);
  }finally{close();}
  const count=events.length;mode={ok:false};await sleep(20);assert.equal(events.length,count);
});
test('bounded waits support timeout, transitions, cancellation and unavailable modes',async()=>{
  let mode={ok:false};const readMode=()=>mode;
  assert.equal(cooperationState('',readMode).desktop_available,false);
  assert.equal((await waitForInteractionMode({readMode,timeout_ms:5,intervalMs:1})).matched,false);
  setTimeout(()=>{mode={ok:true,interaction_mode:'desktop'};},10);
  assert.equal((await waitForInteractionMode({readMode,timeout_ms:100,intervalMs:1})).matched,true);
  mode={ok:false};const controller=new AbortController();const pending=waitForInteractionMode({readMode,signal:controller.signal});controller.abort();await assert.rejects(pending);
  await assert.rejects(waitForInteractionMode({timeout_ms:60001}));
});

test('CLI watch stays alive with closed stdin and streams changes without starting a daemon',async()=>{
  const {spawn}=await import('node:child_process');const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'2026-10-24-opensky-watch-Codex-'));
  fs.writeFileSync(path.join(home,'interaction-mode.json'),JSON.stringify({mode:'alongside'}));
  const child=spawn(process.execPath,[path.resolve(import.meta.dirname,'../src/cli.mjs'),'mode','--watch'],{env:{...process.env,OPENSKY_HOME:home},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',x=>output+=x);
  const until=async count=>{for(let i=0;i<100;i++){if(output.trim().split('\n').length>=count&&output.trim())return;await sleep(10);}assert.fail(output);};
  try {
    await until(1);await sleep(30);assert.equal(child.exitCode,null);
    fs.writeFileSync(path.join(home,'interaction-mode.json'),JSON.stringify({mode:'desktop'}));
    await until(2);assert.equal(JSON.parse(output.trim().split('\n').at(-1)).event,'desktop_available');
    assert.equal(fs.existsSync(path.join(home,'control-token')),false);
  }finally {child.kill();await new Promise(r=>child.once('exit',r));fs.rmSync(home,{recursive:true,force:true});}
});
