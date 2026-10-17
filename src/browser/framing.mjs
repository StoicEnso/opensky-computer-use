/** Chrome Native Messaging frames: UTF-8 JSON, native little-endian UInt32. */
export function nativeFrame(value) {
  const body=Buffer.from(JSON.stringify(value));
  if(body.length>1024*1024)throw new Error('Native-host command exceeds Chrome\'s 1 MiB limit.');
  const header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);
}
export function nativeFrameReader(onMessage,{maxBytes=16*1024*1024}={}) {
  let buffer=Buffer.alloc(0);
  return chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4){const size=buffer.readUInt32LE();if(size<2||size>maxBytes)throw new Error('Invalid native message length.');if(buffer.length<size+4)return;const body=buffer.subarray(4,size+4);buffer=buffer.subarray(size+4);onMessage(JSON.parse(body.toString('utf8')));}};
}
export function jsonLineReader(onMessage,{maxBytes=16*1024*1024}={}) {
  let buffer='';const decoder=new StringDecoder('utf8');return chunk=>{buffer+=decoder.write(chunk);if(Buffer.byteLength(buffer)>maxBytes)throw new Error('Bridge message too large.');let at;while((at=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(line)onMessage(JSON.parse(line));}};
}
import {StringDecoder} from 'node:string_decoder';
