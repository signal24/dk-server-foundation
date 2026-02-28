#!/usr/bin/env node

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'create-app') {
    // Shift argv so dksf-create-app sees the right arguments
    process.argv = [process.argv[0], process.argv[1], ...rest];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./dksf-create-app');
} else {
    console.error('Usage: npx @zyno-io/dk-server-foundation <command>');
    console.error();
    console.error('Commands:');
    console.error('  create-app <package-name> [path]   Scaffold a new application');
    process.exit(1);
}
