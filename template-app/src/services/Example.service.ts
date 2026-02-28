import { ScopedLogger } from '@deepkit/logger';
import { createPersistedEntity } from '@zyno-io/dk-server-foundation';

import { DB } from '../database';
import { ExampleEntity } from '../entities/Example.entity';

export class ExampleService {
    constructor(
        private db: DB,
        private logger: ScopedLogger
    ) {}

    async findAll(): Promise<ExampleEntity[]> {
        return ExampleEntity.query().find();
    }

    async create(name: string): Promise<ExampleEntity> {
        this.logger.info(`Creating example: ${name}`);
        return createPersistedEntity(ExampleEntity, { name });
    }
}
