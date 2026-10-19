import {mkdirSync,writeFileSync,renameSync,readFileSync,readdirSync,lstatSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import nodeProcess from 'node:process';

const proc=globalThis.process??nodeProcess;
const allowed=new Set(['native.list_apps','native.get_app_state','native.click','native.drag','native.scroll','native.set_value','native.type_text','native.press_key','native.paste','native.perform_secondary_action','native.select_text','native.manage_window','native.run_applescript','native.screenshot_screen','browser.tabs_list','browser.tab_open','browser.tab_claim','browser.tab_navigate','browser.tab_close','browser.tab_release','browser.snapshot','browser.frames','browser.click','browser.fill','browser.upload','browser.press_key','browser.select_option','browser.screenshot']);
const deferred=new Set(['desktop_turn_required','stopped','cancelled']);
const filePattern=/^[a-f0-9-]{36}\.json$/;
const dayAt=ms=>{const d=new Date(ms);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const living=pid=>{try{proc?.kill(pid,0);return !!proc;}catch(error){return error.code==='EPERM';}};
let identity={name:proc?.env?.CLAUDECODE?'Claude Code':'JavaScript',interface:'SDK'};
const recorders=new Map();

export function activityClientName(name='') {
  if(/claude.*code/i.test(name))return 'Claude Code';
  if(/claude/i.test(name))return 'Claude';
  if(/codex|chatgpt/i.test(name))return 'Codex';
  if(/antigravity/i.test(name))return 'Antigravity';
  if(/cursor/i.test(name))return 'Cursor';
  return 'MCP client';
}

export function configureActivityClient({name,interface:transport='MCP'}={}) {
  identity={name:transport==='CLI'?'Terminal':activityClientName(name),interface:transport==='CLI'?'CLI':'MCP'};
  for(const recorder of recorders.values())recorder.identify(identity);
}

/** Aggregate counters only. Never accept/store request parameters, outputs or errors. */
export function createActivityRecorder({home,pid=proc?.pid,now=Date.now,id=randomUUID(),client=identity}={}) {
  const directory=path.join(home,'agent-activity');
  const state={schema:1,id,pid,name:client.name,interface:client.interface,updated_at:0,day:dayAt(now()),calls:0,failed:0,deferred:0,duration_ms:0,pending:[],buckets:[]};
  let initialized=false;
  const persist=()=>{
    let temporary;
    try {
      mkdirSync(directory,{recursive:true,mode:0o700});
      if(!initialized){
        initialized=true;
        for(const file of readdirSync(directory).filter(name=>filePattern.test(name))){
          const target=path.join(directory,file),stat=lstatSync(target);
          if(stat.isFile()&&!stat.isSymbolicLink()&&stat.mtimeMs<now()-2*86400000)rmSync(target,{force:true});
        }
      }
      state.updated_at=now();
      temporary=path.join(directory,`.${id}.${randomUUID()}.tmp`);
      writeFileSync(temporary,JSON.stringify(state)+'\n',{mode:0o600,flag:'wx'});
      renameSync(temporary,path.join(directory,`${id}.json`));
    }catch{/* Optional local counters must never block or retry computer input. */}
    finally{if(temporary)try{rmSync(temporary,{force:true});}catch{}}
  };
  return {
    identify(client){state.name=client.name;state.interface=client.interface;},
    begin(method){
      if(!allowed.has(method))return ()=>{};
      const request={id:randomUUID(),method,started_at:now()};
      state.pending.push(request);persist();
      let finished=false;
      return result=>{
        if(finished)return;finished=true;
        state.pending=state.pending.filter(item=>item.id!==request.id);
        const time=now(),day=dayAt(time);
        if(state.day!==day){state.day=day;state.calls=state.failed=state.deferred=state.duration_ms=0;}
        state.calls++;
        state.duration_ms+=Math.min(120000,Math.max(0,time-request.started_at));
        const blocked=result?.ok===false&&deferred.has(result?.error_code);
        if(blocked)state.deferred++;else if(result?.ok===false)state.failed++;
        const minute=Math.floor(time/60000)*60000;
        state.buckets=state.buckets.filter(bin=>bin.minute>=minute-14*60000);
        let bin=state.buckets.find(bin=>bin.minute===minute);
        if(!bin){bin={minute,calls:0};state.buckets.push(bin);}bin.calls++;
        persist();
      };
    }
  };
}

export async function trackAgentOperation(home,method,operation) {
  if(!allowed.has(method)||proc?.env?.OPENSKY_ACTIVITY==='0')return operation();
  let recorder=recorders.get(home);
  if(!recorder){recorder=createActivityRecorder({home});recorders.set(home,recorder);}
  const finish=recorder.begin(method);
  try{const result=await operation();finish(result);return result;}
  catch(error){finish({ok:false});throw error;}
}

export function readAgentActivity({home=proc?.env?.OPENSKY_HOME||path.join(os.homedir(),'.local/share/opensky'),now=Date.now,isAlive=living}={}) {
  const time=now(),minute=Math.floor(time/60000)*60000;
  const bins=Array.from({length:15},(_,i)=>({minute:minute-(14-i)*60000,calls:0}));
  const result={ok:true,schema:1,working:0,recent:0,calls:0,failed:0,deferred:0,average_ms:0,clients:[],buckets:bins,coverage:'Instrumented MCP, CLI and SDK clients; shared connections count once. Older clients need reconnecting. Raw native callers are not included.'};
  let duration=0,files=[];
  try{files=readdirSync(path.join(home,'agent-activity')).filter(file=>filePattern.test(file));}catch{return result;}
  for(const file of files){try{
    const target=path.join(home,'agent-activity',file),stat=lstatSync(target);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)continue;
    const record=JSON.parse(readFileSync(target,'utf8'));
    if(record.schema!==1||record.id+'.json'!==file||!Number.isSafeInteger(record.pid)||record.pid<=0||record.pid>2147483647||!Number.isFinite(record.updated_at)||record.updated_at>time+1000||record.updated_at<time-2*86400000)continue;
    const counts=['calls','failed','deferred','duration_ms'];
    if(counts.some(key=>!Number.isFinite(record[key])||record[key]<0))continue;
    if(!Array.isArray(record.pending)||!Array.isArray(record.buckets))continue;
    if(record.pending.some(item=>!item||typeof item.method!=='string'||!Number.isFinite(item.started_at)))continue;
    if(record.buckets.some(bin=>!bin||!Number.isFinite(bin.minute)||!Number.isFinite(bin.calls)||bin.calls<0))continue;
    if(record.day===dayAt(time)){for(const key of ['calls','failed','deferred'])result[key]+=record[key];duration+=record.duration_ms;}
    for(const bin of record.buckets??[]){const match=bins.find(value=>value.minute===bin.minute);if(match&&Number.isFinite(bin.calls)&&bin.calls>=0)match.calls+=bin.calls;}
    if(!isAlive(record.pid))continue;
    const pending=(record.pending??[]).filter(item=>allowed.has(item.method)&&Number.isFinite(item.started_at)&&item.started_at<=time&&item.started_at>=time-90000);
    const working=pending.length>0,recent=time-record.updated_at<=60000;
    if(!working&&!recent)continue;
    if(working)result.working++;else result.recent++;
    const name=['Claude Code','Claude','Codex','Antigravity','Cursor','Terminal','JavaScript','MCP client'].includes(record.name)?record.name:'MCP client';
    result.clients.push({id:record.id,name,interface:['MCP','CLI','SDK'].includes(record.interface)?record.interface:'SDK',working,pending:pending.length,method:pending[0]?.method??'',last_seen:record.updated_at});
  }catch{/* Ignore a corrupt or interrupted optional counter file. */}}
  result.average_ms=result.calls?duration/result.calls:0;
  result.clients.sort((a,b)=>Number(b.working)-Number(a.working)||b.last_seen-a.last_seen||a.id.localeCompare(b.id));
  return result;
}
