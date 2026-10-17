import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

test('CLI distinguishes delivered input with an observation warning from failed input', async t => {
  const research = new URL('../research/', import.meta.url);
  await mkdir(research, { recursive: true });
  const runtime = await mkdtemp(path.join(research.pathname, 'cli-observation-'));
  await writeFile(path.join(runtime, 'control-token'), 'a'.repeat(64), { mode: 0o600 });
  let result = { ok: true, observation_ok: false, message: 'Sent one key.', error: 'Window closed.', error_code: 'app_window_unavailable' };
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url === '/health' ? { service: 'OpenSky Computer Use Daemon', version: '1.2.0' }
      : request.url === '/status' ? { ok: true, service: 'OpenSky Computer Use Daemon' } : result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(runtime, { recursive: true, force: true }); });
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL('../src/cli.mjs', import.meta.url).pathname, 'key', 'TestApp', 'Return'], {
      env: { ...process.env, OPENSKY_HOME: runtime, OPENSKY_PORT: String(server.address().port) }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
  const delivered = await run();
  assert.equal(delivered.code, 0); assert.match(delivered.stdout, /Sent one key/); assert.match(delivered.stderr, /Observation warning: Window closed/);
  result = { ok: false, message: 'No input sent.' };
  const failed = await run(); assert.equal(failed.code, 1); assert.match(failed.stdout, /No input sent/);
});
