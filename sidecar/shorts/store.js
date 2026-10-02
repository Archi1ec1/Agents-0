'use strict';
const { makeKeyedMutex, readJsonResilient, writeJsonResilient } = require('../durable-store.js');
const { fail, check, digest, initialState, validateState } = require('./model.js');
const mutex = makeKeyedMutex();
function makeShortsStore({ fs, path, directory, writeDurable }) {
  // .ledger avoids the generic recovery exporter's automatic .json -> .bak substitution.
  // A previous ledger can be missing a paid-action receipt and must never be promoted silently.
  const file = path.join(directory, 'workflow.ledger');
  function read() {
    const got = readJsonResilient({ fs }, file);
    if (got.status === 'absent') return initialState();
    check(got.status === 'ok', 'storage_unavailable', 503);
    try {
      check(got.value && got.value.format === 'thelab.shorts.v1' && got.value.checksum === digest(got.value.state), 'invalid_ledger');
      return validateState(got.value.state);
    } catch (_) { throw fail('storage_unavailable', 503); }
  }
  function save(state) {
    validateState(state);
    const value = { format: 'thelab.shorts.v1', checksum: digest(state), state };
    try {
      fs.mkdirSync(directory, { recursive: true });
      writeJsonResilient({ fs, path, writeDurable }, file, value);
      check(digest(read()) === value.checksum, 'storage_unavailable', 503);
    } catch (_) { throw fail('storage_unavailable', 503); }
  }
  return { read, run: fn => mutex.run(path.resolve(file), () => { const state = read(); return fn(state, () => save(state)); }) };
}
module.exports = { makeShortsStore };
