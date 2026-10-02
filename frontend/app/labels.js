/* THE LAB — readable labels. The frame's buttons and headings were written in SHOUTING CAPS for the old CRT look
   ("+ ADD AGENTS", "SESSIONS", "REAL ESTATE"). This rewrites the visible text of frame controls to Title Case in
   place, without touching ids, data attributes, titles or the chat transcript, so every handler keeps working.
   Runs once at load and again (batched per frame) whenever the frame re-renders. */
(function () {
  'use strict';
  const SCOPE = '#topbar, #left, #chat-panel, #bottombar, .o3d-ui, #terms .term';
  const SKIP = '#chat-log, #chat-input, textarea, input, select, option, pre, code, .cmsg, [contenteditable]';
  const KEEP = new Set(['3D', 'HQ', 'AI', 'API', 'URL', 'MCP', 'CTX', 'XP', 'OK', 'ID', 'UI', 'CLI', 'LLM', 'IDLE·']);
  const SMALL = new Set(['a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'the', 'with', 'by', 'at']);

  function fixWord(w, i) {
    if (KEEP.has(w)) return w;
    if (/\d/.test(w) && w.length <= 4) return w;                   // 3D, 4F, 2X stay as written
    const low = w.toLowerCase();
    if (i > 0 && SMALL.has(low)) return low;
    return low.replace(/(^|[-'’/])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }
  // only rewrite text that is genuinely all-caps (at least 3 letters, no lower-case letters)
  function fix(s) {
    if (s.indexOf('·') >= 0) return s.split('·').map(fix).join('·');   // "YOUTUBE · Blocked": each part on its own
    if (!/[A-Z]{3}/.test(s) || /[a-z]/.test(s)) return s;
    let i = 0;
    return s.replace(/[A-Za-z0-9][A-Za-z0-9'’\-/]*/g, w => fixWord(w, i++));
  }
  function walk(root) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        return /[A-Z]{3}/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = []; let n;
    while ((n = tw.nextNode())) nodes.push(n);
    nodes.forEach(t => { const v = fix(t.nodeValue); if (v !== t.nodeValue) t.nodeValue = v; });
  }
  function run() { document.querySelectorAll(SCOPE).forEach(walk); }

  let queued = false;
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; run(); }); }

  function start() {
    run();
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (el && el.closest && el.closest(SCOPE) && !el.closest(SKIP)) { schedule(); return; }
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  }
  if (typeof window !== 'undefined') {
    window.LabLabels = { fix };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
  if (typeof module !== 'undefined') module.exports = { fix };
})();
