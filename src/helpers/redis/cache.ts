import { memoize } from 'lodash';

import { createRedis } from './redis';

const getRedis = memoize(() => createRedis('CACHE'));

export class Cache {
    static async get(key: string): Promise<string | null> {
        const { client, prefix } = getRedis();
        return client.get(`${prefix}:cache:${key}`);
    }

    static async set(key: string, value: string, ttl = 60): Promise<void> {
        const { client, prefix } = getRedis();
        await client.set(`${prefix}:cache:${key}`, value, 'EX', ttl);
    }

    static async getObj<T>(key: string): Promise<T | null> {
        const { client, prefix } = getRedis();
        const value = await client.get(`${prefix}:cache:${key}`);
        return value ? JSON.parse(value) : null;
    }

    static async setObj<T>(key: string, value: T, ttl = 60): Promise<void> {
        const { client, prefix } = getRedis();
        await client.set(`${prefix}:cache:${key}`, JSON.stringify(value), 'EX', ttl);
    }
}
