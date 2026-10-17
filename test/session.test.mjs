import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionWithComputer, matchElements } from '../src/session.mjs';
const button = { element_index: 41, role: 'button', title: 'Save', identifier: 'save', source: 'ax', enabled: true, settable: false };
const field = { element_index: 42, role: 'text field', title: 'Name', identifier: 'name', source: 'ax', enabled: true, settable: true, value: '' };
const snapshot = { ok: true, snapshot_id: 'fresh', elements: [button, field, { ...button, element_index: 99, source: 'ocr' }] };

test('selectors exclude duplicate OCR by default and support explicit source selection', () => {
  assert.deepEqual(matchElements(snapshot, { name: 'save', role: 'button' }), [button]);
  assert.equal(matchElements(snapshot, { name: 'Save', source: 'any' }).length, 2);
  assert.equal(matchElements(snapshot, { identifier: 'name' })[0].element_index, 42);
  assert.equal(matchElements(snapshot, { name: 'Sav' }).length, 0);
  assert.equal(matchElements(snapshot, { name: 'Sav', exact: false }).length, 1);
  assert.throws(() => matchElements(snapshot, { nmae: 'Save' }), { code: 'invalid_selector' });
  assert.throws(() => matchElements(snapshot, {}), { code: 'invalid_selector' });
});
test('ambiguous targets and disabled controls cannot dispatch input', async () => {
  let actions = 0;
  const computer = { get_app_state: async () => ({ ...snapshot, elements: [button, { ...button, element_index: 43 }] }), click: async () => { actions++; } };
  const session = createSessionWithComputer(computer, { app: 'fixture' });
  await assert.rejects(session.click({ name: 'Save' }), { code: 'ambiguous_element' });
  computer.get_app_state = async () => ({ ...snapshot, elements: [{ ...button, enabled: false }] });
  await assert.rejects(session.click({ name: 'Save' }), { code: 'element_disabled' });
  assert.equal(actions, 0);
});
test('a failed mutation is attempted once and always receives its fresh snapshot binding', async () => {
  let attempts = 0, observation = 0;
  const computer = {
    get_app_state: async () => { observation++; return snapshot; },
    click: async params => { attempts++; assert.equal(params.app, 'fixture');assert.equal(params.element_index, 41);assert.equal(params.snapshot_id, 'fresh');return { ok: false, error_code: 'stale_snapshot', error: 'Stale' }; }
  };
  const session = createSessionWithComputer(computer, { app: 'fixture' });
  await assert.rejects(session.click({ name: 'Save' }), { code: 'stale_snapshot' });
  assert.equal(attempts, 1);assert.equal(observation, 1);
});
test('waitFor polls observations only and refuses invalid selectors before app access', async () => {
  let observations = 0;
  const computer = { get_app_state: async () => ({ ...snapshot, elements: ++observations > 1 ? [field] : [] }) };
  const session = createSessionWithComputer(computer, { app: 'fixture' });
  const result = await session.waitFor({ identifier: 'name' }, { timeoutMs: 500, pollIntervalMs: 50 });
  assert.equal(result.element.element_index, 42);assert.equal(observations, 2);
  await assert.rejects(session.find({ exact: 'yes' }), { code: 'invalid_selector' });assert.equal(observations, 2);
});
test('setValue refuses read-only fields and binds writable ones to their snapshot', async () => {
  const computer = {
    get_app_state: async () => snapshot,
    set_value: async params => { assert.equal(params.snapshot_id, 'fresh');assert.equal(params.element_index, 42);assert.equal(params.value, 'ދިވެހި ✓');return { ok: true }; }
  };
  const session = createSessionWithComputer(computer, { app: 'fixture' });
  await assert.rejects(session.setValue({ name: 'Save' }, 'x'), { code: 'element_not_writable' });
  assert.equal((await session.setValue({ identifier: 'name' }, 'ދިވެހި ✓')).ok, true);
});
test('aborted waits stop before further inspection', async () => {
  let observations = 0;const controller = new AbortController();controller.abort();
  const session = createSessionWithComputer({ get_app_state: async () => { observations++;return snapshot; } }, { app: 'fixture' });
  await assert.rejects(session.waitFor({ name: 'Save' }, { signal: controller.signal }), { name: 'AbortError' });assert.equal(observations, 0);
});
