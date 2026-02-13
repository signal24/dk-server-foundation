import { cli } from '@deepkit/app';
import { SQLDatabaseAdapter } from '@deepkit/sql';
import { ReflectionClass } from '@deepkit/type';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';

import { DBProvider } from '../../app/state';
import { createLogger } from '../../services';
import { getDialect, Dialect } from '../dialect';
import { getMigrationsDir } from './helpers';

@cli.controller('migration:reset')
export class MigrationResetCommand {
    private logger = createLogger('MigrationReset');
    private migrationsDir = getMigrationsDir();

    constructor(private dbProvider: DBProvider) {}

    async execute() {
        // Step 1: Ensure migrations directory exists
        if (!existsSync(this.migrationsDir)) {
            this.logger.info(`Creating migrations directory: ${this.migrationsDir}`);
            mkdirSync(this.migrationsDir, { recursive: true });
        }

        // Step 2: Remove all .ts files from migrations directory
        const files = readdirSync(this.migrationsDir).filter(f => f.endsWith('.ts'));
        this.logger.info(`Removing ${files.length} migration file(s)`);
        for (const file of files) {
            const filePath = path.join(this.migrationsDir, file);
            unlinkSync(filePath);
            this.logger.info(`Removed ${file}`);
        }

        // Step 3: Get all registered entities
        const db = this.dbProvider.db;
        const dialect = getDialect(db.adapter as SQLDatabaseAdapter);
        const entityRegistry = db.entityRegistry;
        const entities = entityRegistry.all();

        this.logger.info(`Found ${entities.length} registered entities`);

        // Step 4: Collect CREATE TABLE statements
        const createStatements: string[] = [];

        for (const entity of entities) {
            const reflection = ReflectionClass.from(entity);
            const tableName = reflection.getCollectionName() || reflection.name;

            if (tableName?.substring(0, 1) === '_') {
                this.logger.info(`Skipping internal entity table: ${tableName}`);
                continue;
            }

            this.logger.info(`Getting CREATE TABLE for ${tableName}`);

            try {
                if (dialect === 'postgres') {
                    const createStatement = await this.getPostgresCreateTable(tableName!);
                    if (createStatement) {
                        createStatements.push(createStatement);
                    }
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const result: any[] = await db.rawQuery(`SHOW CREATE TABLE \`${tableName}\``);
                    if (result.length > 0) {
                        // SHOW CREATE TABLE returns a row with 'Create Table' column
                        const createStatement = result[0]['Create Table'];
                        createStatements.push(createStatement);
                    }
                }
            } catch (err) {
                this.logger.warn(`Could not get CREATE TABLE for ${tableName}`, err);
            }
        }

        // Step 5: Create the initial migration file
        const migrationContent = this.generateMigrationFile(createStatements, dialect);
        const migrationPath = path.join(this.migrationsDir, '00000000_000000_base.ts');

        writeFileSync(migrationPath, migrationContent, 'utf8');
        this.logger.info(`Created initial migration: ${migrationPath}`);
        this.logger.info(`Migration reset complete with ${createStatements.length} table(s)`);
    }

    private async getPostgresCreateTable(tableName: string): Promise<string | null> {
        const db = this.dbProvider.db;

        // Get column definitions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const columns: any[] = await db.rawQuery(
            `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default, udt_name
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = '${tableName}'
             ORDER BY ordinal_position`
        );
        if (!columns.length) return null;

        const colDefs = columns.map(col => {
            let type = col.data_type;
            if (type === 'character varying') {
                type = col.character_maximum_length ? `varchar(${col.character_maximum_length})` : 'varchar';
            } else if (type === 'USER-DEFINED') {
                type = col.udt_name;
            }
            let def = `"${col.column_name}" ${type}`;
            if (col.is_nullable === 'NO') def += ' NOT NULL';
            if (col.column_default != null) def += ` DEFAULT ${col.column_default}`;
            return def;
        });

        // Get primary key
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pkCols: any[] = await db.rawQuery(
            `SELECT kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = '${tableName}'
             ORDER BY kcu.ordinal_position`
        );
        let pkClause = '';
        if (pkCols.length) {
            pkClause = `,\n    PRIMARY KEY (${pkCols.map(r => `"${r.column_name}"`).join(', ')})`;
        }

        return `CREATE TABLE "${tableName}" (\n    ${colDefs.join(',\n    ')}${pkClause}\n)`;
    }

    private generateMigrationFile(createStatements: string[], dialect: Dialect): string {
        const statements = createStatements
            .map(stmt => {
                let cleaned = stmt;
                if (dialect === 'mysql') {
                    // Remove AUTO_INCREMENT value from CREATE TABLE statements
                    // since this is an initial migration and we want fresh tables
                    cleaned = cleaned.replace(/\s+AUTO_INCREMENT=\d+/gi, '');
                }

                // Escape backticks and template literal syntax
                const escaped = cleaned.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
                return `        await db.rawExecute(\`${escaped}\`);`;
            })
            .join('\n\n');

        return `import { createMigration } from '@signal24/dk-server-foundation';

export default createMigration(async db => {
${statements}
});
`;
    }
}
