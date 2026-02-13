import { AsyncLocalStorage } from 'async_hooks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SimpleStore = { [name: string | symbol]: any };

const context = new AsyncLocalStorage<SimpleStore>();

export function getContext(): SimpleStore | undefined {
    return context.getStore();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getContextProp<T = any>(name: string): T | undefined {
    return getContext()?.[name];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setContextProp<T = any>(name: string, value: T): void {
    const context = getContext();
    if (context) {
        context[name] = value;
    }
}

export function removeContextProp(name: string): void {
    const context = getContext();
    if (context) {
        delete context[name];
    }
}

export async function withContext<T>(cb: () => Promise<T>) {
    const existingContext = getContext();
    if (existingContext) {
        return cb();
    }

    return new Promise<T>((resolve, reject) => {
        context.run({}, () => {
            cb()
                .then((result: T) => resolve(result))
                .catch(e => reject(e));
        });
    });
}

export async function withContextData<T>(data: SimpleStore, cb: () => Promise<T>) {
    return withContext(async () => {
        const context = getContext()!;

        const dataKeys = [...Object.getOwnPropertyNames(data), ...Object.getOwnPropertySymbols(data)];
        const overwriteKeys = dataKeys.filter(key => key in context);
        const overwriteValues = overwriteKeys.map(key => context[key]);

        Object.assign(context, data);
        try {
            return await cb();
        } finally {
            for (const key of dataKeys) {
                delete context[key];
            }
            for (let i = 0; i < overwriteKeys.length; i++) {
                context[overwriteKeys[i]] = overwriteValues[i];
            }
        }
    });
}
