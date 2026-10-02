'use strict';

const M = require('./model.js');
const { makeCommerceStore } = require('./store.js');
const { demoEvent, STEPS } = require('./demo.js');

// Register only behind the host's Host/Origin/token and update-freeze gates.
// No webhooks, provider credentials, or live write endpoints are exposed here.
function makeCommerceRoutes(options) {
  const stores = Object.fromEntries(['disconnected', 'demo'].map(mode =>
    [mode, makeCommerceStore({ ...options, mode })]));
  return async function handleCommerce(req, res) {
    const json = (status, body, headers = {}) => {
      if (res.headersSent || res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/commerce') {
        if (req.method !== 'GET') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET' });
        M.check([...url.searchParams.keys()].every(key => key === 'mode') && url.searchParams.getAll('mode').length <= 1, 'Invalid commerce query.');
        const mode = url.searchParams.get('mode') || 'disconnected';
        M.check(mode === 'disconnected' || mode === 'demo', 'Live commerce mode is not available yet.');
        return json(200, { ok: true, ...stores[mode].getSnapshot(), demoSteps: Object.keys(STEPS) });
      }
      if (url.pathname === '/api/commerce/demo/events') {
        if (req.method !== 'POST') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
        M.check(!url.search, 'Demonstration events do not accept query parameters.');
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return json(415, { ok: false, code: 'JSON_REQUIRED' });
        let input;
        try { input = JSON.parse(await options.readBody(req, 4096, res)); }
        catch (error) { return json(error.statusCode === 413 ? 413 : 400, { ok: false, code: 'INVALID_JSON' }); }
        const result = await stores.demo.ingest(demoEvent(input));
        return json(200, { ok: true, ...result });
      }
      return json(404, { ok: false, code: 'COMMERCE_ROUTE_NOT_FOUND' });
    } catch (error) {
      const known = typeof error.code === 'string' && error.code.startsWith('ECOMMERCE_');
      return json(known ? error.status : 503, { ok: false,
        code: known ? error.code : 'ECOMMERCE_STORAGE_UNAVAILABLE',
        error: known ? error.message : 'Commerce storage is unavailable; retry after checking local storage.' });
    }
  };
}

module.exports = { makeCommerceRoutes };
