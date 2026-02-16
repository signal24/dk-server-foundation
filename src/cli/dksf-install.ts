#!/usr/bin/env node

import { execSync } from 'child_process';

const packageDir = __dirname.substring(0, __dirname.lastIndexOf('dist') - 1);
const baseDir = packageDir.endsWith('node_modules/@zyno-io/dk-server-foundation') ? packageDir.substring(0, packageDir.length - 43) : packageDir;

execSync('npx deepkit-type-install', { cwd: baseDir });
execSync('npx patch-package --patch-dir ./node_modules/@zyno-io/dk-server-foundation/patches', { cwd: baseDir });

process.exit(0);
