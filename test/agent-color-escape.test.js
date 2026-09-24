/* node test/agent-color-escape.test.js — a saved agent suit colour can never break out of a style attribute
   (2026-09-23 security audit).

   A shared "station backup" is written verbatim into localStorage and rehydrated into the roster; the crew
   dossier, agent list and camera ticker concatenated `color` straight into style="color:…". A crafted colour
   such as `x" onmouseover="…` ran script in the app origin (which holds the API token). Two layers now:
   rehydrateRoster only accepts a hex colour, and every sink escapes. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const app = p => fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', p), 'utf8');

// ---- 1. the load-time validator (evaluated from the shipped source, not a copy) ----
{
  const src = app('app.js');
  const m = src.match(/function suitColor\(v, i\) \{[^\n]*\}/);
  A.ok(!!m, 'app.js defines suitColor');
  const SUITS = ['#6fb3bf', '#7bc88a'];
  const suitColor = new Function('SUITS', m[0] + '; return suitColor;')(SUITS);
  A.eq(suitColor('#cf7d96', 0), '#cf7d96', 'a real palette hex survives the load');
  A.eq(suitColor('#abc', 0), '#abc', 'short hex survives');
  A.eq(suitColor('x" onmouseover="alert(1)', 1), '#7bc88a', 'a markup-bearing colour falls back to the crew palette');
  A.eq(suitColor('red;background:url(//evil)', 0), '#6fb3bf', 'a CSS-injection colour falls back too');
  A.eq(suitColor(undefined, 3), '#7bc88a', 'a missing colour gets a palette suit');
  A.ok(/color: suitColor\(s\.color, agents\.size\)/.test(src), 'rehydrateRoster routes saved colours through suitColor');
}

// ---- 2. every style="color:…" sink escapes the value ----
{
  const ui = app('stationui.js');
  A.ok(!/style="color:' \+ a\.color \+/.test(ui), 'crew dossier name/rename never concatenates a raw colour');
  A.ok(!/style="color:' \+ x\.color \+/.test(ui), 'agent list dot never concatenates a raw colour');
  A.ok(/aria-label="Rename agent" style="color:' \+ esc\(a\.color\)/.test(ui), 'rename input escapes the colour');
  A.ok(/class="ag-name" style="color:' \+ esc\(a\.color\)/.test(ui), 'dossier name escapes the colour');
  A.ok(/class="ag-item-dot" style="color:' \+ esc\(x\.color\)/.test(ui), 'agent list dot escapes the colour');
  const world = app('world.js');
  A.ok(/style="color:' \+ esc\(suit\)/.test(world), 'camera ticker escapes the suit colour');
  const raw = [];
  for (const f of ['stationui.js', 'world.js', 'app.js']) {
    app(f).split('\n').forEach((l, i) => { if (/style="color:' \+ [a-z]+\.color \+/.test(l)) raw.push(f + ':' + (i + 1)); });
  }
  A.eq(raw, [], 'no remaining raw agent-colour sink in the roster surfaces');
}

A.report('agent-color-escape.test');
