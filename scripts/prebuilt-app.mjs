import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {NATIVE_API_VERSION,NATIVE_BUILD_VERSION} from '../src/native-version.mjs';

const plist = (app,key) => execFileSync('/usr/libexec/PlistBuddy',['-c',`Print :${key}`,path.join(app,'Contents/Info.plist')],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
// /usr/bin/lipo is an Xcode shim on fresh Macs. Read the public Mach-O header
// directly so validating a prebuilt app cannot summon developer-tool setup.
export function machOArchitectures(bytes) {
  if(bytes.length<8)throw Error('Incomplete native executable.');
  const magic=bytes.readUInt32BE(0),cpuTypes=[];
  if([0xcafebabe,0xbebafeca,0xcafebabf,0xbfbafeca].includes(magic)) {
    const little=[0xbebafeca,0xbfbafeca].includes(magic),wide=[0xcafebabf,0xbfbafeca].includes(magic);
    const read=offset=>little?bytes.readUInt32LE(offset):bytes.readUInt32BE(offset);
    const count=read(4),stride=wide?32:20;
    if(!count||count>128||bytes.length<8+count*stride)throw Error('Invalid universal executable header.');
    for(let i=0;i<count;i++)cpuTypes.push(read(8+i*stride));
  } else if([0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe].includes(magic))cpuTypes.push([0xcefaedfe,0xcffaedfe].includes(magic)?bytes.readUInt32LE(4):bytes.readUInt32BE(4));
  else throw Error('The native executable is not Mach-O.');
  return [...new Set(cpuTypes.map(cpu=>({[0x0100000c]:'arm64',[0x01000007]:'x86_64'}[cpu])).filter(Boolean))];
}
function signingIdentity(app) {
  execFileSync('/usr/bin/codesign',['--verify','--strict',app],{stdio:'pipe'});
  const result=execFileSync('/usr/bin/codesign',['-d','-r-',app],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  return result.trim();
}
export function validatePrebuiltApp(app) {
  if(plist(app,'CFBundleIdentifier')!=='dev.opensky.computeruse' || plist(app,'CFBundleExecutable')!=='OpenSky') throw Error('The prebuilt app is not OpenSky.');
  if(plist(app,'CFBundleShortVersionString')!==NATIVE_API_VERSION || plist(app,'CFBundleVersion')!==NATIVE_BUILD_VERSION) throw Error('The prebuilt app does not match this runtime’s native API/UI versions.');
  signingIdentity(app);
  const architectures=machOArchitectures(readFileSync(path.join(app,'Contents/MacOS/OpenSky')));
  const required=process.arch==='x64'?'x86_64':process.arch;
  if(!architectures.includes(required) && !(required==='arm64'&&architectures.includes('arm64e'))) throw Error(`The prebuilt app does not support ${required}.`);
  return {architectures};
}
export function sameNativeApp(source,destination) {
  if(!existsSync(path.join(destination,'Contents/Info.plist'))) return false;
  try {
    const digest=app=>createHash('sha256').update(readFileSync(path.join(app,'Contents/MacOS/OpenSky'))).digest('hex');
    return plist(source,'CFBundleIdentifier')===plist(destination,'CFBundleIdentifier') &&
      plist(source,'CFBundleVersion')===plist(destination,'CFBundleVersion') &&
      plist(source,'CFBundleShortVersionString')===plist(destination,'CFBundleShortVersionString') &&
      signingIdentity(source)===signingIdentity(destination) && digest(source)===digest(destination);
  } catch {return false;}
}
