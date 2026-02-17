import { existsSync } from 'node:fs';

export function getMigrationsDir() {
    if (__filename.endsWith('.ts') && process.env.DKSF_FORCE_DIST_MIGRATIONS !== 'true') return 'src/migrations';
    if (existsSync('dist/src/migrations')) return 'dist/src/migrations';
    return 'dist/migrations';
}

export function getSourceMigrationsDir() {
    return 'src/migrations';
}
