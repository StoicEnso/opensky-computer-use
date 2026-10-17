import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildChromeScript,performChromeTabs,chromeAutomationEnabled} from '../src/chrome.mjs';

test('Chrome discovery never launches an optional permission flow before explicit setup',async()=>{
  const folder=mkdtempSync(path.join(os.tmpdir(),'opensky-chrome-'));
  const home=path.join(folder,'uncreated');let calls=0;
  const computer={run_applescript:async()=>{calls++;return{ok:true,output:'{"ok":true,"tabs":[]}'};}};
  try{
    assert.equal((await performChromeTabs(computer,{action:'list'},{home})).error_code,'chrome_setup_required');assert.equal(calls,0);assert.equal(existsSync(home),false);
    const enabled=await performChromeTabs(computer,{action:'enable'},{home});assert.equal(enabled.enabled,true);assert.equal(calls,1);assert.equal(chromeAutomationEnabled(home),true);
    assert.equal((await performChromeTabs(computer,{action:'list'},{home})).ok,true);assert.equal(calls,2);
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('Chrome routing uses exact observed IDs after tab reordering and safely quotes URL data',()=>{
  function makeTab(id,url){let value=url;return{id:()=>id,title:()=>`Tab ${id}`,loading:()=>false,get url(){return()=>value;},set url(v){value=v;}};}
  const a=makeTab(101,'https://a.test'),b=makeTab(202,'https://b.test');
  let order=[b,a];
  const window={id:()=>77,name:()=>'Test',activeTabIndex:()=>1,tabs:()=>order};
  const chrome={running:()=>true,windows:()=>[window]};
  const url='https://example.test/?value=";throw new Error("injection");//\u2028';
  const result=JSON.parse(vm.runInNewContext(buildChromeScript({action:'navigate',tab_id:'101',chrome_window_id:'77',url}),{Application:()=>chrome}));
  assert.equal(result.ok,true);assert.equal(a.url(),url);assert.equal(b.url(),'https://b.test');
  const missing=JSON.parse(vm.runInNewContext(buildChromeScript({action:'navigate',tab_id:'999',url:'https://wrong.test'}),{Application:()=>chrome}));
  assert.equal(missing.error_code,'chrome_tab_unavailable');assert.equal(a.url(),url);assert.equal(b.url(),'https://b.test');
  assert.throws(()=>buildChromeScript({action:'open',url:'https://a.test',new_window:false}),/exact chrome_window_id/);
  assert.throws(()=>buildChromeScript({action:'navigate',tab_id:'101;danger',url:'https://a.test'}),/observed Chrome ID/);
});

test('uncertain Chrome mutations are not retried automatically',async()=>{
  const home=mkdtempSync(path.join(os.tmpdir(),'opensky-chrome-'));let calls=0;
  try{
    await performChromeTabs({run_applescript:async()=>({ok:true,output:'{"ok":true,"tabs":[]}'})},{action:'enable'},{home});
    const result=await performChromeTabs({run_applescript:async()=>{calls++;return{ok:false,output:'timeout'};}},{action:'navigate',tab_id:'101',url:'https://a.test'},{home});
    assert.equal(result.ok,false);assert.equal(calls,1);assert.match(result.outcome,/unknown/);
  }finally{rmSync(home,{recursive:true,force:true});}
});
