import { createInterface } from 'readline';

let nonInteractive = false;

export function setNonInteractive(value: boolean): void {
    nonInteractive = value;
}

export async function promptRename(tableName: string, newName: string, oldCandidates: string[]): Promise<string | null> {
    if (nonInteractive) return null;

    if (oldCandidates.length === 1) {
        const oldName = oldCandidates[0];
        const answer = await ask(
            `Table \`${tableName}\`: Column \`${oldName}\` was removed and \`${newName}\` was added.\n` +
                `Was \`${oldName}\` renamed to \`${newName}\`? [y/N] `
        );
        return answer.toLowerCase() === 'y' ? oldName : null;
    }

    // Multiple candidates
    console.log(`\nTable \`${tableName}\`: Column \`${newName}\` was added and these columns were removed:`);
    for (let i = 0; i < oldCandidates.length; i++) {
        console.log(`  ${i + 1}. ${oldCandidates[i]}`);
    }
    console.log(`  0. None (treat as new column)`);

    const answer = await ask(`Was \`${newName}\` renamed from one of these? [0-${oldCandidates.length}] `);
    const choice = parseInt(answer, 10);
    if (isNaN(choice) || choice === 0 || choice > oldCandidates.length) return null;
    return oldCandidates[choice - 1];
}

export async function promptMigrationDescription(): Promise<string> {
    if (nonInteractive) return 'auto';

    const answer = await ask('Enter a short description for this migration: ');
    return answer.trim() || 'migration';
}

function ask(question: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer);
        });
    });
}
