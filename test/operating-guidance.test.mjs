import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {getOperatingGuidance} from '../src/operator-guidance.mjs';

test('MCP and CLI expose the same auto guidance without starting an absent engine',async t=>{
  await mkdir(path.resolve(import.meta.dirname,'../research'),{recursive:true});
  const temporary=await mkdtemp(path.join(import.meta.dirname,'../research/2026-10-17-guidance-Codex-'));
  t.after(()=>rm(temporary,{recursive:true,force:true}));
  const runtime=path.join(temporary,'must-not-be-created');
  const environment={...process.env,OPENSKY_HOME:runtime,OPENSKY_BINARY:path.join(temporary,'missing-native-binary'),OPENSKY_PORT:'53789'};
  const client=new Client({name:'guidance-check',version:'1.0'},{capabilities:{}});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../src/mcp-server.mjs')],env:environment,stderr:'pipe'}));
  try{
    assert.equal(client.getInstructions(),getOperatingGuidance().instructions);
    assert.match(client.getInstructions().slice(0,650),/preserve an owner-selected auto idle policy/);
    const available=(await client.listTools()).tools;
    assert.ok(available.find(t=>t.name==='interaction_mode').inputSchema.properties.mode.enum.includes('auto'));
    assert.equal(available.find(t=>t.name==='user_activity').annotations.readOnlyHint,true);
    const activity=(await client.callTool({name:'user_activity',arguments:{}})).structuredContent;
    assert.equal(activity.input_contents_recorded,false);
    for(const name of ['get_app_state','click','set_value','find_elements']) assert.match(available.find(t=>t.name===name).description,/^Preferred OpenSky native Mac\/browser UI path/);
    const tool=(await client.listTools()).tools.find(t=>t.name==='get_operating_guidance');
    assert.equal(tool.annotations.readOnlyHint,true);
    const result=await client.callTool({name:'get_operating_guidance',arguments:{}});
    assert.equal(result.isError,false);assert.deepEqual(result.structuredContent,getOperatingGuidance());
    const chrome=await client.callTool({name:'chrome_tabs',arguments:{action:'list'}});
    assert.equal(chrome.isError,true);assert.equal(chrome.structuredContent.error_code,'chrome_setup_required');
    const {stdout}=await promisify(execFile)(process.execPath,[path.resolve(import.meta.dirname,'../src/cli.mjs'),'guidance','--json'],{env:environment});
    assert.deepEqual(JSON.parse(stdout),result.structuredContent);
    await assert.rejects(access(runtime),{code:'ENOENT'});
  }finally{await client.close();}
});
