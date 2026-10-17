import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativeProcessIdentity} from '../src/native-process.mjs';
import {ownAXUpgradeRequired} from '../src/native-version.mjs';

test('known SwiftUI self-control crash is gated by native build without blocking other apps',()=>{
  for(const method of ['click','set_value','perform_secondary_action','select_text','manage_window']) {
    for(const build of [undefined,'1.3.0','1.3.2'])assert.equal(ownAXUpgradeRequired(method,{app:'dev.opensky.computeruse'},build),true);
    for(const build of ['1.3.3','1.10.0','2.0.0'])assert.equal(ownAXUpgradeRequired(method,{app:'OpenSky'},build),false);
    assert.equal(ownAXUpgradeRequired(method,{app:'Google Chrome'},'1.3.2'),false);
  }
  assert.equal(ownAXUpgradeRequired('inspector',{app:'OpenSky'},'1.3.2'),false);
  assert.equal(ownAXUpgradeRequired('get_app_state',{app:'OpenSky'},'1.3.2'),false);
});

test('native process diagnostics distinguish a staging copy with the same executable name',async()=>{
  const readCommand=async pid=>{assert.equal(pid,123);return '/Applications/.staged/OpenSky.app/Contents/MacOS/OpenSky\n';};
  const result=await nativeProcessIdentity(123,'/Applications/OpenSky.app/Contents/MacOS/OpenSky',{readCommand});
  assert.equal(result.binaryMatches,false);
  assert.match(result.runningBinary,/\.staged/);
});

test('native process diagnostics resolve path aliases without reporting a different copy',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'opensky-process-'));
  try {
    const binary=path.join(root,'OpenSky');fs.writeFileSync(binary,'fixture');
    const alias=path.join(root,'alias');fs.symlinkSync(root,alias,'dir');
    const result=await nativeProcessIdentity(123,path.join(alias,'OpenSky'),{readCommand:async()=>binary+'\n'});
    assert.equal(result.binaryMatches,true);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('native process diagnostics never invent a path for an absent or unreadable process',async()=>{
  const absent=await nativeProcessIdentity(null,'/Applications/OpenSky',{readCommand:async()=>{throw Error('must not query');}});
  assert.deepEqual(absent,{runningBinary:null,binaryMatches:null});
  for(const readCommand of [async()=>{throw Error('process exited');},async()=>'',async()=>'relative',async()=>'/a\n/b']) {
    assert.deepEqual(await nativeProcessIdentity(123,'/Applications/OpenSky',{readCommand}),absent);
  }
});
