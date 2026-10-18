import {existsSync,mkdirSync,mkdtempSync,rmSync,renameSync,realpathSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const execute=promisify(execFile);
// Claude's own macOS updater feed avoids a browser-only download redirect.
export const CLAUDE_RELEASES='https://downloads.claude.ai/releases/darwin/universal/RELEASES.json';
export async function installClaudeDependencies({home=os.homedir(),desktop=true,
  run=(command,args)=>execute(command,args,{timeout:600000,maxBuffer:1024*1024}),
  applications=['/Applications',path.join(home,'Applications')],log=console.log}={}) {
  const outcome={code:'existing',desktop:desktop?'existing':'skipped'};
  let code=false;
  try{await run(existsSync(path.join(home,'.local/bin/claude'))?path.join(home,'.local/bin/claude'):'claude',['--version']);code=true;}catch(error){if(error.code!=='ENOENT')throw Error('The existing Claude CLI could not run; it was preserved. Run claude --version to inspect it.');}
  const app=applications.find(folder=>existsSync(path.join(folder,'Claude.app')));
  if(code && (!desktop||app))return outcome;
  const temporary=mkdtempSync(path.join(os.tmpdir(),'2026-10-18-opensky-claude-download-Codex-'));
  try {
    if(!code) {
      log('Installing Claude Code using Anthropic’s official native installer…');
      const script=path.join(temporary,'claude-install.sh');
      await run('/usr/bin/curl',['-fsSL','--proto','=https','--proto-redir','=https','--connect-timeout','20','--max-time','120','https://claude.ai/install.sh','-o',script]);
      await run('/bin/bash',[script,'stable']);
      await run(path.join(home,'.local/bin/claude'),['--version']);
      outcome.code='installed';
    }
    if(desktop&&!app) {
      log('Downloading Claude Desktop from Anthropic…');
      const response=await run('/usr/bin/curl',['-fsSL','--proto','=https','--proto-redir','=https','--max-time','60',CLAUDE_RELEASES]);
      const feed=JSON.parse(response.stdout),release=feed.releases?.find(entry=>entry.version===feed.currentRelease);
      const url=new URL(release?.updateTo?.url);
      if(url.protocol!=='https:'||url.hostname!=='downloads.claude.ai'||!url.pathname.startsWith('/releases/darwin/universal/')||!url.pathname.endsWith('.zip')||url.username||url.password)throw Error('Claude’s download feed returned an unrecognized app URL.');
      const archive=path.join(temporary,'Claude.zip'),unpacked=path.join(temporary,'unpacked');
      await run('/usr/bin/curl',['-fL','--proto','=https','--proto-redir','=https','--connect-timeout','20','--max-time','600',url.href,'-o',archive]);
      mkdirSync(unpacked);await run('/usr/bin/ditto',['-x','-k',archive,unpacked]);
      const source=path.join(unpacked,'Claude.app'),folder=path.join(home,'Applications'),target=path.join(folder,'Claude.app');
      const requirement='=anchor apple generic and identifier "com.anthropic.claudefordesktop" and certificate leaf[subject.OU] = "Q6L2SF6YDW"';
      await run('/usr/bin/codesign',['--verify','--deep','--strict','-R',requirement,source]);
      await run('/usr/sbin/spctl',['--assess','--type','execute',source]);
      mkdirSync(folder,{recursive:true});
      const stage=mkdtempSync(path.join(folder,'.opensky-claude-'));
      try {
        await run('/usr/bin/ditto',[source,path.join(stage,'Claude.app')]);
        await run('/usr/bin/codesign',['--verify','--deep','--strict','-R',requirement,path.join(stage,'Claude.app')]);
        if(existsSync(target))throw Error('Claude appeared during installation. Its existing app was preserved; run setup again.');
        renameSync(path.join(stage,'Claude.app'),target);
      }finally{rmSync(stage,{recursive:true,force:true});}
      outcome.desktop='installed';
    }
    return outcome;
  } finally {
    rmSync(temporary,{recursive:true,force:true});
  }
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url)))installClaudeDependencies({desktop:!process.argv.includes('--no-desktop')}).then(result=>{if(result)console.log(JSON.stringify(result));}).catch(error=>{console.error(`Claude setup: ${error.message}`);process.exitCode=1;});
