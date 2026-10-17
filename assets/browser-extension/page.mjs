/** Runs only in Chrome's isolated world. Page strings remain untrusted observations. */
export function snapshotPage(token,limit=400) {
  const nodes=new Map(),elements=[];
  const label=e=>{const refs=e.getAttribute('aria-labelledby');return (e.getAttribute('aria-label')||(refs?refs.split(/\s+/).map(id=>e.getRootNode().getElementById?.(id)?.textContent??'').join(' '):'')||[...(e.labels??[])].map(l=>l.textContent).join(' ')||e.getAttribute('alt')||e.getAttribute('title')||e.getAttribute('placeholder')||e.innerText||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,250);};
  const fingerprint=e=>JSON.stringify([e.tagName,e.getAttribute('type'),e.id,e.getAttribute('name'),label(e)]);
  const walk=root=>{for(const e of root.querySelectorAll('*')){
    if(elements.length>=limit)break;
    if(e.closest('[data-opensky-overlay]'))continue;
    if(e.shadowRoot)walk(e.shadowRoot);
    const tag=e.tagName.toLowerCase(),inputRole=({checkbox:'checkbox',radio:'radio',range:'slider',number:'spinbutton',search:'searchbox',button:'button',submit:'button',reset:'button',file:'button'}[e.type])||'textbox';
    const role=e.getAttribute('role')||(tag==='input'?inputRole:({a:'link',button:'button',summary:'button',textarea:'textbox',select:'combobox',iframe:'iframe'}[tag]))||(e.isContentEditable?'textbox':'');
    if(!role&&!e.hasAttribute('tabindex'))continue;
    const rect=e.getBoundingClientRect(),file=tag==='input'&&e.type==='file';
    const visible=rect.width>0&&rect.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
    if(!visible&&!file)continue;
    const id='e'+(elements.length+1);nodes.set(id,{node:e,fingerprint:fingerprint(e)});
    elements.push({element_id:id,role,name:label(e),tag,type:e.type??'',disabled:!!e.disabled,read_only:!!e.readOnly,visible,frame:[rect.x,rect.y,rect.width,rect.height],value:e.type==='password'?'[redacted]':String(e.value??'').slice(0,500),...(['checkbox','radio'].includes(role)?{checked:!!e.checked}:{}),...(tag==='select'?{options:Array.from(e.options).slice(0,200).map(o=>({value:o.value,label:o.label,disabled:o.disabled||!!o.closest('optgroup[disabled]'),selected:o.selected}))}:{}),...(file?{accept:e.accept,multiple:e.multiple}:{}),...(tag==='a'?{href:e.href}:{})});
  }};
  walk(document);
  globalThis.__openskySnapshot={token,nodes,fingerprint};
  return {url:location.href,title:document.title,text:(document.body?.innerText??'').slice(0,16000),elements,truncated:elements.length>=limit};
}
export function resolvePageElement(token,id) {
  const state=globalThis.__openskySnapshot,record=state?.nodes.get(id);
  if(!state||state.token!==token||!record||!record.node.isConnected||state.fingerprint(record.node)!==record.fingerprint)throw new Error('OpenSky stale element; inspect this frame again.');
  return record.node;
}
export function animatePagePointer(x,y,label) {
  const old=document.querySelector('[data-opensky-overlay]');old?.remove();
  const host=document.createElement('div');host.dataset.openskyOverlay='true';host.setAttribute('aria-hidden','true');
  Object.assign(host.style,{position:'fixed',left:x+'px',top:y+'px',zIndex:'2147483647',pointerEvents:'none',display:'flex',alignItems:'center',gap:'5px',font:'12px system-ui',color:'white',filter:'drop-shadow(0 2px 5px #001c6655)'});
  const pointer=document.createElementNS('http://www.w3.org/2000/svg','svg');pointer.setAttribute('width','25');pointer.setAttribute('height','30');pointer.setAttribute('viewBox','0 0 25 30');
  const shape=document.createElementNS(pointer.namespaceURI,'path');shape.setAttribute('d','M2 2L22 17L13 18L9 27L2 2Z');shape.setAttribute('fill','#2878ff');shape.setAttribute('stroke','white');shape.setAttribute('stroke-width','1.5');pointer.append(shape);
  const badge=document.createElement('span');badge.textContent='OpenSky · '+label;Object.assign(badge.style,{background:'#1459d9',padding:'4px 7px',borderRadius:'6px'});host.append(pointer,badge);document.documentElement.append(host);
  host.animate([{transform:'translate(-15px,-10px) scale(.8)',opacity:0},{transform:'translate(0,0) scale(1)',opacity:1}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});setTimeout(()=>host.remove(),1000);
}
