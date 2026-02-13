import RedisClient, { RedisOptions } from 'ioredis';

import { getAppConfig } from '../../app/resolver';
import { getPackageName } from '../io/package';

export function createRedisOptions(configPrefix?: string): { options: RedisOptions; prefix: string } {
    const config = { ...getAppConfig() };

    if (configPrefix) {
        for (const key in config) {
            if (key.startsWith(`${configPrefix}_REDIS_`)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (config as any)[key.substring(configPrefix.length + 1)] = (config as any)[key];
            }
        }
    }

    const prefix = config.REDIS_PREFIX ?? getPackageName() ?? 'app';

    if (config.REDIS_SENTINEL_HOST) {
        const options: RedisOptions = {
            sentinels: [
                {
                    host: config.REDIS_SENTINEL_HOST,
                    port: config.REDIS_SENTINEL_PORT
                }
            ],
            name: config.REDIS_SENTINEL_NAME
        };
        return { options, prefix };
    }

    if (config.REDIS_HOST) {
        const options: RedisOptions = { host: config.REDIS_HOST, port: config.REDIS_PORT };
        return { options, prefix };
    }

    throw new Error('REDIS_HOST or REDIS_SENTINEL_HOST must be configured');
}

const allClients = new Set<RedisClient>();

export function createRedis(configPrefix?: string): {
    client: RedisClient;
    prefix: string;
} {
    const { options, prefix } = createRedisOptions(configPrefix);
    const client = new RedisClient(options);
    allClients.add(client);
    client.on('end', () => allClients.delete(client));
    return { client, prefix };
}

export async function disconnectAllRedis(): Promise<void> {
    const clients = [...allClients];
    allClients.clear();
    await Promise.all(clients.map(c => c.quit().catch(() => {})));
}

// todo: register Redis instances with healthcheck controller
