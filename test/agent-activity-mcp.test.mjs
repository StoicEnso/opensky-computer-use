import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,writeFileSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('real MCP clients report concurrent native requests without counting their own status reads',{timeout:15000},async()=>{
  const home=mkdtempSync(path.join(os.tmpdir(),'2026-10-19-opensky-mcp-activity-Codex-'));
  const token='a'.repeat(64);writeFileSync(path.join(home,'control-token'),token,{mode:0o600});
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/health'){res.end(JSON.stringify({service:'OpenSky Computer Use Daemon',version:'1.3.0'}));return;}
    assert.equal(req.headers.authorization,`Bearer ${token}`);
    if(req.url==='/status'){res.end(JSON.stringify({ok:true,service:'OpenSky Computer Use Daemon',build_version:'1.3.9'}));return;}
    let body='';for await(const chunk of req)body+=chunk;
    assert.equal(JSON.parse(body).method,'get_app_state');requests.push(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const clients=[];
  try{
    for(const name of ['Codex','claude-code']){
      const client=new Client({name,version:'1.0'},{capabilities:{}});
      await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../src/mcp-server.mjs')],env:{...process.env,OPENSKY_HOME:home,OPENSKY_PORT:String(server.address().port)}}));clients.push(client);
    }
    const pending=clients.map(client=>client.callTool({name:'get_app_state',arguments:{app:'dev.opensky.fixture',include_screenshot:false}}));
    for(let i=0;i<100&&requests.length<2;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(requests.length,2);
    let activity=(await clients[0].callTool({name:'agent_activity',arguments:{}})).structuredContent;
    assert.equal(activity.working,2);assert.equal(activity.calls,0);assert.deepEqual(activity.clients.map(c=>c.name).sort(),['Claude Code','Codex']);
    for(const res of requests)res.end(JSON.stringify({ok:true,text:'fixture-page-secret-not-stored'}));
    await Promise.all(pending);
    activity=(await clients[0].callTool({name:'agent_activity',arguments:{}})).structuredContent;
    assert.equal(activity.calls,2);assert.equal(activity.working,0);assert.equal(activity.recent,2);
    for(const file of readdirSync(path.join(home,'agent-activity'))){const text=readFileSync(path.join(home,'agent-activity',file),'utf8');assert.equal(text.includes('fixture-page-secret'),false);assert.equal(text.includes('dev.opensky.fixture'),false);}
  }finally{
    for(const res of requests)res.end('{}');
    await Promise.all(clients.map(client=>client.close()));
    await new Promise(resolve=>server.close(resolve));rmSync(home,{recursive:true,force:true});
  }
});
