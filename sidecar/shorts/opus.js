'use strict';
const { check, fail, id, text, integer, mediaUrl, digest } = require('./model.js');
const { swallow } = require('../failopen.js');
const BASE = 'https://api.opus.pro/api';
function makeOpusClient({ fetchImpl, timeoutSignal = ms => AbortSignal.timeout(ms) }) {
  async function request(credentials, method, endpoint, body) {
    let response;
    try {
      response = await fetchImpl(BASE + endpoint, { method, redirect: 'error', signal: timeoutSignal(30000),
        headers: { Authorization: 'Bearer ' + credentials.apiKey, 'x-opus-org-id': credentials.orgId, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (_) { throw Object.assign(fail('provider_unreachable', 502), { ambiguous: method !== 'GET' }); }
    if (!response.ok) {
      // Never echo provider bodies: upstream errors can include URLs and credentials.
      if (response.body && response.body.cancel) await response.body.cancel().catch(() => swallow('shorts.opus.cancel-body')(new Error('Provider response cleanup failed')));
      const code = response.status === 401 || response.status === 403 ? 'provider_access_required' : response.status === 429 ? 'provider_rate_limited' : 'provider_rejected';
      throw Object.assign(fail(code, 502), { ambiguous: method !== 'GET' && ![400, 401, 403, 404, 422].includes(response.status), providerStatus: response.status });
    }
    if (response.status === 204) return null;
    try {
      const reader = response.body.getReader(); let length = 0; const chunks = [];
      for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('too large'); } chunks.push(Buffer.from(part.value)); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (_) { throw Object.assign(fail('provider_invalid_response', 502), { ambiguous: method !== 'GET' }); }
  }
  async function accounts(c) {
    const r = await request(c, 'GET', '/social-accounts?q=mine');
    check(r && Array.isArray(r.data) && r.data.length <= 100, 'provider_invalid_response', 502);
    const out = r.data.filter(a => a.platform === 'YOUTUBE').map(a => ({ id: id(a.postAccountId), name: text(a.extUserName || a.postAccountId, 200) }));
    check(new Set(out.map(a => a.id)).size === out.length, 'provider_invalid_response', 502); return out;
  }
  async function create(c, source) {
    const r = await request(c, 'POST', '/clip-projects', { videoUrl: source.url,
      uploadedVideoAttr: { title: 'THE LAB: ' + source.id },
      curationPref: { model: 'ClipBasic', clipDurations: [[30, 60]], genre: 'Auto' },
      renderPref: { layoutAspectRatio: 'portrait', enableCaption: true } });
    try { check(r && r.orgId === c.orgId && (!r.id || !r.projectId || r.id === r.projectId), 'provider_invalid_response'); return id(r.projectId || r.id); }
    catch (_) { throw Object.assign(fail('provider_invalid_response', 502), { ambiguous: true }); }
  }
  async function clips(c, projectId) {
    const rows = await request(c, 'GET', '/exportable-clips?q=findByProjectId&projectId=' + encodeURIComponent(id(projectId)));
    check(Array.isArray(rows) && rows.length <= 100, 'provider_invalid_response', 502);
    const result = rows.map(row => {
      check(row && row.projectId === projectId && row.orgId === c.orgId, 'provider_identity_mismatch', 502);
      const clipId = id(row.curationId || String(row.id || '').slice(projectId.length + 1));
      check(row.id === projectId + '.' + clipId, 'provider_identity_mismatch', 502);
      const projected = { providerClipId: clipId, title: text(row.title, 200), durationMs: integer(row.durationMs, 1, 180000),
        previewUrl: mediaUrl(row.uriForPreview), exportUrl: mediaUrl(row.uriForExport) };
      return { ...projected, fingerprint: digest({ ...projected, updatedAt: row.updatedAt, timeRanges: row.timeRanges, renderPref: row.renderPref }) };
    });
    check(new Set(result.map(x => x.providerClipId)).size === result.length, 'provider_invalid_response', 502); return result;
  }
  async function schedule(c, job, clip, approval) {
    const r = await request(c, 'POST', '/publish-schedules', { projectId: job.projectId, clipId: clip.providerClipId,
      postAccountId: approval.accountId, publishAt: approval.publishAt,
      postDetail: { title: approval.title, custom: { description: approval.description, privacy: 'public' }, mediaType: 'video' } });
    try { return id(r.data.scheduleId); } catch (_) { throw Object.assign(fail('provider_invalid_response', 502), { ambiguous: true }); }
  }
  async function cancel(c, scheduleId) { await request(c, 'DELETE', '/publish-schedules/' + encodeURIComponent(id(scheduleId))); }
  return { accounts, create, clips, schedule, cancel };
}
module.exports = { makeOpusClient };
