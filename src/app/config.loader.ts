import { AppModule } from '@deepkit/app';
import { ReflectionClass } from '@deepkit/type';
import { loadConfig } from '@zyno-io/config';
import { existsSync } from 'fs';
import { compact } from 'lodash';

import { isTest } from './const';

export class CustomConfigLoader {
    private configLoaded = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(private defaultConfig?: { [p: string]: any }) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    load(_module: AppModule<any>, config: { [p: string]: any }, schema: ReflectionClass<any>) {
        if (this.configLoaded) {
            return;
        }

        if (this.defaultConfig) {
            Object.assign(config, this.defaultConfig);
        }

        const loadedConfig = this.loadConfigObject();

        // copy the keys from the schema over, and DK will validate it after
        for (const prop of schema.getProperties()) {
            if (prop.name in loadedConfig) {
                config[prop.name] = loadedConfig[prop.name];
            }
        }

        this.configLoaded = true;
    }

    protected loadConfigObject() {
        if (!process.env.APP_ENV) {
            if (process.argv.includes('--test')) {
                process.env.APP_ENV = 'test';
            } else {
                throw new Error('APP_ENV must be specified in the environment');
            }
        }

        const cwd = process.cwd();
        const configFiles = compact([
            `.env`,
            `.env.local`,
            isTest && `.env.development`,
            isTest && `.env.development.local`,
            `.env.${process.env.APP_ENV}`,
            `.env.${process.env.APP_ENV}.local`
        ]);
        const configPaths = configFiles.map(file => `${cwd}/${file}`);
        const validConfigPaths = configPaths.filter(path => existsSync(path));

        if (validConfigPaths.length === 0) {
            return process.env;
        }

        return loadConfig({
            file: validConfigPaths
        });
    }
}
