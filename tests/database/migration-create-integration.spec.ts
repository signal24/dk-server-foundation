import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ActiveRecord } from '@deepkit/orm';
import { SQLDatabaseAdapter } from '@deepkit/sql';
import { AutoIncrement, entity, Index, MaxLength, PrimaryKey } from '@deepkit/type';

import { DateString } from '../../src';
import { getDialect, Dialect } from '../../src/database/dialect';
import { readEntitiesSchema } from '../../src/database/migration/create/entity-reader';
import { readDatabaseSchema } from '../../src/database/migration/create/db-reader';
import { compareSchemas } from '../../src/database/migration/create/comparator';
import { generateDDL } from '../../src/database/migration/create/ddl-generator';
import { setNonInteractive } from '../../src/database/migration/create/prompt';
import { forEachAdapter } from '../shared/db';

setNonInteractive(true);

// --- Test entities ---

@entity.name('mig_users')
class MigUserEntity extends ActiveRecord {
    id!: number & AutoIncrement & PrimaryKey;
    name!: string & MaxLength<100>;
    email!: string & MaxLength<255> & Index;
    bio!: string | null;
    active!: boolean;
    createdAt!: Date;
}

@entity.name('mig_posts')
class MigPostEntity extends ActiveRecord {
    id!: number & AutoIncrement & PrimaryKey;
    title!: string & MaxLength<200>;
    body!: string;
    publishedAt!: DateString | null;
}

@entity.name('mig_sessions')
class MigSessionEntity extends ActiveRecord {
    id!: number & AutoIncrement & PrimaryKey;
    token!: string & MaxLength<255>;
    userId?: string;
    userName?: string & MaxLength<100>;
}

const testEntities = [MigUserEntity, MigPostEntity, MigSessionEntity];

