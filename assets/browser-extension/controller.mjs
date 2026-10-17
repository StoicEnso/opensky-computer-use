import {snapshotPage,resolvePageElement,animatePagePointer} from './page.mjs';

export class BrowserControlError extends Error {constructor(code,message){super(message);this.code=code;}}
const fail=(code,message)=>{throw new BrowserControlError(code,message);};
const tabNumber=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)fail('invalid_tab','Use an observed Chrome tab_id.');return n;};
const workflow=value=>{if(typeof value!=='string'||!value.trim()||value.length>100)fail('workflow_required','Provide a distinct workflow_id for this task.');return value;};
const urlValue=value=>{try{if(typeof value!=='string'||value.length>32768)throw 0;new URL(value);return value;}catch{fail('invalid_url','Provide an absolute URL.');}};

export function createBrowserController(chrome,{canAct=()=>true}={}) {
  const owners=new Map(),attached=new Map(),snapshots=new Map(),queues=new Map(),expectedDetach=new Set(),choosers=new Map();let generation=0,persist=Promise.resolve();
  const ready=chrome.storage.session.get('opensky_owners').then(value=>{for(const[id,owner]of Object.entries(value.opensky_owners??{}))owners.set(Number(id),owner);});
  const save=()=>{persist=persist.then(()=>chrome.storage.session.set({opensky_owners:Object.fromEntries(owners)}));return persist;};
  const debug=(tabId,sessionId)=>sessionId?{tabId,sessionId}:{tabId};
  const send=(tabId,method,params={},sessionId)=>chrome.debugger.sendCommand(debug(tabId,sessionId),method,params);
  const invalidate=tabId=>{for(const[key,value]of snapshots)if(value.tabId===tabId)snapshots.delete(key);};
  const check=expected=>{if(expected!==generation||!canAct())fail('cancelled','OpenSky browser control stopped or the queued turn was cancelled.');};
  const owned=(tabId,params)=>{const id=workflow(params.workflow_id),owner=owners.get(tabId);if(!owner||owner.workflow_id!==id)fail('tab_not_owned','Claim this exact task tab first; another workflow\'s tabs are never substituted.');if(owner.revoked)fail('tab_control_paused','Control was detached by Chrome or its user. Resume this tab from the OpenSky extension before reattaching.');return owner;};
  chrome.tabs.onRemoved.addListener(tabId=>{owners.delete(tabId);attached.delete(tabId);invalidate(tabId);void save();});
  chrome.tabs.onUpdated.addListener((tabId,changes)=>{if(changes.url||changes.status==='loading')invalidate(tabId);});
  chrome.debugger.onDetach.addListener((source,reason)=>{attached.delete(source.tabId);invalidate(source.tabId);if(expectedDetach.delete(source.tabId))return;const owner=owners.get(source.tabId);if(owner&&reason!=='target_closed'){owner.revoked=true;void save();}});
  chrome.debugger.onEvent.addListener((source,method,params)=>{
    const state=attached.get(source.tabId);
    if(method==='Target.attachedToTarget'&&state&&params.targetInfo?.type==='iframe'){
      state.sessions.add(params.sessionId);
      void send(source.tabId,'Page.enable',{},params.sessionId).then(()=>send(source.tabId,'Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true,filter:[{type:'iframe',exclude:false}]},params.sessionId)).catch(()=>{});
    }
    if(['Page.frameNavigated','Page.navigatedWithinDocument','Runtime.executionContextsCleared'].includes(method))invalidate(source.tabId);
    if(method==='Target.detachedFromTarget')state?.sessions.delete(params.sessionId);
    if(method==='Page.fileChooserOpened')choosers.get(source.tabId)?.({source,params});
  });
  async function attach(tabId) {
    if(attached.has(tabId))return;
    try{await chrome.debugger.attach({tabId},'1.3');}
    catch(error){fail('debugger_unavailable','Chrome did not attach OpenSky: '+error.message+'. No other debugger was detached.');}
    const state={sessions:new Set()};attached.set(tabId,state);
    await send(tabId,'Page.enable');await send(tabId,'DOM.enable');
    await send(tabId,'Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true,filter:[{type:'iframe',exclude:false}]});
  }
  async function frameList(tabId) {
    await attach(tabId);const frames=new Map();
    for(const sessionId of [undefined,...attached.get(tabId).sessions]){
      try{const tree=await send(tabId,'Page.getFrameTree',{},sessionId);const visit=t=>{const previous=frames.get(t.frame.id);if(!previous||sessionId)frames.set(t.frame.id,{frame_id:t.frame.id,parent_id:t.frame.parentId??previous?.parent_id,url:t.frame.url,name:t.frame.name,loader_id:t.frame.loaderId,sessionId});for(const c of t.childFrames??[])visit(c);};visit(tree.frameTree);}catch{/* Detached frames are omitted; never substitute another frame. */}
    }
    return frames;
  }
  async function context(tabId,frameId) {
    const frames=await frameList(tabId),frame=frameId?frames.get(frameId):[...frames.values()].find(f=>!f.parent_id);
    if(!frame)fail('frame_unavailable','The exact frame is unavailable. Inspect frames again.');
    const {executionContextId}=await send(tabId,'Page.createIsolatedWorld',{frameId:frame.frame_id,worldName:'OpenSky'},frame.sessionId);
    return {...frame,contextId:executionContextId};
  }
  async function evaluate(tabId,ctx,expression,byValue=true) {
    const result=await send(tabId,'Runtime.evaluate',{expression,contextId:ctx.contextId,returnByValue:byValue,awaitPromise:true},ctx.sessionId);
    if(result.exceptionDetails)fail('page_evaluation_failed',result.exceptionDetails.exception?.description??result.exceptionDetails.text);
    return byValue?result.result.value:result.result;
  }
  async function snapshot(tabId,params) {
    const ctx=await context(tabId,params.frame_id),token=crypto.randomUUID();
    const value=await evaluate(tabId,ctx,`(${snapshotPage})(${JSON.stringify(token)},${Math.min(800,Math.max(1,params.limit??400))})`);
    for(const[key,s]of snapshots)if(s.tabId===tabId&&s.ctx.frame_id===ctx.frame_id)snapshots.delete(key);
    snapshots.set(token,{tabId,ctx,createdAt:Date.now()});
    return {ok:true,tab_id:String(tabId),frame_id:ctx.frame_id,snapshot_id:token,...value};
  }
  async function target(tabId,params) {
    const state=snapshots.get(params.snapshot_id);
    if(!state||state.tabId!==tabId||Date.now()-state.createdAt>60000||params.frame_id&&params.frame_id!==state.ctx.frame_id)fail('stale_browser_snapshot','Inspect this exact tab/frame again; no input was sent.');
    const expression=`(${resolvePageElement})(${JSON.stringify(params.snapshot_id)},${JSON.stringify(params.element_id)})`;
    let object;
    try{object=await evaluate(tabId,state.ctx,expression,false);}catch(error){fail('stale_browser_element',error.message);}
    if(!object.objectId)fail('stale_browser_element','The observed element is no longer available.');
    return {ctx:state.ctx,objectId:object.objectId};
  }
  async function onElement(tabId,element,fn,args=[]) {
    const result=await send(tabId,'Runtime.callFunctionOn',{objectId:element.objectId,functionDeclaration:fn.toString(),arguments:args.map(value=>({value})),returnByValue:true,awaitPromise:true},element.ctx.sessionId);
    if(result.exceptionDetails)fail('element_action_failed',result.exceptionDetails.exception?.description??result.exceptionDetails.text);
    return result.result.value;
  }
  async function withPageFocus(tabId,ctx,action) {
    // Headful Chrome can acknowledge and discard input to an inactive widget.
    // Emulate focus only in this renderer; never select the tab or activate Chrome.
    try{
      await send(tabId,'Emulation.setFocusEmulationEnabled',{enabled:true},ctx.sessionId);
      return await action();
    }finally{await send(tabId,'Emulation.setFocusEmulationEnabled',{enabled:false},ctx.sessionId).catch(()=>{});}
  }
  async function click(tabId,params,turn) {
    const element=await target(tabId,params);
    check(turn);
    return withPageFocus(tabId,element.ctx,async()=>{
      check(turn);
      const box=await onElement(tabId,element,function(){if(this.disabled)throw Error('Control is disabled');this.scrollIntoView({block:'center',inline:'center'});const r=this.getBoundingClientRect();if(!r.width||!r.height)throw Error('Control is not visible');return{x:r.x+r.width/2,y:r.y+r.height/2};});
      // CDP quads use this renderer target's viewport, including same-process
      // descendant frames. Verify the hit before delivering one trusted click.
      const {quads=[]}=await send(tabId,'DOM.getContentQuads',{objectId:element.objectId},element.ctx.sessionId);
      // Hit testing takes document coordinates; mouse input takes viewport coordinates.
      const metrics=await send(tabId,'Page.getLayoutMetrics',{},element.ctx.sessionId),viewport=metrics.cssVisualViewport??metrics.cssLayoutViewport;
      let point;
      for(const quad of quads.slice(0,20)){
        if(quad.length!==8)continue;
        const x=(quad[0]+quad[2]+quad[4]+quad[6])/4,y=(quad[1]+quad[3]+quad[5]+quad[7])/4;
        let hitObjectId;
        try{
          const hit=await send(tabId,'DOM.getNodeForLocation',{x:Math.round(x+(viewport?.pageX??0)),y:Math.round(y+(viewport?.pageY??0))},element.ctx.sessionId);
          const node=await send(tabId,'DOM.resolveNode',{backendNodeId:hit.backendNodeId,executionContextId:element.ctx.contextId},element.ctx.sessionId);
          hitObjectId=node.object.objectId;
          const matches=await send(tabId,'Runtime.callFunctionOn',{objectId:element.objectId,functionDeclaration:'function(node){return this===node||this.contains(node);}',arguments:[{objectId:hitObjectId}],returnByValue:true},element.ctx.sessionId);
          if(matches.result?.value===true){point={x,y};break;}
        }catch{/* Only a proven hit on the observed control can receive input. */}
        finally{if(hitObjectId)await send(tabId,'Runtime.releaseObject',{objectId:hitObjectId},element.ctx.sessionId).catch(()=>{});}
      }
      if(!point)fail('browser_target_obscured','The observed control has no verified clickable point in this frame. Inspect its layout before input.');
      check(turn);
      await evaluate(tabId,element.ctx,`(${animatePagePointer})(${box.x},${box.y},${JSON.stringify(params.workflow_id)})`);
      check(turn);
      await send(tabId,'Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1},element.ctx.sessionId);
      await send(tabId,'Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1},element.ctx.sessionId);
      return {ok:true,tab_id:String(tabId),activation:'tab_input',verification_required:true};
    });
  }
  async function upload(tabId,params,turn) {
    if(!Array.isArray(params.files)||!params.files.length||params.files.some(f=>typeof f!=='string'))fail('invalid_files','Provide explicit absolute local file paths.');
    const element=await target(tabId,params),type=await onElement(tabId,element,function(){return{file:this.tagName==='INPUT'&&this.type==='file',multiple:!!this.multiple};});
    let input=element,timer,sessions=[];
    try{
    if(!type.file){
      let resolveChooser;
      const choice=new Promise((resolve,reject)=>{resolveChooser=resolve;timer=setTimeout(()=>reject(new BrowserControlError('file_chooser_not_observed','Upload control did not open a chooser. Inspect before repeating the click.')),8000);});
      // A failed click must not leave an unhandled chooser timeout behind.
      choice.catch(()=>{});
      choosers.set(tabId,resolveChooser);
      sessions=[undefined,...attached.get(tabId).sessions];
        for(const id of sessions)await send(tabId,'Page.setInterceptFileChooserDialog',{enabled:true},id);
        await click(tabId,params,turn);
        const observed=await choice;check(turn);
        if(!observed.params.backendNodeId)fail('file_input_unavailable','Chrome did not expose the chooser input.');
        const resolved=await send(tabId,'DOM.resolveNode',{backendNodeId:observed.params.backendNodeId},observed.source.sessionId);
        input={objectId:resolved.object.objectId,ctx:{sessionId:observed.source.sessionId}};
    }
    const capability=await onElement(tabId,input,function(){return{file:this.tagName==='INPUT'&&this.type==='file',multiple:!!this.multiple};});
    if(!capability.file||params.files.length>1&&!capability.multiple)fail('invalid_file_input','The selected input does not accept this file count.');
    check(turn);await send(tabId,'DOM.setFileInputFiles',{objectId:input.objectId,files:params.files},input.ctx.sessionId);
    const files=await onElement(tabId,input,function(){return Array.from(this.files??[],f=>({name:f.name,size:f.size,type:f.type}));});
    return {ok:true,tab_id:String(tabId),files,file_count:files.length,verification_required:true};
    }finally{clearTimeout(timer);choosers.delete(tabId);for(const id of sessions)await send(tabId,'Page.setInterceptFileChooserDialog',{enabled:false},id).catch(()=>{});}
  }
  async function perform(method,params,turn) {
    if(method==='tabs_list')return {ok:true,tabs:(await chrome.tabs.query({})).map(t=>({tab_id:String(t.id),window_id:String(t.windowId),url:t.url,pending_url:t.pendingUrl,title:t.title,active:t.active,status:t.status,workflow_id:owners.get(t.id)?.workflow_id,control_paused:!!owners.get(t.id)?.revoked}))};
    if(method==='status')return {ok:true,owned_tabs:owners.size,attached_tabs:attached.size};
    if(method==='tab_open'){
      workflow(params.workflow_id);const url=urlValue(params.url??'about:blank');check(turn);
      const windows=await chrome.tabs.query({windowType:'normal',...(params.window_id?{windowId:tabNumber(params.window_id)}:{lastFocusedWindow:true})});
      if(!windows.length)fail('browser_window_required','Use an existing normal Chrome window (window_id from browser_tabs). OpenSky will not create or activate a new window for background work.');
      check(turn);
      const t=await chrome.tabs.create({url:'about:blank',active:false,windowId:windows[0].windowId});owners.set(t.id,{workflow_id:params.workflow_id});await save();
      try{await attach(t.id);check(turn);const result=await send(t.id,'Page.navigate',{url});if(result.errorText)fail('navigation_failed',result.errorText);return{ok:true,tab_id:String(t.id),window_id:String(t.windowId),active:t.active,navigation_requested:true};}
      catch(error){return{ok:false,tab_id:String(t.id),window_id:String(t.windowId),error_code:error.code??'navigation_failed',error:error.message,outcome:'The inactive task tab exists. Inspect it before creating another tab or retrying navigation.'};}
    }
    const tabId=tabNumber(params.tab_id);
    if(method==='tab_claim'){const id=workflow(params.workflow_id),existing=owners.get(tabId);if(existing&&existing.workflow_id!==id)fail('tab_owned_by_other_workflow','This tab belongs to another workflow.');if(existing?.revoked)fail('tab_control_paused','Resume the tab from the OpenSky extension.');await chrome.tabs.get(tabId);owners.set(tabId,{workflow_id:id});await save();return{ok:true,tab_id:String(tabId),workflow_id:id};}
    owned(tabId,params);
    if(!['snapshot','frames','screenshot'].includes(method))check(turn);
    if(method==='tab_release'||method==='tab_close'){
      if(attached.has(tabId)){expectedDetach.add(tabId);await chrome.debugger.detach({tabId}).catch(()=>{});}attached.delete(tabId);owners.delete(tabId);invalidate(tabId);await save();if(method==='tab_close')await chrome.tabs.remove(tabId);return{ok:true,tab_id:String(tabId),released:true,closed:method==='tab_close'};
    }
    if(method==='tab_navigate'){const url=urlValue(params.url);await attach(tabId);check(turn);invalidate(tabId);const result=await send(tabId,'Page.navigate',{url});if(result.errorText)fail('navigation_failed',result.errorText);return{ok:true,tab_id:String(tabId),navigation_requested:true};}
    if(method==='snapshot')return snapshot(tabId,params);
    if(method==='frames')return{ok:true,tab_id:String(tabId),frames:[...(await frameList(tabId)).values()].map(({sessionId,...f})=>f)};
    if(method==='screenshot'){await attach(tabId);const result=await send(tabId,'Page.captureScreenshot',{format:'png',captureBeyondViewport:false});return{ok:true,tab_id:String(tabId),image_base64:result.data};}
    if(method==='click')return click(tabId,params,turn);
    if(method==='upload')return upload(tabId,params,turn);
    const element=await target(tabId,params);check(turn);
    if(method==='fill'){
      if(typeof params.value!=='string')fail('invalid_value','Provide text to fill.');
      const result=await onElement(tabId,element,function(value){if(this.disabled||this.readOnly)throw Error('Field is not writable');if(this.isContentEditable)this.textContent=value;else{const proto=this.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!setter)throw Error('Not a text field');setter.call(this,value);}this.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:null}));this.dispatchEvent(new Event('change',{bubbles:true}));return{value_set:true,length:value.length};},[params.value]);return{ok:true,tab_id:String(tabId),...result,verification_required:true};
    }
    if(method==='select_option'){const result=await onElement(tabId,element,function(value){if(this.tagName!=='SELECT'||this.disabled)throw Error('Not an enabled select');if(!Array.from(this.options).some(o=>o.value===value))throw Error('Option not found');this.value=value;this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true}));return{selected_value:this.value};},[params.value]);return{ok:true,...result};}
    if(method==='press_key'){
      const codes={Enter:13,Tab:9,Escape:27,Backspace:8,Delete:46,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40};if(!codes[params.key])fail('unsupported_key','Use Enter, Tab, Escape, Backspace, Delete or an arrow key.');
      return withPageFocus(tabId,element.ctx,async()=>{
        check(turn);await send(tabId,'DOM.focus',{objectId:element.objectId},element.ctx.sessionId);
        // Initial inactive-widget focus can lag the CDP acknowledgement. Yield
        // one renderer task, then verify the exact field before sending any key.
        // MessageChannel avoids background-tab timer throttling and sends no input.
        const focused=await onElement(tabId,element,function(){return new Promise(resolve=>{
          const channel=new MessageChannel();channel.port1.onmessage=()=>{
            channel.port1.close();channel.port2.close();
            resolve(this.isConnected&&this.getRootNode().activeElement===this&&this.ownerDocument.hasFocus());
          };channel.port2.postMessage(null);
        });});
        check(turn);if(focused!==true)fail('browser_focus_unavailable','The exact observed control did not acquire renderer focus; no key was sent. Inspect this tab before continuing.');
        await send(tabId,'Input.dispatchKeyEvent',{type:'keyDown',key:params.key,windowsVirtualKeyCode:codes[params.key]},element.ctx.sessionId);await send(tabId,'Input.dispatchKeyEvent',{type:'keyUp',key:params.key,windowsVirtualKeyCode:codes[params.key]},element.ctx.sessionId);return{ok:true,tab_id:String(tabId),verification_required:true};
      });
    }
    fail('unknown_browser_method','Unsupported browser method.');
  }
  return {
    async run(method,params={}){const turn=generation;await ready;const key=method==='tab_open'?'new:'+crypto.randomUUID():params.tab_id?String(params.tab_id):'tabs';const previous=queues.get(key)??Promise.resolve();const job=previous.catch(()=>{}).then(()=>perform(method,params,turn));queues.set(key,job);try{return await job;}catch(error){return{ok:false,error_code:error.code??'browser_action_failed',error:error.message,outcome:['snapshot','frames','tabs_list','status','screenshot'].includes(method)?'Observation unavailable.':'Inspect before repeating any input.'};}finally{if(queues.get(key)===job)queues.delete(key);}},
    cancel(){generation++;},
    async resumeTabs(){for(const owner of owners.values())owner.revoked=false;await save();},
    async close(){generation++;for(const tabId of attached.keys()){expectedDetach.add(tabId);await chrome.debugger.detach({tabId}).catch(()=>{});}attached.clear();snapshots.clear();}
  };
}
