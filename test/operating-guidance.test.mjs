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
    const tool=(await client.listTools()).tools.find(t=>t.name==='get_operating_guidance');
    assert.equal(tool.annotations.readOnlyHint,true);
    const result=await client.callTool({name:'get_operating_guidance',arguments:{}});
    assert.equal(result.isError,false);assert.deepEqual(result.structuredContent,getOperatingGuidance());
    const {stdout}=await promisify(execFile)(process.execPath,[path.resolve(import.meta.dirname,'../src/cli.mjs'),'guidance','--json'],{env:environment});
    assert.deepEqual(JSON.parse(stdout),result.structuredContent);
    await assert.rejects(access(runtime),{code:'ENOENT'});
  }finally{await client.close();}
});
