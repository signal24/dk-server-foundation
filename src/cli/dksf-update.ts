#!/usr/bin/env node

import { assert } from '@deepkit/type';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { readFile, stat, writeFile } from 'fs/promises';
import glob from 'tiny-glob';

const packageJsonPath = `package.json`;
if (!existsSync(packageJsonPath)) {
    console.log('No package.json found in current directory.');
    process.exit(1);
}

const latestDKSFInfoStr = execSync('npm info @zyno-io/dk-server-foundation@latest --json').toString();
const latestDKSFInfo = JSON.parse(latestDKSFInfoStr);
assert<{
    'dist-tags': {
        latest: string;
    };
    dependencies: {
        [key: string]: string;
    };
}>(latestDKSFInfo);
const latestVersion = latestDKSFInfo['dist-tags'].latest;

applyUpdates()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

////

async function applyUpdates() {
    const rootPackageJson = await processPackageJson(packageJsonPath);

    if (rootPackageJson.workspaces) {
        for (const workspace of rootPackageJson.workspaces) {
            const matches = await glob(workspace);
            for (const match of matches) {
                const matchState = await stat(match);
                if (matchState.isDirectory()) {
                    const packageJsonPath = `${match}/package.json`;
                    if (existsSync(packageJsonPath)) {
                        await processPackageJson(packageJsonPath);
                    }
                }
            }
        }
    }
}

async function processPackageJson(path: string) {
    const packageJsonStr = await readFile(path, 'utf8');
    const packageJson = JSON.parse(packageJsonStr);
    assert<{
        workspaces?: string[];
        dependencies?: {
            [key: string]: string;
        };
    }>(packageJson);

    if (packageJson.dependencies) {
        const currentVersion = packageJson.dependencies['@zyno-io/dk-server-foundation'];
        if (!currentVersion) {
            console.log(`${path}: No @zyno-io/dk-server-foundation dependency found in package.json.`);
            return packageJson;
        }

        if (currentVersion === latestVersion) {
            console.log(`${path}: DKSF already up to date.`);
        } else if (currentVersion === '*') {
            console.log(`${path}: DKSF set to '*'`);
        } else {
            console.log(`${path}: Updating @zyno-io/dk-server-foundation from ${currentVersion} to ${latestVersion}.`);
            packageJson.dependencies['@zyno-io/dk-server-foundation'] = latestVersion;
        }

        for (const dependency in latestDKSFInfo.dependencies) {
            if (dependency in packageJson.dependencies) {
                if (packageJson.dependencies[dependency] === '*') {
                    console.log(`${path}: ${dependency} is set to '*'.`);
                    continue;
                }
                if (packageJson.dependencies[dependency] !== latestDKSFInfo.dependencies[dependency]) {
                    console.log(
                        `${path}: Updating ${dependency} from ${packageJson.dependencies[dependency]} to ${latestDKSFInfo.dependencies[dependency]}.`
                    );
                    packageJson.dependencies[dependency] = latestDKSFInfo.dependencies[dependency];
                }
            }
        }

        const newPackageJsonStr = JSON.stringify(packageJson, undefined, 4);
        await writeFile(path, `${newPackageJsonStr}\n`);
    }

    return packageJson;
}
