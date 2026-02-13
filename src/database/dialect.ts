import { SQLDatabaseAdapter } from '@deepkit/sql';

export type Dialect = 'mysql' | 'postgres';

export function getDialect(adapter: SQLDatabaseAdapter): Dialect {
    const name = adapter.getName();
    if (name === 'mysql') return 'mysql';
    if (name === 'postgres') return 'postgres';
    throw new Error(`Unsupported database dialect: ${name}`);
}

export function quoteId(dialect: Dialect, name: string): string {
    if (dialect === 'mysql') return `\`${name.replace(/`/g, '``')}\``;
    return `"${name.replace(/"/g, '""')}"`;
}

export function tableExistsSql(dialect: Dialect, tableName: string, schema = 'public'): string {
    if (dialect === 'mysql') {
        return `SHOW TABLES LIKE '${tableName}'`;
    }
    return `SELECT tablename FROM pg_tables WHERE schemaname = '${schema}' AND tablename = '${tableName}'`;
}

export function listTablesSql(dialect: Dialect, schema = 'public'): string {
    if (dialect === 'mysql') {
        return `SHOW TABLES`;
    }
    return `SELECT tablename FROM pg_tables WHERE schemaname = '${schema}'`;
}

export function listDatabasesSql(dialect: Dialect): string {
    if (dialect === 'mysql') {
        return `SHOW DATABASES`;
    }
    return `SELECT datname AS "Database" FROM pg_database WHERE datistemplate = false`;
}

export function currentDatabaseSql(dialect: Dialect): string {
    if (dialect === 'mysql') {
        return `SELECT DATABASE()`;
    }
    return `SELECT current_database()`;
}
