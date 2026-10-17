let state,refreshing,messageSource,closed=false;
const $=id=>document.getElementById(id);
const text=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
function message(value,error=false,source='action'){text('message',value);$('message').classList.toggle('error',error);messageSource=source;}
function updateConfig(){if(state?.configs)text('config',typeof state.configs[$('client').value]==='string'?state.configs[$('client').value]:JSON.stringify(state.configs[$('client').value],null,2));}
function refresh(){
  if(closed)return Promise.resolve();
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    try{
      const response=await fetch('state');if(!response.ok)throw new Error(response.status>=500?'Could not check readiness. Choose Check again.':'Setup is no longer available. Run opensky onboard again.');
      const next=await response.json();if(!next.ok)throw new Error('Could not check readiness. Choose Check again.');
      const previous=state?.browserConnectionState;state=next;
      for(const [id,ready] of [['service',state.running&&!state.stopped],['accessibility',state.accessibility],['screen',state.screenRecording]]) $(id+'-dot').classList.toggle('ready',ready);
      text('service-state',state.stopped?'Paused — resume explicitly when you are ready.':state.running?'Running on this Mac':'Not running');
      $('start').hidden=state.running;
      text('accessibility-state',state.accessibility?'Verified access':'Enable OpenSky in the Mac setting');
      text('screen-state',state.screenRecording?'Verified access':'Enable OpenSky in the Mac setting');
      $('accessibility').hidden=state.accessibility;$('screen').hidden=state.screenRecording;
      const ready=state.running&&!state.stopped&&state.accessibility&&state.screenRecording;
      text('ready-badge',ready?'DESKTOP DEMO READY':'MAC SETUP IN PROGRESS');$('demo').disabled=!ready;
      text('chrome-state',state.chromeEnabled?'Enabled after successful setup':'Off until you choose to enable it.');
      $('chrome').hidden=state.chromeEnabled;updateConfig();
      // Keep older setup servers readable; host registration never proves connection.
      const phase=state.browserConnectionState??(state.browserConnected?(state.browserPaused?'paused':'connected'):'unregistered');
      const descriptions={unregistered:'Set up the local connection, then load the Chrome extension.',waiting:'Local host registered. Waiting for Chrome to connect…',connected:'Chrome connection verified. Background tabs and uploads are ready.',paused:'Chrome is connected. Control is paused; resume OpenSky explicitly when you are ready.'};
      text('browser-state',descriptions[phase]??'Chrome connection could not be checked.');
      text('browser-path',state.browserExtensionPath??'Run opensky web install to find the extension folder.');
      $('browser').hidden=!!state.browserConnected||!!state.browserHostRegistered;
      $('browser-install-steps').hidden=!!state.browserConnected;
      $('browser-folder').hidden=!state.browserFolderRevealAvailable;
      if(messageSource==='readiness')message('');
      if(previous==='waiting'&&phase==='connected')message('Chrome connection verified. Continue your task in your agent.');
    }catch(error){
      state=undefined;$('demo').disabled=true;text('ready-badge','READINESS NOT VERIFIED');text('browser-state','Connection could not be checked. Choose Check again.');message(error.message,true,'readiness');
    }
  })().finally(()=>{refreshing=undefined;});
  return refreshing;
}
for(const button of document.querySelectorAll('[data-action]')) button.addEventListener('click',async()=>{
  button.disabled=true;message(button.dataset.action==='chrome'?'Check your Mac for the optional Chrome permission dialog. Native Accessibility remains available.':'Working…');
  try{
    const response=await fetch('action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:button.dataset.action})});
    const result=await response.json();if(!result.ok)throw new Error(result.error||'The action could not be completed.');message(result.message||'Done.');
    if(button.dataset.action==='close'){closed=true;clearInterval(poll);}else await refresh();
  }catch(error){message(error.message,true);}finally{button.disabled=false;if(button.id==='demo')$('demo').disabled=!(state?.running&&!state.stopped&&state.accessibility&&state.screenRecording);}
});
$('refresh').addEventListener('click',refresh);$('client').addEventListener('change',updateConfig);
async function copy(id,success,failure){try{await navigator.clipboard.writeText($(id).textContent);message(success);}catch{message(failure,true);}}
$('copy').addEventListener('click',()=>copy('config','Configuration copied. Add it in your agent’s MCP settings.','Select the configuration text to copy it.'));
$('copy-browser-path').addEventListener('click',()=>copy('browser-path','Folder path copied. In Chrome’s folder picker, press Command+Shift+G and paste it.','Select the folder path above to copy it.'));
window.addEventListener('focus',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
// Only readiness GETs run automatically. No install, restart, reveal, copy or resume.
const poll=setInterval(()=>{if(!document.hidden||state?.browserConnectionState==='waiting')void refresh();},2000);
refresh();
