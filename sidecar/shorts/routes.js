'use strict';
const { makeShortsStore } = require('./store.js');
const { makeShortsCredentials } = require('./credentials.js');
const { makeOpusClient } = require('./opus.js');
const { makeShortsService } = require('./service.js');
function makeShortsRoutes({ fs, path, directory, vault, fetchImpl, now, readBody, writeDurable }) {
  const service = makeShortsService({ store: makeShortsStore({ fs, path, directory, writeDurable }),
    credentials: makeShortsCredentials({ vault, file: path.join(directory, '..', '.secrets', 'shorts-opus.json') }),
    client: makeOpusClient({ fetchImpl }), now });
  const commands = { '/connect': 'connect', '/sources': 'addSource', '/sources/clear': 'clearSource', '/jobs/submit': 'submit',
    '/jobs/refresh': 'refresh', '/jobs/reconcile': 'reconcile', '/clips/approve': 'approve', '/publications/schedule': 'schedule', '/publications/cancel': 'cancel' };
  async function route(req, res) {
    const json = (status, body) => { if (res.headersSent || res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      const u = new URL(req.url, 'http://localhost');
      if (u.search) return json(400, { ok: false, code: 'unexpected_query' });
      const suffix = u.pathname.slice('/api/shorts'.length);
      if (suffix !== '' && !commands[suffix]) return json(404, { ok: false, code: 'not_found' });
      const method = suffix === '' ? 'GET' : 'POST';
      if (req.method !== method) { res.setHeader('Allow', method); return json(405, { ok: false, code: 'method_not_allowed' }); }
      if (method === 'GET') return json(200, service.snapshot());
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return json(415, { ok: false, code: 'json_required' });
      let body;
      try { body = JSON.parse(await readBody(req, 16384, res)); } catch (_) { return json(400, { ok: false, code: 'invalid_json' }); }
      return json(200, await service[commands[suffix]](body));
    } catch (e) { return json(e.shortsError ? e.status : 503, { ok: false, code: e.shortsError ? e.code : 'shorts_unavailable' }); }
  }
  return { route, poll: service.poll, secretValues: service.secretValues };
}
module.exports = { makeShortsRoutes };
