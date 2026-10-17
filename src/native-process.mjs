import {execFile} from 'node:child_process';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const canonical=file=>{try{return realpathSync(file);}catch{return path.resolve(file);}};

// Diagnostic only: macOS may reopen a registered staging/backup app with the
// same bundle ID. API/version/permission checks alone cannot establish its path.
// `comm` returns the executable path without process arguments or environment.
export async function nativeProcessIdentity(pid,expectedBinary,{readCommand=async id=>{
  const {stdout}=await execute('/bin/ps',['-ww','-p',String(id),'-o','comm='],{encoding:'utf8',timeout:2000,maxBuffer:16384});
  return stdout;
}}={}) {
  if(!Number.isSafeInteger(pid)||pid<=0)return {runningBinary:null,binaryMatches:null};
  try {
    const command=(await readCommand(pid)).trim();
    if(!path.isAbsolute(command)||command.includes('\n'))return {runningBinary:null,binaryMatches:null};
    return {runningBinary:command,binaryMatches:canonical(command)===canonical(expectedBinary)};
  } catch {return {runningBinary:null,binaryMatches:null};}
}
