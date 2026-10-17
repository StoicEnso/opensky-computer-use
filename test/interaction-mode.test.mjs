import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, stat, access, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readInteractionMode, writeInteractionMode, prepareInteraction} from '../src/interaction-mode.mjs';

const run = promisify(execFile);
const cli = path.resolve(import.meta.dirname, '../src/cli.mjs');
const server = path.resolve(import.meta.dirname, '../src/mcp-server.mjs');

test('alongside defers shared input before any absent engine can launch, across MCP, CLI and SDK', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'opensky-alongside-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const env={...process.env, OPENSKY_HOME:home, OPENSKY_PORT:'53788', OPENSKY_BINARY:path.join(home,'must-not-launch')};
  const client=new Client({name:'alongside-check',version:'1'},{capabilities:{}});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[server],env,stderr:'pipe'}));
  t.after(()=>client.close());
  assert.equal((await client.callTool({name:'interaction_mode',arguments:{}})).structuredContent.interaction_mode,'desktop');
  await run(process.execPath,[cli,'mode','alongside','--json'],{env});
  assert.equal((await stat(path.join(home,'interaction-mode.json'))).mode & 0o777,0o600);
  const probes=[
    ['click',{app:'Fixture',element_index:1,snapshot_id:'fresh',mode:'takeover'}],
    ['press_key',{app:'Fixture',keys:['Return'],mode:'background'}],
    ['type_text',{app:'Fixture',text:'test',mode:'background'}],
    ['paste',{app:'Fixture',content:'test'}],
    ['manage_window',{app:'Fixture',action:'focus'}],
    ['run_applescript',{script:'tell application "Finder" to activate'}],
    ['drag',{app:'Fixture',start_point:[1,1],end_point:[2,2]}],
    ['scroll',{app:'Fixture',mode:'background'}]
  ];
  for(const [name,args] of probes) {
    const result=(await client.callTool({name,arguments:args})).structuredContent;
    assert.equal(result.error_code,'desktop_turn_required',name);
    assert.equal(result.deferred,true,name);
    assert.match(result.next_step,/continue independent/);
  }
  const state=(await client.callTool({name:'get_app_state',arguments:{app:'Fixture'}})).structuredContent;
  assert.equal(state.error_code,'window_required');
  const sdkProbe=`const {computer_use}=await import(${JSON.stringify(new URL('../src/index.mjs',import.meta.url).href)}); console.log(JSON.stringify(await computer_use.press_key({app:'Fixture',keys:['Return'],mode:'takeover'})));`;
  assert.equal(JSON.parse((await run(process.execPath,['--input-type=module','-e',sdkProbe],{env})).stdout).error_code,'desktop_turn_required');
  await assert.rejects(access(path.join(home,'control-token')),{code:'ENOENT'});
  assert.equal((await client.callTool({name:'interaction_mode',arguments:{}})).structuredContent.interaction_mode,'alongside');
  const invalid=(await client.callTool({name:'interaction_mode',arguments:{mode:'automatic'}})).structuredContent;
  assert.equal(invalid.ok,false);
  assert.equal(JSON.parse(await readFile(path.join(home,'interaction-mode.json'),'utf8')).mode,'alongside');
  await run(process.execPath,[cli,'mode','desktop'],{env});
  assert.equal((await client.callTool({name:'interaction_mode',arguments:{}})).structuredContent.interaction_mode,'desktop');
});

test('alongside retains exact-window AX work, forces omitted mode to background and preserves recovery', async t => {
  const home=await mkdtemp(path.join(os.tmpdir(),'opensky-alongside-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  writeInteractionMode(home,'alongside');
  const target={app:'Fixture',element_index:4,snapshot_id:'fresh'};
  for(const method of ['click','set_value','select_text','perform_secondary_action']) {
    assert.equal(prepareInteraction(home,method,target).params.mode,'background');
    assert.equal(prepareInteraction(home,method,{...target,snapshot_id:undefined}).result.error_code,'fresh_target_required');
  }
  assert.equal(prepareInteraction(home,'get_app_state',{app:'Fixture',window_id:123}).params.window_id,123);
  await writeFile(path.join(home,'interaction-mode.json'),'broken');
  assert.equal(readInteractionMode(home).ok,false);
  assert.equal(prepareInteraction(home,'click',target).result.error_code,'invalid_interaction_mode');
  for(const method of ['stop','resume','shutdown','status']) assert.deepEqual(prepareInteraction(home,method,{}),{params:{}});
  writeInteractionMode(home,'desktop');
  assert.equal(prepareInteraction(home,'click',{...target,mode:'takeover'}).params.mode,'takeover');
});
