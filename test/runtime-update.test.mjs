import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {parseOptions} from '../scripts/install.mjs';
import {NATIVE_API_VERSION} from '../src/native-version.mjs';

test('runtime-only update preserves signed native files, running service and private data',{skip:process.platform!=='darwin'},()=>{
  assert.equal(parseOptions(['--runtime-only']).runtimeOnly,true);
  assert.throws(()=>parseOptions(['--runtime-only','--uninstall']),/cannot be combined/);
  // Keep the disposable signed bundle in OS temp, away from user document metadata services.
  const temporary=mkdtempSync(path.join(os.tmpdir(),'2026-10-17-runtime-update-Codex-'));
  try{
    const prefix=path.join(temporary,'space folder'),runtime=path.join(prefix,'share/opensky'),appDir=path.join(temporary,'Applications'),app=path.join(appDir,'OpenSky.app');
    const installScript=path.resolve(import.meta.dirname,'../scripts/install.mjs');
    const stopped=path.join(temporary,'service-was-contacted');
    const run=()=>spawnSync(process.execPath,[installScript,'--runtime-only','--prefix',prefix,'--app-dir',appDir],{encoding:'utf8',env:{...process.env,OPENSKY_HOME:runtime}});
    assert.equal(run().status,1);assert.equal(existsSync(runtime),false);
    mkdirSync(path.join(runtime,'src'),{recursive:true});mkdirSync(path.join(runtime,'screenshots'));
    writeFileSync(path.join(runtime,'src/cli.mjs'),`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(stopped)},'called');`);
    writeFileSync(path.join(runtime,'control-token'),'a'.repeat(64),{mode:0o600});writeFileSync(path.join(runtime,'screenshots/keep'),'capture');
    writeFileSync(path.join(runtime,'package.json'),'old runtime');
    writeFileSync(path.join(runtime,'.opensky-install.json'),JSON.stringify({schema:1,product:'opensky-computer-use',runtime,app,skillFiles:[]}));
    mkdirSync(path.join(app,'Contents/MacOS'),{recursive:true});
    copyFileSync('/usr/bin/true',path.join(app,'Contents/MacOS/OpenSky'));
    const plist=version=>`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.opensky.computeruse</string><key>CFBundleExecutable</key><string>OpenSky</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`;
    writeFileSync(path.join(app,'Contents/Info.plist'),plist('1.2.0'));
    assert.equal(run().status,1);assert.equal(readFileSync(path.join(runtime,'package.json'),'utf8'),'old runtime');
    writeFileSync(path.join(app,'Contents/Info.plist'),plist(NATIVE_API_VERSION));
    execFileSync('/usr/bin/codesign',['--force','--sign','-','--identifier','dev.opensky.computeruse',app],{stdio:'ignore'});
    const beforeBinary=readFileSync(path.join(app,'Contents/MacOS/OpenSky')),beforePlist=readFileSync(path.join(app,'Contents/Info.plist'));
    const result=run();assert.equal(result.status,0,result.stderr);
    assert.deepEqual(readFileSync(path.join(app,'Contents/MacOS/OpenSky')),beforeBinary);assert.deepEqual(readFileSync(path.join(app,'Contents/Info.plist')),beforePlist);
    assert.equal(existsSync(stopped),false);
    assert.equal(readFileSync(path.join(runtime,'control-token'),'utf8'),'a'.repeat(64));assert.equal(readFileSync(path.join(runtime,'screenshots/keep'),'utf8'),'capture');
    assert.equal(existsSync(path.join(runtime,'src/operator-guidance.mjs')),true);
    assert.equal(JSON.parse(readFileSync(path.join(runtime,'package.json'),'utf8')).version,JSON.parse(readFileSync(path.resolve(import.meta.dirname,'../package.json'),'utf8')).version);
    const signature=spawnSync('/usr/bin/codesign',['--verify','--strict',app],{encoding:'utf8'});
    assert.equal(signature.status,0,signature.stderr+(signature.status?execFileSync('/usr/bin/xattr',['-lr',app],{encoding:'utf8'}):''));
  }finally{rmSync(temporary,{recursive:true,force:true});}
});
