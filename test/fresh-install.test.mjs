import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,copyFileSync,symlinkSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runTerminalOnboarding} from '../scripts/onboarding-terminal.mjs';
import {installClaudeDependencies} from '../scripts/claude-dependencies.mjs';
import {NATIVE_API_VERSION,NATIVE_BUILD_VERSION} from '../src/native-version.mjs';
import {machOArchitectures} from '../scripts/prebuilt-app.mjs';

test('prebuilt architecture checks parse thin and universal Mach-O without Xcode shims',()=>{
  const thin=Buffer.alloc(8);thin.writeUInt32LE(0xfeedfacf,0);thin.writeUInt32LE(0x0100000c,4);assert.deepEqual(machOArchitectures(thin),['arm64']);
  const fat=Buffer.alloc(48);fat.writeUInt32BE(0xcafebabe,0);fat.writeUInt32BE(2,4);fat.writeUInt32BE(0x0100000c,8);fat.writeUInt32BE(0x01000007,28);assert.deepEqual(machOArchitectures(fat),['arm64','x86_64']);
  assert.throws(()=>machOArchitectures(fat.subarray(0,10)),/Invalid universal/);assert.throws(()=>machOArchitectures(Buffer.alloc(8)),/not Mach-O/);
});

test('first-run requests missing consent once, reads back every grant and never resumes an emergency pause',async()=>{
  let state={running:false},starts=0,time=0;const requests=[],settings=[],logs=[];
  const options={interactive:true,status:async()=>({...state}),start:async()=>{starts++;state.running=true;},
    computer:{status:async value=>{requests.push(value);const key=Object.keys(value)[0];state[{promptAX:'axTrusted',promptScreen:'screenRecordingTrusted',promptPostEvent:'eventPostingTrusted'}[key]]=true;}},
    open:async value=>settings.push(value),now:()=>time,sleep:async ms=>{time+=ms;},log:v=>logs.push(v)};
  let result=await runTerminalOnboarding(options);
  assert.equal(result.ok,true);assert.equal(starts,1);assert.deepEqual(requests,[{promptAX:true},{promptScreen:true},{promptPostEvent:true}]);assert.equal(settings.length,3);
  await runTerminalOnboarding(options);assert.equal(requests.length,3,'Rerun repeated settled consent');
  state.stopped=true;result=await runTerminalOnboarding(options);assert.equal(result.ok,false);assert.equal(starts,1);assert.equal(requests.length,3);
});
test('denied consent, noninteractive setup and incomplete Claude review never claim full onboarding',async()=>{
  const state={running:true,axTrusted:false};let requests=0,time=0;
  const options={interactive:true,status:async()=>state,computer:{status:async()=>{requests++;}},open:async()=>{},sleep:async ms=>{time+=ms;},now:()=>time,timeoutMs:1,log:()=>{}};
  const denied=await runTerminalOnboarding(options);assert.equal(denied.ok,false);assert.equal(denied.pending,'Accessibility');assert.equal(requests,1);
  const unattended=await runTerminalOnboarding({...options,interactive:false});assert.equal(unattended.pending,'interactive_setup');assert.equal(requests,1);
  Object.assign(state,{axTrusted:true,screenRecordingTrusted:true,eventPostingTrusted:true});
  const client=await runTerminalOnboarding({...options,claude:true,connect:async()=>({ok:true,complete:false,claudeCode:{status:'connected'},desktop:{status:'review_required',bundle:'/pending.mcpb'}})});
  assert.equal(client.pending,'claude_review');assert.equal(client.claude.desktop,'review_required');
});
test('Claude dependency setup uses official installers, checks the app signature and leaves existing apps alone',async t=>{
  const home=mkdtempSync(path.join(os.tmpdir(),'2026-10-18-claude-dependencies-Codex-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const calls=[];let cli=false;
  const run=async(command,args)=>{
    calls.push([command,args]);
    if(args[0]==='--version'&&!cli){const error=Error('absent');error.code='ENOENT';throw error;}
    if(command==='/bin/bash')cli=true;
    if(command==='/usr/bin/curl'&&args.some(a=>a.endsWith('RELEASES.json')))return {stdout:JSON.stringify({currentRelease:'test',releases:[{version:'test',updateTo:{url:'https://downloads.claude.ai/releases/darwin/universal/test/Claude.zip'}}]})};
    if(command==='/usr/bin/ditto'&&args[0]!=='-x')mkdirSync(args[1],{recursive:true});
    return {stdout:''};
  };
  const installed=await installClaudeDependencies({home,applications:[],run,log:()=>{}});
  assert.deepEqual(installed,{code:'installed',desktop:'installed'});
  assert.ok(calls.some(c=>c[0]==='/bin/bash'&&c[1][1]==='stable'));
  assert.ok(calls.some(c=>c[0]==='/usr/bin/codesign'&&c[1].includes('=anchor apple generic and identifier "com.anthropic.claudefordesktop" and certificate leaf[subject.OU] = "Q6L2SF6YDW"')));
  assert.ok(calls.some(c=>c[0]==='/usr/sbin/spctl'));
  calls.length=0;
  assert.deepEqual(await installClaudeDependencies({home,applications:[path.join(home,'Applications')],run,log:()=>{}}),{code:'existing',desktop:'existing'});
  assert.equal(calls.length,1);
});
test('checksum failure blocks bootstrap extraction; stdin command and paths with spaces work',{skip:process.platform!=='darwin'},t=>{
  const folder=mkdtempSync(path.join(os.tmpdir(),'2026-10-18-opensky-bootstrap-Codex-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const file=path.join(folder,'archive with spaces.tgz'),sums=path.join(folder,'sums');writeFileSync(file,'corrupt payload');
  writeFileSync(sums,'0'.repeat(64)+'  payload.tgz\n');
  const script=path.resolve('bootstrap.sh');
  let check=spawnSync('/bin/bash',['-c','source "$1"; opensky_verify "$2" payload.tgz "$3"','fixture',script,file,sums],{encoding:'utf8'});
  assert.notEqual(check.status,0);assert.match(check.stderr,/Checksum failed/);
  writeFileSync(sums,createHash('sha256').update(readFileSync(file)).digest('hex')+'  payload.tgz\n');
  check=spawnSync('/bin/bash',['-c','source "$1"; opensky_verify "$2" payload.tgz "$3"','fixture',script,file,sums]);assert.equal(check.status,0);
  const help=spawnSync('/bin/bash',['-s','--','--help'],{input:readFileSync(script),encoding:'utf8'});assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/OpenSky \+ Claude/);
});
test('Claude dependency entry point runs through a symlinked temporary checkout',t=>{
  const home=mkdtempSync(path.join(os.tmpdir(),'2026-10-18-opensky-entry-Codex-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
  const alias=path.join(home,'linked checkout');symlinkSync(path.resolve('.'),alias,'dir');
  mkdirSync(path.join(home,'.local/bin'),{recursive:true});writeFileSync(path.join(home,'.local/bin/claude'),'#!/bin/sh\necho "Claude fixture version"\n',{mode:0o755});
  const run=spawnSync(process.execPath,[path.join(alias,'scripts/claude-dependencies.mjs'),'--no-desktop'],{env:{HOME:home,PATH:'/usr/bin:/bin'},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),{code:'existing',desktop:'skipped'});
});
test('prebuilt installation needs no compiler, preserves exact signed bytes on rerun and rejects mismatches',{skip:process.platform!=='darwin'},t=>{
  const folder=mkdtempSync(path.join(os.tmpdir(),'2026-10-18-opensky-prebuilt-Codex-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const source=path.join(folder,'source/OpenSky.app'),prefix=path.join(folder,'fresh home/.local'),appDir=path.join(folder,'fresh home/Applications');
  mkdirSync(path.join(source,'Contents/MacOS'),{recursive:true});copyFileSync('/usr/bin/true',path.join(source,'Contents/MacOS/OpenSky'));
  const plist=version=>`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.opensky.computeruse</string><key>CFBundleExecutable</key><string>OpenSky</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${NATIVE_BUILD_VERSION}</string></dict></plist>`;
  writeFileSync(path.join(source,'Contents/Info.plist'),plist(NATIVE_API_VERSION));
  execFileSync('/usr/bin/codesign',['--force','--sign','-',source],{stdio:'pipe'});
  const alias=path.join(folder,'linked checkout');symlinkSync(path.resolve('.'),alias,'dir');
  const args=[path.join(alias,'scripts/install.mjs'),'--prefix',prefix,'--app-dir',appDir,'--prebuilt-app',source];
  const env={...process.env,OPENSKY_HOME:path.join(prefix,'share/opensky'),PATH:'/usr/bin:/bin:/usr/sbin:/sbin',DEVELOPER_DIR:'/does-not-exist'};
  let first=spawnSync(process.execPath,args,{env,encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  assert.equal(existsSync(path.join(prefix,'share/opensky/.opensky-install.json')),true,'A successful exit must actually install, including through a symlinked path.');
  const target=path.join(appDir,'OpenSky.app/Contents/MacOS/OpenSky');assert.deepEqual(readFileSync(target),readFileSync(path.join(source,'Contents/MacOS/OpenSky')));
  const preview=spawnSync(process.execPath,[...args,'--dry-run'],{env,encoding:'utf8'});assert.equal(preview.status,0,preview.stderr);assert.equal(JSON.parse(preview.stdout).action,'runtime-update');
  const runtime=env.OPENSKY_HOME;writeFileSync(path.join(runtime,'control-token'),'private fixture');
  first=spawnSync(process.execPath,args,{env,encoding:'utf8'});assert.equal(first.status,0,first.stderr);assert.equal(readFileSync(path.join(runtime,'control-token'),'utf8'),'private fixture');
  writeFileSync(path.join(source,'Contents/Info.plist'),plist('0.0.0'));execFileSync('/usr/bin/codesign',['--force','--sign','-',source],{stdio:'pipe'});
  const rejected=spawnSync(process.execPath,args,{env,encoding:'utf8'});assert.equal(rejected.status,1);assert.match(rejected.stderr,/does not match/);assert.equal(readFileSync(path.join(runtime,'control-token'),'utf8'),'private fixture');
});
