'use strict';

const crypto = require('node:crypto');
const { readJsonResilient, writeJsonResilient, makeKeyedMutex } = require('../durable-store.js');
const M = require('./model.js');
// Shared by store instances in one process. The host's workspace-owner guard
// remains responsible for excluding a second sidecar process.
const mutex = makeKeyedMutex();

function makeCommerceStore({ fs, path, directory, mode, now, writeDurable }) {
  M.check(typeof now === 'function', 'Commerce requires an injected clock.');
  M.initialState(mode); // validate mode before using it in a path
  const file = path.resolve(directory, mode + '.json');
  function load() {
    const read = readJsonResilient({ fs }, file);
    if (read.status === 'absent') return { state: M.initialState(mode), status: 'absent' };
    // A backup may omit the latest deduplication receipt. Never resume mutation
    // from it automatically; retain both files for an explicit recovery decision.
    if (read.status === 'recovered') M.fail('ECOMMERCE_RECOVERY_REQUIRED', 'Commerce backup requires review before continuing.', 503);
    if (read.status !== 'ok') M.fail('ECOMMERCE_STORAGE_UNAVAILABLE', 'Commerce records are unavailable; existing files were preserved.', 503);
    try { return { state: M.validateState(read.value, mode), status: 'ok' }; }
    catch (_) { M.fail('ECOMMERCE_STATE_INVALID', 'Commerce records failed validation; existing files were preserved.', 503); }
  }
  function getSnapshot() {
    const loaded = load(); return M.snapshot(loaded.state, now(), loaded.status);
  }
  async function ingest(input) {
    const event = M.normalizeEvent(input);
    const digest = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
    return mutex.run(file, () => {
      const { state } = load();
      const previous = state.receipts.find(r => r.id === event.id);
      if (previous) {
        if (previous.digest !== digest) M.fail('ECOMMERCE_EVENT_CONFLICT', 'Event identifier was reused with different data.', 409);
        return { duplicate: true, outcome: previous.outcome, snapshot: M.snapshot(state, now(), 'ok') };
      }
      if (state.receipts.length >= M.LIMITS.receipts) M.fail('ECOMMERCE_CAPACITY', 'Event capacity reached; receipts were retained to prevent replay.', 409);
      const at = M.timestamp(now());
      const result = M.applyEvent(state, event, at);
      const next = result.state;
      next.receipts.push({ id: event.id, digest, outcome: result.outcome });
      next.actions.push({ id: event.id, actor: 'demo', actionType: event.type, targetId: event.orderId,
        policyDecision: 'demo_only', status: result.outcome, externalReference: null, occurredAt: at });
      next.updatedAt = at;
      M.validateState(next, mode);
      fs.mkdirSync(directory, { recursive: true });
      writeJsonResilient({ fs, path, writeDurable }, file, next);
      const proven = load().state;
      if (JSON.stringify(proven) !== JSON.stringify(next)) M.fail('ECOMMERCE_WRITE_UNPROVEN', 'Commerce write could not be verified.', 503);
      return { duplicate: false, outcome: result.outcome, snapshot: M.snapshot(proven, now(), 'ok') };
    });
  }
  return { getSnapshot, ingest };
}

module.exports = { makeCommerceStore };
