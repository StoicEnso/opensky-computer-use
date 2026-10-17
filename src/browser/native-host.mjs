#!/usr/bin/env node
import net from 'node:net';
import {ensureBrowserBridge} from './client.mjs';
import {browserSettings,browserToken,EXTENSION_ID} from './settings.mjs';
import {nativeFrame,nativeFrameReader,jsonLineReader} from './framing.mjs';

if(process.argv[2]!==`chrome-extension://${EXTENSION_ID}/`)throw new Error('Unexpected native-messaging origin.');
const settings=browserSettings();await ensureBrowserBridge();
let first=true;
const fromChrome=nativeFrameReader(message=>{
  if(first){first=false;if(message.type!=='hello')throw new Error('Extension handshake required.');connectProfile(message);return;}
  activeSocket?.write(JSON.stringify(message)+'\n');
});
let activeSocket;
function connectProfile(hello){activeSocket=net.connect(settings.socket);activeSocket.on('connect',()=>activeSocket.write(JSON.stringify({...hello,token:browserToken(settings)})+'\n'));const read=jsonLineReader(value=>process.stdout.write(nativeFrame(value)));activeSocket.on('data',chunk=>{try{read(chunk);}catch{process.exit(1);}});activeSocket.on('error',()=>process.exit(1));activeSocket.on('close',()=>process.exit(0));}
process.stdin.on('data',chunk=>{try{fromChrome(chunk);}catch(error){process.stderr.write(error.message+'\n');process.exit(1);}});
process.stdin.on('end',()=>{activeSocket?.destroy();});
