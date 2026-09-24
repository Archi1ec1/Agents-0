/* node test/comms-wait-line.test.js — COMMS LIVE WAIT LINE (2026-09-23, live-events lane).

   The presence card (#comms-presence) read THINKING and nothing else while the sidecar sat in its retry ladder or
   waited minutes on a slow first byte. The sidecar now emits provider.retry before each backoff and agent.waiting on
   a ~15 s heartbeat; chat.js folds them per run and renders the result in the card's existing .cp-tool slot — the
   same transient line that names the running tool (no new visual vocabulary: COMMS is already designed).

   chat.js is browser-flow (not node-loadable), so — like comms-presence.test.js — the wiring is locked on the source,
   and the two PURE pieces (foldWaitNote: event -> note, waitNoteText: note -> line) are extracted with A.fnBody and
   RUN against the event sequences the loop really emits. Truthful telemetry: every number on the line comes off an
   event (no local countdown), and the line clears the moment the run shows output, fails over or ends. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/chat.js'), 'utf8');
const grab = header => {
  const body = A.fnBody(src, header);
  A.ok(body && body.length < 4000, header + ' extracted (' + (body ? body.length : 0) + ' chars)');
  return body;
};
const lib = new Function(grab('function fmtElapsed(') + '\n' + grab('function foldWaitNote(') + '\n' + grab('function waitNoteText(')
  + '\nreturn { fmtElapsed, foldWaitNote, waitNoteText };')();
const { foldWaitNote, waitNoteText } = lib;
const run = evs => evs.reduce((note, [name, p]) => foldWaitNote(note, name, p), null);

/* ---------- 1. the lines the Commander reads ---------- */
{
  const retry = { agentId: 'a', runId: 'r', attempt: 3, maxAttempts: 6, reason: 'overloaded', delayMs: 30000, model: 'anthropic/claude-sonnet-4.5' };
  let n = foldWaitNote(null, 'provider.retry', retry);
  A.eq(waitNoteText(n), 'waiting on anthropic/claude-sonnet-4.5 — retry 3/6 in 30s (overloaded)', 'retry line: model, rung/budget, the announced wait, the reason');
  n = foldWaitNote(n, 'agent.waiting', { runId: 'r', phase: 'retry_backoff', sinceMs: 15000, model: 'anthropic/claude-sonnet-4.5' });
  A.eq(waitNoteText(n), 'waiting on anthropic/claude-sonnet-4.5 — retry 3/6 in 15s (overloaded)', 'a backoff beat updates the remaining wait from the EVENT (delayMs − sinceMs)');
  n = foldWaitNote(n, 'agent.waiting', { runId: 'r', phase: 'first_byte', sinceMs: 0, model: 'anthropic/claude-sonnet-4.5' });
  A.eq(waitNoteText(n), 'waiting on anthropic/claude-sonnet-4.5…', 'the retry going out replaces the countdown (no stale "retry in 15s")');
  n = foldWaitNote(n, 'agent.waiting', { runId: 'r', phase: 'first_byte', sinceMs: 45000, model: 'anthropic/claude-sonnet-4.5' });
  A.eq(waitNoteText(n), 'waiting on anthropic/claude-sonnet-4.5 for 45s…', 'a slow first byte: how long, per the heartbeat');
  n = foldWaitNote(n, 'agent.waiting', { runId: 'r', phase: 'streaming', sinceMs: 75000, model: 'anthropic/claude-sonnet-4.5' });
  A.eq(waitNoteText(n), 'waiting on anthropic/claude-sonnet-4.5 for 1:15… (stream open)', 'an open stream with nothing shown says so; long waits use the COMMS m:ss format');
  A.eq(foldWaitNote(n, 'agent.token', { runId: 'r', delta: 'Hello' }), null, 'the first token clears the line');
  A.eq(foldWaitNote(n, 'agent.token', { runId: 'r', delta: '' }), n, 'an empty delta shows nothing, so it clears nothing');
  for (const ev of ['agent.tool_call', 'agent.tool_result', 'provider.fallback', 'agent.run.end', 'agent.run.error']) {
    A.eq(foldWaitNote(n, ev, { runId: 'r' }), null, ev + ' ends the wait');
  }
  A.eq(foldWaitNote(n, 'agent.cost', { runId: 'r' }), n, 'unrelated events leave the note alone');
}

