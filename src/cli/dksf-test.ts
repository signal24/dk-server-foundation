#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-require-imports */

import { spawn } from 'child_process';
import { globSync } from 'fs';
import { join, resolve } from 'path';

process.env.TZ = 'UTC';
process.env.APP_ENV = 'test';

const distDir = resolve('dist');

async function main() {
    // Run global setup if available
    let teardown: (() => Promise<void>) | undefined;
    try {
        const globalSetup = require(join(distDir, 'tests', 'shared', 'globalSetup'));
        if (globalSetup.setup) {
            await globalSetup.setup();
        }
        if (globalSetup.teardown) {
            teardown = globalSetup.teardown;
        }
    } catch {
        // No global setup found, continue
    }

    // Parse arguments
    const args = process.argv.slice(2);
    const nodeArgs: string[] = [];
    const fileArgs: string[] = [];

    for (const arg of args) {
        if (arg.startsWith('-')) {
            nodeArgs.push(arg);
        } else {
            fileArgs.push(arg);
        }
    }

    // Collect test files
    const testFiles: string[] = [];
    for (const f of fileArgs) {
        const distPath = f.startsWith('dist/') ? f : f.replace(/^tests\//, 'dist/tests/').replace(/\.ts$/, '.js');
        if (distPath.endsWith('/') || !distPath.includes('.')) {
            testFiles.push(...globSync(join(distPath, '**/*.spec.js')));
        } else {
            testFiles.push(distPath);
        }
    }
    if (testFiles.length === 0) {
        testFiles.push(...globSync(join(distDir, 'tests', '**/*.spec.js')));
    }

    // Run node --test
    // Note: --test-timeout applies to describe() suites on Node 24+, so this must be high
    // enough to cover DB setup in before() hooks under concurrent execution.
    // Individual tests can override with { timeout } per-test if needed.
    const child = spawn(
        process.execPath,
        ['--enable-source-maps', '--test', '--test-force-exit', '--test-timeout=180000', ...nodeArgs, ...testFiles],
        {
            stdio: 'inherit',
            env: { ...process.env, TZ: 'UTC' }
        }
    );

    const exitCode = await new Promise<number | null>(resolve => {
        child.on('close', resolve);
    });

    // Run teardown
    if (teardown) {
        await teardown();
    }

    process.exit(exitCode ?? 1);
}

main().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
