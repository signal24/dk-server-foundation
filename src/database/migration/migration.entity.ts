import { entity, PrimaryKey } from '@deepkit/type';

import { BaseEntity } from '../entity';

@entity.name('_migrations')
export class MigrationEntity extends BaseEntity {
    name!: string & PrimaryKey;
    executedAt!: Date;
    durationMs!: number;
}
