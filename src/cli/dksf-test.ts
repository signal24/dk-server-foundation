#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-require-imports */

import { spawn } from 'child_process';
import { readdirSync } from 'fs';
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
    let testFiles: string[];
    if (fileArgs.length > 0) {
        // Map source paths to dist paths
        testFiles = fileArgs.map(f => {
            if (f.startsWith('dist/')) return f;
            return f.replace(/^tests\//, 'dist/tests/').replace(/\.ts$/, '.js');
        });
    } else {
        // Find all spec files in dist/tests
        testFiles = [];
        const findSpecFiles = (dir: string) => {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    findSpecFiles(fullPath);
                } else if (entry.name.endsWith('.spec.js')) {
                    testFiles.push(fullPath);
                }
            }
        };
        findSpecFiles(join(distDir, 'tests'));
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
