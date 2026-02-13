import { uuid } from '@deepkit/type';
import { createHash } from 'crypto';
import { memoize } from 'lodash';

import { getAppConfig } from '../../app/resolver';
import { withSpan } from '../../telemetry';
import { ConcretePrimitive } from '../../types';
import { getPackageName } from '../io/package';
import { sleepMs } from '../utils/date';
import { createRedis } from './redis';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MutexFn<R = any> = (didWait: boolean) => Promise<R>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MutexKey = ConcretePrimitive | InstanceType<any>;

const getMutexHelpers = memoize(() => {
    const appConfig = getAppConfig();

    if (appConfig.MUTEX_MODE === 'local') {
        return {
            prepareKey: (k: string) => k,
            exec: localMutexExec
        };
    }

    const prefix = appConfig.MUTEX_REDIS_PREFIX ?? appConfig.REDIS_PREFIX ?? getPackageName() ?? 'app';
    return {
        prepareKey: (k: string) => `${prefix}:${k}`,
        exec: redisMutexExec
    };
});

interface IMutexOptions<T> {
    key: MutexKey | MutexKey[];
    fn: MutexFn<T>;
    retryCount?: number;
    retryDelay?: number;
    renewInterval?: number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DefaultMutexOptions: Partial<IMutexOptions<any>> = {
    retryCount: 30,
    retryDelay: 1000,
    renewInterval: 1000
};

export class MutexAcquisitionError extends Error {
    constructor(message?: string) {
        super(message ?? 'Failed to acquire mutex within timeout');
        this.name = 'MutexAcquisitionError';
    }
}

export function withMutex<T>(options: IMutexOptions<T>): Promise<T> {
    const flattenedKey = flattenMutexKey(options.key);
    const helpers = getMutexHelpers();
    const preparedKey = helpers.prepareKey(flattenedKey);
    return withSpan('mutex:requested', { key: flattenedKey }, () =>
        helpers.exec({
            ...DefaultMutexOptions,
            ...options,
            key: preparedKey,
            fn: (didWait: boolean) => withSpan('mutex:held', () => options.fn(didWait))
        })
    );
}

export function withMutexes<T>(options: Omit<IMutexOptions<T>, 'key'> & { keys: IMutexOptions<T>['key'][] }): Promise<T> {
    const currentKey = options.keys[0];
    const remainingKeys = options.keys.slice(1);

    let didAnyWait = false;
    return withMutex({
        ...options,
        key: currentKey,
        fn: didWait => {
            didAnyWait = didAnyWait || didWait;
            return remainingKeys.length ? withMutexes({ ...options, keys: remainingKeys }) : options.fn(didAnyWait);
        }
    });
}

/**
 * Local Mutex
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const localMutexes = new Map<string, Promise<any>>();
async function localMutexExec<T>(options: IMutexOptions<T>): Promise<T> {
    const hasMutex = localMutexes.has(options.key);

    if (localMutexes.has(options.key)) {
        // eslint-disable-next-line no-async-promise-executor
        await new Promise<void>(async (resolve, reject) => {
            let hasTimedOut = false;

            const timeout = setTimeout(() => {
                hasTimedOut = true;
                reject(new MutexAcquisitionError());
            }, options.retryDelay! * options.retryCount!);

            while (localMutexes.has(options.key)) {
                try {
                    await localMutexes.get(options.key);
                } catch {
                    /**/
                }
            }

            if (hasTimedOut) return;
            clearTimeout(timeout);

            resolve();
        });
    }

    const promise = new Promise<T>((resolve, reject) => {
        options
            .fn(hasMutex)
            .then(resolve)
            .catch(reject)
            .finally(() => {
                localMutexes.delete(options.key);
            });
    });
    localMutexes.set(options.key, promise);
    return promise;
}

/**
 * Redis Mutex
 */

// Redis scripts:
// ACQUIRE [key] [value] [ttl]
// RENEW [key] [value] [ttl]
// RELEASE [key] [value]
const ACQUIRE_SCRIPT = `
if redis.call("exists", KEYS[1]) == 1 then
    return 0
end
redis.call("set", KEYS[1], ARGV[1], "px", ARGV[2])
return 1
`;
const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) ~= ARGV[1] then
    return 0
end
redis.call("pexpire", KEYS[1], ARGV[2])
return 1
`;
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) ~= ARGV[1] then
    return 0
end
redis.call("del", KEYS[1])
return 1
`;

const getMutexRedisClient = memoize(() => {
    const { client } = createRedis('MUTEX');
    return client;
});

const getRedisClient = memoize(() => {
    const redisClient = getMutexRedisClient();
    redisClient.defineCommand('ACQUIRE', {
        lua: ACQUIRE_SCRIPT,
        numberOfKeys: 1
    });
    redisClient.defineCommand('RENEW', {
        lua: RENEW_SCRIPT,
        numberOfKeys: 1
    });
    redisClient.defineCommand('RELEASE', {
        lua: RELEASE_SCRIPT,
        numberOfKeys: 1
    });
    return redisClient as typeof redisClient & {
        ACQUIRE: (key: string, value: string, ttl: number) => Promise<number>;
        RENEW: (key: string, value: string, ttl: number) => Promise<number>;
        RELEASE: (key: string, value: string) => Promise<number>;
    };
});

async function redisMutexExec<T>(options: IMutexOptions<T>): Promise<T> {
    const lockId = uuid();
    const redisClient = getRedisClient();

    const lockTtl = options.renewInterval! * 3;
    const deadlineMs = Date.now() + options.retryCount! * options.retryDelay!;
    let attempts = 0;

    do {
        attempts++;
        const result = await redisClient.ACQUIRE(options.key, lockId, lockTtl);
        if (result === 0) {
            await sleepMs(options.retryDelay!);
            continue;
        }

        return new Promise<T>((resolve, reject) => {
            const interval = setInterval(() => {
                redisClient
                    .RENEW(options.key, lockId, lockTtl)
                    .then(result => {
                        if (result === 0) throw new MutexAcquisitionError('Key missing or value mismatch');
                    })
                    .catch(err => {
                        reject(new MutexAcquisitionError(`Failed to renew mutex ${options.key} ${lockId}: ${String(err)}`));
                    });
            }, options.renewInterval! / 2);

            options
                .fn(attempts > 1)
                .then(resolve)
                .catch(reject)
                .finally(() => {
                    clearInterval(interval);
                    redisClient
                        .RELEASE(options.key, lockId)
                        .then(result => {
                            if (result === 0) throw new MutexAcquisitionError('Key missing or value mismatch');
                        })
                        .catch(err => {
                            console.warn(`Failed to release mutex ${options.key} ${lockId}`, err);
                        });
                });
        });
    } while (Date.now() < deadlineMs);

    throw new MutexAcquisitionError();
}

/**
 * Helpers
 */

export function flattenMutexKey(key: MutexKey | MutexKey[]): string {
    if (Array.isArray(key)) {
        return key.map(k => flattenMutexKey(k)).join(':');
    }

    if (typeof key === 'object') {
        if ('name' in key) {
            return key.name;
        }

        if ('constructor' in key) {
            return key.constructor.name;
        }

        const jsonKey = JSON.stringify(key);
        const objectKey = jsonKey.length === 2 ? String(key) : jsonKey;
        return createHash('md5').update(objectKey).digest('hex');
    }

    return String(key);
}
