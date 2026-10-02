/* STARNET — livewatch.js : the LIVE panel — what every agent is doing right now, and what it is costing.

   Two halves, like floorstats.js:
     • a PURE core (LiveWatch.create) that folds the real U.bus runtime events — agent.run.start, agent.tool_call,
       agent.tool_result, agent.cost, agent.run.end, agent.run.error — into "who is running, on which step, for how
       much". No DOM, no clock of its own (now is injected), so it is unit-testable under node.
     • a small DOM shell (browser only): a LIVE chip in the top bar showing the number of running agents and the
       spend today, which opens a panel listing each running agent's current step, its spend, a recent-steps
       feed, and today's spend against the daily cap from GET /api/budget/status (the ledger's truth, so
       background passes that never reach the bus are still counted there).

   Read-only: it never emits on the bus and never changes another module's state. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.LiveWatch = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FEED_MAX = 60;          // recent steps kept for the feed
  const ENDED_KEEP_MS = 90000;  // a finished run stays visible this long so a quick task is not missed
  const TRIGGER_LABEL = { directive: 'you asked', schedule: 'routine', event: 'event', loop: 'loop', nightshift: 'while you were away' };

  function num(n) { n = Number(n); return isFinite(n) ? n : 0; }
  function str(s, max) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return max && s.length > max ? s.slice(0, max - 1) + '…' : s; }

  function create() {
    const runs = new Map();     // runId -> run record
    const calls = new Map();    // callId -> { runId, name, at }
    let feed = [];
    let sessionUsd = 0;

    function runFor(p, now) {
      const id = str(p.runId);
      if (!id) return null;
      let r = runs.get(id);
      if (!r) {
        // a run we joined mid-flight (panel opened late, or its start event was not on this bus)
        r = { runId: id, agentId: str(p.agentId) || 'agent', trigger: '', model: '', startedAt: now, steps: 0,
          usd: 0, tool: '', toolArgs: '', toolSince: 0, lastAt: now, ended: false, endedAt: 0, reason: '' };
        runs.set(id, r);
      }
      return r;
    }
    function push(now, agentId, kind, text) {
      feed.push({ at: now, agentId: agentId, kind: kind, text: text });
      if (feed.length > FEED_MAX) feed = feed.slice(feed.length - FEED_MAX);
    }

    function onEvent(name, p, now) {
      p = p || {};
      now = num(now);
      if (name === 'agent.run.start') {
        const r = runFor(p, now); if (!r) return;
        r.trigger = str(p.trigger); r.model = str(p.model); r.startedAt = now; r.ended = false; r.lastAt = now;
        push(now, r.agentId, 'start', 'started' + (TRIGGER_LABEL[r.trigger] ? ' (' + TRIGGER_LABEL[r.trigger] + ')' : '') + (r.model ? ' on ' + r.model : ''));
      } else if (name === 'agent.tool_call') {
        const r = runFor(p, now); if (!r) return;
        r.tool = str(p.name, 60); r.toolArgs = str(p.argsSummary, 140); r.toolSince = now; r.steps++; r.lastAt = now;
        if (p.callId) calls.set(String(p.callId), { runId: r.runId, name: r.tool, at: now });
        push(now, r.agentId, 'tool', r.tool + (r.toolArgs ? ' · ' + r.toolArgs : ''));
      } else if (name === 'agent.tool_result') {
        const c = p.callId ? calls.get(String(p.callId)) : null;
        if (c) calls.delete(String(p.callId));
        const r = runFor(p, now); if (!r) return;
        r.lastAt = now;
        if (r.tool && c && c.name === r.tool) { r.tool = ''; r.toolArgs = ''; r.toolSince = 0; }
        if (p.isError || p.ok === false) push(now, r.agentId, 'error', (c ? c.name : 'step') + ' failed' + (p.summary ? ': ' + str(p.summary, 120) : ''));
      } else if (name === 'agent.cost') {
        const usd = num(p.usd);
        sessionUsd += usd;
        const r = runFor(p, now); if (!r) return;
        r.usd += usd; r.lastAt = now;
        if (p.model) r.model = str(p.model);
      } else if (name === 'agent.run.end') {
        const r = runFor(p, now); if (!r) return;
        r.ended = true; r.endedAt = now; r.reason = str(p.reason); r.tool = ''; r.toolArgs = '';
        if (num(p.usd) > r.usd) r.usd = num(p.usd);
        push(now, r.agentId, r.reason === 'done' ? 'end' : 'error', 'finished: ' + (r.reason || 'done') + ' · $' + r.usd.toFixed(r.usd < 1 ? 3 : 2));
      } else if (name === 'agent.run.error') {
        const r = runFor(p, now); if (!r) return;
        push(now, r.agentId, 'error', 'error: ' + str(p.message, 140));
      }
    }

    function snapshot(now) {
      now = num(now);
      const active = [], recent = [];
      for (const [id, r] of runs) {
        if (r.ended && now - r.endedAt > ENDED_KEEP_MS) { runs.delete(id); continue; }
        (r.ended ? recent : active).push(Object.assign({}, r));
      }
      active.sort((a, b) => a.startedAt - b.startedAt);
      recent.sort((a, b) => b.endedAt - a.endedAt);
      return { active: active, recent: recent, feed: feed.slice().reverse(), sessionUsd: sessionUsd };
    }

    return { onEvent: onEvent, snapshot: snapshot, _runs: runs };
  }

  const EVENTS = ['agent.run.start', 'agent.tool_call', 'agent.tool_result', 'agent.cost', 'agent.run.end', 'agent.run.error'];

  /* ---------------- DOM shell (browser only) ---------------- */
  function mount() {
    if (typeof document === 'undefined' || typeof U === 'undefined' || !U.bus) return null;
    const core = create();
    let budget = null, budgetErr = '', open = false, paintQueued = false;
    let watch = null, watchErr = '', watchBusy = false;   // "show the agent's browser" — server truth, null = unknown

    const css = document.createElement('style');
    css.textContent = [
      '#lw-chip{display:inline-flex;align-items:center;gap:6px;margin-right:10px;padding:2px 9px;border:1px solid currentColor;border-radius:3px;background:transparent;color:inherit;font:inherit;font-size:11px;letter-spacing:.06em;cursor:pointer;opacity:.85}',
      '#lw-chip:hover,#lw-chip.open{opacity:1}',
      '#lw-chip .lw-dot{width:7px;height:7px;border-radius:50%;background:#6b7280}',
      '#lw-chip.busy .lw-dot{background:#22c55e;box-shadow:0 0 6px #22c55e;animation:lwpulse 1.2s infinite}',
      '#lw-chip.over{color:#f59e0b}',
      '@keyframes lwpulse{50%{opacity:.35}}',
      '#lw-panel{position:fixed;top:52px;right:12px;width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 80px);overflow:auto;z-index:2000;padding:12px 14px;background:rgba(10,14,22,.97);color:#e5e7eb;border:1px solid rgba(148,163,184,.35);border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.5);font-size:12px;line-height:1.45}',
      '#lw-panel[hidden]{display:none}',
      '#lw-panel h5{margin:10px 0 6px;font-size:10px;letter-spacing:.12em;color:#94a3b8;font-weight:600}',
      '#lw-panel h5:first-child{margin-top:0}',
      '.lw-spend{display:flex;justify-content:space-between;align-items:baseline;gap:8px}',
      '.lw-spend b{font-size:18px;color:#f8fafc}',
      '.lw-bar{height:6px;margin:6px 0 2px;background:rgba(148,163,184,.2);border-radius:3px;overflow:hidden}',
      '.lw-bar i{display:block;height:100%;background:#22c55e}',
      '.lw-bar.warn i{background:#f59e0b}.lw-bar.over i{background:#ef4444}',
      '.lw-dim{color:#94a3b8}',
      '.lw-run{padding:7px 8px;margin:0 0 6px;border:1px solid rgba(148,163,184,.25);border-radius:4px}',
      '.lw-run .lw-top{display:flex;justify-content:space-between;gap:8px}',
      '.lw-run .lw-name{font-weight:600;color:#f8fafc}',
      '.lw-run .lw-step{margin-top:3px;color:#cbd5e1;word-break:break-word}',
      '.lw-run.ended{opacity:.6}',
      '.lw-watch{display:flex;justify-content:space-between;align-items:center;gap:10px}',
      '.lw-btn{flex:none;padding:3px 10px;border:1px solid rgba(148,163,184,.5);border-radius:3px;background:transparent;color:#f8fafc;font:inherit;font-size:11px;letter-spacing:.06em;cursor:pointer}',
      '.lw-btn:hover{border-color:#f8fafc}.lw-btn[disabled]{opacity:.5;cursor:default}',
      '.lw-err{color:#fca5a5}',
      '.lw-feed{list-style:none;margin:0;padding:0}',
      '.lw-feed li{padding:2px 0;border-bottom:1px solid rgba(148,163,184,.12);word-break:break-word}',
      '.lw-feed li.error{color:#fca5a5}.lw-feed li.end{color:#86efac}',
      '.lw-feed .lw-t{color:#64748b;margin-right:6px;font-variant-numeric:tabular-nums}'
    ].join('\n');
    document.head.appendChild(css);

    const chip = document.createElement('button');
    chip.id = 'lw-chip';
    chip.type = 'button';
    chip.title = 'See what your agents are doing right now and what it is costing';
    chip.innerHTML = '<span class="lw-dot" aria-hidden="true"></span><span class="lw-txt">LIVE</span>';
    const host = document.querySelector('#topbar .tb-stats');
    if (host) host.insertBefore(chip, host.firstChild); else document.body.appendChild(chip);

    const panel = document.createElement('div');
    panel.id = 'lw-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Live agent activity and spend');
    document.body.appendChild(panel);

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = n => '$' + (n < 1 ? n.toFixed(3) : n.toFixed(2));
    const nameOf = id => { try { if (typeof App !== 'undefined' && App.agentName) return App.agentName(id) || id; } catch (_) {} return id; };
    const ago = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'; };
    const clock = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0'); };

    function spentToday() {
      const snap = core.snapshot(Date.now());
      // the ledger is the truth but lags a live turn by a moment, so never show less than this window has seen.
      if (budget && typeof budget.spentToday === 'number') return { usd: Math.max(budget.spentToday, snap.sessionUsd), known: true, snap: snap };
      return { usd: snap.sessionUsd, known: false, snap: snap };
    }

    function paintChip() {
      const s = spentToday();
      const n = s.snap.active.length;
      const cap = budget && budget.caps ? num(budget.caps.perDay) : 0;
      chip.classList.toggle('busy', n > 0);
      chip.classList.toggle('over', cap > 0 && s.usd >= cap * 0.8);
      chip.classList.toggle('open', open);
      chip.querySelector('.lw-txt').textContent = (n > 0 ? n + ' WORKING' : 'IDLE') + ' · ' + money(s.usd) + ' TODAY';
    }

    function paintPanel() {
      if (!open) return;
      const now = Date.now();
      const s = spentToday();
      const cap = budget && budget.caps ? num(budget.caps.perDay) : 0;
      const pct = cap > 0 ? Math.min(100, (s.usd / cap) * 100) : 0;
      let html = '<h5>SPEND TODAY</h5>' +
        '<div class="lw-spend"><b>' + money(s.usd) + '</b><span class="lw-dim">' +
        (cap > 0 ? 'of ' + money(cap) + ' daily cap' : 'no daily cap set') + '</span></div>';
      if (cap > 0) html += '<div class="lw-bar' + (pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '') + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
      html += '<div class="lw-dim">' + (s.known ? 'From the spend ledger, including background passes.' : (budgetErr ? 'Ledger unavailable (' + esc(budgetErr) + '); showing this window only.' : 'Counting this window only until the ledger answers.')) +
        (budget && typeof budget.lifetime === 'number' ? ' All time: ' + money(budget.lifetime) + '.' : '') + '</div>';

      html += '<h5>AGENT BROWSER</h5><div class="lw-watch"><span>' +
        (watch === null ? 'Checking…' : watch ? 'Shown in a window you can watch. The agent drives it; your clicks there are ignored.' : 'Hidden. Agents browse in the background.') +
        '</span><button type="button" class="lw-btn" id="lw-watch"' + (watch === null || watchBusy ? ' disabled' : '') + '>' + (watch ? 'HIDE' : 'SHOW') + '</button></div>' +
        (watchErr ? '<div class="lw-err">' + esc(watchErr) + '</div>' : '') +
        '<div class="lw-dim">Applies to the next task an agent starts.</div>';
      html += '<h5>WORKING NOW</h5>';
      if (!s.snap.active.length) html += '<div class="lw-dim">No agent is running.</div>';
      for (const r of s.snap.active) {
        const step = r.tool ? esc(r.tool) + (r.toolArgs ? ' <span class="lw-dim">' + esc(r.toolArgs) + '</span>' : '') + ' <span class="lw-dim">· ' + ago(now - r.toolSince) + '</span>'
          : '<span class="lw-dim">thinking…</span>';
        html += '<div class="lw-run"><div class="lw-top"><span class="lw-name">' + esc(nameOf(r.agentId)) + '</span><span>' + money(r.usd) + '</span></div>' +
          '<div class="lw-dim">' + esc((r.trigger ? ({ directive: 'you asked', schedule: 'routine', event: 'event', loop: 'loop', nightshift: 'while you were away' }[r.trigger] || r.trigger) + ' · ' : '') +
            (r.model || '') + ' · ' + r.steps + (r.steps === 1 ? ' step · ' : ' steps · ') + ago(now - r.startedAt)) + '</div>' +
          '<div class="lw-step">' + step + '</div></div>';
      }
      if (s.snap.recent.length) {
        html += '<h5>JUST FINISHED</h5>';
        for (const r of s.snap.recent) {
          html += '<div class="lw-run ended"><div class="lw-top"><span class="lw-name">' + esc(nameOf(r.agentId)) + '</span><span>' + money(r.usd) + '</span></div>' +
            '<div class="lw-dim">' + esc((r.reason || 'done') + ' · ' + r.steps + (r.steps === 1 ? ' step · ' : ' steps · ') + ago(now - r.endedAt) + ' ago') + '</div></div>';
        }
      }
      html += '<h5>RECENT STEPS</h5>';
      if (!s.snap.feed.length) html += '<div class="lw-dim">Steps appear here as agents work.</div>';
      else html += '<ul class="lw-feed">' + s.snap.feed.slice(0, 40).map(f =>
        '<li class="' + esc(f.kind) + '"><span class="lw-t">' + clock(f.at) + '</span><b>' + esc(nameOf(f.agentId)) + '</b> ' + esc(f.text) + '</li>').join('') + '</ul>';
      panel.innerHTML = html;
      const wb = panel.querySelector('#lw-watch');
      if (wb) wb.addEventListener('click', () => {
        if (typeof Harness === 'undefined' || !Harness.api || watch === null) return;
        watchBusy = true; schedulePaint();
        Harness.api.post('/api/browser/watch', { on: !watch }).then(({ ok, j }) => {
          watchBusy = false;
          if (ok && j) { watch = j.on === true; watchErr = ''; } else watchErr = String((j && j.reason) || 'could not change the setting');
          schedulePaint();
        }).catch(e => { watchBusy = false; watchErr = String((e && e.message) || 'the station could not be reached'); schedulePaint(); });
      });
    }
    function refreshWatch() {
      if (typeof Harness === 'undefined' || !Harness.api) return;
      Harness.api.get('/api/browser/watch').then(j => { watch = !!(j && j.on === true); watchErr = ''; schedulePaint(); })
        .catch(e => { watchErr = String((e && e.message) || 'setting unavailable'); schedulePaint(); });
    }

    function schedulePaint() {
      if (paintQueued) return;
      paintQueued = true;
      requestAnimationFrame(() => { paintQueued = false; paintChip(); paintPanel(); });
    }

    function refreshBudget() {
      // Harness.api.get rejects on a non-2xx, so an error body is never painted as spend.
      if (typeof Harness === 'undefined' || !Harness.api) { budgetErr = 'station api unavailable'; return Promise.resolve(); }
      return Harness.api.get('/api/budget/status').then(j => { budget = j || null; budgetErr = ''; schedulePaint(); })
        .catch(e => { budgetErr = String((e && e.message) || 'unreachable'); schedulePaint(); });
    }

    for (const n of EVENTS) {
      U.bus.on(n, (p) => {
        try { core.onEvent(n, p, Date.now()); } catch (_) {}
        if (n === 'agent.run.end') refreshBudget();
        schedulePaint();
      });
    }
    chip.addEventListener('click', () => {
      open = !open;
      panel.hidden = !open;
      if (open) { refreshBudget(); refreshWatch(); }
      schedulePaint();
    });
    document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { open = false; panel.hidden = true; schedulePaint(); } });
    // the ledger also counts passes that never reach the bus, so keep it fresh: often while open, slowly otherwise.
    setInterval(() => { if (open || core.snapshot(Date.now()).active.length) refreshBudget(); }, 10000);
    setInterval(refreshBudget, 60000);
    setInterval(() => { if (open) paintPanel(); }, 1000);   // step timers tick
    refreshBudget();
    return { core: core, refresh: refreshBudget };
  }

  let mounted = null;
  if (typeof document !== 'undefined') {
    const go = () => { if (!mounted) mounted = mount(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }

  return { create: create, EVENTS: EVENTS, _mounted: () => mounted };
});
