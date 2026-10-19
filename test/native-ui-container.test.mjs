import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const binary=path.join(root,'Native/.build/release/opensky-daemon');
test('native activity popover container fits initially, grows, shrinks and renders without starting control',{
  skip:process.platform!=='darwin'||!existsSync(binary),timeout:35000
},()=>{
  const result=spawnSync(process.execPath,[path.join(root,'test/native-ui-preview.mjs'),binary],{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr||result.error?.message||`UI checks exited ${result.status}, signal ${result.signal}.`);
  assert.match(result.stdout,/Native UI checks passed/);
});
