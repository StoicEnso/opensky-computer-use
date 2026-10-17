/** Structured selection never guesses between multiple controls or retries input. */
export class OpenSkyError extends Error {
  constructor(code, message, details) { super(message); this.name = 'OpenSkyError'; this.code = code; this.details = details; }
}

export function matchElements(state, selector = {}) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) throw new OpenSkyError('invalid_selector', 'Selector must be an object.');
  const allowed = new Set(['name', 'role', 'identifier', 'value', 'source', 'exact', 'enabled']);
  for (const [key, value] of Object.entries(selector)) {
    if (!allowed.has(key)) throw new OpenSkyError('invalid_selector', `Unknown selector field: ${key}`);
    if (['exact', 'enabled'].includes(key) ? typeof value !== 'boolean' : typeof value !== 'string') throw new OpenSkyError('invalid_selector', `Invalid selector field: ${key}`);
  }
  if (selector.source && !['ax', 'ocr', 'any'].includes(selector.source)) throw new OpenSkyError('invalid_selector', 'Source must be ax, ocr or any.');
  if (!['name', 'role', 'identifier', 'value'].some(key => typeof selector[key] === 'string' && selector[key].length)) throw new OpenSkyError('invalid_selector', 'Provide a name, role, identifier or value.');
  if (!Array.isArray(state?.elements)) throw new OpenSkyError('structured_state_unavailable', 'This daemon does not return structured controls. Update OpenSky.');
  const normalize = value => String(value ?? '').normalize('NFC').toLowerCase();
  return state.elements.filter(element => {
    if ((selector.source ?? 'ax') !== 'any' && element.source !== (selector.source ?? 'ax')) return false;
    if (selector.role !== undefined && normalize(element.role) !== normalize(selector.role)) return false;
    if (selector.identifier !== undefined && element.identifier !== selector.identifier) return false;
    if (selector.value !== undefined && element.value !== selector.value) return false;
    if (selector.enabled !== undefined && element.enabled !== selector.enabled) return false;
    if (selector.name !== undefined) {
      const actual = normalize(element.title), expected = normalize(selector.name);
      if (selector.exact === false ? !actual.includes(expected) : actual !== expected) return false;
    }
    return true;
  });
}

function checked(result) {
  if (!result?.ok) throw new OpenSkyError(result?.error_code ?? 'action_failed', result?.error ?? result?.message ?? 'OpenSky request failed.', result);
  return result;
}

export function createSessionWithComputer(computer, { app, mode = 'hybrid' } = {}) {
  if (typeof app !== 'string' || !app.trim()) throw new OpenSkyError('invalid_app', 'A session requires an exact app name or bundle ID.');
  if (!['background', 'hybrid', 'takeover'].includes(mode)) throw new OpenSkyError('invalid_mode', 'Invalid execution mode.');
  const observe = async (options = {}) => checked(await computer.get_app_state({ ...options, app }));
  async function find(selector, { timeoutMs = 0, pollIntervalMs = 150, include_ocr = ['ocr', 'any'].includes(selector?.source), signal } = {}) {
    // Validate before inspecting/launching an app.
    matchElements({ elements: [] }, selector);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000 || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 50 || pollIntervalMs > 5000) throw new OpenSkyError('invalid_timeout', 'Timeout must be 0–30000 ms and polling 50–5000 ms.');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      signal?.throwIfAborted();
      const state = await observe({ include_screenshot: false, include_ocr });
      signal?.throwIfAborted();
      const matches = matchElements(state, selector);
      if (matches.length > 1) throw new OpenSkyError('ambiguous_element', `${matches.length} controls match. Add a role or identifier.`, { matches, snapshot_id: state.snapshot_id });
      if (matches.length === 1) return { element: matches[0], snapshot_id: state.snapshot_id, state };
      if (Date.now() >= deadline) throw new OpenSkyError('element_not_found', 'No control matches the selector.', { selector, snapshot_id: state.snapshot_id });
      await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))));
    }
  }
  return {
    app, observe, find,
    waitFor: (selector, options = {}) => find(selector, { timeoutMs: 5000, ...options }),
    async click(selector, options = {}) {
      const target = await find(selector);
      if (target.element.enabled === false) throw new OpenSkyError('element_disabled', 'The selected control is disabled.');
      return checked(await computer.click({ ...options, mode: options.mode ?? mode, app, element_index: target.element.element_index, snapshot_id: target.snapshot_id }));
    },
    async setValue(selector, value) {
      const target = await find(selector);
      if (target.element.enabled === false || !target.element.settable) throw new OpenSkyError('element_not_writable', 'The selected control is not writable.');
      return checked(await computer.set_value({ app, element_index: target.element.element_index, snapshot_id: target.snapshot_id, value }));
    }
  };
}
