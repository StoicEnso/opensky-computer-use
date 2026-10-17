import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, writeFile, rm, access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {findElementsWithComputer} from '../src/session.mjs';

const run=promisify(execFile);
const root=path.resolve(import.meta.dirname,'..');
const button={element_index:7,title:'Save',role:'button',identifier:'save',source:'ax',enabled:true,settable:false};

test('MCP, CLI and SDK share read-only exact-window element discovery',async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'opensky-find-'));
  await writeFile(path.join(home,'control-token'),'b'.repeat(64),{mode:0o600});
  await writeFile(path.join(home,'interaction-mode.json'),JSON.stringify({mode:'alongside'}),{mode:0o600});
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/health') return res.end(JSON.stringify({service:'OpenSky Computer Use Daemon',version:'1.3.0'}));
    if(req.url==='/status') return res.end(JSON.stringify({ok:true,service:'OpenSky Computer Use Daemon'}));
    let body='';for await(const part of req) body+=part;
    requests.push(JSON.parse(body));
    res.end(JSON.stringify({ok:true,app:'Fixture',window_id:123,snapshot_id:'fresh',elements:[button,{...button,element_index:8,source:'ocr'}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(home,{recursive:true,force:true});});
  const env={...process.env,OPENSKY_HOME:home,OPENSKY_PORT:String(server.address().port),OPENSKY_BINARY:path.join(home,'must-not-launch')};
  const client=new Client({name:'discovery-parity',version:'1'},{capabilities:{}});
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/mcp-server.mjs')],env,stderr:'pipe'}));
  t.after(()=>client.close());
  const params={app:'Fixture',window_id:123,selector:{name:'Save'}};
  const mcp=(await client.callTool({name:'find_elements',arguments:params})).structuredContent;
  const source=`const {computer_use}=await import(${JSON.stringify(new URL('../src/index.mjs',import.meta.url).href)});console.log(JSON.stringify(await computer_use.find_elements(${JSON.stringify(params)})));`;
  const sdk=JSON.parse((await run(process.execPath,['--input-type=module','-e',source],{env})).stdout);
  const cli=JSON.parse((await run(process.execPath,[path.join(root,'src/cli.mjs'),'find','Fixture','Save','--window','123','--json'],{env})).stdout);
  assert.deepEqual(sdk,mcp);assert.deepEqual(cli,mcp);
  assert.equal(mcp.snapshot_id,'fresh');assert.equal(mcp.window_id,123);assert.deepEqual(mcp.matches,[button]);
  assert.equal(requests.length,3);
  for(const request of requests) assert.deepEqual(request,{method:'get_app_state',params:{app:'Fixture',window_id:123,include_screenshot:false,include_ocr:false}});
});

test('discovery returns ambiguity and preserves failures without input or repeated inspection',async()=>{
  let calls=0;
  const computer={get_app_state:async p=>{calls++;assert.equal(p.include_ocr,true);return {ok:true,window_id:123,snapshot_id:'fresh',elements:[button,{...button,element_index:9}]};}};
  const result=await findElementsWithComputer(computer,{app:'Fixture',window_id:123,selector:{name:'Save',source:'any'}});
  assert.equal(result.match_count,2);assert.equal(calls,1);
  await assert.rejects(findElementsWithComputer(computer,{app:'Fixture',selector:{nmae:'Save'}}),{code:'invalid_selector'});
  await assert.rejects(findElementsWithComputer(computer,{app:'Fixture',window_id:0,selector:{name:'Save'}}),{code:'invalid_window'});
  assert.equal(calls,1);
  const failure={ok:false,error_code:'exact_window_unavailable',error:'Window gone'};
  assert.equal(await findElementsWithComputer({get_app_state:async()=>failure},{app:'Fixture',window_id:123,selector:{name:'Save'}}),failure);
});

test('subcommand help does not inspect an app or start a missing engine',async t=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'opensky-help-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const runtime=path.join(home,'absent');
  const env={...process.env,OPENSKY_HOME:runtime,OPENSKY_PORT:'53787',OPENSKY_BINARY:path.join(home,'must-not-launch')};
  for(const command of ['find','state','click']) {
    const result=await run(process.execPath,[path.join(root,'src/cli.mjs'),command,'--help'],{env});
    assert.match(result.stdout,/Usage: opensky/);assert.equal(result.stderr,'');
  }
  await assert.rejects(access(runtime),{code:'ENOENT'});
});
