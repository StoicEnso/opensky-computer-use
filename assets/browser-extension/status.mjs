export function bindBrowserStatus(document,runtime) {
  let reloading=false;
  const status=document.querySelector('#state'),error=document.querySelector('#error'),version=document.querySelector('#version'),reload=document.querySelector('#reload');
  async function refresh(action='status') {
    try {
      const state=await runtime.sendMessage({action});if(reloading)return;
      status.textContent=state.connected?(state.paused?'Connected · paused':'Connected · ready for your agent'):'Local bridge is not connected';
      version.textContent=state.version?'Loaded extension '+state.version:'';error.textContent=state.error??'';
    }catch(e){if(!reloading)error.textContent=e.message;}
  }
  for(const button of document.querySelectorAll('[data-action]'))button.addEventListener('click',()=>refresh(button.dataset.action));
  reload.addEventListener('click',()=>{
    if(reloading)return;reloading=true;reload.disabled=true;error.textContent='';status.textContent='Reloading OpenSky Browser…';
    try{runtime.reload();}catch(e){reloading=false;reload.disabled=false;error.textContent=e.message;void refresh();}
  });
  void refresh();
  return {refresh};
}
if(typeof document!=='undefined'&&typeof chrome!=='undefined')bindBrowserStatus(document,chrome.runtime);
