import { ClassType } from '@deepkit/core';
import { HttpRequest, RouteParameterResolver, RouteParameterResolverContext } from '@deepkit/http';

type CacheKey = string | symbol | object;
const ObjectRefSymbol = Symbol('ObjectRef');

/**
 * Key generator
 */
export function getCompositeCacheKey(target: ClassType, key: symbol) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((target as any)[key] === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (target as any)[key] = Symbol(`${target.name}_${key.description}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (target as any)[key];
}

/**
 * Cache implementation
 */
type ValueResolver<T> = (request: HttpRequest) => Promise<T>;
export async function getOrCacheValue<T>(request: HttpRequest, key: CacheKey, resolver: ValueResolver<T>): Promise<T> {
    if (typeof key === 'function' || typeof key === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (request.store[ObjectRefSymbol as any] === undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            request.store[ObjectRefSymbol as any] = new Map<object, T>();
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map: Map<object, T> = request.store[ObjectRefSymbol as any];
        if (!map.has(key)) {
            const value = await resolver(request);
            map.set(key, value);
            return value;
        }
        return map.get(key) as T;
    } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (request.store[key as any] === undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            request.store[key as any] = await resolver(request);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return request.store[key as any];
    }
}

export function getCachedValue<T>(request: HttpRequest, key: CacheKey): T | undefined {
    const isObjectRefKey = typeof key === 'function' || typeof key === 'object';
    const resolvedKey = isObjectRefKey ? ObjectRefSymbol : key;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawValue = request.store[resolvedKey as any];
    return isObjectRefKey ? rawValue.get(key) : rawValue;
}

export function getCachedValueOrThrow<T>(request: HttpRequest, key: CacheKey): T {
    const value = getCachedValue<T>(request, key);
    if (value === undefined) throw new Error(`Request does not contain cached value [${String(key)}]`);
    return value;
}

/**
 * Generic store value resolver
 * Requires a previous listener to have attached data to the store
 */
export function createCachedValueResolver<T>(key: string | symbol | object, isRequired = true) {
    const getter = isRequired ? getCachedValueOrThrow : getCachedValue;
    return class implements RouteParameterResolver {
        async resolve(context: RouteParameterResolverContext): Promise<T | undefined> {
            return getter(context.request, key) ?? undefined;
        }
    };
}

/**
 * Generic store value resolver with cache miss lookup
 */
export function createCachingParameterResolver<T>(key: string | symbol | object, lookupFn: (context: RouteParameterResolverContext) => Promise<T>) {
    return class implements RouteParameterResolver {
        async resolve(context: RouteParameterResolverContext): Promise<T | undefined> {
            return getOrCacheValue(context.request, key, async () => lookupFn(context));
        }
    };
}
