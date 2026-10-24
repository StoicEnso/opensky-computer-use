import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync,spawnSync} from 'node:child_process';import path from 'node:path';
test('native shared-input yield interrupts a real script and preserves background/stop generations',{skip:process.platform!=='darwin',timeout:90000},()=>{
  execFileSync('swift',['build','-c','release','--package-path','Native'],{cwd:path.resolve(import.meta.dirname,'..'),stdio:'pipe'});
  const result=spawnSync(path.resolve(import.meta.dirname,'../Native/.build/release/opensky-daemon'),['--test-cooperation'],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  assert.match(result.stdout,/Cooperation interlock passed/);
  const http=spawnSync(process.execPath,[path.resolve(import.meta.dirname,'native-cooperation-http.mjs')],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:15000});
  assert.equal(http.status,0,http.stderr||http.stdout);
});
