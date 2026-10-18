import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// A manual Check again must not disappear behind an earlier passive request.
// The second response fails so stale success cannot leave the native demo enabled.
test('manual readiness refresh survives an in-flight passive check and clears stale success',async()=>{
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,disabled:false,value:'codex',dataset:{},classList:{toggle(){}},listeners:new Map(),addEventListener(type,handler){this.listeners.set(type,handler);}});
    return elements.get(id);
  };
  const requests=[];
  const document={getElementById:element,querySelectorAll:()=>[],addEventListener(){},hidden:true};
  const context=vm.createContext({document,window:{addEventListener(){}},navigator:{},setInterval:()=>1,clearInterval(){},fetch:()=>new Promise(resolve=>requests.push(resolve))});
  vm.runInContext(fs.readFileSync(new URL('../assets/onboarding.js',import.meta.url),'utf8'),context);
  assert.equal(requests.length,1);
  element('refresh').listeners.get('click')();
  requests[0]({ok:true,json:async()=>({ok:true,running:true,accessibility:true,screenRecording:true,eventPosting:true,browserConnected:true,browserConnectionState:'connected'})});
  for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));
  assert.equal(requests.length,2,'A deliberate recheck was lost behind the old passive result.');
  requests[1]({ok:false,status:500});
  for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));
  assert.equal(element('demo').disabled,true);
  assert.equal(element('ready-badge').textContent,'READINESS NOT VERIFIED');
  assert.match(element('message').textContent,/Could not check readiness/);
});
