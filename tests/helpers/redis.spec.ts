import { describe, it, before, after } from 'node:test';

import { TestingHelpers } from '../../src';
import { createRedisOptions } from '../../src/helpers/redis/redis';
import { assertMatchObject } from '../shared/helpers';

describe('Redis Helpers', () => {
    const tf = TestingHelpers.createTestingFacade({
        defaultConfig: {
            REDIS_HOST: 'localhost',
            REDIS_PORT: 6379,
            BULL_REDIS_HOST: 'anotherhost',
            BULL_REDIS_PORT: 6380,
            MUTEX_REDIS_SENTINEL_HOST: 'sentinelhost',
            MUTEX_REDIS_SENTINEL_PORT: 26379,
            MUTEX_REDIS_SENTINEL_NAME: 'redis-0'
        }
    });
    before(() => tf.start());
    after(() => tf.stop());

    it('creates a Redis client with generic config', () => {
        const { options } = createRedisOptions();
        assertMatchObject(options, {
            host: process.env.REDIS_HOST ?? 'localhost',
            port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379
        });
    });

    it('prioritizes scoped config over generic', async () => {
        const { options } = createRedisOptions('BULL');
        assertMatchObject(options, {
            host: 'anotherhost',
            port: 6380
        });
    });

    it('prioritizes sentinel config over regular', async () => {
        const { options } = createRedisOptions('MUTEX');
        assertMatchObject(options, {
            sentinels: [
                {
                    host: 'sentinelhost',
                    port: 26379
                }
            ],
            name: 'redis-0'
        });
    });
});
