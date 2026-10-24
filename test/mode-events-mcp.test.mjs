import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {LoggingMessageNotificationSchema} from '@modelcontextprotocol/sdk/types.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async test=>{for(let i=0;i<150;i++){if(test())return;await sleep(10);}assert.fail('Expected notification was not delivered');};
test('two generic MCP agents receive both transitions while native work is pending',{timeout:15000},async()=>{
  const home=mkdtempSync(path.join(os.tmpdir(),'2026-10-24-opensky-events-Codex-'));
  writeFileSync(path.join(home,'control-token'),'a'.repeat(64),{mode:0o600});
  writeFileSync(path.join(home,'interaction-mode.json'),JSON.stringify({mode:'auto'}));
  const activity=idle=>writeFileSync(path.join(home,'user-activity.json'),JSON.stringify({schema:1,pid:process.pid,sampled_at_ms:Date.now(),external_idle_seconds:idle,observed_for_seconds:300,monitor_ready:true,own_input_filtered:true,input_contents_recorded:false}),{mode:0o600});
  activity(121);let pending;
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/health')res.end(JSON.stringify({service:'OpenSky Computer Use Daemon',version:'1.3.0'}));
    else if(req.url==='/status')res.end(JSON.stringify({ok:true,service:'OpenSky Computer Use Daemon',build_version:'1.4.5'}));
    else {for await(const _ of req){}pending=res;}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const clients=[],events=[[],[]];
  try {
    for(let i=0;i<2;i++) {
      const client=new Client({name:`fixture-${i}`,version:'1'},{capabilities:{}});
      client.setNotificationHandler(LoggingMessageNotificationSchema,n=>events[i].push(n.params));
      await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve(import.meta.dirname,'../src/mcp-server.mjs')],env:{...process.env,OPENSKY_HOME:home,OPENSKY_PORT:String(server.address().port)}}));clients.push(client);
    }
    await until(()=>events.every(e=>e.length===1));
    assert.ok(clients[0].getServerCapabilities().logging);
    const work=clients[0].callTool({name:'type_text',arguments:{app:'disposable-fixture',text:'private-not-logged',return_state:false}});
    await until(()=>pending);
    activity(0);await until(()=>events.every(e=>e.some(x=>x.data.event==='alongside')));
    assert.ok(pending,'Notifications must arrive while the tool call is in flight');
    pending.end(JSON.stringify({ok:false,error_code:'desktop_yielded'}));
    assert.equal((await work).structuredContent.cooperation.effective_mode,'alongside');
    const wait=clients[0].callTool({name:'wait_for_mode',arguments:{timeout_ms:5000}});
    activity(121);await until(()=>events.every(e=>e.some(x=>x.data.event==='desktop_available')));
    assert.equal((await wait).structuredContent.matched,true);
    await clients[0].setLoggingLevel('error');
    const count=events[0].length;activity(0);await until(()=>events[1].at(-1).data.event==='alongside');
    assert.equal(events[0].length,count);
    assert.equal(JSON.stringify(events).includes('private-not-logged'),false);
  }finally {pending?.end('{}');await Promise.all(clients.map(c=>c.close()));await new Promise(r=>server.close(r));rmSync(home,{recursive:true,force:true});}
});
