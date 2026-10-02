/* THE LAB ▸ SHOP — the E-Commerce floor's panel over the commerce engine (sidecar/commerce, docs/commerce-interface.md).
   Read-only views of connections, money, orders, problems and history, plus clearly labelled DEMO simulation
   buttons. No live Connect / Publish / Fulfill action exists yet, so none is offered as enabled.
   Rules from the contract kept here: the demo notice is always visible; unknown amounts read "unavailable", never 0;
   each currency is its own total; the money line is "contribution", not profit; a failed read keeps the last data
   on screen marked stale instead of showing an empty healthy shop; a retried simulation reuses its event id.
   The hardened window.fetch (harness.js) attaches the sidecar token to every /api/ URL. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CommercePanel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODE_KEY = 'thelab.shop.mode';
  const STEP_LABELS = {
    paid: 'Customer pays', payment_failed: 'Supplier billing fails', processing: 'Supplier starts production',
    tracking_missing: 'Shipped, no tracking', shipped: 'Shipped with tracking', delivered: 'Delivered',
    cancel_requested: 'Customer asks to cancel', canceled: 'Order canceled', refunded: 'Full refund',
    costs_confirmed: 'Costs confirmed'
  };
  const PROVIDERS = { etsy: 'Etsy', printful: 'Printful' };
  const FIELDS = { revenueMinor: 'revenue', supplierCostMinor: 'supplier cost', shippingCostMinor: 'shipping', marketplaceFeesMinor: 'Etsy fees',
    refundsMinor: 'refunds', advertisingCostMinor: 'advertising' };

  /* ---------- pure helpers (unit-tested) ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function money(minor, currency) {
    if (minor == null || !Number.isFinite(minor)) return 'unavailable';
    const v = minor / 100;
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(v); }
    catch (_) { return v.toFixed(2) + ' ' + (currency || ''); }
  }
  function when(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  const completenessLabel = c => ({ complete: 'All costs known', estimated: 'Includes estimates', incomplete: 'Missing costs' })[c] || 'Unknown';
  function eventId(step, now, rand) { return ('ui-' + step + '-' + now.toString(36) + '-' + rand).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 128); }

  /* ---------- view ---------- */
  function render(state) {
    const s = state.snap;
    const head = '<div class="shop-head"><div class="shop-title">SHOP <span>E-COMMERCE</span></div>'
      + '<div class="shop-mode" role="tablist" aria-label="Shop data">'
      + '<button data-mode="disconnected" class="' + (state.mode === 'disconnected' ? 'on' : '') + '">My shop</button>'
      + '<button data-mode="demo" class="' + (state.mode === 'demo' ? 'on' : '') + '">Demo</button></div>'
      + '<button class="shop-x" data-act="close" aria-label="Close shop">✕</button></div>';
    if (!s) {
      const msg = state.error ? 'Could not load the shop: ' + esc(state.error) : 'Loading…';
      return head + '<div class="shop-body"><div class="shop-empty">' + msg + '</div></div>';
    }
    let h = head + '<div class="shop-body">';
    h += '<div class="shop-notice ' + (s.mode === 'demo' ? 'demo' : '') + '">' + (s.mode === 'demo' ? '<b>DEMO</b> ' : '') + esc(s.notice) + '</div>';
    if (state.error) h += '<div class="shop-stale">Couldn\'t refresh (' + esc(state.error) + '). Showing data from ' + esc(when(state.loadedAt)) + '.</div>';

    // connections
    h += '<section><h4>Connections</h4><div class="shop-conns">';
    (s.connections || []).forEach(c => {
      h += '<div class="shop-conn"><div class="sc-name">' + esc(PROVIDERS[c.provider] || c.provider) + '</div>'
        + '<div class="sc-status st-' + esc(c.status) + '">' + esc(c.status) + '</div>'
        + '<div class="sc-sub">' + esc(c.displayName || '') + (c.lastSyncedAt ? ' · synced ' + esc(when(c.lastSyncedAt)) : '') + '</div></div>';
    });
    h += '</div><button class="shop-live" disabled title="Live Etsy connection is the next build phase">Connect Etsy (coming next)</button></section>';

    // money
    const groups = (s.financials && s.financials.byCurrency) || [];
    h += '<section><h4>Money</h4>';
    if (!groups.length) h += '<div class="shop-empty">No recorded orders yet, so there are no totals.</div>';
    groups.forEach(g => {
      const row = (k, v, neg) => '<div class="sm-row"><span>' + k + '</span><b class="' + (v == null ? 'na' : '') + '">' + (neg && v != null ? '−' : '') + esc(money(v, g.currency)) + '</b></div>';
      h += '<div class="shop-money"><div class="sm-cur">' + esc(g.currency) + ' · ' + g.orderCount + ' order' + (g.orderCount === 1 ? '' : 's')
        + ' <span class="sm-badge c-' + esc(g.completeness) + '">' + completenessLabel(g.completeness) + '</span></div>'
        + row('Revenue', g.revenueMinor) + row('Supplier cost', g.supplierCostMinor, 1) + row('Shipping', g.shippingCostMinor, 1)
        + row('Etsy fees', g.marketplaceFeesMinor, 1) + row('Refunds', g.refundsMinor, 1) + row('Advertising', g.advertisingCostMinor, 1)
        + '<div class="sm-row sm-total"><span>Contribution <i>(before overhead &amp; tax, not net profit)</i></span><b class="' + (g.contributionMinor == null ? 'na' : '') + '">' + esc(money(g.contributionMinor, g.currency)) + '</b></div>'
        + ((g.missingFields || []).length ? '<div class="sm-miss">Missing: ' + esc(g.missingFields.map(f => FIELDS[f] || f).join(', ')) + '</div>' : '')
        + '</div>';
    });
    h += '</section>';

    // problems
    const ex = (s.exceptions || []).slice().sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1));
    const open = ex.filter(e => e.status === 'open').length;
    h += '<section><h4>Problems ' + (open ? '<span class="shop-count">' + open + ' open</span>' : '') + '</h4>';
    if (!ex.length) h += '<div class="shop-empty">Nothing needs attention.</div>';
    ex.forEach(e => {
      h += '<div class="shop-ex sev-' + esc(e.severity) + (e.status === 'resolved' ? ' done' : '') + '">'
        + '<div class="se-top"><b>' + esc(e.summary) + '</b>' + (e.requiresApproval && e.status === 'open' ? '<span class="se-you">Needs your decision</span>' : '')
        + '<span class="se-st">' + esc(e.status) + '</span></div>'
        + (e.suggestedAction ? '<div class="se-act">Suggested: ' + esc(e.suggestedAction) + '</div>' : '') + '</div>';
    });
    h += '</section>';

    // orders
    h += '<section><h4>Orders</h4>';
    if (!(s.orders || []).length) h += '<div class="shop-empty">No orders yet.' + (s.mode === 'demo' ? ' Use “Customer pays” below to create one.' : '') + '</div>';
    else {
      h += '<table class="shop-orders"><thead><tr><th>Order</th><th>Placed</th><th>Payment</th><th>Production</th><th>Tracking</th><th>Contribution</th></tr></thead><tbody>';
      s.orders.forEach(o => {
        const f = o.financials || {};
        h += '<tr><td>' + esc(o.channelOrderId || o.id) + (o.cancellationStatus && o.cancellationStatus !== 'none' ? ' <span class="so-cx">' + esc(o.cancellationStatus) + '</span>' : '') + '</td>'
          + '<td>' + esc(when(o.placedAt)) + '</td><td>' + esc(o.paymentStatus) + '</td><td>' + esc(o.fulfillmentStatus) + (o.failureReason ? ' · ' + esc(o.failureReason) : '') + '</td>'
          + '<td>' + (o.trackingAvailable ? 'yes' : 'no') + '</td><td>' + esc(money(f.contributionMinor, f.currency)) + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '</section>';

    // simulation
    if (s.mode === 'demo') {
      h += '<section class="shop-sim"><h4>Simulate <span class="shop-count demo">DEMO ONLY</span></h4>'
        + '<div class="shop-sim-note">These buttons play out a pretend order so you can see how THE LAB tracks it. Nothing is sent to Etsy or a supplier.</div><div class="shop-steps">';
      (state.steps || []).forEach(step => {
        h += '<button data-step="' + esc(step) + '"' + (state.busy ? ' disabled' : '') + '>' + esc(STEP_LABELS[step] || step) + '</button>';
      });
      h += '</div>' + (state.simError ? '<div class="shop-stale">' + esc(state.simError) + '</div>' : '') + '</section>';
    }

    // history
    const acts = (s.actions || []).slice(0, 8);
    if (acts.length) {
      h += '<section><h4>History</h4><ul class="shop-acts">';
      acts.forEach(a => { h += '<li><span>' + esc(when(a.occurredAt)) + '</span> ' + esc(STEP_LABELS[a.actionType] || a.actionType) + (a.status === 'ignored_stale' ? ' <i>(ignored: older than current state)</i>' : '') + '</li>'; });
      h += '</ul></section>';
    }
    h += '<div class="shop-foot">Updated ' + esc(when(s.updatedAt)) + ' · not yet synced with Etsy</div></div>';
    return h;
  }

  /* ---------- controller (browser only) ---------- */
  let el = null, state = null, pending = {}, timer = null;
  function readMode() { try { return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'disconnected'; } catch (_) { return 'disconnected'; } }
  function writeMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (_) {} }
  function paint() { if (el) el.innerHTML = render(state); }

  async function load() {
    const mode = state.mode;
    try {
      const r = await fetch('/api/commerce' + (mode === 'demo' ? '?mode=demo' : ''), { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || j.code || ('HTTP ' + r.status));
      if (mode !== state.mode) return;
      state.snap = j; state.steps = j.demoSteps || state.steps; state.error = null; state.loadedAt = new Date().toISOString();
    } catch (e) {
      if (mode !== state.mode) return;
      state.error = e.message || 'network error';   // keep state.snap: the last data stays on screen, marked stale
    }
    paint();
  }

  async function simulate(step) {
    state.busy = true; state.simError = null; paint();
    const id = pending[step] || (pending[step] = eventId(step, Date.now(), Math.random().toString(36).slice(2, 8)));
    try {
      const r = await fetch('/api/commerce/demo/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: id, step }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        delete pending[step];                              // done: the next click is a new action
        state.snap = Object.assign({}, j.snapshot, { demoSteps: state.steps }); state.error = null; state.loadedAt = new Date().toISOString();
        if (j.outcome === 'ignored_stale') state.simError = '“' + (STEP_LABELS[step] || step) + '” is older than where the order already is, so it was ignored.';
      } else {
        if (r.status >= 400 && r.status < 500) delete pending[step];   // rejected, not lost: a retry would get the same answer
        state.simError = j.error || (j.code === 'ECOMMERCE_ORDER_MISSING' ? 'Run “Customer pays” first.' : (j.code || 'HTTP ' + r.status));
      }
    } catch (e) { state.simError = 'Network error. Click again to retry the same step safely.'; }
    state.busy = false; paint();
  }

  function open() {
    if (!el) {
      el = document.createElement('div'); el.id = 'shop-panel'; el.className = 'shop-panel'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Shop');
      document.body.appendChild(el);
      el.addEventListener('click', ev => {
        const b = ev.target.closest('button'); if (!b || b.disabled) return;
        if (b.dataset.act === 'close') return close();
        if (b.dataset.mode && b.dataset.mode !== state.mode) { state.mode = b.dataset.mode; writeMode(state.mode); state.snap = null; state.error = null; state.simError = null; paint(); load(); }
        if (b.dataset.step) simulate(b.dataset.step);
      });
      document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && el && !el.hidden) close(); });
    }
    state = state || { mode: readMode(), snap: null, steps: [], error: null, busy: false };
    el.hidden = false; paint(); load();
    clearInterval(timer); timer = setInterval(() => { if (el && !el.hidden && !state.busy) load(); }, 15000);
  }
  function close() { if (el) el.hidden = true; clearInterval(timer); }
  const isOpen = () => !!(el && !el.hidden);

  // the SHOP button lives in the 3D view's overlay (office3d.js), next to the floors list
  function mountButton() {
    if (typeof document === 'undefined') return;
    const tryMount = () => {
      const ui = document.querySelector('.o3d-ui'); if (!ui) return false;
      if (ui.querySelector('.o3d-shop')) return true;
      const b = document.createElement('button'); b.className = 'o3d-shop'; b.type = 'button'; b.title = 'Open the E-Commerce shop';
      b.textContent = 'SHOP'; b.addEventListener('click', () => (isOpen() ? close() : open()));
      ui.appendChild(b); return true;
    };
    if (!tryMount()) { const iv = setInterval(() => { if (tryMount()) clearInterval(iv); }, 1000); }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton); else mountButton();
  }

  return { open, close, isOpen, render, money, when, esc, eventId, completenessLabel, STEP_LABELS };
});
