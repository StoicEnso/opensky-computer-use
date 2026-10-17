import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(import.meta.dirname, '..');
const binary = path.join(root, 'Native/.build/release/opensky-daemon');
const available = process.platform === 'darwin' && existsSync(binary);

test('native control transport and real MCP client interoperability', { skip: !available, timeout: 45000 }, async t => {
  mkdirSync(path.join(root, 'research'), { recursive: true });
  const runtime = mkdtempSync(path.join(root, 'research/test-runtime-'));
  const port = await new Promise(resolve => {
    const listener = net.createServer(); listener.listen(0, '127.0.0.1', () => { const value = listener.address().port; listener.close(() => resolve(value)); });
  });
  const environment = { ...process.env, OPENSKY_HOME: runtime, OPENSKY_PORT: String(port), OPENSKY_BINARY: binary };
  const processHandle = spawn(binary, [], { env: environment, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostics = ''; processHandle.stderr.on('data', data => { diagnostics += data; });
  t.after(() => processHandle.kill('SIGTERM'));
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(100) }); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, diagnostics);
  const tokenPath = path.join(runtime, 'control-token');
  const token = readFileSync(tokenPath, 'utf8').trim();
  assert.equal(statSync(tokenPath).mode & 0o777, 0o600);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const rpc = async (method, params = {}) => (await fetch(`${url}/rpc`, { method: 'POST', headers, body: JSON.stringify({ method, params }) })).json();

  await t.test('machine control rejects unauthenticated and browser-origin requests', async () => {
    const unsigned = await fetch(`${url}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'status', params: {} }) });
    assert.equal(unsigned.status, 401);
    const browser = await fetch(`${url}/rpc`, { method: 'POST', headers: { ...headers, Origin: 'https://example.com' }, body: JSON.stringify({ method: 'status', params: {} }) });
    assert.equal(browser.status, 403);
    assert.equal((await fetch(`${url}/anything`, { headers })).status, 404);
    const health = await (await fetch(`${url}/health`)).json();
    assert.equal(health.service, 'OpenSky Computer Use Daemon');
    assert.equal(typeof (await rpc('status')).eventPostingTrusted,'boolean');
    assert.equal('pid' in health, false);
    assert.equal('access-control-allow-origin' in Object.fromEntries(unsigned.headers), false);
  });
  await t.test('invalid inputs fail before control and stale snapshots are rejected', async () => {
    assert.equal((await rpc('get_app_state', {})).error_code, 'invalid_arguments');
    assert.equal((await rpc('get_app_state', {app: 42})).error_code, 'invalid_arguments');
    assert.equal((await rpc('get_app_state', {app: 'Finder', include_ocr: 'true'})).error_code, 'invalid_arguments');
    for (const window_id of [0,-1,1.5,true,4294967296]) assert.equal((await rpc('get_app_state',{app:'Finder',window_id})).error_code,'invalid_arguments');
    assert.ok(['exact_window_unavailable','app_not_found_or_ambiguous'].includes((await rpc('get_app_state',{app:'com.apple.finder',window_id:4294967295,include_screenshot:false})).error_code));
    assert.equal((await rpc('cursor_move', { point: [1] })).ok, false);
    assert.equal((await rpc('click', { element_index: -1 })).ok, false);
    assert.equal((await rpc('cursor_move', { point: [10, 10], duration: -1 })).ok, false);
    assert.equal((await rpc('cursor_move', { point: [true, 10] })).ok, false);
    assert.equal((await rpc('get_app_state', { app: 'Finder', includeOCR: 'true' })).error_code, 'invalid_arguments');
    assert.equal((await rpc('click', { app: 'Finder', snapshot_id: 'not-an-observation', element_index: 1 })).error_code, 'stale_snapshot');
    assert.equal((await rpc('not_a_method')).ok, false);
  });
  await t.test('stop gates future actions and remains independently resumable', async () => {
    assert.equal((await rpc('stop')).stopped, true);
    assert.equal((await rpc('cursor_move', { point: [20, 20] })).error_code, 'stopped');
    assert.equal((await rpc('status')).stopped, true);
    assert.equal((await rpc('resume')).stopped, false);
  });
  await t.test('stop then immediate resume permanently cancels running and queued requests', async () => {
    const running = rpc('cursor_wiggle', { enabled: true, duration: 3, cursor_id: 'cancel-running' });
    await new Promise(resolve => setTimeout(resolve, 100));
    const queued = Array.from({ length: 5 }, (_, i) => rpc('cursor_move', { point: [60 + i, 60], cursor_id: 'cancel-queued' }));
    await new Promise(resolve => setTimeout(resolve, 100));
    await rpc('stop');await rpc('resume');
    assert.equal((await running).error_code, 'cancelled');
    for (const result of await Promise.all(queued)) assert.equal(result.error_code, 'cancelled');
    assert.equal((await rpc('cursor_move', { point: [60, 60] })).ok, true);
    await rpc('cursor_dismiss');
  });
  await t.test('bounded native queue rejects overload while stop remains responsive', async () => {
    const running = rpc('cursor_wiggle', { enabled: true, duration: 3, cursor_id: 'overload' });
    await new Promise(resolve => setTimeout(resolve, 100));
    const queued = Array.from({ length: 70 }, () => rpc('cursor_move', { point: [65, 65] }));
    await new Promise(resolve => setTimeout(resolve, 250));
    const start = Date.now();await rpc('stop');assert.ok(Date.now() - start < 800);await rpc('resume');
    await running;const results = await Promise.all(queued);
    assert.ok(results.some(result => result.error_code === 'queue_full'));
    assert.ok(results.every(result => ['queue_full', 'cancelled'].includes(result.error_code)));
  });
  await t.test('passive Inspector and pointer recovery bypass a busy action queue', async () => {
    const running=rpc('cursor_wiggle',{enabled:true,duration:1.5});await new Promise(r=>setTimeout(r,100));
    for(const [method,params] of [['cursor_status',{}],['cursor_dismiss',{}],['inspector',{action:'status'}],['inspector',{action:'close'}]]){
      const began=Date.now();assert.equal((await rpc(method,params)).ok,true);assert.ok(Date.now()-began<800,method+' must not wait behind the active request');
    }
    assert.equal((await rpc('status')).stopped,false);await running;
  });
  await t.test('queued requests expire instead of delivering late desktop input', async () => {
    const running = rpc('cursor_wiggle', { enabled: true, duration: 5.4, cursor_id: 'expiry-check' });
    await new Promise(resolve => setTimeout(resolve, 100));
    const queued = rpc('cursor_move', { point: [80, 80] });
    await running;assert.equal((await queued).error_code, 'queue_expired');await rpc('cursor_dismiss');
  });
  await t.test('official MCP client discovers tools and reads native status', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/mcp-server.mjs')], env: environment, stderr: 'pipe' });
    const client = new Client({ name: 'opensky-interoperability', version: '1.0' }, { capabilities: {} });
    await client.connect(transport);
    try {
      const result = await client.listTools();
      assert.ok(result.tools.length >= 18);
      for (const name of ['status', 'stop', 'resume', 'get_app_state', 'click', 'cursor_choreography']) assert.ok(result.tools.some(tool => tool.name === name));
      const status = await client.callTool({ name: 'status', arguments: {} });
      assert.equal(status.isError, false);
      assert.equal(status.structuredContent.version, '1.3.0');
      assert.equal(status.structuredContent.screen.width > 0, true);
      const invalid = await client.callTool({ name: 'get_app_state', arguments: {} });
      assert.equal(invalid.isError, true);
      const pending = client.callTool({ name: 'cursor_choreography', arguments: { command: 'wiggle', cursor_id: 'stop-test', label: 'Stop verification', enabled: true, duration: 1.2 } });
      await new Promise(resolve => setTimeout(resolve, 100));
      const started = Date.now();
      const stopped = await client.callTool({ name: 'stop', arguments: {} });
      assert.equal(stopped.structuredContent.stopped, true);
      const feedback = await client.callTool({name:'cursor_choreography',arguments:{command:'status'}});
      assert.equal(feedback.isError,false);assert.equal(feedback.structuredContent.visible,false);
      assert.equal((await client.callTool({name:'cursor_choreography',arguments:{command:'dismiss'}})).isError,false);
      assert.equal((await client.callTool({name:'status',arguments:{}})).structuredContent.stopped,true,'Reading/dismissing feedback must never resume control.');
      assert.ok(Date.now() - started < 800, 'MCP stop must not queue behind an ongoing operation');
      const guidance = await client.callTool({name:'get_operating_guidance',arguments:{}});
      assert.equal(guidance.isError,false);assert.equal(guidance.structuredContent.default_workflow_mode,'auto');
      assert.equal((await client.callTool({name:'status',arguments:{}})).structuredContent.stopped,true);
      await pending;
      await client.callTool({ name: 'resume', arguments: {} });
      const running = client.callTool({ name: 'cursor_choreography', arguments: { command: 'wiggle', enabled: true, duration: 3 } });
      await new Promise(resolve => setTimeout(resolve, 100));
      const queued = Array.from({ length: 4 }, () => client.callTool({ name: 'cursor_choreography', arguments: { command: 'move', point: [70, 70] } }));
      await new Promise(resolve => setTimeout(resolve, 100));
      await client.callTool({ name: 'stop', arguments: {} });
      await client.callTool({ name: 'resume', arguments: {} });
      assert.equal((await running).structuredContent.error_code, 'cancelled');
      for (const result of await Promise.all(queued)) assert.equal(result.structuredContent.error_code, 'cancelled');
      // A different client (or the menu/hotkey) must also cancel MCP-submitted work.
      const externalRunning = client.callTool({ name: 'cursor_choreography', arguments: { command: 'wiggle', enabled: true, duration: 3 } });
      await new Promise(resolve => setTimeout(resolve, 100));
      const externalQueued = Array.from({ length: 4 }, () => client.callTool({ name: 'cursor_choreography', arguments: { command: 'move', point: [75, 75] } }));
      await new Promise(resolve => setTimeout(resolve, 100));
      await rpc('stop');await rpc('resume');
      assert.equal((await externalRunning).structuredContent.error_code, 'cancelled');
      for (const result of await Promise.all(externalQueued)) assert.equal(result.structuredContent.error_code, 'cancelled');
    } finally { await client.close(); }
  });
  await t.test('SDK authenticates against the existing daemon without exposing credentials', async () => {
    const source = `import { computer_use, daemonStatus } from ${JSON.stringify(new URL('../src/index.mjs', import.meta.url).href)}; console.log(JSON.stringify({status:await daemonStatus(),apps:(await computer_use.list_apps({running_only:true})).length}));`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: environment });
    let output = '', error = '';child.stdout.on('data', data => output += data);child.stderr.on('data', data => error += data);
    assert.equal(await new Promise(resolve => child.on('exit', resolve)), 0, error);
    const result = JSON.parse(output); assert.equal(result.status.running, true); assert.ok(result.apps > 0); assert.equal(output.includes(token), false);
  });
  assert.equal((await rpc('shutdown')).ok, true);
});
