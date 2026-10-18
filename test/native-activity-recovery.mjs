// Opt-in regression with the actual production tracker and a disposable runtime.
// Retires only this fixture's listen-only tap; never posts input or requests access.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync,spawnSync} from 'node:child_process';
const source=path.resolve(process.argv[2]??path.join(import.meta.dirname,'../Native/Sources/OpenSkyDaemon/UserActivity.swift'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'2026-10-18-opensky-activity-recovery-Codex-'));
try{
 const swift=fs.readFileSync(source,'utf8')+`
final class CursorOverlayManager {static let shared=CursorOverlayManager();func externalInputObserved(){}}
extension UserActivityTracker {
 func checkRetiredTapRecovery(home: String) throws {
  func require(_ value: Bool,_ message:String) throws {if !value{throw NSError(domain:message,code:1)}}
  try require(AXIsProcessTrusted(),"Already-approved host Accessibility is required; no permission was requested")
  self.home=home
  try FileManager.default.createDirectory(atPath:home,withIntermediateDirectories:true)
  try Data("{\\\"mode\\\":\\\"auto\\\"}".utf8).write(to:URL(fileURLWithPath:home).appendingPathComponent("interaction-mode.json"))
  defer{removeMonitor()}
  sample()
  guard let old=eventTap else{throw NSError(domain:"Already-approved listen access is required; no permission was requested",code:1)}
  try require(CFMachPortIsValid(old)&&CGEvent.tapIsEnabled(tap:old),"Initial fixture tap unavailable")
  CFMachPortInvalidate(old)
  sample()
  try require(eventTap==nil,"Invalid tap retained instead of being retired")
  try require(!monitorReady,"An invalid tap must keep auto restricted")
  Thread.sleep(forTimeInterval:2.1)
  let recoveryStarted=ProcessInfo.processInfo.systemUptime
  sample()
  guard let recovered=eventTap else{throw NSError(domain:"Fixture tap was not recreated",code:1)}
  try require(!CFEqual(old,recovered)&&CFMachPortIsValid(recovered)&&CGEvent.tapIsEnabled(tap:recovered),"Replacement tap not live")
  try require(monitorReady&&clock.startedAt>=recoveryStarted,"Recovery must start a fresh monitored interval")
  try require(clock.idle(at:ProcessInfo.processInfo.systemUptime)<1,"Recovery must not inherit desktop availability")
 }
}
do{try UserActivityTracker().checkRetiredTapRecovery(home:CommandLine.arguments[1]);print("{\\\"passed\\\":true,\\\"realRetiredTapRecreated\\\":true,\\\"newIdleInterval\\\":true,\\\"inputPosted\\\":false,\\\"permissionsRequested\\\":false}")}
catch{fputs(String(describing:error)+"\\n",stderr);exit(1)}
`;
 const main=path.join(root,'main.swift'),binary=path.join(root,'probe');fs.writeFileSync(main,swift);
 execFileSync('swiftc',['-O',main,'-framework','AppKit','-framework','ApplicationServices','-o',binary],{stdio:'pipe'});
 const run=spawnSync(binary,[path.join(root,'runtime')],{encoding:'utf8',timeout:15000});assert.equal(run.status,0,run.stderr||run.error?.message);console.log(run.stdout.trim());
}finally{fs.rmSync(root,{recursive:true,force:true});}
