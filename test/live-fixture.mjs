import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { computer_use as computer, createSession } from '../src/index.mjs';

const root = path.resolve(import.meta.dirname, '..');
const artifactDir = path.join(root, 'research');fs.mkdirSync(artifactDir,{recursive:true});
const axOnly = process.argv.includes('--ax-only');
const reportPath = path.join(artifactDir,axOnly ? '2026-10-17-live-ax-verification-Codex.json' : '2026-10-17-live-verification-Codex.json');
const checks = [];
const status = await computer.status();
if (!status.axTrusted || (!axOnly && !status.screenRecordingTrusted)) {
  const result = { status:'blocked', reason: !status.axTrusted ? 'macOS Accessibility permission is required for OpenSky' : 'macOS Screen Recording permission is required for OpenSky', checks, permissions:{accessibility:status.axTrusted,screenRecording:status.screenRecordingTrusted} };
  fs.writeFileSync(reportPath,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exit(2);
}
const fixtureId=randomUUID().replaceAll('-','');
const app=`dev.opensky.fixture.${fixtureId}`;
const fixtureRoot=path.join(artifactDir,`2026-10-17-live-fixture-${fixtureId.slice(0,6)}-Codex`);
const fixtureBundle = path.join(fixtureRoot,'OpenSkyFixture.app');
const fixtureExecutableDir = path.join(fixtureBundle,'Contents/MacOS');
fs.mkdirSync(fixtureExecutableDir,{recursive:true});
fs.writeFileSync(path.join(fixtureBundle,'Contents/Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>OpenSkyFixture</string><key>CFBundleIdentifier</key><string>${app}</string><key>CFBundleName</key><string>OpenSkyFixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
const binary = path.join(fixtureExecutableDir,'OpenSkyFixture');
execFileSync('swiftc',[path.join(root,'scripts/fixtures/ControlFixture.swift'),'-o',binary,'-framework','AppKit']);
const fixtureState = path.join(fixtureRoot,'state.json');
fs.rmSync(fixtureState,{force:true});
const fixture = spawn('/usr/bin/open',['-n','-a',fixtureBundle,'--env',`OPENSKY_FIXTURE_OUTPUT=${fixtureState}`],{stdio:'ignore'});
async function observe() { const result=await computer.get_app_state({app,include_ocr:!axOnly,include_screenshot:!axOnly});assert.equal(result.ok,true,result.error);return result; }
function index(state,matcher) { const line=state.text.split('\n').find(matcher);assert.ok(line,`Expected control absent: ${state.text}`);return Number(line.trim().match(/^\d+/)[0]); }
async function verify(name,body) { await body();checks.push({name,passed:true}); }
let state;
try {
  for(let i=0;i<40;i++){ if(fs.existsSync(fixtureState))break; await new Promise(resolve=>setTimeout(resolve,100)); }
  await verify(axOnly ? 'Live Accessibility tree' : 'Window screenshot, AX tree and OCR',async()=>{
    // The fixture's ready marker precedes WindowServer publishing its window.
    // Retry only that startup condition, before any input has been delivered.
    const deadline=Date.now()+5000;
    for(;;){
      const result=await computer.get_app_state({app,include_ocr:!axOnly,include_screenshot:!axOnly});
      if(result.ok){state=result;break;}
      if(!['app_window_unavailable','app_not_found_or_ambiguous','window_moved'].includes(result.error_code)||Date.now()>=deadline)assert.fail(JSON.stringify(result));
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    if(!axOnly){
      assert.ok(state.screenshot.path);
      assert.ok(state.text.includes('[Vision OCR visual elements'));
      assert.match(state.text,/\d+ text "Increment counter" \[at /);
    }
    assert.ok(state.text.includes('Increment counter'));assert.ok(state.ax_trusted);
  });
  await verify('Background Accessibility click changes actual counter',async()=>{
    const button=index(state,line=>/\bbutton\b.*Increment counter/.test(line));
    const result=await computer.click({app,element_index:button,snapshot_id:state.snapshot_id,mode:'background'});assert.ok(result.ok,JSON.stringify(result));
    assert.equal(JSON.parse(fs.readFileSync(fixtureState)).counter,1);state=await observe();
  });
  await verify('Old snapshot cannot act on refreshed controls',async()=>{
    const old=state;state=await observe();
    const result=await computer.click({app,element_index:index(old,line=>/\bbutton\b.*Increment counter/.test(line)),snapshot_id:old.snapshot_id,mode:'background'});assert.equal(result.ok,false);assert.equal(JSON.parse(fs.readFileSync(fixtureState)).counter,1);
  });
  await verify('Structured controls expose real identifiers and source metadata',async()=>{
    const button=state.elements.find(element=>element.identifier==='increment-counter');
    assert.equal(button.source,'ax');assert.equal(button.role,'button');assert.equal(button.enabled,true);assert.equal(button.title,'Increment counter');
    assert.ok(button.frame.length===4);
  });
  await verify('Semantic session clicks a uniquely named real control',async()=>{
    const session=createSession({app,mode:'background'});
    await session.click({name:'Increment counter',role:'button'});
    assert.equal(JSON.parse(fs.readFileSync(fixtureState)).counter,2);state=await observe();
  });
  await verify('Foreground physical click changes the actual counter',async()=>{
    const session=createSession({app});
    await session.click({identifier:'increment-counter'},{mode:'takeover'});
    assert.equal(JSON.parse(fs.readFileSync(fixtureState)).counter,3);state=await observe();
  });
  await verify('Semantic session sets a field by its Accessibility identifier',async()=>{
    const session=createSession({app});
    await session.setValue({identifier:'verification-input'},'Selected by identifier ✓');
    const found=await session.waitFor({identifier:'verification-input',value:'Selected by identifier ✓'},{timeoutMs:1000});
    assert.equal(found.element.settable,true);state=await observe();
  });
  await verify('Set a Unicode value and read it back from the real field',async()=>{
    const field=index(state,line=>/text field.*Verification input/.test(line));
    const result=await computer.set_value({app,element_index:field,value:'OpenSky — café 🌍'});assert.ok(result.ok,JSON.stringify(result));state=await observe();assert.ok(state.text.includes('OpenSky — café 🌍'));
  });
  await verify('Rejected background AX writes never fall back to physical input',async()=>{
    let toggle=state.elements.find(element=>element.identifier==='reject-ax-writes');assert.ok(toggle);
    let result=await computer.click({app,element_index:toggle.element_index,snapshot_id:state.snapshot_id,mode:'background'});assert.equal(result.ok,true,result.message);
    const before=JSON.parse(fs.readFileSync(fixtureState));assert.equal(before.rejectAXWrites,true);
    state=await observe();let field=state.elements.find(element=>element.identifier==='verification-input');assert.ok(field);
    assert.equal(field.role,'text field');assert.equal(field.settable,false);
    result=await computer.set_value({app,element_index:field.element_index,snapshot_id:state.snapshot_id,value:'BACKGROUND MUST NOT TYPE',mode:'background'});
    assert.equal(result.ok,false);assert.match(result.message,/Background mode never falls back/);
    const after=JSON.parse(fs.readFileSync(fixtureState));assert.equal(after.input,before.input);assert.deepEqual(after.events,before.events);
    state=await observe();toggle=state.elements.find(element=>element.identifier==='reject-ax-writes');
    result=await computer.click({app,element_index:toggle.element_index,snapshot_id:state.snapshot_id,mode:'background'});assert.equal(result.ok,true,result.message);state=await observe();
  });
  await verify('A pinned background session edits one window while another stays focused',async()=>{
    const primaryID=state.window_id;
    const openOther=state.elements.find(element=>element.identifier==='open-other-window');assert.ok(openOther);
    let result=await computer.click({app,element_index:openOther.element_index,snapshot_id:state.snapshot_id,mode:'background'});assert.equal(result.ok,true,result.message);
    state=await observe();const otherID=state.window_id;assert.notEqual(otherID,primaryID);assert.ok(state.text.includes('SECOND_WINDOW_ONLY'));
    const pinned=createSession({app,window_id:primaryID,mode:'background'});
    result=await pinned.setValue({identifier:'verification-input'},'Pinned background window ✓');assert.equal(result.window_id,primaryID);
    assert.ok(result.elements.some(element=>element.value==='Pinned background window ✓'));
    state=await observe();assert.equal(state.window_id,otherID);assert.ok(state.text.includes('SECOND_WINDOW_ONLY'));
    result=await computer.get_app_state({app,window_id:4294967295,include_screenshot:false});assert.equal(result.ok,false);assert.equal(result.error_code,'exact_window_unavailable');
    state=await observe();const close=state.elements.find(element=>element.identifier==='close-other-window');assert.ok(close);
    result=await computer.click({app,element_index:close.element_index,snapshot_id:state.snapshot_id,mode:'background'});assert.equal(result.ok,true,result.message);
    state=await observe();assert.equal(state.window_id,primaryID);
  });
  await verify('Foreground keyboard input preserves Unicode',async()=>{
    const field=index(state,line=>/text field.*Verification input/.test(line));
    let result=await computer.click({app,element_index:field,mode:'takeover'});assert.ok(result.ok,JSON.stringify(result));
    result=await computer.press_key({app,keys:['super+a'],mode:'takeover'});assert.ok(result.ok,JSON.stringify(result));
    result=await computer.type_text({app,text:'Typed ✓ ދިވެހި 🌍',mode:'takeover'});assert.ok(result.ok,JSON.stringify(result));
    state=await observe();assert.ok(state.text.includes('Typed ✓ ދިވެހި 🌍'));
  });
  await verify('Clipboard paste reaches the field',async()=>{
    let result=await computer.press_key({app,keys:['super+a'],mode:'takeover'});assert.ok(result.ok,JSON.stringify(result));
    result=await computer.paste({app,content:'Clipboard ✓ — OpenSky',format:'text'});assert.ok(result.ok,JSON.stringify(result));
    state=await observe();assert.ok(state.text.includes('Clipboard ✓ — OpenSky'));
  });
  await verify('Markdown paste alias is accepted and preserves its text',async()=>{
    await computer.press_key({app,keys:['super+a'],mode:'takeover'});
    const result=await computer.paste({app,content:'**Markdown ✓**',format:'md'});assert.ok(result.ok,JSON.stringify(result));
    state=await observe();assert.ok(state.text.includes('**Markdown ✓**'));
  });
  await verify('Physical editor click transfers keyboard focus before typing',async()=>{
    const session=createSession({app});
    await session.click({role:'text area',name:'Scratch editor'},{mode:'takeover'});
    const result=await computer.type_text({app,text:'EDITOR FOCUS VERIFIED',mode:'takeover'});assert.ok(result.ok);
    const fixture=JSON.parse(fs.readFileSync(fixtureState));
    assert.ok(fixture.editor.includes('EDITOR FOCUS VERIFIED'));assert.equal(fixture.input,'**Markdown ✓**');state=await observe();
  });
  await verify('Unknown keys fail without changing the target',async()=>{ const result=await computer.press_key({app,keys:['NotARealKey'],mode:'takeover'});assert.equal(result.ok,false); });
  await verify('Emergency pause blocks input until explicit resume',async()=>{
    assert.equal((await computer.stop()).stopped,true);assert.equal((await computer.type_text({app,text:'SHOULD NOT TYPE',mode:'takeover'})).ok,false);await computer.resume();
    state=await observe();assert.equal(state.text.includes('SHOULD NOT TYPE'),false);
  });
  await verify('Window resize finishes at the requested geometry',async()=>{
    const frame=[250,140,1000,650];const result=await computer.manage_window({app,action:'move_resize',frame});
    assert.equal(result.ok,true,result.message);assert.equal(result.observation_ok,true,result.error);
    assert.ok(result.window_frame.every((value,i)=>Math.abs(value-frame[i])<=2));state=await observe();
  });
  if(status.displays?.length>1)await verify('Moving and resizing across displays preserves the complete requested frame',async()=>{
    const other=status.displays.find(display=>!display.frame.every((value,i)=>value===status.displays[0].frame[i]));
    for(const frame of [[other.frame[0]+200,other.frame[1]+120,1100,700],[250,140,1000,650]]){
      const result=await computer.manage_window({app,action:'move_resize',frame});
      assert.equal(result.ok,true,result.message);assert.equal(result.observation_ok,true,result.error);
      assert.ok(result.window_frame.every((value,i)=>Math.abs(value-frame[i])<=2));
    }
    state=await observe();
  });
  await verify('Open native menu commands are exposed beyond their container',async()=>{
    state=await observe();const menu=state.elements.find(element=>element.role==='menu bar item'&&element.title==='Edit');
    assert.ok(menu);const result=await computer.click({app,element_index:menu.element_index,snapshot_id:state.snapshot_id,mode:'takeover'});
    assert.equal(result.ok,true,result.message);assert.equal(result.observation_ok,true,result.error);
    assert.ok(result.elements.some(element=>element.role==='menu item'&&element.title==='Paste'));
    await computer.press_key({app,keys:['Escape'],mode:'takeover'});state=await observe();
  });
  await verify('Quitting a target is not undone by its post-action observation',async()=>{
    const result=await computer.press_key({app,keys:['super+q'],mode:'takeover'});assert.equal(result.ok,true,result.message);
    await new Promise(resolve=>setTimeout(resolve,200));
    assert.equal((await computer.list_apps({running_only:true})).some(candidate=>candidate.id===app),false);
  });
  fs.writeFileSync(reportPath,JSON.stringify({status:'passed',checks,screenshot:state.screenshot,permissions:{accessibility:true,screenRecording:status.screenRecordingTrusted},mode:axOnly?'accessibility-only':'visual-and-accessibility'},null,2));
  console.log(`Live verification passed (${checks.length} checks): ${reportPath}`);
} catch(error) {fs.writeFileSync(reportPath,JSON.stringify({status:'failed',checks,error:error.message,last_observation:state?.text,fixture:fs.existsSync(fixtureState)?JSON.parse(fs.readFileSync(fixtureState)):null},null,2));throw error;}
finally {
  await computer.cursor_dismiss();
  const pid=state?.pid??(fs.existsSync(fixtureState)?JSON.parse(fs.readFileSync(fixtureState)).pid:null);
  if(pid)try{process.kill(pid,'SIGTERM');}catch{}
  fixture.kill('SIGTERM');
}
