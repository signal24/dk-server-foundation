export function getMigrationsDir() {
    return __filename.endsWith('.ts') && process.env.DKSF_FORCE_DIST_MIGRATIONS !== 'true' ? 'src/migrations' : 'dist/src/migrations';
}
