'use strict';
// Loaded only by shorts.http.test.js. The production adapter still targets its fixed official host.
const fs = require('node:fs');
const path = require('node:path');
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(input, options = {}) {
  const url = new URL(String(input));
  if (url.origin !== 'https://api.opus.pro') return originalFetch(input, options);
  if (options.headers.Authorization !== 'Bearer fixture-short-token-0123456789') return new Response('{}', { status: 401 });
  fs.appendFileSync(path.join(process.env.STARNET_WORKSPACES, 'shorts-provider-calls.jsonl'), JSON.stringify({ method: options.method, path: url.pathname }) + '\n');
  if (url.pathname === '/api/social-accounts') return Response.json({ data: [{ platform: 'YOUTUBE', postAccountId: 'youtube-fixture', extUserName: 'Fixture channel' }] });
  if (url.pathname === '/api/clip-projects') return Response.json({ id: 'Pfixture', projectId: 'Pfixture', orgId: 'org_fixture' }, { status: 201 });
  if (url.pathname === '/api/exportable-clips') return Response.json([{ id: 'Pfixture.Cfixture', projectId: 'Pfixture', curationId: 'Cfixture', orgId: 'org_fixture',
    title: 'Fixture clip', durationMs: 45000, uriForPreview: 'https://ext.cdn.opus.pro/preview.mp4', uriForExport: 'https://ext.cdn.opus.pro/export.mp4',
    updatedAt: '2026-10-02T10:00:00.000Z', renderPref: { enableCaption: true } }]);
  if (url.pathname === '/api/publish-schedules' && options.method === 'POST') return Response.json({ data: { scheduleId: 'schedule-fixture' } }, { status: 201 });
  if (url.pathname === '/api/publish-schedules/schedule-fixture' && options.method === 'DELETE') return new Response(null, { status: 204 });
  return Response.json({}, { status: 404 });
};
