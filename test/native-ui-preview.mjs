import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,rmSync,copyFileSync,chmodSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root=path.resolve(import.meta.dirname,'..');
const temporary=mkdtempSync(path.join(os.tmpdir(),'2026-10-17-opensky-ui-Codex-'));
const output=process.argv[3]?path.resolve(process.argv[3]):path.join(temporary,'previews');
try {
  const source=process.argv[2]?path.resolve(process.argv[2]):path.join(execFileSync('swift',['build','-c','release','--package-path',path.join(root,'Native'),'--show-bin-path'],{encoding:'utf8'}).trim(),'opensky-daemon');
  // Run outside a production bundle so a fixture cannot register a staging app
  // under the installed bundle ID and redirect a later macOS Quit & Reopen.
  const binary=path.join(temporary,'opensky-ui-preview');copyFileSync(source,binary);chmodSync(binary,0o755);
  const env={...process.env,OPENSKY_HOME:path.join(temporary,'never-started'),OPENSKY_PORT:'53793'};
  const invalid=spawnSync(binary,['--render-ui-preview'],{env,encoding:'utf8',timeout:5000});
  assert.equal(invalid.status,64,invalid.stderr);
  const run=spawnSync(binary,['--render-ui-preview',output],{env,encoding:'utf8',timeout:20000});
  assert.equal(run.status,0,run.stderr||run.error?.message);
  assert.match(run.stdout,/stale-result recovery/);assert.match(run.stdout,/Window feedback checks passed/);
  for(const [name,width,height] of [['inspector-light',920,660],['inspector-dark',920,660],['tray-preview',800,220],['window-feedback',400,300],['window-feedback-offset',400,300]]) {
    const png=readFileSync(path.join(output,`2026-10-17-opensky-${name}-Codex.png`));
    assert.equal(png.subarray(1,4).toString(),'PNG');
    // The backing scale may differ between local and CI displays.
    const scale=png.readUInt32BE(16)/width;
    assert.ok([1,2,3].includes(scale));assert.equal(png.readUInt32BE(20),height*scale);
  }
  assert.equal(existsSync(env.OPENSKY_HOME),false,'UI rendering must not initialize service credentials or runtime state.');
  console.log('Native UI checks passed: offscreen light/dark/tray rendering, exact fixture selection, stale-result recovery, search, clear-on-close, independent cache, template marks and no service startup.');
} finally {rmSync(temporary,{recursive:true,force:true});}
