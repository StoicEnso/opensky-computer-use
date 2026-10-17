import test from 'node:test';import assert from 'node:assert/strict';
import {bindBrowserStatus} from '../assets/browser-extension/status.mjs';

test('extension status exposes its loaded version and reloads only on one explicit intent',async()=>{
  const element=()=>({textContent:'',disabled:false,handlers:new Map(),addEventListener(type,fn){this.handlers.set(type,fn);}});
  const fields=Object.fromEntries(['state','error','version','reload'].map(k=>['#'+k,element()]));
  const document={querySelector:key=>fields[key],querySelectorAll:()=>[]};const calls=[];let reloads=0;
  bindBrowserStatus(document,{sendMessage:async value=>{calls.push(value.action);return{connected:true,paused:false,version:'1.5.2'};},reload:()=>reloads++});
  await new Promise(r=>setImmediate(r));assert.equal(reloads,0);assert.deepEqual(calls,['status']);assert.match(fields['#version'].textContent,/1\.5\.2/);
  const click=fields['#reload'].handlers.get('click');click();click();assert.equal(reloads,1);assert.equal(fields['#reload'].disabled,true);assert.match(fields['#state'].textContent,/Reloading/);assert.deepEqual(calls,['status'],'Reload must not implicitly connect, resume or pause.');
});
