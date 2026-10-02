'use strict';
const M = require('./model.js');
const { check, fields, text, id, integer, iso, digest, fail, LIMITS } = M;

function makeShortsService({ store, credentials, client, now }) {
  const inFlight = new Set();
  const timestamp = () => iso(now());
  const later = (at, ms) => new Date(Date.parse(at) + ms).toISOString();
  function find(rows, key) { const row = rows.find(x => x.id === id(key)); check(row, 'not_found', 404); return row; }
  function room(state, name, count = 1) { check(state[name].length + count <= LIMITS[name], 'ledger_capacity', 409); }
  function live(state) {
    const c = credentials.get(); check(c, 'opus_not_connected', 409);
    check(c.orgId === state.connection.orgId, 'connection_mismatch', 409); return c;
  }
  function connection(state) {
    try {
      const c = credentials.get();
      return { configured: !!c && c.orgId === state.connection.orgId, status: c ? 'configured' : 'disconnected',
        encrypted: credentials.protected(), ...state.connection, apiEntitlement: 'live_trial_required' };
    } catch (e) { return { configured: false, status: 'locked', encrypted: false, errorCode: e.code || 'credentials_locked', ...state.connection, apiEntitlement: 'live_trial_required' }; }
  }
  function snapshot(state = store.read()) {
    const at = timestamp(), conn = connection(state);
    const jobs = state.jobs.map(j => ({ ...j, state: j.state === 'submitting' && !inFlight.has(j.id) ? 'submission_unknown' : j.state }));
    const publications = state.publications.map(p => ({ ...p, state: !inFlight.has(p.id) && p.state === 'scheduling' ? 'schedule_unknown' : !inFlight.has(p.id) && p.state === 'canceling' ? 'cancel_unknown' : p.state }));
    const attention = jobs.filter(j => j.errorCode || ['submission_unknown', 'attention', 'rejected'].includes(j.state)).map(j => ({ targetId: j.id, code: j.errorCode || 'check_opus_project', requiresReview: true }));
    for (const p of publications) {
      if (['schedule_unknown', 'cancel_unknown', 'rejected'].includes(p.state)) attention.push({ targetId: p.id, code: p.errorCode || 'check_opus_schedule', requiresReview: true });
      if (p.state === 'scheduled' && Date.parse(state.approvals.find(a => a.id === p.approvalId).publishAt) <= Date.parse(at)) attention.push({ targetId: p.id, code: 'verify_publication_in_youtube', requiresReview: true });
    }
    return { ok: true, schemaVersion: 1, mode: conn.configured ? 'connected' : 'disconnected', updatedAt: state.updatedAt,
      connection: conn, budget: M.budget(state, at),
      capabilities: { prepareSources: true, configure: credentials.protected(), submit: conn.configured, review: true,
        schedule: conn.configured && conn.accounts.length > 0, automaticDiscovery: false, automaticEditorial: false, analytics: false },
      notice: 'Processing spends Opus credits only after confirmation. Rights and editorial checks are user attestations. Scheduled is not verified published.',
      sources: state.sources,
      jobs, attention,
      clips: state.clips,
      approvals: state.approvals.map(a => ({ ...a, valid: state.approvals.filter(x => x.clipId === a.clipId).at(-1).id === a.id && state.clips.some(c => c.id === a.clipId && c.available && c.fingerprint === a.fingerprint) })),
      publications,
      actions: state.actions.slice(-100).map(({ digest: omitted, ...a }) => a).reverse(), generatedAt: at };
  }
  async function command(type, input, allowed, fn) {
    fields(input, ['actionId', ...allowed]); id(input.actionId);
    const hash = digest({ type, input });
    return store.run(async (state, persist) => {
      const old = state.actions.find(a => a.id === input.actionId);
      if (old) { check(old.digest === hash, 'action_id_conflict', 409); return { ok: true, duplicate: true, targetId: old.targetId, snapshot: snapshot(state) }; }
      room(state, 'actions');
      const save = () => { state.updatedAt = timestamp(); persist(); };
      const record = targetId => state.actions.push({ id: input.actionId, digest: hash, type, targetId, at: timestamp() });
      const targetId = await fn(state, save, record);
      return { ok: true, duplicate: false, targetId, snapshot: snapshot(state) };
    });
  }
  function connect(input) {
    return command('connect', input, ['apiKey', 'orgId'], async (s, save, record) => {
      id(input.orgId); check(credentials.protected(), 'encrypted_storage_required', 503);
      check(typeof input.apiKey === 'string' && /^[\x21-\x7e]{16,512}$/.test(input.apiKey), 'invalid_api_key');
      check(!s.connection.orgId || s.connection.orgId === input.orgId, 'organization_change_requires_migration', 409);
      const c = { apiKey: input.apiKey, orgId: input.orgId };
      const accounts = await client.accounts(c); // read-only check; not proof of clipping entitlement
      credentials.set(c);
      s.connection = { orgId: c.orgId, accounts, verifiedAt: timestamp() };
      record('opusclip'); save(); return 'opusclip';
    });
  }
  function addSource(input) {
    return command('source.add', input, ['sourceId', 'title', 'creator', 'url', 'kind', 'durationSec'], async (s, save, record) => {
      room(s, 'sources'); const sourceId = id(input.sourceId), url = M.sourceUrl(input.url, input.kind);
      check(!s.sources.some(x => x.id === sourceId || x.url === url), 'source_already_exists', 409);
      s.sources.push({ id: sourceId, title: text(input.title, 200), creator: text(input.creator, 200), url, kind: input.kind,
        durationSec: integer(input.durationSec, 1, 18000), createdAt: timestamp(), clearance: null });
      record(sourceId); save(); return sourceId;
    });
  }
  function clearSource(input) {
    return command('source.clear', input, ['sourceId', 'evidence', 'attribution', 'originalityPlan', 'commercialEditsAllowed', 'sourceAccessConfirmed'], async (s, save, record) => {
      const source = find(s.sources, input.sourceId);
      check(!s.jobs.some(j => j.sourceId === source.id), 'source_already_submitted', 409);
      check(input.commercialEditsAllowed === true && input.sourceAccessConfirmed === true, 'source_clearance_required', 409);
      source.clearance = { evidence: text(input.evidence), attribution: text(input.attribution), originalityPlan: text(input.originalityPlan), clearedAt: timestamp() };
      record(source.id); save(); return source.id;
    });
  }
  function submit(input) {
    return command('job.submit', input, ['sourceId', 'confirmProcessing', 'maxCredits'], async (s, save, record) => {
      const c = live(s), source = find(s.sources, input.sourceId);
      check(source.clearance, 'source_clearance_required', 409); check(input.confirmProcessing === true, 'processing_confirmation_required', 409);
      check(!s.jobs.some(j => j.sourceId === source.id), 'source_already_submitted', 409);
      check(!s.jobs.some(j => ['submitting', 'submission_unknown', 'processing', 'attention'].includes(j.state)), 'processing_job_needs_attention', 409);
      const at = timestamp(), reservedCredits = Math.max(10, Math.ceil(source.durationSec / 60));
      check(integer(input.maxCredits, 10, M.MONTHLY_CREDITS) >= reservedCredits && M.budget(s, at).remainingCredits >= reservedCredits, 'credit_budget_exceeded', 409);
      room(s, 'jobs');
      const job = { id: 'job.' + digest(source.id).slice(0, 24), sourceId: source.id, orgId: c.orgId, projectId: null,
        state: 'submitting', month: at.slice(0, 7), reservedCredits, createdAt: at, checkedAt: null, nextCheckAt: null, errorCode: null, pollFailures: 0, reconciliation: null };
      s.jobs.push(job); record(job.id); save(); // durable intent BEFORE any billable request
      inFlight.add(job.id);
      try {
        const projectId = await client.create(c, source);
        check(!s.jobs.some(j => j.id !== job.id && j.projectId === projectId), 'provider_identity_mismatch', 502);
        job.projectId = projectId; job.state = 'processing'; job.nextCheckAt = later(timestamp(), 30000);
      } catch (e) { job.state = e.ambiguous === false ? 'rejected' : 'submission_unknown'; job.errorCode = e.shortsError ? e.code : 'provider_unreachable'; }
      finally { inFlight.delete(job.id); }
      save(); return job.id;
    });
  }
  async function updateClips(s, job, c) {
    check(job.projectId && c.orgId === job.orgId, 'job_requires_reconciliation', 409);
    const incoming = await client.clips(c, job.projectId), at = timestamp();
    room(s, 'clips', incoming.filter(r => !s.clips.some(x => x.jobId === job.id && x.providerClipId === r.providerClipId)).length);
    for (const old of s.clips.filter(x => x.jobId === job.id)) old.available = false;
    for (const row of incoming) {
      const old = s.clips.find(x => x.jobId === job.id && x.providerClipId === row.providerClipId);
      const value = { ...row, id: old ? old.id : 'clip.' + digest([job.id, row.providerClipId]).slice(0, 32), jobId: job.id, available: true, fetchedAt: at };
      if (old) Object.assign(old, value); else s.clips.push(value);
    }
    job.checkedAt = at; job.pollFailures = 0; job.errorCode = null;
    job.state = incoming.length ? 'review' : Date.parse(at) - Date.parse(job.createdAt) > 3600000 ? 'attention' : 'processing';
    job.nextCheckAt = job.state === 'processing' ? later(at, 30000) : null;
    if (job.state === 'attention') job.errorCode = 'no_exportable_clips_check_opus';
  }
  async function refreshInside(s, job, save) {
    try { await updateClips(s, job, live(s)); save(); }
    catch (e) {
      job.errorCode = e.shortsError ? e.code : 'provider_unreachable'; job.pollFailures++;
      if (e.providerStatus === 401 || e.providerStatus === 403 || !job.projectId || job.pollFailures >= 8) {
        job.state = 'attention'; job.nextCheckAt = null;
      } else job.nextCheckAt = later(timestamp(), Math.min(600000, 30000 * Math.pow(2, Math.min(job.pollFailures, 5))));
      save(); throw e;
    }
  }
  function refresh(input) {
    return command('job.refresh', input, ['jobId'], async (s, save, record) => {
      const job = find(s.jobs, input.jobId); check(job.projectId, 'job_requires_reconciliation', 409);
      await refreshInside(s, job, save); record(job.id); save(); return job.id;
    });
  }
  function reconcile(input) {
    return command('job.reconcile', input, ['jobId', 'projectId', 'evidence', 'confirmSourceMatch'], async (s, save, record) => {
      const job = find(s.jobs, input.jobId), c = live(s);
      check(!job.projectId && ['submitting', 'submission_unknown', 'attention'].includes(job.state), 'job_not_awaiting_reconciliation', 409);
      check(input.confirmSourceMatch === true, 'source_match_confirmation_required', 409);
      const evidence = text(input.evidence), projectId = id(input.projectId);
      check(!s.jobs.some(j => j.projectId === projectId), 'project_already_linked', 409);
      // The owner matches the source in Opus; the read API proves only project/org/clip identity.
      // No paid retry is sent, and an empty/unverifiable project is not accepted as reconciliation.
      job.projectId = projectId;
      await updateClips(s, job, c);
      check(s.clips.some(x => x.jobId === job.id && x.available), 'project_not_ready_to_reconcile', 409);
      job.reconciliation = { evidence, confirmedAt: timestamp() }; record(job.id); save(); return job.id;
    });
  }
  function approve(input) {
    return command('clip.approve', input, ['clipId', 'fingerprint', 'accountId', 'title', 'description', 'publishAt', 'editorialNotes', 'checks'], async (s, save, record) => {
      live(s); const clip = find(s.clips, input.clipId); room(s, 'approvals');
      check(clip.available && clip.fingerprint === input.fingerprint, 'clip_changed_review_again', 409);
      check(!s.publications.some(p => p.clipId === clip.id), 'clip_already_scheduled', 409);
      check(s.connection.accounts.some(a => a.id === input.accountId), 'youtube_account_required', 409);
      fields(input.checks, ['rights', 'originality', 'captions', 'framing', 'audio']);
      check(['rights', 'originality', 'captions', 'framing', 'audio'].every(k => input.checks[k] === true), 'editorial_review_required', 409);
      const at = timestamp(), publishAt = iso(input.publishAt);
      check(Date.parse(publishAt) >= Date.parse(at) + 600000, 'schedule_at_least_ten_minutes_ahead');
      const approval = { id: 'approval.' + digest(input.actionId).slice(0, 24), clipId: clip.id, fingerprint: clip.fingerprint,
        accountId: id(input.accountId), title: text(input.title, 100), description: text(input.description, 4500, true),
        publishAt, editorialNotes: text(input.editorialNotes), approvedAt: at };
      s.approvals.push(approval); record(approval.id); save(); return approval.id;
    });
  }
  function schedule(input) {
    return command('publication.schedule', input, ['approvalId', 'confirmPublication'], async (s, save, record) => {
      const c = live(s), a = find(s.approvals, input.approvalId), clip = find(s.clips, a.clipId), job = find(s.jobs, clip.jobId);
      check(s.approvals.filter(x => x.clipId === clip.id).at(-1).id === a.id, 'approval_superseded', 409);
      check(input.confirmPublication === true, 'publication_confirmation_required', 409);
      check(!s.publications.some(p => p.clipId === clip.id), 'clip_already_scheduled', 409); room(s, 'publications');
      check(Date.parse(a.publishAt) >= Date.parse(timestamp()) + 600000, 'approval_schedule_expired', 409);
      const accounts = await client.accounts(c);
      s.connection.accounts = accounts; s.connection.verifiedAt = timestamp();
      await refreshInside(s, job, save);
      check(accounts.some(x => x.id === a.accountId), 'youtube_account_required', 409);
      check(clip.available && clip.fingerprint === a.fingerprint, 'clip_changed_review_again', 409);
      const p = { id: 'post.' + digest(clip.id).slice(0, 24), clipId: clip.id, approvalId: a.id, scheduleId: null, state: 'scheduling', createdAt: timestamp(), errorCode: null };
      s.publications.push(p); record(p.id); save();
      inFlight.add(p.id);
      try { p.scheduleId = await client.schedule(c, job, clip, a); p.state = 'scheduled'; }
      catch (e) { p.state = e.ambiguous === false ? 'rejected' : 'schedule_unknown'; p.errorCode = e.shortsError ? e.code : 'provider_unreachable'; }
      finally { inFlight.delete(p.id); }
      save(); return p.id;
    });
  }
  function cancel(input) {
    return command('publication.cancel', input, ['publicationId', 'confirmCancellation'], async (s, save, record) => {
      const c = live(s), p = find(s.publications, input.publicationId), a = find(s.approvals, p.approvalId);
      check(input.confirmCancellation === true, 'cancellation_confirmation_required', 409);
      check(p.state === 'scheduled' && p.scheduleId, 'schedule_requires_reconciliation', 409);
      check(Date.parse(a.publishAt) > Date.parse(timestamp()), 'scheduled_time_passed_check_youtube', 409);
      p.state = 'canceling'; record(p.id); save(); inFlight.add(p.id);
      try { await client.cancel(c, p.scheduleId); p.state = 'canceled'; }
      catch (e) { p.state = 'cancel_unknown'; p.errorCode = e.shortsError ? e.code : 'provider_unreachable'; }
      finally { inFlight.delete(p.id); }
      save(); return p.id;
    });
  }
  async function poll() {
    return store.run(async (s, persist) => {
      const job = s.jobs.find(j => j.projectId && j.nextCheckAt && Date.parse(j.nextCheckAt) <= Date.parse(timestamp()));
      if (!job) return;
      await refreshInside(s, job, () => { s.updatedAt = timestamp(); persist(); });
    });
  }
  return { snapshot, connect, addSource, clearSource, submit, refresh, reconcile, approve, schedule, cancel, poll, secretValues: credentials.secretValues };
}
module.exports = { makeShortsService };
