let state;
const $=id=>document.getElementById(id);
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function updateConfig(){if(state)$('config').textContent=typeof state.configs[$('client').value]==='string'?state.configs[$('client').value]:JSON.stringify(state.configs[$('client').value],null,2);}
async function refresh(){
  try{
    const response=await fetch('state');if(!response.ok)throw new Error('Setup is no longer available. Run opensky onboard again.');
    state=await response.json();
    for(const [id,ready] of [['service',state.running&&!state.stopped],['accessibility',state.accessibility],['screen',state.screenRecording]]) $(id+'-dot').classList.toggle('ready',ready);
    $('service-state').textContent=state.stopped?'Paused — resume explicitly when you are ready.':state.running?'Running on this Mac':'Not running';
    $('start').hidden=state.running;
    $('accessibility-state').textContent=state.accessibility?'Verified access':'Enable OpenSky in the Mac setting';
    $('screen-state').textContent=state.screenRecording?'Verified access':'Enable OpenSky in the Mac setting';
    $('accessibility').hidden=state.accessibility;$('screen').hidden=state.screenRecording;
    const ready=state.running&&!state.stopped&&state.accessibility&&state.screenRecording;
    $('ready-badge').textContent=ready?'READY FOR COMPUTER USE':'SETUP IN PROGRESS';$('demo').disabled=!ready;
    $('chrome-state').textContent=state.chromeEnabled?'Enabled after successful setup':'Off until you choose to enable it.';
    $('chrome').hidden=state.chromeEnabled;updateConfig();
    $('browser-state').textContent=state.browserConnected?'Connected to Chrome':'One-time extension setup needed';
    $('browser-path').textContent=state.browserExtensionPath;
    $('browser').hidden=state.browserConnected;
  }catch(error){message(error.message,true);}
}
for(const button of document.querySelectorAll('[data-action]')) button.addEventListener('click',async()=>{
  button.disabled=true;message(button.dataset.action==='chrome'?'Check your Mac for the optional Chrome permission dialog. Native Accessibility remains available.':'Working…');
  try{
    const response=await fetch('action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:button.dataset.action})});
    const result=await response.json();if(!result.ok)throw new Error(result.error||'The action could not be completed.');message(result.message||'Done.');
    if(button.dataset.action!=='close')await refresh();
  }catch(error){message(error.message,true);}finally{button.disabled=false;if(button.id==='demo'&&state)$('demo').disabled=!(state.running&&!state.stopped&&state.accessibility&&state.screenRecording);}
});
$('refresh').addEventListener('click',refresh);$('client').addEventListener('change',updateConfig);
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('config').textContent);message('Configuration copied. Add it in your agent’s MCP settings.');}catch{message('Select the configuration text to copy it.',true);}});
window.addEventListener('focus',refresh);refresh();
