import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {browserSettings,browserToken,browserPaused,writeBrowserPaused,nativeStopped,BROWSER_SERVICE,BROWSER_PROTOCOL,browserReads,browserMethods} from './settings.mjs';
import {jsonLineReader} from './framing.mjs';

export async function startBrowserBridge(settings=browserSettings()) {
  const token=browserToken(settings,true),connections=new Map(),pending=new Map();let generation=0,closeBridge;
  const authorized=value=>typeof value==='string'&&Buffer.byteLength(value)===Buffer.byteLength(token)&&timingSafeEqual(Buffer.from(value),Buffer.from(token));
  const send=(socket,value)=>{if(!socket.destroyed)socket.write(JSON.stringify(value)+'\n');};
  const cancel=reason=>{generation++;for(const c of connections.values())send(c.socket,{type:'cancel',generation});for(const [id,p]of pending){clearTimeout(p.timer);p.resolve({ok:false,error_code:'cancelled',error:reason,outcome:'Inspect any input already delivered before retrying.'});pending.delete(id);}};
  const peers=net.createServer(socket=>{
    let connectionId;
    const authTimer=setTimeout(()=>socket.destroy(),2000);
    const read=jsonLineReader(message=>{
      if(!connectionId){if(message.type!=='hello'||!authorized(message.token)||typeof message.profile_id!=='string')return socket.destroy();clearTimeout(authTimer);connectionId=randomUUID();connections.set(connectionId,{socket,profile_id:message.profile_id,extension_version:message.version});send(socket,{type:'ready',generation,paused:browserPaused(settings)});return;}
      if(message.type==='result'){const p=pending.get(message.id);if(p&&p.connectionId===connectionId){pending.delete(message.id);clearTimeout(p.timer);p.resolve(message.result);}}
      if(message.type==='user_pause'){writeBrowserPaused(settings,true);cancel('Stopped from the OpenSky Chrome extension.');}
      if(message.type==='user_resume'){void nativeStopped(settings).then(stopped=>{if(stopped){send(socket,{type:'ready',generation,paused:true,native_paused:true});return;}writeBrowserPaused(settings,false);for(const c of connections.values())send(c.socket,{type:'resume',generation});});}
    });
    socket.on('data',chunk=>{try{read(chunk);}catch{socket.destroy();}});socket.on('error',()=>{});
    socket.on('close',()=>{clearTimeout(authTimer);connections.delete(connectionId);for(const[id,p]of pending)if(p.connectionId===connectionId){clearTimeout(p.timer);p.resolve({ok:false,error_code:'browser_disconnected',error:'Chrome connection closed.',outcome:'Inspect before repeating any input.'});pending.delete(id);}});
  });
  if(fs.existsSync(settings.socket)){
    const info=fs.lstatSync(settings.socket);if(!info.isSocket()||info.uid!==process.getuid?.())throw new Error('Browser socket path is not an owned socket.');
    const live=await new Promise(resolve=>{const s=net.connect(settings.socket);s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));});
    if(live)throw new Error('Browser bridge socket is already in use.');fs.unlinkSync(settings.socket);
  }
  await new Promise((resolve,reject)=>{peers.once('error',reject);peers.listen(settings.socket,resolve);});fs.chmodSync(settings.socket,0o600);
  const body=async req=>{let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>2*1024*1024)throw new Error('Request too large.');}return JSON.parse(text||'{}');};
  const status=()=>({ok:true,service:BROWSER_SERVICE,protocol:BROWSER_PROTOCOL,pid:process.pid,connected:connections.size>0,paused:browserPaused(settings),profiles:[...connections.values()].map(c=>({profile_id:c.profile_id,extension_version:c.extension_version})),pending:pending.size});
  const server=http.createServer(async(req,res)=>{
    const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    if(req.headers.host!==`127.0.0.1:${settings.port}`||req.headers.origin||!authorized(req.headers.authorization?.replace(/^Bearer /,'')))return reply(403,{ok:false,error:'Local OpenSky credentials required.'});
    try{
      if(req.method==='GET'&&req.url==='/status')return reply(200,status());
      if(req.method==='POST'&&req.url==='/shutdown'){writeBrowserPaused(settings,true);for(const c of connections.values())send(c.socket,{type:'shutdown'});reply(200,{ok:true,shutdown:true});setImmediate(()=>void closeBridge());return;}
      if(req.method==='POST'&&req.url==='/pause'){const value=await body(req);if(typeof value.paused!=='boolean')throw new Error('paused must be boolean.');writeBrowserPaused(settings,value.paused);if(value.paused)cancel('OpenSky browser control stopped.');else for(const c of connections.values())send(c.socket,{type:'resume',generation});return reply(200,status());}
      if(req.method!=='POST'||req.url!=='/rpc')return reply(404,{ok:false,error:'Unknown route.'});
      const {method,params={}}=await body(req);
      if(!browserMethods.has(method)||!params||typeof params!=='object'||Array.isArray(params))return reply(400,{ok:false,error_code:'invalid_browser_request',error:'Unknown browser method or invalid parameters.'});
      if(Buffer.byteLength(JSON.stringify({method,params}))>900000)throw new Error('Browser command exceeds the native-messaging command limit.');
      if(!browserReads.has(method)&&(browserPaused(settings)||await nativeStopped(settings)))return reply(409,{ok:false,error_code:'stopped',error:'OpenSky control is paused; resume explicitly.'});
      if(method==='upload'){
        if(!Array.isArray(params.files)||!params.files.length||params.files.length>20)throw new Error('Provide 1–20 absolute file paths.');
        for(const file of params.files)if(typeof file!=='string'||!path.isAbsolute(file)||!fs.statSync(file).isFile())throw new Error('Upload paths must identify existing regular files.');
      }
      const candidates=[...connections.entries()].filter(([,c])=>!params.profile_id||c.profile_id===params.profile_id);
      if(candidates.length!==1)return reply(409,{ok:false,error_code:candidates.length?'browser_profile_ambiguous':'browser_extension_disconnected',error:candidates.length?'Choose an observed profile_id; no Chrome profile was guessed.':'The OpenSky Chrome extension is not connected.'});
      if(pending.size>=64)return reply(429,{ok:false,error_code:'queue_full',error:'Browser request queue is full.'});
      const [connectionId,c]=candidates[0],id=randomUUID(),requestGeneration=generation;
      const result=await new Promise(resolve=>{const timer=setTimeout(()=>{pending.delete(id);resolve({ok:false,error_code:'browser_request_timeout',error:'Browser request timed out.',outcome:'Input may have been delivered. Inspect before retrying.'});},35000);pending.set(id,{resolve,timer,connectionId});send(c.socket,{type:'request',id,method,params,generation:requestGeneration});});
      return reply(200,result);
    }catch(error){return reply(400,{ok:false,error_code:'invalid_browser_request',error:error.message});}
  });
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(settings.port,'127.0.0.1',resolve);});}catch(e){peers.close();fs.rmSync(settings.socket,{force:true});throw e;}
  let checking=false;
  const pausePoll=setInterval(async()=>{if(checking||!pending.size)return;checking=true;try{if(await nativeStopped(settings))cancel('Native emergency pause interrupted browser requests.');}finally{checking=false;}},200);pausePoll.unref();
  closeBridge=async()=>{clearInterval(pausePoll);cancel('Bridge closed.');for(const c of connections.values()){c.socket.end();const timer=setTimeout(()=>c.socket.destroy(),500);timer.unref();}await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>peers.close(r))]);fs.rmSync(settings.socket,{force:true});};
  return {status,server,peers,close:closeBridge};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startBrowserBridge().then(bridge=>{for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>bridge.close().then(()=>process.exit(0)));}).catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
