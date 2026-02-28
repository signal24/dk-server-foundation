#!/usr/bin/env node

// OTEL must be initialized before all other imports
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('@zyno-io/dk-server-foundation/telemetry/otel/index.js').init();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app } = require('./app');
app.run();
