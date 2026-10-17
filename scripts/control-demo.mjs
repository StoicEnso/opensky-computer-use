import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computer_use as computer, createSession, OPENSKY_HOME, callDaemon } from '../src/index.mjs';

/** A visible, verified control demonstration confined to a newly created native window. */
export async function runControlDemo({ quick = false } = {}) {
  const status = await computer.status();
  if (status.stopped) throw new Error('OpenSky is paused. Resume explicitly before running a demo.');
  if (!status.axTrusted || !status.screenRecordingTrusted) throw new Error('Enable OpenSky Accessibility and Screen Recording, then run opensky doctor.');
  const date = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const id = randomUUID().replaceAll('-', '');
  const root = path.join(OPENSKY_HOME, 'demos', `${date}-control-demo-${id.slice(0, 6)}-Codex`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const bundle = path.join(root, 'OpenSkyDemo.app'), contents = path.join(bundle, 'Contents');
  mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  const app = `dev.opensky.demo.${id}`;
  writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>OpenSkyDemo</string><key>CFBundleIdentifier</key><string>${app}</string><key>CFBundleName</key><string>OpenSky Demo</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
  execFileSync('swiftc', [fileURLToPath(new URL('./fixtures/ControlFixture.swift', import.meta.url)), '-o', path.join(contents, 'MacOS/OpenSkyDemo'), '-framework', 'AppKit'], { stdio: 'pipe' });
  execFileSync('/usr/bin/open', ['-n', '-a', bundle, '--env', `OPENSKY_FIXTURE_OUTPUT=${path.join(root, 'state.json')}`]);
  const session = createSession({ app });
  const pause = ms => new Promise(resolve => setTimeout(resolve, quick ? 20 : ms));
  const checked = value => { if (!value.ok) throw new Error(value.error ?? value.message); return value; };
  const checks = [];
  try {
    const deadline = Date.now() + 8000;
    let state;
    for (;;) {
      state = await computer.get_app_state({ app, include_ocr: true });
      if (state.ok) break;
      if (!['app_window_unavailable', 'app_not_found_or_ambiguous'].includes(state.error_code) || Date.now() > deadline) checked(state);
      await pause(150);
    }
    checked(await computer.manage_window({ app, action: 'focus' }));
    const title = state.elements.find(element => element.title === 'A pointer with a purpose.' && element.source === 'ax');
    const point = title?.frame ? [title.frame[0] + title.frame[2] * .8, title.frame[1] + title.frame[3]] : [state.window_frame[0] + 600, state.window_frame[1] + 160];
    checked(await computer.cursor_move({ point, label: '1 / 4 · Reading controls', duration: quick ? .05 : .8 }));
    await pause(1200);checks.push('Read actual Accessibility controls and screenshot OCR');
    for (let i = 1; i <= 3; i++) {
      await session.click({ role: 'button', name: 'Increment counter' }, { mode: 'background', label: `2 / 4 · Click ${i} of 3` });
      await pause(850);
    }
    await session.waitFor({ identifier: 'counter-value', value: '3' });checks.push('Three real background clicks; counter verified as 3');
    await session.click({ identifier: 'verification-input' }, { mode: 'takeover', label: '3 / 4 · Typing Unicode' });
    checked(await computer.type_text({ app, text: 'OpenSky on your Mac ✓ ދިވެހި 🌍', mode: 'takeover' }));
    await session.waitFor({ identifier: 'verification-input', value: 'OpenSky on your Mac ✓ ދިވެހި 🌍' });checks.push('English, Dhivehi and emoji typed and read back');await pause(1400);
    await session.click({ role: 'text area', name: 'Scratch editor' }, { mode: 'takeover', label: '4 / 4 · Pasting a checklist' });
    checked(await computer.press_key({ app, keys: ['super+a'], mode: 'takeover' }));
    const checklist = 'LIVE DEMO\n\n✓ Read this window\n✓ Clicked the counter three times\n✓ Typed Unicode\n✓ Pasted this checklist\n\nThe pointer shows intent; each result was verified.';
    checked(await computer.paste({ app, content: checklist, format: 'text' }));
    await session.waitFor({ role: 'text area', name: 'Scratch editor', value: checklist });checks.push('Clipboard paste verified in the real editor');
    checked(await computer.cursor_move({ point, label: 'Verified · demo complete ✓', duration: quick ? .05 : .8 }));
    await pause(2200);
    state = checked(await computer.get_app_state({ app, include_ocr: true }));
    const screenshot = path.join(root, `${date}-opensky-control-demo-Codex.png`);copyFileSync(state.screenshot.path, screenshot);
    const result = { ok: true, app, checks, screenshot, report: path.join(root, `${date}-opensky-control-demo-Codex.json`) };
    writeFileSync(result.report, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    return result;
  } finally { await callDaemon('cursor_dismiss', {}, { autoStart: false }).catch(() => {}); }
}
