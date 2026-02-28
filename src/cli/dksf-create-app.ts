#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        printUsage();
        process.exit(args.length === 0 ? 1 : 0);
    }

    const packageName = args[0];
    const unscopedName = packageName.includes('/') ? packageName.split('/').pop()! : packageName;
    const targetDir = args[1] || unscopedName;
    const absoluteTarget = path.resolve(targetDir);

    if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(packageName)) {
        console.error(`Error: Invalid package name: ${packageName}`);
        process.exit(1);
    }

    if (fs.existsSync(absoluteTarget)) {
        console.error(`Error: Directory already exists: ${absoluteTarget}`);
        process.exit(1);
    }

    const packageDir = __dirname.substring(0, __dirname.lastIndexOf('dist') - 1);
    const templateDir = path.join(packageDir, 'template-app');
    if (!fs.existsSync(templateDir)) {
        console.error('Error: Template directory not found. Ensure @zyno-io/dk-server-foundation is properly installed.');
        process.exit(1);
    }

    const dbName = unscopedName.replace(/[^a-z0-9]/g, '_');
    const redisPrefix = unscopedName.replace(/[-_.]/g, '');
    const dksfVersion = getDksfVersion(packageDir);

    const replacements: Record<string, string> = {
        '%%PACKAGE_NAME%%': packageName,
        '%%APP_DB_NAME%%': dbName,
        '%%APP_REDIS_PREFIX%%': redisPrefix,
        '%%DKSF_VERSION%%': dksfVersion
    };

    console.log(`Creating ${packageName} in ${absoluteTarget}...`);
    console.log();

    copyTemplate(templateDir, absoluteTarget, replacements);

    console.log('Done! Next steps:');
    console.log();
    console.log(`  cd ${targetDir}`);
    console.log('  yarn install    # or: npm install');
    console.log();
    console.log('  # Configure .env.development with your database credentials');
    console.log('  # Then start developing:');
    console.log('  yarn dev');
    console.log();
}

function printUsage() {
    console.log('Usage: dksf-create-app <package-name> [path]');
    console.log();
    console.log('Arguments:');
    console.log('  <package-name>  npm package name (e.g. @myorg/my-api or my-api)');
    console.log('  [path]          Output directory (defaults to the unscoped package name)');
    console.log();
    console.log('Examples:');
    console.log('  npx @zyno-io/dk-server-foundation create-app @myorg/my-api');
    console.log('  npx @zyno-io/dk-server-foundation create-app my-api ./custom-path');
    console.log('  dksf-create-app @myorg/my-api');
    console.log();
}

function getDksfVersion(packageDir: string): string {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8'));
        if (pkg.version === '0.0.0-dev') return '*';
        return `^${pkg.version}`;
    } catch {
        return '*';
    }
}

function copyTemplate(src: string, dest: string, replacements: Record<string, string>) {
    fs.mkdirSync(dest, { recursive: true });

    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === 'dist') continue;
            copyTemplate(srcPath, path.join(dest, entry.name), replacements);
            continue;
        }

        // Rename .tmpl files (e.g. package.json.tmpl -> package.json)
        let destName = entry.name;
        if (destName.endsWith('.tmpl')) {
            destName = destName.slice(0, -5);
        }

        let content = fs.readFileSync(srcPath, 'utf-8');
        for (const [key, value] of Object.entries(replacements)) {
            content = content.split(key).join(value);
        }
        fs.writeFileSync(path.join(dest, destName), content);
    }
}

main();
