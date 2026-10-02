/* AGENT 0 — windows/connections.js : the CONNECTIONS window — one place to see and set up everything the
   agents can reach: AI models, connectors, API keys, chat channels, skills and website logins.
   It owns no setup flow of its own. It reads the same endpoints the existing screens read, joins them into
   one searchable list with an honest status per row, and each row's button opens the real screen that
   sets that thing up (SETTINGS ▸ PROVIDERS, ABILITIES ▸ CATALOG / SAVED API CONNECTIONS / CONNECTED SERVICES /
   SKILL LIBRARY, CHANNELS ▸ <platform>). A source that fails to load is reported as unreadable, never as
   "not set up". The pure join/search core (Connections.join / Connections.search) is node-testable. */
'use strict';
(() => {
  const KINDS = {
    model:     { label: 'AI MODEL',  order: 0 },
    connector: { label: 'CONNECTOR', order: 1 },
    apikey:    { label: 'API KEY',   order: 2 },
    channel:   { label: 'CHANNEL',   order: 3 },
    skill:     { label: 'SKILL',     order: 4 },
    login:     { label: 'LOGINS',    order: 5 }
  };
  const STATE_ORDER = { on: 0, attention: 1, off: 2, unknown: 3 };
  const CHANNEL_NAMES = { telegram: 'Telegram', discord: 'Discord', slack: 'Slack', matrix: 'Matrix', signal: 'Signal' };

  const arr = (x) => Array.isArray(x) ? x : [];
  const str = (x) => (x == null ? '' : String(x));

  // src: { providers, catalog, live, keys, keysCatalog, channels, skills } — each the raw JSON of its endpoint,
  // or null when that endpoint could not be read. Returns { rows, failed: [source names] }.
  function join(src) {
    src = src || {};
    const rows = [], failed = [];
    const miss = (k) => { if (src[k] == null) { failed.push(k); return true; } return false; };

    // ---- AI models (SETTINGS ▸ PROVIDERS) ----
    if (!miss('providers')) {
      for (const p of arr(src.providers.providers)) {
        if (!p || !p.id) continue;
        rows.push({
          key: 'model:' + p.id, kind: 'model', name: str(p.name || p.label || p.id),
          blurb: str(p.blurb || p.endpoint), aliases: arr(p.aliases).map(str),
          state: p.configured ? 'on' : 'off',
          detail: p.configured ? 'ready to use' : (p.keyRequired === false ? 'sign in to use' : 'needs an API key'),
          door: { term: 'settings', section: 'providers' }
        });
      }
    }

    // ---- connectors: the catalog joined with what is actually running (/api/connectors) ----
    const liveOk = !miss('live');
    const liveById = {};
    if (liveOk) for (const c of arr(src.live.connectors)) if (c && c.id) liveById[c.id] = c;
    const liveState = (c) => {
      if (!c) return null;
      if (c.enabled === false) return { state: 'attention', detail: 'added, switched off' };
      if (c.authRequired) return { state: 'attention', detail: 'sign in again' };
      if (c.state === 'up') return { state: 'on', detail: 'connected' };
      if (c.state === 'error') return { state: 'attention', detail: str(c.detail) || 'not working' };
      if (arr(c.missingFields).length) return { state: 'attention', detail: 'setup unfinished' };
      return { state: 'attention', detail: 'added, not running' };
    };
    const seenConnector = {};
    if (!miss('catalog')) {
      for (const g of arr(src.catalog.groups)) for (const e of arr(g && g.connectors)) {
        if (!e || !e.id || seenConnector[e.id]) continue;
        seenConnector[e.id] = true;
        const live = liveById[e.id];
        const ls = liveState(live);
        const state = ls ? ls.state : (e.installed ? 'attention' : (liveOk ? 'off' : 'unknown'));
        rows.push({
          key: 'connector:' + e.id, kind: 'connector', name: str(e.name || e.id),
          blurb: str(e.blurb), aliases: arr(e.aliases).map(str), category: str(e.category || g.category),
          state, detail: ls ? ls.detail : (e.installed ? 'added, not running' : (liveOk ? 'not set up' : 'status unknown')),
          door: (live || e.installed) ? { term: 'connectors', section: 'mcp' } : { term: 'connectors', section: 'catalog', search: str(e.name || e.id) }
        });
      }
    }
    // custom connectors the catalog doesn't list
    for (const id of Object.keys(liveById)) {
      if (seenConnector[id]) continue;
      const c = liveById[id], ls = liveState(c);
      rows.push({ key: 'connector:' + id, kind: 'connector', name: str(c.label || id), blurb: 'your own connector',
        aliases: [], state: ls.state, detail: ls.detail, door: { term: 'connectors', section: 'mcp' } });
    }

    // ---- API keys: the platform catalog joined with the saved keys (/api/servicekeys) ----
    const keysOk = !miss('keys');
    const savedByEnv = {};
    if (keysOk) for (const k of arr(src.keys.keys)) if (k && k.envVar) savedByEnv[k.envVar] = k;
    const keyRow = (k) => k.enabled === false
      ? { state: 'attention', detail: 'saved, switched off' }
      : { state: 'on', detail: 'saved' + (k.last4 ? ' · ' + str(k.last4) : '') };
    const seenEnv = {};
    if (!miss('keysCatalog')) {
      for (const g of arr(src.keysCatalog.groups)) for (const p of arr(g && g.platforms)) {
        if (!p || !p.id || !p.envVar || seenEnv[p.envVar]) continue;
        seenEnv[p.envVar] = true;
        const saved = savedByEnv[p.envVar];
        const s = saved ? keyRow(saved) : (p.installed ? { state: 'on', detail: 'saved' } : (keysOk ? { state: 'off', detail: 'not set up' } : { state: 'unknown', detail: 'status unknown' }));
        rows.push({
          key: 'apikey:' + p.id, kind: 'apikey', name: str(p.name || p.id), blurb: str(p.blurb),
          aliases: arr(p.aliases).map(str), category: str(p.category || g.category), state: s.state, detail: s.detail,
          door: (saved || p.installed) ? { term: 'connectors', section: 'keys' } : { term: 'connectors', section: 'catalog', search: str(p.name || p.id) }
        });
      }
    }
    for (const env of Object.keys(savedByEnv)) {
      if (seenEnv[env]) continue;
      const k = savedByEnv[env], s = keyRow(k);
      rows.push({ key: 'apikey:' + (k.id || env), kind: 'apikey', name: str(k.name || env), blurb: 'your own API key (' + env + ')',
        aliases: [env], state: s.state, detail: s.detail, door: { term: 'connectors', section: 'keys' } });
    }

    // ---- chat channels (CHANNELS ▸ <platform>) ----
    if (!miss('channels')) {
      for (const id of Object.keys(CHANNEL_NAMES)) {
        const c = src.channels[id];
        if (!c) continue;
        const state = c.connected ? 'on' : (c.configured ? 'attention' : 'off');
        rows.push({
          key: 'channel:' + id, kind: 'channel', name: CHANNEL_NAMES[id], blurb: 'talk to your agents from ' + CHANNEL_NAMES[id],
          aliases: ['chat', 'messages', 'dm'], state,
          detail: c.connected ? 'connected' : (c.configured ? (str(c.detail) || 'saved, not connected') : 'not set up'),
          door: { term: 'messaging', section: id }
        });
      }
    }

    // ---- skills (ABILITIES ▸ SKILL LIBRARY) ----
    if (!miss('skills')) {
      for (const s of arr(src.skills.skills)) {
        if (!s || !s.slug) continue;
        rows.push({
          key: 'skill:' + s.slug, kind: 'skill', name: str(s.name || s.slug), blurb: str(s.description),
          aliases: [], category: str(s.category), state: s.enabled ? 'on' : 'off',
          detail: s.enabled ? 'turned on' : 'available', door: { term: 'connectors', section: 'library' }
        });
      }
    }

    // ---- website logins: these never pass through the agent, so there is nothing to list — say how it works ----
    rows.push({
      key: 'login:browser', kind: 'login', name: 'Website logins and passwords',
      blurb: 'When an agent hits a sign-in page, it asks to open a visible browser window. You type your password into Chrome yourself and click Done; it never passes through the agent. The site keeps you signed in for later runs. This needs you watching a chat, not an unattended run. For a service with an API, add its API key here instead.',
      aliases: ['password', 'passwords', 'login', 'sign in', 'browser', 'chrome', 'account'], state: 'info', detail: 'you sign in, the agent never sees the password',
      door: null
    });

    rows.sort((a, b) =>
      (STATE_ORDER[a.state] ?? 4) - (STATE_ORDER[b.state] ?? 4) ||
      KINDS[a.kind].order - KINDS[b.kind].order ||
      a.name.localeCompare(b.name));
    return { rows, failed };
  }

  // every word of the query must appear in the row's name, aliases, blurb, category or kind label
  function search(rows, query, kind) {
    const words = str(query).toLowerCase().split(/\s+/).filter(Boolean);
    return arr(rows).filter(r => {
      if (kind && kind !== 'all') {
        if (kind === 'on') { if (r.state !== 'on' && r.state !== 'attention') return false; }
        else if (r.kind !== kind) return false;
      }
      if (!words.length) return true;
      const hay = [r.name, r.blurb, r.category, KINDS[r.kind] && KINDS[r.kind].label, r.kind].concat(r.aliases || []).join(' ').toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }

  function counts(rows) {
    const c = { on: 0, attention: 0 };
    for (const r of arr(rows)) if (r.state === 'on') c.on++; else if (r.state === 'attention') c.attention++;
    return c;
  }

  const Connections = { join, search, counts, KINDS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Connections; return; }
  if (typeof window !== 'undefined') window.Connections = Connections;
  if (typeof StationUI === 'undefined' || !StationUI.registerWindow) return;

  const H = StationUI.h;
  const esc = H.esc, sfx = H.sfx, openTerm = H.openTerm;
  const SOURCES = {
    providers: '/api/providers', catalog: '/api/connectors/catalog', live: '/api/connectors',
    keys: '/api/servicekeys', keysCatalog: '/api/servicekeys/catalog', channels: '/api/channels/status', skills: '/api/skills'
  };
  const SOURCE_NAMES = { providers: 'AI models', catalog: 'connector catalog', live: 'running connectors', keys: 'saved API keys',
    keysCatalog: 'API key catalog', channels: 'chat channels', skills: 'skills' };
  const FILTERS = [['all', 'ALL'], ['on', 'SET UP'], ['model', 'AI MODELS'], ['connector', 'CONNECTORS'], ['apikey', 'API KEYS'],
    ['channel', 'CHANNELS'], ['skill', 'SKILLS'], ['login', 'LOGINS']];
  const SHOW_MAX = 150;

  let styled = false;
  function style() {
    if (styled) return; styled = true;
    const css = document.createElement('style');
    css.textContent = [
      '.cx{display:flex;flex-direction:column;gap:10px;min-height:0;font-size:12px;line-height:1.45}',
      '.cx-sum{color:#cbd5e1}.cx-sum b{color:#f8fafc}',
      '.cx-warn{color:#f59e0b}',
      '.cx-search{width:100%;box-sizing:border-box;padding:8px 10px;font:inherit;font-size:13px;background:rgba(15,23,42,.8);color:#f8fafc;border:1px solid rgba(148,163,184,.4);border-radius:4px}',
      '.cx-filters{display:flex;flex-wrap:wrap;gap:6px}',
      '.cx-f{padding:3px 9px;font:inherit;font-size:10px;letter-spacing:.08em;background:transparent;color:#94a3b8;border:1px solid rgba(148,163,184,.35);border-radius:3px;cursor:pointer}',
      '.cx-f.on{color:#f8fafc;border-color:#f8fafc}',
      '.cx-list{list-style:none;margin:0;padding:0;overflow:auto;min-height:0}',
      '.cx-row{display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;align-items:center;padding:8px 6px;border-bottom:1px solid rgba(148,163,184,.14)}',
      '.cx-dot{width:9px;height:9px;border-radius:50%;background:#475569}',
      '.cx-row.on .cx-dot{background:#22c55e}.cx-row.attention .cx-dot{background:#f59e0b}.cx-row.info .cx-dot{background:#38bdf8}.cx-row.unknown .cx-dot{background:transparent;border:1px solid #64748b}',
      '.cx-name{font-weight:600;color:#f8fafc}',
      '.cx-kind{margin-left:8px;font-size:9px;letter-spacing:.1em;color:#94a3b8;border:1px solid rgba(148,163,184,.3);border-radius:2px;padding:0 4px;font-weight:400}',
      '.cx-detail{font-size:11px;color:#94a3b8}.cx-row.attention .cx-detail{color:#fbbf24}.cx-row.on .cx-detail{color:#86efac}',
      '.cx-blurb{grid-column:2/4;color:#94a3b8;font-size:11px}',
      '.cx-go{padding:3px 10px;font:inherit;font-size:10px;letter-spacing:.08em;background:transparent;color:#f8fafc;border:1px solid rgba(148,163,184,.5);border-radius:3px;cursor:pointer;white-space:nowrap}',
      '.cx-go:hover{border-color:#f8fafc}',
      '.cx-more{padding:8px 6px;color:#94a3b8}'
    ].join('\n');
    document.head.appendChild(css);
  }

  async function load() {
    const keys = Object.keys(SOURCES);
    const got = await Promise.all(keys.map(k => Harness.api.get(SOURCES[k]).catch(() => null)));
    const src = {}; keys.forEach((k, i) => { src[k] = got[i]; });
    return join(src);
  }

  function buildConnections(body) {
    style();
    body.innerHTML =
      '<div class="cx">' +
        '<div class="cx-sum" id="cx-sum" role="status" aria-live="polite">Loading your connections…</div>' +
        '<input type="search" class="cx-search" id="cx-q" placeholder="Search: a model, an app, a service, “password”…" autocomplete="off" spellcheck="false" aria-label="Search connections">' +
        '<div class="cx-filters" role="group" aria-label="Show">' +
          FILTERS.map(f => '<button type="button" class="cx-f' + (f[0] === 'all' ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>').join('') +
        '</div>' +
        '<ul class="cx-list" id="cx-list"></ul>' +
      '</div>';
    const sum = body.querySelector('#cx-sum'), q = body.querySelector('#cx-q'), list = body.querySelector('#cx-list');
    let data = { rows: [], failed: [] }, filter = 'all';

    function paint() {
      const shown = search(data.rows, q.value, filter);
      const c = counts(data.rows);
      let s = '<b>' + c.on + '</b> set up and working' + (c.attention ? ' · <span class="cx-warn"><b>' + c.attention + '</b> need attention</span>' : '');
      if (data.failed.length) s += ' · <span class="cx-warn">couldn’t read: ' + esc(data.failed.map(f => SOURCE_NAMES[f] || f).join(', ')) + '</span>';
      sum.innerHTML = s;
      list.innerHTML = shown.slice(0, SHOW_MAX).map(r =>
        '<li class="cx-row ' + esc(r.state) + '">' +
          '<span class="cx-dot" aria-hidden="true"></span>' +
          '<span><span class="cx-name">' + esc(r.name) + '</span><span class="cx-kind">' + esc(KINDS[r.kind].label) + '</span><br>' +
            '<span class="cx-detail">' + esc(r.detail) + '</span></span>' +
          (r.door ? '<button type="button" class="cx-go" data-k="' + esc(r.key) + '">' + (r.state === 'off' ? 'SET UP' : 'MANAGE') + '</button>' : '<span></span>') +
          (r.blurb ? '<span class="cx-blurb">' + esc(r.blurb) + '</span>' : '') +
        '</li>').join('') +
        (shown.length > SHOW_MAX ? '<li class="cx-more">Showing ' + SHOW_MAX + ' of ' + shown.length + '. Type to narrow it down.</li>' : '') +
        (!shown.length ? '<li class="cx-more">Nothing matches. Try another word, or pick ALL.</li>' : '');
    }

    list.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.cx-go'); if (!b) return;
      const r = data.rows.find(x => x.key === b.dataset.k); if (!r || !r.door) return;
      try { sfx('click'); } catch (_) {}
      openTerm(r.door.term, r.door.section);
      if (r.door.search && typeof Friendly !== 'undefined' && Friendly.routeConsoleSearch) {
        try { Friendly.routeConsoleSearch(document, r.door.search); } catch (_) {}
      }
    });
    body.querySelector('.cx-filters').addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.cx-f'); if (!b) return;
      filter = b.dataset.f;
      body.querySelectorAll('.cx-f').forEach(x => x.classList.toggle('on', x === b));
      paint();
    });
    q.addEventListener('input', paint);

    load().then(d => { data = d; paint(); }).catch(() => { sum.textContent = 'Couldn’t load your connections. Close and reopen to try again.'; });
    setTimeout(() => { try { q.focus(); } catch (_) {} }, 0);
  }

  StationUI.registerWindow('connections', 'CONNECTIONS', buildConnections);
})();
