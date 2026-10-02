/* node test/connections.test.js — the CONNECTIONS window's pure core (frontend/app/windows/connections.js).
   Joins the existing endpoints into one list with an honest status per row and a door to the real setup screen. */
'use strict';
const A = require('./_assert.js');
const C = require('../frontend/app/windows/connections.js');

const src = {
  providers: { providers: [
    { id: 'openai', name: 'OpenAI', aliases: ['gpt'], configured: true, keyRequired: true },
    { id: 'anthropic', name: 'Anthropic', aliases: ['claude'], configured: false, keyRequired: true }
  ] },
  catalog: { groups: [{ category: 'Productivity', connectors: [
    { id: 'notion', name: 'Notion', blurb: 'pages and databases', aliases: ['wiki'], installed: true },
    { id: 'linear', name: 'Linear', blurb: 'issues', aliases: [], installed: false },
    { id: 'gmail', name: 'Gmail', blurb: 'mail', aliases: ['email'], installed: true }
  ] }] },
  live: { connectors: [
    { id: 'notion', label: 'Notion', enabled: true, state: 'up', missingFields: [] },
    { id: 'gmail', label: 'Gmail', enabled: true, state: 'up', authRequired: true, missingFields: [] },
    { id: 'my-db', label: 'My DB', enabled: true, state: 'starting', missingFields: [] }
  ] },
  keys: { keys: [
    { id: 'k1', name: 'Shopify', envVar: 'SHOPIFY_TOKEN', enabled: true, last4: '••••a1b2' },
    { id: 'k2', name: 'Weird API', envVar: 'WEIRD_KEY', enabled: false, last4: '' }
  ] },
  keysCatalog: { groups: [{ category: 'Commerce', platforms: [
    { id: 'shopify', name: 'Shopify', envVar: 'SHOPIFY_TOKEN', aliases: ['store'] },
    { id: 'etsy', name: 'Etsy', envVar: 'ETSY_API_KEY', aliases: [] }
  ] }] },
  channels: { telegram: { connected: true }, discord: { configured: true, connected: false }, slack: { configured: false } },
  skills: { skills: [{ slug: 'inbox-triage', name: 'Inbox Triage', description: 'triage', enabled: true }, { slug: 'seo', name: 'SEO', enabled: false }] }
};

const { rows, failed } = C.join(src);
const by = (k) => rows.find(r => r.key === k);
A.eq(failed, [], 'every source read');
A.eq(by('model:openai').state, 'on', 'a configured model is on');
A.eq(by('model:anthropic').state, 'off', 'an unconfigured model is off');
A.eq(by('model:anthropic').door, { term: 'settings', section: 'providers' }, 'models open SETTINGS ▸ PROVIDERS');
A.eq(by('connector:notion').state, 'on', 'a running connector is on');
A.eq(by('connector:gmail').detail, 'sign in again', 'a rejected credential needs attention, not "connected"');
A.eq(by('connector:linear').door, { term: 'connectors', section: 'catalog', search: 'Linear' }, 'an unadded connector opens the catalog searched to it');
A.eq(by('connector:notion').door.section, 'mcp', 'an added connector opens CONNECTED SERVICES');
A.eq(by('connector:my-db').state, 'attention', 'a custom connector the catalog lacks is still listed');
A.eq(by('apikey:shopify').state, 'on', 'a saved key joins its catalog platform by env var');
A.ok(/a1b2/.test(by('apikey:shopify').detail), 'only the masked tail is shown');
A.eq(by('apikey:etsy').state, 'off', 'an unsaved platform is off');
A.eq(by('apikey:k2').state, 'attention', 'a custom key switched off needs attention');
A.eq(by('channel:telegram').state, 'on', 'connected channel');
A.eq(by('channel:discord').state, 'attention', 'saved but not connected channel');
A.eq(by('channel:discord').door, { term: 'messaging', section: 'discord' }, 'channels open their own card');
A.eq(by('skill:inbox-triage').state, 'on', 'enabled skill');
A.ok(by('login:browser') && by('login:browser').door === null, 'website logins are explained, never collected');
A.ok(rows.findIndex(r => r.state === 'on') < rows.findIndex(r => r.state === 'off'), 'set-up rows sort first');
A.eq(C.counts(rows).attention, 4, 'attention count');

// search: every word must match; aliases count
A.eq(C.search(rows, 'claude').map(r => r.key), ['model:anthropic'], 'aliases are searchable');
A.eq(C.search(rows, 'password').map(r => r.key), ['login:browser'], '"password" finds the logins note');
A.ok(C.search(rows, 'store shopify').length === 1, 'all words must match');
A.ok(C.search(rows, '', 'channel').every(r => r.kind === 'channel'), 'kind filter');
A.ok(C.search(rows, '', 'on').every(r => r.state === 'on' || r.state === 'attention'), 'SET UP filter');

// a source that fails to load is reported, never painted as "not set up"
const partial = C.join(Object.assign({}, src, { live: null, keys: null, providers: null }));
A.eq(partial.failed.sort(), ['keys', 'live', 'providers'], 'failed sources are named');
A.eq(partial.rows.find(r => r.key === 'connector:linear').state, 'unknown', 'connector status unknown when the live list failed');
A.eq(partial.rows.find(r => r.key === 'apikey:etsy').state, 'unknown', 'key status unknown when saved keys failed');
A.ok(!partial.rows.some(r => r.kind === 'model'), 'no model rows invented');
A.ok(Array.isArray(C.join(null).rows), 'null input never throws');

A.report('connections.test');
