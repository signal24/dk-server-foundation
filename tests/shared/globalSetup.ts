import { TestingHelpers } from '../../src';

export async function setup() {
    process.env.TZ = 'UTC';

    TestingHelpers.setDefaultDatabaseConfig({
        MYSQL_HOST: 'localhost',
        MYSQL_PORT: 3306,
        MYSQL_USER: 'root',
        MYSQL_PASSWORD_SECRET: 'secret'
    });

    await TestingHelpers.cleanupTestDatabases('dksf_test');

    if (process.env.PG_HOST) {
        TestingHelpers.setDefaultDatabaseConfig({
            PG_HOST: process.env.PG_HOST,
            PG_PORT: process.env.PG_PORT ? parseInt(process.env.PG_PORT) : 5432,
            PG_USER: process.env.PG_USER ?? 'root',
            PG_PASSWORD_SECRET: process.env.PG_PASSWORD_SECRET ?? 'secret'
        });

        // temporarily set DB_ADAPTER so cleanupTestDatabases targets PG
        const prevAdapter = process.env.DB_ADAPTER;
        process.env.DB_ADAPTER = 'postgres';
        await TestingHelpers.cleanupTestDatabases('dksf_pg_test');
        if (prevAdapter === undefined) {
            delete process.env.DB_ADAPTER;
        } else {
            process.env.DB_ADAPTER = prevAdapter;
        }
    }
}

export async function teardown() {
    await TestingHelpers.cleanupTestDatabases('dksf_test');

    if (process.env.PG_HOST) {
        const prevAdapter = process.env.DB_ADAPTER;
        process.env.DB_ADAPTER = 'postgres';
        await TestingHelpers.cleanupTestDatabases('dksf_pg_test');
        if (prevAdapter === undefined) {
            delete process.env.DB_ADAPTER;
        } else {
            process.env.DB_ADAPTER = prevAdapter;
        }
    }
}
