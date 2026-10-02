'use strict';
const { check, fields, id, fail } = require('./model.js');
function makeShortsCredentials({ vault, file }) {
  const known = new Set();
  function get() {
    check(vault.protected, 'encrypted_storage_required', 503);
    let value; try { value = vault.load(file); } catch (_) { throw fail('credentials_locked', 503); }
    if (value === undefined) return null;
    try {
      check(value.version === 2 && value.configs.length === 1, 'invalid_credentials');
      const c = value.configs[0]; fields(c, ['id', 'apiKey', 'orgId']); check(c.id === 'opusclip', 'invalid_credentials'); validate(c); known.add(c.apiKey); return { apiKey: c.apiKey, orgId: c.orgId };
    } catch (_) { throw fail('credentials_locked', 503); }
  }
  function validate(c) { id(c.orgId); check(typeof c.apiKey === 'string' && /^[\x21-\x7e]{16,512}$/.test(c.apiKey), 'invalid_api_key'); }
  function set(c) {
    check(vault.protected, 'encrypted_storage_required', 503); validate(c); known.add(c.apiKey);
    try { vault.write(file, { version: 2, configs: [{ id: 'opusclip', apiKey: c.apiKey, orgId: c.orgId }], oauth: { byId: {}, clients: {} } }, { removal: true }); }
    catch (_) { throw fail('credentials_locked', 503); }
  }
  return { get, set, protected: () => vault.protected, secretValues: () => Array.from(known) };
}
module.exports = { makeShortsCredentials };
