import { cli } from '@deepkit/app';
import { InjectorError } from '@deepkit/injector';
import { DatabaseRegistry } from '@deepkit/orm';
import { ReflectionClass } from '@deepkit/type';

import { getAppModule, getOrCreateInjectorForModule, r } from '../../app/resolver';
import { getProviderTree } from '../../helpers/framework/injection';

@cli.controller('provider:invoke', {
    description: 'Invoke a function in any registered provider'
})
export class ProviderInvokeCommand {
    constructor() {}

    async execute(providerName: string, methodName: string, argsJson?: string) {
        const providers = getProviderTree(getAppModule());
        const provider = providers.find(p => p.name === providerName);

        if (!provider) {
            throw new InjectorError(`Provider ${providerName} not found.`);
        }

        const resolved = getOrCreateInjectorForModule(provider.module).get(provider.provide);
        const resolvedType = ReflectionClass.from(resolved);
        if (!resolvedType.hasMethod(methodName)) {
            throw new InjectorError(`Provider ${providerName} does not have method ${methodName}.`);
        }

        const args = argsJson ? JSON.parse(argsJson) : [];

        // DK lazily starts the database registry, but we don't have any calls that
        // would cause that. without the registry, the application shutdown hook to
        // disconect from the database is never executed. thus, we'll invoke this manually.
        r(DatabaseRegistry).init();

        // eslint-disable-next-line prefer-spread, @typescript-eslint/no-explicit-any
        return resolved[methodName].apply(resolved, args as any);
    }
}
