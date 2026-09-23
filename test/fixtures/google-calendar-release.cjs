'use strict';
// Test-only: synthetic Google (the sign-in preload) with ONE service released through the per-service map,
// exactly as a future source change would ship it. Never loaded by product code.
require('./google-signin-preload.cjs');
const google = require('../../sidecar/mcp/google-client.js');
google.RELEASE_DEFERRED = true;
google.RELEASED['google-calendar'] = true;