/* ---------- 2. edges stay honest ---------- */
A.eq(waitNoteText(run([['provider.retry', { attempt: 1, maxAttempts: 6, reason: 'server_error', delayMs: 400, model: 'm' }]])),
  'waiting on m — retry 1/6 in 1s (server error)', 'a sub-second rung reads "in 1s" (rounded up), reason made readable');
A.eq(waitNoteText(run([['provider.retry', { attempt: 2, reason: 'timeout', delayMs: 0, model: 'm' }]])),
  'waiting on m — retry 2 now (timeout)', 'no sleep wired -> "now"; no budget -> no "/N"');
A.eq(waitNoteText(run([['agent.waiting', { phase: 'retry_backoff', sinceMs: 30000, model: 'm' }]])),
  'waiting on m — retry backoff, 30s so far', 'a backoff beat with no retry seen (e.g. after a reload) claims only what it says');
A.eq(waitNoteText(run([['agent.waiting', { phase: 'first_byte', sinceMs: 15000 }]])), 'waiting on the model for 15s…', 'no model named -> "the model"');
A.eq(waitNoteText(run([['agent.waiting', { phase: 'connect', sinceMs: 15000, model: 'm' }]])), 'connecting to m for 15s…', 'connect phase');
A.eq(waitNoteText(null), '', 'no note -> empty line (the slot hides)');
const longModel = 'x'.repeat(80);
A.ok(waitNoteText(run([['agent.waiting', { phase: 'first_byte', sinceMs: 15000, model: longModel }]])).length < 80, 'a very long model id is clipped');

/* ---------- 3. wiring (source lock) ---------- */
const rp = A.fnBody(src, 'function renderPresence(');
A.ok(/presenceCurTool\s*\?\s*shortName\(presenceCurTool\)\s*:\s*waitNoteText\(presenceWaitNote\(\)\)/.test(rp),
  'the presence card .cp-tool slot shows the running tool, else the wait line');
A.ok(/paused[\s\S]*waitNoteText/.test(rp), 'an approval pause still outranks the wait line');
const pw = A.fnBody(src, 'function presenceWaitNote(');
A.ok(/Channels\.runIdOf\(activeWs\.id\)/.test(pw), 'the line is keyed to the DISPLAYED stream\'s confirmed run id');
const ww = A.fnBody(src, 'function wireWaitNotes(');
for (const ev of ['provider.retry', 'agent.waiting', 'agent.token', 'agent.tool_call', 'agent.tool_result', 'provider.fallback', 'agent.run.end', 'agent.run.error']) {
  A.ok(ww.indexOf("'" + ev + "'") >= 0, 'wireWaitNotes listens for ' + ev);
}
A.ok(/U\.bus\.on\(/.test(ww) && /waitWired/.test(ww), 'subscribes on U.bus exactly once');
A.ok(/shown\s*===\s*rid\)\s*renderPresence\(\)/.test(ww), 'only the displayed run redraws the card');
A.ok(/waitNotes\.size\s*>\s*24/.test(ww), 'the per-run note map is bounded');
A.ok(/wireWaitNotes\(\);/.test(src.replace(/function wireWaitNotes\(/, '')), 'wireWaitNotes() is called at COMMS init');
A.ok(!/Date\.now\(\)/.test(A.fnBody(src, 'function waitNoteText(')) && !/Date\.now\(\)/.test(A.fnBody(src, 'function foldWaitNote(')),
  'no local clock: the line never extrapolates beyond what the events said');

A.report('comms-wait-line');