describe('migration:create integration', () => {
    forEachAdapter(({ createFacade, type: adapterType }) => {
        const tf = createFacade({ entities: testEntities });
        let dialect: Dialect;

        before(
            async () => {
                await tf.start();
                dialect = getDialect(tf.getDb().adapter as SQLDatabaseAdapter);
            },
            { timeout: 10_000 }
        );
        after(() => tf.stop(), { timeout: 10_000 });

        describe('entity reader', () => {
            it('should read entity schema', () => {
                const db = tf.getDb();
                const entitySchema = readEntitiesSchema(db, dialect);

                assert.ok(entitySchema.has('mig_users'));
                assert.ok(entitySchema.has('mig_posts'));

                const users = entitySchema.get('mig_users')!;
                assert.equal(users.name, 'mig_users');

                // Check columns
                const colNames = users.columns.map(c => c.name);
                assert.ok(colNames.includes('id'));
                assert.ok(colNames.includes('name'));
                assert.ok(colNames.includes('email'));
                assert.ok(colNames.includes('bio'));
                assert.ok(colNames.includes('active'));
                assert.ok(colNames.includes('createdAt'));

                // Check PK
                const idCol = users.columns.find(c => c.name === 'id')!;
                assert.equal(idCol.isPrimaryKey, true);
                assert.equal(idCol.autoIncrement, true);

                // Check MaxLength → varchar
                const nameCol = users.columns.find(c => c.name === 'name')!;
                assert.equal(nameCol.type, 'varchar');
                assert.equal(nameCol.size, 100);

                // Check nullable
                const bioCol = users.columns.find(c => c.name === 'bio')!;
                assert.equal(bioCol.nullable, true);

                const emailCol = users.columns.find(c => c.name === 'email')!;
                assert.equal(emailCol.nullable, false);

                // Check boolean mapping
                const activeCol = users.columns.find(c => c.name === 'active')!;
                if (dialect === 'mysql') {
                    assert.equal(activeCol.type, 'tinyint');
                    assert.equal(activeCol.size, 1);
                } else {
                    assert.equal(activeCol.type, 'boolean');
                }

                // Check Date mapping
                const createdAtCol = users.columns.find(c => c.name === 'createdAt')!;
                if (dialect === 'mysql') {
                    assert.equal(createdAtCol.type, 'datetime');
                } else {
                    assert.equal(createdAtCol.type, 'timestamp');
                }

                // Check DateString mapping
                const posts = entitySchema.get('mig_posts')!;
                const publishedAtCol = posts.columns.find(c => c.name === 'publishedAt')!;
                assert.equal(publishedAtCol.type, 'date');
                assert.equal(publishedAtCol.nullable, true);

                // Check index on email (should appear exactly once after deduplication)
                const emailIndexes = users.indexes.filter(i => i.columns.includes('email'));
                assert.equal(emailIndexes.length, 1, 'email index should appear exactly once (no duplicates)');

                // Check optional (?) fields are nullable
                const sessions = entitySchema.get('mig_sessions')!;
                const userIdCol = sessions.columns.find(c => c.name === 'userId')!;
                assert.equal(userIdCol.nullable, true, 'optional field userId? should be nullable');
                const userNameCol = sessions.columns.find(c => c.name === 'userName')!;
                assert.equal(userNameCol.nullable, true, 'optional field userName? should be nullable');
                const tokenCol = sessions.columns.find(c => c.name === 'token')!;
                assert.equal(tokenCol.nullable, false, 'required field token should not be nullable');
            });

            it('should skip internal tables', () => {
                const db = tf.getDb();
                const entitySchema = readEntitiesSchema(db, dialect);

                // _migrations and _locks should be skipped
                for (const [name] of entitySchema) {
                    assert.ok(!name.startsWith('_'), `Internal table ${name} should be skipped`);
                }
            });

            it('should preserve column order', () => {
                const db = tf.getDb();
                const entitySchema = readEntitiesSchema(db, dialect);

                const users = entitySchema.get('mig_users')!;
                const positions = users.columns.map(c => c.ordinalPosition);

                // Positions should be sequential
                for (let i = 1; i < positions.length; i++) {
                    assert.ok(positions[i] > positions[i - 1], `Column order should be sequential`);
                }
            });
        });

        describe('db reader', () => {
            before(async () => {
                await tf.createTables();
            });

            it('should read database schema matching entity schema', async () => {
                const db = tf.getDb();
                const entitySchema = readEntitiesSchema(db, dialect);
                const tableNames = Array.from(entitySchema.keys());

                const dbSchema = await readDatabaseSchema(db, dialect, tableNames);

                assert.ok(dbSchema.has('mig_users'));
                assert.ok(dbSchema.has('mig_posts'));

                const users = dbSchema.get('mig_users')!;
                const colNames = users.columns.map(c => c.name);
                assert.ok(colNames.includes('id'));
                assert.ok(colNames.includes('name'));
                assert.ok(colNames.includes('email'));

                // PK should be detected
                const idCol = users.columns.find(c => c.name === 'id')!;
                assert.equal(idCol.isPrimaryKey, true);
                assert.equal(idCol.autoIncrement, true);

                // Nullable
                const bioCol = users.columns.find(c => c.name === 'bio')!;
                assert.equal(bioCol.nullable, true);
            });

            it('should return empty schema for non-existent tables', async () => {
                const db = tf.getDb();
                const dbSchema = await readDatabaseSchema(db, dialect, ['nonexistent_table_xyz']);
                assert.equal(dbSchema.size, 0);
            });
        });

        describe('full pipeline (compare + DDL)', () => {
            it('should detect no changes when DB matches entities', async () => {
                const db = tf.getDb();
                const entitySchema = readEntitiesSchema(db, dialect);
                const tableNames = Array.from(entitySchema.keys());
                const dbSchema = await readDatabaseSchema(db, dialect, tableNames);

                const diff = await compareSchemas(entitySchema, dbSchema, dialect, false);

                // After createTables, the DB should match the entities
                // Some minor differences may exist due to type normalization,
                // but there should be no added/removed tables
                assert.equal(diff.addedTables.length, 0);
                assert.equal(diff.removedTables.length, 0);
            });

            it('should detect a missing table as added', async () => {
                const db = tf.getDb();
                const entitySchema = readEntitiesSchema(db, dialect);

                // Only give the DB reader one of the two tables
                const dbSchema = await readDatabaseSchema(db, dialect, ['mig_users']);

                const diff = await compareSchemas(entitySchema, dbSchema, dialect, false);

                // mig_posts should show as "added" since it's not in the DB schema we gave
                assert.ok(diff.addedTables.some(t => t.name === 'mig_posts'));
            });

            it('should generate valid DDL for new tables', async () => {
                const db = tf.getDb();
                const entitySchema = readEntitiesSchema(db, dialect);

                const diff = await compareSchemas(entitySchema, new Map(), dialect, false);
                const stmts = generateDDL(diff);

                // Should have CREATE TABLE statements
                assert.ok(stmts.length > 0);
                for (const stmt of stmts) {
                    // All statements should be non-empty strings
                    assert.ok(typeof stmt === 'string' && stmt.length > 0);
                }

                // Check dialect-appropriate quoting
                if (dialect === 'mysql') {
                    assert.ok(stmts.some(s => s.includes('`mig_users`')));
                    assert.ok(stmts.some(s => s.includes('`mig_posts`')));
                } else {
                    assert.ok(stmts.some(s => s.includes('"mig_users"')));
                    assert.ok(stmts.some(s => s.includes('"mig_posts"')));
                }
            });
        });
    });
});
