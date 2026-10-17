async function refresh(action='status'){try{const state=await chrome.runtime.sendMessage({action});document.querySelector('#state').textContent=state.connected?(state.paused?'Connected · paused':'Connected · ready for your agent'):'Local bridge is not connected';document.querySelector('#error').textContent=state.error??'';}catch(e){document.querySelector('#error').textContent=e.message;}}
for(const button of document.querySelectorAll('[data-action]'))button.addEventListener('click',()=>refresh(button.dataset.action));
void refresh();
