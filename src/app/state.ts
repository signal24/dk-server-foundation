import { App } from '@deepkit/app';
import { ClassType } from '@deepkit/core';
import { ReflectionClass, Type } from '@deepkit/type';

import type { BaseDatabase } from '../database';

export const globalState: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currentApp?: App<any>;
    enableWorker?: boolean;
    isCliService?: boolean;
    dbClass?: ClassType<BaseDatabase>;
    // oxlint-disable-next-line typescript/no-explicit-any
    additionalEntities: (Type | ClassType | ReflectionClass<any>)[];
} = { additionalEntities: [] };

export class DBProvider {
    constructor(public db: BaseDatabase) {}
}
