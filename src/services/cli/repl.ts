import { cli } from '@deepkit/app';
import { DatabaseRegistry } from '@deepkit/orm';
import * as repl from 'repl';

import { getAppModule, getOrCreateInjectorForModule, r } from '../../app/resolver';
import { getProviderTree } from '../../helpers/framework/injection';

@cli.controller('repl', {
    description: 'Start a REPL'
})
export class ReplCommand {
    constructor() {}

    async execute() {
        // DK lazily starts the database registry, but we don't have any calls that
        // would cause that. without the registry, the application shutdown hook to
        // disconect from the database is never executed. thus, we'll invoke this manually.
        const databaseRegistry = r(DatabaseRegistry);
        databaseRegistry.init();

        const providers = getProviderTree(getAppModule());

        const classProvider = {};
        const instanceProvider = {};

        for (const provider of providers) {
            if (!(provider.name in classProvider)) {
                Object.defineProperty(classProvider, provider.name, {
                    get() {
                        return provider.provide;
                    }
                });
            }

            if (!(provider.name in instanceProvider)) {
                Object.defineProperty(instanceProvider, provider.name, {
                    get() {
                        const injector = getOrCreateInjectorForModule(provider.module);
                        return injector.get(provider.provide);
                    }
                });
            }
        }

        for (const database of databaseRegistry.getDatabases()) {
            for (const entity of database.entityRegistry.all()) {
                Object.defineProperty(instanceProvider, entity.type.typeName!, {
                    get() {
                        return entity.getClassType();
                    }
                });
            }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global as any).$ = classProvider;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global as any).$$ = instanceProvider;

        return new Promise<void>(resolve => {
            const replServer = repl.start();
            replServer.on('exit', () => {
                resolve();
            });
        });
    }
}
