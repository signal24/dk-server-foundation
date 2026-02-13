import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

import { getMigrationsDir } from '../helpers';

export function generateMigrationFile(statements: string[], description: string): string {
    const migrationsDir = getMigrationsDir();

    if (!existsSync(migrationsDir)) {
        mkdirSync(migrationsDir, { recursive: true });
    }

    const timestamp = formatTimestamp(new Date());
    const slug = slugify(description);
    const filename = `${timestamp}_${slug}.ts`;
    const filePath = path.join(migrationsDir, filename);

    const content = buildFileContent(statements);
    writeFileSync(filePath, content, 'utf8');

    return filePath;
}

function buildFileContent(statements: string[]): string {
    const execLines = statements
        .map(stmt => {
            const escaped = stmt.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
            return `    await db.rawExecute(\`${escaped}\`);`;
        })
        .join('\n');

    return `import { createMigration } from '@signal24/dk-server-foundation';\n\nexport default createMigration(async db => {\n${execLines}\n});\n`;
}

function formatTimestamp(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    const s = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${y}${m}${d}_${h}${min}${s}${ms}`;
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 50);
}
