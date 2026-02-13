import { getClassName, isClass } from '@deepkit/core';
import { InjectorModule, isClassProvider, isExistingProvider, isFactoryProvider, isValueProvider } from '@deepkit/injector';
import { compact } from 'lodash';

export function getProviderTree(module: InjectorModule) {
    const result = compact(
        module.providers.map(p => {
            if (isClass(p)) {
                const name = getProviderName(p);
                if (name) {
                    return {
                        name,
                        module,
                        provide: p
                    };
                }
            } else if (isValueProvider(p) || isClassProvider(p) || isExistingProvider(p) || isFactoryProvider(p)) {
                if (p.scope) return null;

                const name = getProviderName(p.provide);
                if (name) {
                    return {
                        name,
                        module,
                        provide: p.provide
                    };
                }
            }
            return null;
        })
    );

    for (const anImport of module.imports) {
        result.push(...getProviderTree(anImport));
    }

    return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getProviderName(p: any) {
    if (typeof p === 'string') {
        return p;
    }
    const className = getClassName(p);
    return className !== 'undefined' && className !== 'anonymous class' ? className : null;
}
