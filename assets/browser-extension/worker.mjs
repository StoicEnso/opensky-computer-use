import {createBrowserController} from './controller.mjs';

let port,connecting=false,connected=false,error='',userPaused=true,bridgePaused=true,autoReconnect=true,brokerGeneration=0;
const localReady=chrome.storage.local.get(['profile_id','user_paused','auto_reconnect']).then(async value=>{userPaused=value.user_paused===true;autoReconnect=value.auto_reconnect!==false;if(!value.profile_id){value.profile_id=crypto.randomUUID();await chrome.storage.local.set({profile_id:value.profile_id});}return value.profile_id;});
const controller=createBrowserController(chrome,{canAct:()=>!userPaused&&!bridgePaused});
const readMethods=new Set(['status','tabs_list','snapshot','frames','screenshot']);
const state=()=>({connected,paused:userPaused||bridgePaused,error,version:chrome.runtime.getManifest().version});
async function connect({explicit=false}={}) {
  if(port||connecting)return;
  connecting=true;
  try{
    const profile_id=await localReady;
    if(explicit){autoReconnect=true;await chrome.storage.local.set({auto_reconnect:true});}
    if(!autoReconnect)return;
    port=chrome.runtime.connectNative('dev.opensky.browser');
    port.onDisconnect.addListener(()=>{error=chrome.runtime.lastError?.message??'OpenSky local bridge disconnected.';connected=false;port=null;controller.cancel();});
    port.onMessage.addListener(async message=>{
      if(message.type==='ready'){connected=true;error='';brokerGeneration=message.generation;bridgePaused=message.paused;return;}
      if(message.type==='shutdown'){autoReconnect=false;userPaused=true;bridgePaused=true;controller.cancel();await chrome.storage.local.set({auto_reconnect:false,user_paused:true});port?.disconnect();return;}
      if(message.type==='cancel'){brokerGeneration=message.generation;bridgePaused=true;controller.cancel();return;}
      if(message.type==='resume'){brokerGeneration=message.generation;bridgePaused=false;userPaused=false;await chrome.storage.local.set({user_paused:false});await controller.resumeTabs();return;}
      if(message.type!=='request')return;
      let result;
      if(message.generation!==brokerGeneration||!readMethods.has(message.method)&&(userPaused||bridgePaused))result={ok:false,error_code:'stopped',error:'OpenSky browser control is paused.'};
      else result=await controller.run(message.method,message.params);
      try{port?.postMessage({type:'result',id:message.id,result});}catch{/* Broker reports disconnect; input is never retried. */}
    });
    port.postMessage({type:'hello',profile_id,version:chrome.runtime.getManifest().version});
  }catch(e){error=e.message;port=null;}finally{connecting=false;}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  void(async()=>{
    await localReady;
    if(message.action==='connect')await connect({explicit:true});
    if(message.action==='stop'){userPaused=true;controller.cancel();await chrome.storage.local.set({user_paused:true});port?.postMessage({type:'user_pause'});await controller.close();}
    if(message.action==='resume'){await connect({explicit:true});userPaused=false;await chrome.storage.local.set({user_paused:false});await controller.resumeTabs();port?.postMessage({type:'user_resume'});}
    respond(state());
  })();return true;
});
chrome.runtime.onInstalled.addListener(()=>{void connect();});
chrome.runtime.onStartup.addListener(()=>{void connect();});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='opensky-reconnect'&&!port)void connect();});
void chrome.alarms.create('opensky-reconnect',{periodInMinutes:.5});
void connect();
