import {readInteractionMode} from './interaction-mode.mjs';

/** Content-free cooperation state, suitable for agents and local event streams. */
export function cooperationState(home, readMode=readInteractionMode) {
  const state=readMode(home);
  const effective=state.ok ? state.effective_mode??state.interaction_mode : 'alongside';
  const reason=!state.ok?'mode_unavailable':state.desktop_override?'explicit_desktop_turn':
    state.interaction_mode==='auto'?(state.user_activity?.ok?(effective==='desktop'?'idle':'owner_active'):'activity_unavailable'):'selected';
  return {interaction_mode:state.interaction_mode??'unavailable',effective_mode:effective,
    desktop_available:effective==='desktop',reason,
    next_step:effective==='desktop'?
      'Desktop is available under the saved cooperation policy. Re-observe the saved checkpoint and continue authorized work. Never replay uncertain input or resume emergency pause automatically.':
      'Yield shared keyboard, pointer, clipboard and foreground work. Continue supported exact-window background AX or browser work, or wait for desktop availability. Preserve the checkpoint; no repeated permission question is needed.'};
}

/** Returns cleanup; never launches, changes mode, retries input or resumes control. */
export function watchInteractionMode(listener,{home,readMode,intervalMs=250,initial=true,keepAlive=false}={}) {
  let last,sequence=0,closed=false;
  const poll=()=>{
    if(closed)return;
    const state=cooperationState(home,readMode),key=JSON.stringify(state);
    if(last===key)return;
    const first=last===undefined;last=key;
    if(first&&!initial)return;
    listener({type:'opensky.cooperation',event:first?'mode_state':state.desktop_available?'desktop_available':'alongside',
      sequence:++sequence,at:new Date().toISOString(),...state});
  };
  poll();const timer=setInterval(poll,intervalMs);if(!keepAlive)timer.unref?.();
  return ()=>{closed=true;clearInterval(timer);};
}

/** Bounded wait for hosts that do not deliver MCP log notifications to an agent. */
export async function waitForInteractionMode({home,effective_mode='desktop',timeout_ms=60000,signal,readMode,intervalMs=250}={}) {
  if(!['alongside','desktop'].includes(effective_mode)||!Number.isInteger(timeout_ms)||timeout_ms<0||timeout_ms>60000)
    throw new Error('Use effective_mode alongside/desktop and timeout_ms from 0 to 60000.');
  const deadline=Date.now()+timeout_ms;
  for(;;){
    signal?.throwIfAborted();
    const state=cooperationState(home,readMode);
    if(state.effective_mode===effective_mode)return {ok:true,matched:true,...state};
    if(Date.now()>=deadline)return {ok:true,matched:false,...state};
    await new Promise((resolve,reject)=>{
      const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve();};
      const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason);};
      const timer=setTimeout(finish,Math.min(intervalMs,deadline-Date.now()));
      signal?.addEventListener('abort',abort,{once:true});
    });
  }
}
