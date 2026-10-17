import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve(import.meta.dirname,'..');
const assets=path.join(root,'assets/2026-10-17-opensky-brand-Codex');
mkdirSync(assets,{recursive:true});
const png=path.join(assets,'2026-10-17-opensky-icon-Codex.png');
execFileSync('swift',[path.join(root,'scripts/fixtures/BrandIcon.swift'),png],{stdio:'inherit'});
const temporary=mkdtempSync(path.join(os.tmpdir(),'opensky-icon-'));
try{
  const iconset=path.join(temporary,'OpenSky.iconset');mkdirSync(iconset);
  for(const size of [16,32,128,256,512])for(const scale of [1,2]) execFileSync('/usr/bin/sips',['-z',String(size*scale),String(size*scale),png,'--out',path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
  execFileSync('/usr/bin/iconutil',['-c','icns',iconset,'-o',path.join(assets,'OpenSky.icns')]);
}finally{rmSync(temporary,{recursive:true,force:true});}
console.log('Generated OpenSky PNG and ICNS from editable geometry.');
