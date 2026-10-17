import {readFileSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Aggregate metadata from the opted-in native monitor; never reads input contents. */
export function readUserActivity({
  home=globalThis.process?.env.OPENSKY_HOME??path.join(os.homedir(),'.local/share/opensky'),
  platform=globalThis.process?.platform,read=readFileSync,stat=statSync,now=Date.now,
  running=pid=>{try{globalThis.process.kill(pid,0);return true;}catch{return false;}}
}={}) {
  const unavailable={ok:false,error_code:'user_activity_unavailable',idle_seconds:null,source:'OpenSky filtered external-input monitor',input_contents_recorded:false,required_native_build:'1.3.3'};
  if(platform!=='darwin')return unavailable;
  try {
    const file=path.join(home,'user-activity.json'),info=stat(file);
    if((info.mode&0o077)!==0||globalThis.process?.getuid&&info.uid!==globalThis.process.getuid())return unavailable;
    const record=JSON.parse(read(file,'utf8')),age=(now()-record.sampled_at_ms)/1000;
    if(record.schema!==1||record.monitor_ready!==true||record.own_input_filtered!==true||record.input_contents_recorded!==false||!Number.isSafeInteger(record.pid)||record.pid<=0||!running(record.pid))return unavailable;
    if(!Number.isFinite(age)||age<0||age>1.5||!Number.isFinite(record.external_idle_seconds)||record.external_idle_seconds<0||!Number.isFinite(record.observed_for_seconds)||record.observed_for_seconds<record.external_idle_seconds)return unavailable;
    return {ok:true,idle_seconds:Math.floor((record.external_idle_seconds+age)*1000)/1000,source:unavailable.source,input_contents_recorded:false,own_input_filtered:true,sample_age_seconds:Math.floor(age*1000)/1000};
  }catch{return unavailable;}
}
