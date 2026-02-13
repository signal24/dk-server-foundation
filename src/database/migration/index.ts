import { App } from '@deepkit/app';
import { ClassType } from '@deepkit/core';
import { FrameworkModule } from '@deepkit/framework';

import { r } from '../../app/resolver';
import { DBProvider } from '../../app/state';
import { BaseDatabase } from '../common';
import { MigrationCharactersCommand } from './characters';
import { MigrationCreateCommand } from './create/MigrationCreateCommand';
import { MigrationResetCommand } from './MigrationResetCommand';
import { MigrationRunCommand } from './MigrationRunCommand';

export * from './characters';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function replaceMigrationCommands(_app: App<any>, frameworkModule: FrameworkModule, dbClass?: ClassType<BaseDatabase>) {
    frameworkModule.controllers = frameworkModule.controllers.filter(c => !c.name.startsWith('Migration'));

    if (!dbClass) {
        return;
    }

    frameworkModule.addController(MigrationRunCommand);
    frameworkModule.addController(MigrationCreateCommand);
    frameworkModule.addController(MigrationCharactersCommand);
    frameworkModule.addController(MigrationResetCommand);
}

export function createMigration<T extends BaseDatabase>(fn: (db: T) => Promise<void>) {
    return fn;
}

export function runMigrations() {
    return new MigrationRunCommand(r(DBProvider)).execute();
}
