// Opt-in: reuse a disposable OpenSky fixture; never launch/activate an app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn, execFileSync} from 'node:child_process';
import {computer_use as cu, createSession} from '../src/index.mjs';

const app=process.argv[2], window_id=Number(process.argv[3]);
if (!/^dev\.opensky\.(agenttrial|fixture)\./.test(app??'') || !Number.isInteger(window_id) || window_id<1) throw new Error('Provide a disposable fixture bundle ID and exact window ID. No app is launched by this check.');
assert.equal((await cu.interaction_mode()).interaction_mode,'alongside','Enable alongside mode first.');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'opensky-alongside-live-'));
const source=path.join(temporary,'Observer.swift'), binary=path.join(temporary,'Observer'), done=path.join(temporary,'done');
fs.writeFileSync(source,`import AppKit
import Foundation
import Darwin
let fixture=CommandLine.arguments[1], done=CommandLine.arguments[2]
let workspace=NSWorkspace.shared
let initial=workspace.frontmostApplication?.bundleIdentifier == fixture
let clipboard=NSPasteboard.general.changeCount
var activations=0
let token=workspace.notificationCenter.addObserver(forName:NSWorkspace.didActivateApplicationNotification,object:nil,queue:nil) { n in
  if let app=n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication, app.bundleIdentifier == fixture { activations += 1 }
}
print("ready");fflush(stdout)
let deadline=Date().addingTimeInterval(15)
while !FileManager.default.fileExists(atPath:done) && Date()<deadline { _=RunLoop.current.run(mode:.default,before:Date().addingTimeInterval(0.02)) }
workspace.notificationCenter.removeObserver(token)
let result:[String:Any]=["initialFixtureActive":initial,"finalFixtureActive":workspace.frontmostApplication?.bundleIdentifier == fixture,"fixtureActivations":activations,"clipboardChangeCountDelta":NSPasteboard.general.changeCount-clipboard]
print(String(data:try! JSONSerialization.data(withJSONObject:result),encoding:.utf8)!)
`);
execFileSync('swiftc',[source,'-o',binary,'-framework','AppKit']);
const observer=spawn(binary,[app,done],{stdio:['ignore','pipe','pipe']});
let data='',diagnostics='';
observer.stdout.on('data',chunk=>{data+=chunk;});observer.stderr.on('data',chunk=>{diagnostics+=chunk;});
const exit=new Promise((resolve,reject)=>{observer.on('error',reject);observer.on('close',code=>code===0?resolve():reject(new Error(diagnostics)));});
try {
  const ready=Date.now()+3000;
  while(!data.includes('ready\n') && Date.now()<ready) await new Promise(r=>setTimeout(r,20));
  assert.ok(data.includes('ready\n'),'Observer did not start.');
  const session=createSession({app,window_id});
  const before=await session.observe({include_screenshot:false});
  const counter=before.elements.find(e=>e.identifier==='counter-value');
  const original=Number(counter?.value??counter?.title);
  assert.ok(Number.isFinite(original),'Missing fixture counter.');
  await session.click({identifier:'increment-counter'});
  await session.setValue({identifier:'verification-input'},'Alongside mode verified ✓');
  const deferred=await cu.press_key({app,keys:['Return'],mode:'takeover'});
  assert.equal(deferred.error_code,'desktop_turn_required');
  const after=await session.observe({include_screenshot:false});
  const field=after.elements.find(e=>e.identifier==='verification-input');
  const next=after.elements.find(e=>e.identifier==='counter-value');
  assert.equal(field.value,'Alongside mode verified ✓');
  assert.equal(Number(next.value??next.title),original+1);
  const found=JSON.parse(execFileSync(process.execPath,[path.resolve(import.meta.dirname,'../src/cli.mjs'),'find',app,'Verification input','--window',String(window_id),'--json'],{encoding:'utf8'}));
  assert.equal(found.match_count,1,'CLI window flag was not applied to the exact-name query.');
  const cliWrite=JSON.parse(execFileSync(process.execPath,[path.resolve(import.meta.dirname,'../src/cli.mjs'),'set-value',app,String(found.matches[0].element_index),'Alongside mode verified ✓','--snapshot',found.snapshot_id,'--json'],{encoding:'utf8'}));
  assert.equal(cliWrite.ok,true,'CLI snapshot metadata was not bound to the field write.');
  fs.writeFileSync(done,'done');await exit;
  const observation=JSON.parse(data.trim().split('\n').at(-1));
  assert.equal(observation.fixtureActivations,0,'Fixture stole focus.');
  assert.equal(observation.finalFixtureActive,false,'Fixture became foreground.');
  const result={passed:true,backgroundClick:true,backgroundUnicodeFieldWrite:true,foregroundKeyDeferred:true,observations:observation,limits:['Clipboard changes can come from the owner; no clipboard contents were read.','This check covers a disposable native fixture, not every Chrome control.']};
  const folder=path.resolve(import.meta.dirname,'../research/2026-10-17-opensky-alongside-Codex');fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'2026-10-17-alongside-live-Codex.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} finally { fs.writeFileSync(done,'done');await exit;fs.rmSync(temporary,{recursive:true,force:true}); }
